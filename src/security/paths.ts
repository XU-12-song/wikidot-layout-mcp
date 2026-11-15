/**
 * 路径与 URL 安全：
 * - Wikidot 站点名 / 页面名归一化与校验
 * - layout_export 的允许根目录、绝对路径与符号链接逃逸防护
 * - 截图 URL 的协议与私网地址拒绝（SSRF）
 */

import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';
import net from 'node:net';
import { CONFIG } from '../config.js';
import { LayoutError } from '../errors.js';

const SITE_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** `scp-wiki-cn`、`https://scp-wiki.wikidot.com/...` → `scp-wiki`。 */
export function normalizeSite(input: string): string {
  let site = String(input ?? '').trim().toLowerCase();
  site = site.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  site = site.replace(/^www\./, '');
  site = site.replace(/\/.*$/, '');
  site = site.replace(/\.wikidot\.com$/, '');
  if (!SITE_RE.test(site)) {
    throw new LayoutError('INVALID_INPUT', `非法站点名: ${JSON.stringify(input)}`, {
      hint: '站点名应形如 scp-wiki-cn（只允许小写字母、数字、连字符）。',
    });
  }
  return site;
}

/** 页面名：允许 Unicode、冒号分类，但禁止协议、查询串与路径穿越。 */
export function normalizePage(input: string): string {
  let page = String(input ?? '').trim();
  page = page.replace(/^\/+/, '');
  if (!page) throw new LayoutError('INVALID_INPUT', '页面名不能为空');
  if (/^[a-z][a-z0-9+.-]*:/i.test(page) && !page.startsWith('_default:')) {
    // `theme:bedrock` / `nav:side` / `component:x` 是合法的分类前缀；
    // 只有 `https:`、`file:` 这类协议才拒绝。
    if (/^(?:https?|file|ftp|javascript|data):/i.test(page)) {
      throw new LayoutError('INVALID_INPUT', `页面名不能是 URL: ${page}`);
    }
  }
  if (page.includes('..') || /[?#]/.test(page) || page.includes('\\')) {
    throw new LayoutError('INVALID_INPUT', `页面名包含非法字符: ${page}`);
  }
  return page;
}

export function wikidotOrigin(site: string): string {
  return `https://${normalizeSite(site)}.wikidot.com`;
}

export function pageUrl(site: string, page: string): string {
  return `${wikidotOrigin(site)}/${encodeURI(normalizePage(page))}`;
}

function isWithin(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** 找到最近的已存在祖先并 realpath，避免符号链接逃逸。 */
function realpathNearest(target: string): string {
  let current = target;
  const tail: string[] = [];
  for (;;) {
    try {
      const real = fs.realpathSync.native(current);
      return path.join(real, ...tail.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return target;
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * 把用户提供的路径限制在允许根目录内。
 * 相对路径以第一个允许根（项目根）为基准。
 */
export function resolveAllowedPath(
  input: string,
  roots: string[] = CONFIG.security.allowedRoots,
  opts: { baseDir?: string } = {}
): string {
  const raw = String(input ?? '').trim();
  if (!raw) throw new LayoutError('INVALID_INPUT', '路径不能为空');
  if (raw.includes('\0')) throw new LayoutError('PATH_NOT_ALLOWED', '路径包含 NUL 字符');

  const candidates: string[] = [];
  if (path.isAbsolute(raw)) {
    candidates.push(path.resolve(raw));
  } else {
    const base = opts.baseDir ?? roots[0] ?? CONFIG.artifacts.dir;
    candidates.push(path.resolve(base, raw));
    for (const root of roots) candidates.push(path.resolve(root, raw));
  }

  for (const candidate of candidates) {
    const realCandidate = realpathNearest(candidate);
    for (const root of roots) {
      const realRoot = realpathNearest(path.resolve(root));
      if (isWithin(realRoot, realCandidate)) return candidate;
    }
  }
  throw new LayoutError('PATH_NOT_ALLOWED', `路径不在允许目录内: ${raw}`, {
    hint: `允许根目录：${roots.join(' | ')}`,
  });
}

/** 静态服务器用：把 URL pathname 安全拼到 root 下。 */
export function safeJoin(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const rel = decoded.replace(/^\/+/, '');
  if (rel.split('/').some((seg) => seg === '..' || seg === '.')) return null;
  const target = path.resolve(root, rel);
  return isWithin(path.resolve(root), target) ? target : null;
}

/* ------------------------------------------------------------------ */
/* SSRF                                                                 */
/* ------------------------------------------------------------------ */

const PRIVATE_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
]);

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
    if (lower.startsWith('::ffff:')) {
      const v4 = lower.slice('::ffff:'.length);
      if (net.isIPv4(v4)) return isPrivateIp(v4);
    }
    return false;
  }
  return false;
}

/**
 * 校验可截图 URL：仅 http/https，拒绝 localhost、.local、私网与保留地址。
 * 域名会做一次 DNS 解析，但 Playwright 仍可能重绑定；这是基础防护，不替代网络隔离。
 */
export async function assertPublicHttpUrl(input: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new LayoutError('INVALID_INPUT', `非法 URL: ${input}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new LayoutError('INVALID_INPUT', `只允许 http/https URL，收到 ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new LayoutError('INVALID_INPUT', 'URL 不能内嵌凭证');
  }
  if (!CONFIG.security.allowRemoteScreenshots) {
    throw new LayoutError('PATH_NOT_ALLOWED', '远程截图已被 WIKIDOT_LAYOUT_ALLOW_REMOTE_URL=0 禁用');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (PRIVATE_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new LayoutError('PATH_NOT_ALLOWED', `拒绝本机/内网主机: ${hostname}`);
  }
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new LayoutError('PATH_NOT_ALLOWED', `拒绝内网地址: ${hostname}`);
    }
    return url;
  }
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    if (!records.length) throw new Error('无解析结果');
    for (const record of records) {
      if (isPrivateIp(record.address)) {
        throw new LayoutError('PATH_NOT_ALLOWED', `域名解析到内网地址: ${hostname} → ${record.address}`);
      }
    }
  } catch (e) {
    if (e instanceof LayoutError) throw e;
    throw new LayoutError('NETWORK_ERROR', `无法解析主机: ${hostname}`, { retryable: true });
  }
  return url;
}
