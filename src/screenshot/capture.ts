/** 截图：本地静态服务 + Playwright Chromium。 */

import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.js';
import { LayoutError } from '../errors.js';
import { log } from '../logger.js';
import { addScreenshot, artifactUri, createArtifact, readArtifact } from '../artifacts.js';
import { assertPublicHttpUrl } from '../security/paths.js';
import { getBrowser } from './browser.js';
import { startStaticServer } from './static-server.js';

export type ViewportInput =
  | 'desktop'
  | 'tablet'
  | 'mobile'
  | { width: number; height: number };

export interface ScreenshotOptions {
  artifactId?: string;
  html?: string;
  url?: string;
  viewport?: ViewportInput;
  fullPage?: boolean;
  selector?: string;
  waitForSelector?: string;
  waitMs?: number;
  colorScheme?: 'light' | 'dark' | 'no-preference';
  reducedMotion?: 'reduce' | 'no-preference';
  clip?: { x: number; y: number; width: number; height: number };
  title?: string;
  /** 已由调用方创建的 artifact（preview_and_screenshot）。 */
  existingArtifactId?: string;
}

export interface ScreenshotResult {
  ok: true;
  artifactId: string;
  screenshotPath: string;
  resourceUri: string;
  url: string;
  width: number;
  height: number;
  fullPage: boolean;
  viewport: { width: number; height: number };
  consoleErrors: Array<{ type: string; text: string }>;
  pageErrors: string[];
  durationMs: number;
}

export function resolveViewport(input?: ViewportInput): { width: number; height: number } {
  if (!input) return CONFIG.screenshots.viewports.desktop;
  if (typeof input === 'string') {
    const preset = CONFIG.screenshots.viewports[input as keyof typeof CONFIG.screenshots.viewports];
    if (!preset) {
      throw new LayoutError('INVALID_INPUT', `未知视口预设: ${input}`, {
        hint: '可用 desktop / tablet / mobile 或 { width, height }。',
      });
    }
    return preset;
  }
  const { width, height } = input;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 100 || height < 100 || width > 5000 || height > 8000) {
    throw new LayoutError('INVALID_INPUT', `非法视口: ${width}x${height}`, {
      hint: '宽高须为 100–5000 / 100–8000 的整数。',
    });
  }
  return { width, height };
}

/** 从 PNG IHDR 读取像素尺寸。 */
export function pngSize(file: string): { width: number; height: number } {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(24);
    fs.readSync(fd, buf, 0, 24, 0);
    if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not png');
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } finally {
    fs.closeSync(fd);
  }
}

export async function captureScreenshot(options: ScreenshotOptions): Promise<ScreenshotResult> {
  const viewport = resolveViewport(options.viewport);
  const artifactSource = options.artifactId ?? options.existingArtifactId;
  const sources = [artifactSource, options.html, options.url].filter(Boolean);
  if (sources.length === 0) {
    throw new LayoutError('INVALID_INPUT', '必须提供 artifactId、html 或 url 之一');
  }
  if (sources.length > 1) {
    throw new LayoutError('INVALID_INPUT', 'artifactId / html / url 只能提供一个');
  }
  if (options.selector && options.clip) {
    throw new LayoutError('INVALID_INPUT', 'selector 与 clip 不能同时使用');
  }

  let artifactId: string;
  let targetUrl: string;
  let server: Awaited<ReturnType<typeof startStaticServer>> | null = null;

  if (options.url) {
    const publicUrl = await assertPublicHttpUrl(options.url);
    targetUrl = publicUrl.href;
    if (options.existingArtifactId) {
      artifactId = options.existingArtifactId;
    } else {
      // 外部 URL 也需要一个 artifact 承载截图与 resource URI
      const created = createArtifact({
        html: `<!doctype html><meta charset="utf-8"><title>${options.title ?? 'remote'}</title><p>Remote screenshot: ${publicUrl.href}</p>`,
        title: options.title ?? 'remote screenshot',
        viewport,
      });
      artifactId = created.id;
    }
  } else if (options.html) {
    if (options.existingArtifactId) {
      const { dir } = readArtifact(options.existingArtifactId);
      fs.writeFileSync(path.join(dir, 'index.html'), options.html, 'utf8');
      artifactId = options.existingArtifactId;
    } else {
      const created = createArtifact({ html: options.html, title: options.title ?? 'inline html', viewport });
      artifactId = created.id;
    }
    server = await startStaticServer(CONFIG.artifacts.dir);
    targetUrl = `${server.origin}/${artifactId}/index.html`;
  } else {
    artifactId = artifactSource!;
    readArtifact(artifactId);
    server = await startStaticServer(CONFIG.artifacts.dir);
    targetUrl = `${server.origin}/${artifactId}/index.html`;
  }

  const started = Date.now();
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    colorScheme: options.colorScheme ?? 'light',
    reducedMotion: options.reducedMotion ?? 'reduce',
  });
  const consoleErrors: Array<{ type: string; text: string }> = [];
  const pageErrors: string[] = [];
  let screenshotPath = '';
  try {
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push({ type: msg.type(), text: msg.text() });
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await page.goto(targetUrl, {
        waitUntil: 'networkidle',
        timeout: CONFIG.screenshots.timeoutMs,
      });
    } catch (e) {
      const message = (e as Error).message;
      if (/timeout/i.test(message)) {
        throw new LayoutError('SCREENSHOT_TIMEOUT', `页面加载超时: ${targetUrl}`, {
          hint: '检查远程资源（字体/图片）是否阻塞，或减少 waitMs。',
          retryable: true,
        });
      }
      throw new LayoutError('NETWORK_ERROR', `截图页面加载失败: ${message}`);
    }

    await page.evaluate(() => document.fonts.ready.then(() => true));
    if (options.waitForSelector) {
      try {
        await page.waitForSelector(options.waitForSelector, {
          state: 'visible',
          timeout: Math.min(CONFIG.screenshots.timeoutMs, 15_000),
        });
      } catch {
        throw new LayoutError('SCREENSHOT_TIMEOUT', `等待选择器超时: ${options.waitForSelector}`, {
          retryable: true,
        });
      }
    }
    if (options.waitMs && options.waitMs > 0) {
      await page.waitForTimeout(Math.min(options.waitMs, 60_000));
    }

    const { dir } = readArtifact(artifactId);
    screenshotPath = path.join(dir, 'screenshot.png');
    let elementSize: { width: number; height: number } | null = null;
    if (options.selector) {
      const locator = page.locator(options.selector).first();
      const box = await locator.boundingBox();
      if (!box) {
        throw new LayoutError('SCREENSHOT_TIMEOUT', `选择器无可截图区域: ${options.selector}`);
      }
      elementSize = { width: Math.round(box.width), height: Math.round(box.height) };
      await locator.screenshot({
        path: screenshotPath,
        animations: 'disabled',
        caret: 'hide',
        timeout: CONFIG.screenshots.timeoutMs,
      });
    } else {
      await page.screenshot({
        path: screenshotPath,
        fullPage: Boolean(options.fullPage),
        animations: 'disabled',
        caret: 'hide',
        ...(options.clip ? { clip: options.clip } : {}),
        timeout: CONFIG.screenshots.timeoutMs,
      });
    }

    let size: { width: number; height: number };
    try {
      size = pngSize(screenshotPath);
    } catch {
      size = elementSize ?? { width: viewport.width, height: viewport.height };
    }
    addScreenshot(artifactId, 'screenshot.png', { width: size.width, height: size.height });

    return {
      ok: true,
      artifactId,
      screenshotPath,
      resourceUri: artifactUri(artifactId, 'screenshot.png'),
      url: targetUrl,
      width: size.width,
      height: size.height,
      fullPage: Boolean(options.fullPage),
      viewport,
      consoleErrors,
      pageErrors,
      durationMs: Date.now() - started,
    };
  } catch (e) {
    if (e instanceof LayoutError) throw e;
    const message = (e as Error).message;
    if (/timeout/i.test(message)) {
      throw new LayoutError('SCREENSHOT_TIMEOUT', `截图超时: ${message}`, { retryable: true });
    }
    log.error(`截图失败: ${message}`);
    throw new LayoutError('INTERNAL_ERROR', `截图失败: ${message}`);
  } finally {
    try {
      await context.close();
    } catch {
      /* ignore */
    }
    if (server) await server.close();
  }
}
