/** 复用本机 Chrome/Edge/Chromium，不下载 playwright 浏览器包。 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium, type Browser } from 'playwright-core';
import { CONFIG } from '../config.js';
import { LayoutError } from '../errors.js';
import { log } from '../logger.js';

function candidates(): string[] {
  if (CONFIG.browser.executablePath) return [CONFIG.browser.executablePath];
  const home = os.homedir();
  const list: string[] = [];
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    const local = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
    list.push(
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    );
  } else if (process.platform === 'darwin') {
    list.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    );
  } else {
    list.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium'
    );
    for (const bin of ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge']) {
      try {
        const which = spawnSync('which', [bin], { encoding: 'utf8' });
        const found = which.stdout?.trim();
        if (found) list.push(found);
      } catch {
        /* ignore */
      }
    }
  }
  return list;
}

export function resolveExecutable(): string {
  for (const candidate of candidates()) {
    try {
      if (candidate && fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* 继续 */
    }
  }
  throw new LayoutError('BROWSER_NOT_FOUND', '未找到本机 Chrome / Edge / Chromium 可执行文件', {
    hint: '安装 Chrome 或 Edge，或设置环境变量 CHROME_PATH 指向可执行文件。',
  });
}

let browserPromise: Promise<Browser> | null = null;

/** 截图页面里的远程资源（主题图片、字体）也走同一代理。 */
function browserProxy(): { server: string; bypass: string } | undefined {
  if (process.env.WIKIDOT_LAYOUT_DISABLE_PROXY === '1') return undefined;
  const server =
    process.env.WIKIDOT_LAYOUT_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;
  if (!server) return undefined;
  return {
    server,
    bypass: process.env.NO_PROXY || process.env.no_proxy || 'localhost,127.0.0.1,::1',
  };
}

export async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const executablePath = resolveExecutable();
    const proxy = browserProxy();
    log.info(`使用浏览器: ${executablePath}${proxy ? '（启用代理）' : ''}`);
    browserPromise = chromium
      .launch({
        executablePath,
        headless: CONFIG.browser.headless,
        args: ['--disable-dev-shm-usage', '--disable-background-networking'],
        ...(proxy ? { proxy } : {}),
      })
      .catch((e: Error) => {
        browserPromise = null;
        throw new LayoutError('BROWSER_NOT_FOUND', `浏览器启动失败: ${e.message}`, {
          hint: `确认 CHROME_PATH 可执行且未被策略禁止。当前路径：${executablePath}`,
        });
      });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  const current = browserPromise;
  browserPromise = null;
  if (!current) return;
  try {
    const browser = await current;
    await browser.close();
  } catch {
    /* 退出阶段忽略 */
  }
}
