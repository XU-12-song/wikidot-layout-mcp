/**
 * Wikidot 整页外壳（#container）。
 *
 * 版式设计必须作用在真实结构上：header / top-bar / side-bar / main-content /
 * page-title / page-content / page-options / footer。这里提供两种来源：
 *   - site：匿名抓取 https://<site>.wikidot.com/_template，解析 #container
 *   - builtin：内置的沙盒站结构（离线可用）
 * 与 ftml-cli 的 getSiteLayout 同思路，但只保留渲染所需部分。
 */

import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { CONFIG, PACKAGE_ROOT } from '../config.js';
import { LayoutError } from '../errors.js';
import { log } from '../logger.js';
import { normalizeSite, wikidotOrigin } from '../security/paths.js';
import { readJsonFile, writeJsonFile } from '../storage/json-cache.js';
import { fetchWithTimeout } from '../util/concurrency.js';

export type ShellMode = 'site' | 'builtin' | 'none';

export const TITLE_MARKER = '<!--LAYOUT_TITLE-->';
export const CONTENT_MARKER = '<!--LAYOUT_CONTENT-->';

export interface ShellResult {
  mode: ShellMode;
  source: 'site' | 'builtin' | null;
  html: string | null;
  warning: string | null;
}

interface LayoutCacheEntry {
  v: 1;
  site: string;
  fetchedAt: number;
  containerHtml: string;
}

const BUILTIN_SHELL = path.join(PACKAGE_ROOT, 'src', 'render', 'shells', 'scpsandboxcn.html');

function cachePath(site: string): string {
  return path.join(CONFIG.layout.cacheDir, `${site}.json`);
}

function wrapContainer(containerHtml: string): string {
  return `<div id="container-wrap-wrap">
  <div id="container-wrap">
    ${containerHtml}
    <div id="extra-div-1"><span></span></div>
    <div id="extra-div-2"><span></span></div>
    <div id="extra-div-3"><span></span></div>
  </div>
</div>`;
}

function readBuiltin(): string {
  try {
    const html = fs.readFileSync(BUILTIN_SHELL, 'utf8');
    return wrapContainer(html);
  } catch (e) {
    throw new LayoutError('RENDER_FAILED', `无法读取内置页面外壳: ${(e as Error).message}`);
  }
}

function absolutize(ref: string, site: string): string {
  if (!ref || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) return ref;
  try {
    return new URL(ref, `${wikidotOrigin(site)}/`).href;
  } catch {
    return ref;
  }
}

/** `_template` HTML → 带标题/正文 marker 的 #container。 */
export function parseTemplateHtml(siteInput: string, html: string): string {
  const site = normalizeSite(siteInput);
  const $ = cheerio.load(html);
  const container = $('#container').first();
  if (!container.length) throw new Error('_template 缺少 #container');

  const content = container.find('#page-content').first();
  if (!content.length) throw new Error('_template 缺少 #page-content');

  if (!container.find('#page-title').length) {
    content.before('<div id="page-title"></div>');
  }
  container.find('#page-title').first().html(TITLE_MARKER);
  content.html(CONTENT_MARKER);

  // 顶栏文本节点补 <a>（Wikidot 运行时由 fixMenuList 完成）
  container.find('#top-bar li').each((_, el) => {
    const li = $(el);
    const first = (el as { firstChild?: AnyNode }).firstChild;
    if (!first || first.type !== 'text' || !first.data) return;
    const anchor = $('<a href="#"></a>');
    li.prepend(anchor);
    anchor.append(first);
  });

  container.find('script').remove();
  container.find('*').add(container).each((_, el) => {
    const attribs = (el as { attribs?: Record<string, string> }).attribs;
    if (!attribs) return;
    for (const attr of Object.keys(attribs)) {
      if (/^on/i.test(attr)) {
        delete attribs[attr];
        continue;
      }
      if (attr === 'href' && /^\s*javascript:/i.test(attribs[attr])) {
        // 折叠块链接保留，其余去掉不可执行的 javascript:
        if (!/collapsible-block-link/.test(attribs.class ?? '')) {
          delete attribs[attr];
          continue;
        }
      }
      if (attr === 'href' || attr === 'src' || attr === 'action') {
        const value = attribs[attr];
        if (typeof value === 'string') attribs[attr] = absolutize(value, site);
      }
    }
  });

  const outer = $.html(container);
  if (!outer) throw new Error('_template 序列化失败');
  return wrapContainer(outer);
}

function readCache(site: string): LayoutCacheEntry | null {
  const entry = readJsonFile<LayoutCacheEntry>(cachePath(site));
  if (!entry || entry.v !== 1 || entry.site !== site || !entry.containerHtml) return null;
  return entry;
}

async function fetchSiteContainer(site: string): Promise<string> {
  const url = `${wikidotOrigin(site)}/_template`;
  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        'User-Agent': 'wikidot-layout-mcp/0.1',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    },
    CONFIG.source.timeoutMs
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  if (!html.trim()) throw new Error('空响应');
  return parseTemplateHtml(site, html);
}

async function loadSiteShell(
  siteInput: string,
  forceRefresh: boolean
): Promise<{ html: string; warning: string | null }> {
  const site = normalizeSite(siteInput);
  const cached = readCache(site);
  const fresh = cached && Date.now() - cached.fetchedAt < CONFIG.layout.ttlMs;
  if (cached && fresh && !forceRefresh) return { html: cached.containerHtml, warning: null };

  try {
    const html = await fetchSiteContainer(site);
    writeJsonFile(cachePath(site), {
      v: 1,
      site,
      fetchedAt: Date.now(),
      containerHtml: html,
    } satisfies LayoutCacheEntry);
    return { html, warning: null };
  } catch (e) {
    const message = (e as Error)?.message ?? String(e);
    log.warn(`获取 _template 失败 ${site}: ${message}`);
    if (cached) {
      return {
        html: cached.containerHtml,
        warning: `_template 刷新失败，使用过期缓存：${message}`,
      };
    }
    return { html: readBuiltin(), warning: `_template 获取失败，回退内置外壳：${message}` };
  }
}

export async function resolveShell({
  mode,
  site,
  forceRefresh = false,
}: {
  mode: ShellMode;
  site?: string | null;
  forceRefresh?: boolean;
}): Promise<ShellResult> {
  if (mode === 'none') {
    return { mode, source: null, html: null, warning: null };
  }
  if (mode === 'builtin') {
    return { mode, source: 'builtin', html: readBuiltin(), warning: null };
  }
  if (!site) {
    return {
      mode: 'builtin',
      source: 'builtin',
      html: readBuiltin(),
      warning: '未提供 site，使用内置外壳',
    };
  }
  const loaded = await loadSiteShell(site, forceRefresh);
  const fromSite = !loaded.warning || !loaded.warning.startsWith('_template 获取失败');
  return {
    mode: 'site',
    source: fromSite ? 'site' : 'builtin',
    html: loaded.html,
    warning: loaded.warning,
  };
}

/** 把标题与正文注入外壳 marker。 */
export function applyShell(shellHtml: string, title: string, content: string): string {
  return shellHtml
    .replace(TITLE_MARKER, () => title)
    .replace(CONTENT_MARKER, () => content);
}

/** 清空布局缓存（测试用）。 */
export function clearShellCache(): void {
  fs.rmSync(CONFIG.layout.cacheDir, { recursive: true, force: true });
}
