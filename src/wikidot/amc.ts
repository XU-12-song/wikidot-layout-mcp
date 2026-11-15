/**
 * 直接调用 Wikidot AMC 获取源码弹层（库行为变更时的备选方案）。
 *
 * 流程（已用公开页面验证）：
 *   1. GET 页面 HTML，提取 pageId 与 wikidot_token7
 *   2. POST /ajax-module-connector.php，moduleName=viewsource/ViewSourceModule
 *   3. cheerio 解析返回 body 中的 div.page-source
 *
 * Cookie 文件：仅服务端 WIKIDOT_COOKIE_FILE 指定时读取（Netscape 或 JSON），
 * 用于私有页面。工具参数永远不接收 Cookie。
 */

import fs from 'node:fs';
import * as cheerio from 'cheerio';
import { CONFIG } from '../config.js';
import { LayoutError } from '../errors.js';
import { fetchWithTimeout } from '../util/concurrency.js';
import { normalizePage, normalizeSite, pageUrl } from '../security/paths.js';

export interface AmcSourceResult {
  source: string;
  pageId: number | null;
  title: string | null;
}

interface Cookie {
  name: string;
  value: string;
}

function parseCookieLine(line: string): Cookie | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  // Netscape: domain flag path secure expires name value
  const parts = trimmed.split('\t');
  if (parts.length >= 7) return { name: parts[5], value: parts[6] };
  // name=value
  const eq = trimmed.indexOf('=');
  if (eq <= 0) return null;
  return { name: trimmed.slice(0, eq).trim(), value: trimmed.slice(eq + 1).trim() };
}

/** 读取服务端预配置 Cookie 文件。 */
export function loadCookieFile(): Cookie[] {
  const file = CONFIG.privateAccess.cookieFile;
  if (!file) return [];
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new LayoutError('SOURCE_FORBIDDEN', `无法读取 Cookie 文件: ${(e as Error).message}`);
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((c) => ({ name: String(c.name ?? ''), value: String(c.value ?? '') }))
        .filter((c) => c.name);
    }
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed).map(([name, value]) => ({ name, value: String(value) }));
    }
  } catch {
    // 不是 JSON → 按 Netscape 文本处理
  }
  return raw
    .split(/\r?\n/)
    .map(parseCookieLine)
    .filter((c): c is Cookie => Boolean(c?.name));
}

function cookieHeader(cookies: Cookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

function mergeSetCookies(headers: Headers, jar: Cookie[]): void {
  const setCookies = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  for (const header of setCookies) {
    const first = header.split(';')[0];
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    const existing = jar.find((c) => c.name === name);
    if (existing) existing.value = value;
    else jar.push({ name, value });
  }
}

function extractPageId(html: string): number | null {
  const patterns = [
    /pageId\s*=\s*(\d+)/,
    /page_id\s*[:=]\s*['"]?(\d+)/,
    /"pageId"\s*:\s*(\d+)/,
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m) return Number(m[1]);
  }
  return null;
}

function extractTitle(html: string): string | null {
  const $ = cheerio.load(html);
  const title = $('#page-title').first().text().trim() || $('title').first().text().trim();
  return title || null;
}

function extractToken7(html: string, jar: Cookie[]): string | null {
  const fromCookie = jar.find((c) => c.name === 'wikidot_token7')?.value;
  if (fromCookie) return fromCookie;
  const m = /wikidot_token7["']?\s*[:=]\s*["']?([A-Za-z0-9]+)/.exec(html);
  return m?.[1] ?? null;
}

const FORBIDDEN_RE = /permission|forbidden|not allowed|access denied|not authorized|无权|禁止/i;
const NOT_FOUND_RE = /does not exist|not found|deleted|不存在|已被删除|404/i;

/** 获取公开页面 HTML（结构分析用）。不请求 AMC 源码弹层。 */
export async function fetchPageHtml(
  siteInput: string,
  pageInput: string
): Promise<{ html: string; title: string | null; pageId: number | null }> {
  const site = normalizeSite(siteInput);
  const page = normalizePage(pageInput);
  const url = pageUrl(site, page);
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
  if (res.status === 404) throw new LayoutError('PAGE_NOT_FOUND', `页面不存在: ${site}:${page}`);
  if (res.status === 403) throw new LayoutError('SOURCE_FORBIDDEN', `没有读取权限: ${site}:${page}`);
  if (!res.ok) throw new LayoutError('NETWORK_ERROR', `Wikidot 返回 HTTP ${res.status}`);
  const html = await res.text();
  return { html, title: extractTitle(html), pageId: extractPageId(html) };
}

async function requestSourceOnce(
  site: string,
  page: string,
  jar: Cookie[],
  useCookieFile: boolean
): Promise<AmcSourceResult> {
  if (useCookieFile && jar.length === 0) {
    for (const c of loadCookieFile()) jar.push(c);
  }
  const url = pageUrl(site, page);
  const pageRes = await fetchWithTimeout(
    url,
    {
      headers: {
        'User-Agent': 'wikidot-layout-mcp/0.1',
        Accept: 'text/html,application/xhtml+xml',
        ...(jar.length ? { Cookie: cookieHeader(jar) } : {}),
      },
      redirect: 'follow',
    },
    CONFIG.source.timeoutMs
  );
  if (!pageRes.ok) {
    if (pageRes.status === 404) throw new LayoutError('PAGE_NOT_FOUND', `页面不存在: ${site}:${page}`);
    if (pageRes.status === 403) throw new LayoutError('SOURCE_FORBIDDEN', `没有读取权限: ${site}:${page}`);
    throw new LayoutError('NETWORK_ERROR', `Wikidot 返回 HTTP ${pageRes.status}`);
  }
  const html = await pageRes.text();
  mergeSetCookies(pageRes.headers, jar);

  const pageId = extractPageId(html);
  const token7 = extractToken7(html, jar);
  if (!pageId) {
    if (NOT_FOUND_RE.test(html) && !/#page-content/i.test(html)) {
      throw new LayoutError('PAGE_NOT_FOUND', `页面不存在或未渲染: ${site}:${page}`);
    }
    throw new LayoutError('SOURCE_PARSE_FAILED', `无法从页面 HTML 提取 pageId: ${site}:${page}`);
  }
  if (!token7) {
    throw new LayoutError('SOURCE_PARSE_FAILED', '无法获取 wikidot_token7（Cookie 被禁用或页面结构变化）');
  }

  const origin = new URL(url).origin;
  const body = new URLSearchParams({
    moduleName: 'viewsource/ViewSourceModule',
    page_id: String(pageId),
    wikidot_token7: token7,
  });
  const res = await fetchWithTimeout(
    `${origin}/ajax-module-connector.php`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': 'wikidot-layout-mcp/0.1',
        Referer: url,
        Cookie: cookieHeader([...jar.filter((c) => c.name !== 'wikidot_token7'), { name: 'wikidot_token7', value: token7 }]),
      },
      body: body.toString(),
    },
    CONFIG.source.timeoutMs
  );
  if (!res.ok) throw new LayoutError('NETWORK_ERROR', `AMC 返回 HTTP ${res.status}`);
  let json: { status?: string; body?: string; message?: string };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    throw new LayoutError('SOURCE_PARSE_FAILED', 'AMC 响应不是 JSON');
  }
  if (json.status === 'wrong_token7') {
    const err = new LayoutError('NETWORK_ERROR', 'AMC token7 失效', { retryable: true });
    (err as LayoutError & { code2?: string }).code2 = 'wrong_token7';
    throw err;
  }
  if (json.status !== 'ok') {
    const message = json.message ?? json.status ?? 'unknown';
    if (NOT_FOUND_RE.test(message)) throw new LayoutError('PAGE_NOT_FOUND', `页面不存在: ${site}:${page}`);
    throw new LayoutError('SOURCE_FORBIDDEN', `AMC 拒绝读取: ${message}`);
  }
  const $ = cheerio.load(json.body ?? '');
  const sourceNode = $('div.page-source').first();
  if (!sourceNode.length) {
    const text = $.root().text();
    if (FORBIDDEN_RE.test(text)) throw new LayoutError('SOURCE_FORBIDDEN', '该页面不允许读取源码');
    throw new LayoutError('SOURCE_PARSE_FAILED', 'AMC 响应中缺少 div.page-source');
  }
  const source = sourceNode.text().replace(/\u00a0/g, ' ').replace(/^\n+|\n+$/g, '');
  return { source, pageId, title: extractTitle(html) };
}

/** 通过 AMC 获取源码；wrong_token7 时重新 GET 并重试一次。 */
export async function fetchSourceViaAmc(
  siteInput: string,
  pageInput: string,
  { useCookieFile = false }: { useCookieFile?: boolean } = {}
): Promise<AmcSourceResult> {
  const site = normalizeSite(siteInput);
  const page = normalizePage(pageInput);
  const jar: Cookie[] = [];
  try {
    return await requestSourceOnce(site, page, jar, useCookieFile);
  } catch (e) {
    if (e instanceof LayoutError && (e as LayoutError & { code2?: string }).code2 === 'wrong_token7') {
      jar.length = 0;
      return requestSourceOnce(site, page, jar, useCookieFile);
    }
    throw e;
  }
}
