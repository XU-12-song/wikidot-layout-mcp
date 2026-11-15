/**
 * 匿名获取公开页面源码。
 *
 * 顺序：进程/磁盘缓存 → @ukwhatn/wikidot 匿名客户端 → AMC 直连回退。
 * 私有页面：只在服务端显式启用时使用环境变量凭证或 Cookie 文件；
 * 工具参数中没有 username/password/token/cookie。
 */

import path from 'node:path';
import { LRUCache } from 'lru-cache';
import { CONFIG } from '../config.js';
import { LayoutError } from '../errors.js';
import { log } from '../logger.js';
import { dirtToIdeal } from '../compat/ideal.js';
import { fetchSourceViaAmc } from './amc.js';
import {
  classifyWikidotError,
  getAnonymousClient,
  getPage,
  getPrivateClient,
  getSite,
  privateAccessConfigured,
  sourceText,
} from './client.js';
import { normalizePage, normalizeSite } from '../security/paths.js';
import { sha256 } from '../util/hash.js';
import { readJsonFile, writeJsonFile } from '../storage/json-cache.js';
import { withHostLimit, withTimeout } from '../util/concurrency.js';

export interface PageSourceOptions {
  site: string;
  page: string;
  raw?: boolean;
  forceRefresh?: boolean;
}

export interface PageSourceResult {
  ok: true;
  site: string;
  page: string;
  pageId: number | null;
  title: string | null;
  source: string;
  normalizedSource: string | null;
  contentHash: string;
  fetchedAt: string;
  cached: boolean;
  privateAccess: boolean;
  warning: string | null;
  normalization: {
    changed: boolean;
    changes: number;
    diagnostics: Array<{ code: string; message: string; line: number; column: number }>;
  };
}

interface CacheEntry {
  v: 1;
  site: string;
  page: string;
  pageId: number | null;
  title: string | null;
  source: string;
  normalizedSource: string | null;
  contentHash: string;
  fetchedAt: number;
  privateAccess: boolean;
  warning: string | null;
  normalization: PageSourceResult['normalization'];
}

const memo = new LRUCache<string, CacheEntry>({ max: 300 });

function cacheKey(site: string, page: string): string {
  return `${site}\u0000${page}`;
}

function diskPath(site: string, page: string): string {
  return path.join(CONFIG.source.cacheDir, site, `${sha256(page).slice(7, 31)}.json`);
}

function isFresh(entry: CacheEntry): boolean {
  return Date.now() - entry.fetchedAt < CONFIG.source.ttlMs;
}

function readCache(site: string, page: string): CacheEntry | null {
  const key = cacheKey(site, page);
  const mem = memo.get(key);
  if (mem) return mem;
  const disk = readJsonFile<CacheEntry>(diskPath(site, page));
  if (disk?.v === 1 && disk.site === site && disk.page === page) {
    memo.set(key, disk);
    return disk;
  }
  return null;
}

function writeCache(entry: CacheEntry): void {
  memo.set(cacheKey(entry.site, entry.page), entry);
  writeJsonFile(diskPath(entry.site, entry.page), entry);
}

function toResult(entry: CacheEntry, cached: boolean): PageSourceResult {
  return {
    ok: true,
    site: entry.site,
    page: entry.page,
    pageId: entry.pageId,
    title: entry.title,
    source: entry.source,
    normalizedSource: entry.normalizedSource,
    contentHash: entry.contentHash,
    fetchedAt: new Date(entry.fetchedAt).toISOString(),
    cached,
    privateAccess: entry.privateAccess,
    warning: entry.warning,
    normalization: entry.normalization,
  };
}

interface FetchedSource {
  source: string;
  pageId: number | null;
  title: string | null;
  via: 'library' | 'amc' | 'private';
  warning: string | null;
}

async function fetchViaLibraryFor(siteName: string, pageName: string): Promise<FetchedSource> {
  const client = getAnonymousClient();
  const site = await getSite(client, siteName);
  const page = await getPage(site, pageName);
  if (!page) throw new LayoutError('PAGE_NOT_FOUND', `页面不存在: ${siteName}:${pageName}`);
  const sourceResult = await page.getSource();
  if (!sourceResult.isOk()) throw classifyWikidotError(sourceResult.error);
  return {
    source: sourceText(sourceResult.value),
    pageId: page.id ?? null,
    title: page.title || null,
    via: 'library',
    warning: null,
  };
}

async function fetchViaPrivateLibrary(siteName: string, pageName: string): Promise<FetchedSource | null> {
  const client = await getPrivateClient();
  if (!client) return null;
  const site = await getSite(client, siteName);
  const page = await getPage(site, pageName);
  if (!page) throw new LayoutError('PAGE_NOT_FOUND', `页面不存在: ${siteName}:${pageName}`);
  const sourceResult = await page.getSource();
  if (!sourceResult.isOk()) throw classifyWikidotError(sourceResult.error);
  return {
    source: sourceText(sourceResult.value),
    pageId: page.id ?? null,
    title: page.title || null,
    via: 'private',
    warning: null,
  };
}

async function fetchViaAmcFor(
  siteName: string,
  pageName: string,
  useCookieFile: boolean
): Promise<FetchedSource> {
  const r = await fetchSourceViaAmc(siteName, pageName, { useCookieFile });
  return { ...r, via: 'amc', warning: null };
}

/**
 * 获取源码。
 * 所有网络调用都套 15s 超时与同站点并发 2 的限制。
 */
export async function getPageSource(options: PageSourceOptions): Promise<PageSourceResult> {
  const site = normalizeSite(options.site);
  const page = normalizePage(options.page);

  if (!options.forceRefresh) {
    const cached = readCache(site, page);
    if (cached && isFresh(cached)) return toResult(cached, true);
  }

  const host = `${site}.wikidot.com`;
  const warnings: string[] = [];
  let fetched: FetchedSource;

  const run = <T>(fn: () => Promise<T>, what: string) =>
    withHostLimit(host, CONFIG.source.perHostConcurrency, () =>
      withTimeout(fn, CONFIG.source.timeoutMs, what)
    );

  try {
    fetched = await run(() => fetchViaLibraryFor(site, page), '获取页面');
  } catch (libraryError) {
    const libErr = libraryError instanceof LayoutError ? libraryError : classifyWikidotError(libraryError);
    // 缓存/权限错误直接按明确结果处理
    if (libErr.code === 'PAGE_NOT_FOUND') throw libErr;
    if (libErr.code === 'SOURCE_FORBIDDEN') {
      const privateResult = await tryPrivate(site, page, run);
      if (privateResult) fetched = privateResult;
      else throw libErr;
    } else {
      log.warn(`客户端获取失败，尝试 AMC 回退: ${libErr.message}`);
      warnings.push(`客户端获取失败，已尝试 AMC：${libErr.message}`);
      try {
        fetched = await run(() => fetchViaAmcFor(site, page, false), 'AMC 获取源码');
      } catch (amcError) {
        const amcErr = amcError instanceof LayoutError ? amcError : classifyWikidotError(amcError);
        if (amcErr.code === 'SOURCE_FORBIDDEN') {
          const privateResult = await tryPrivate(site, page, run);
          if (privateResult) fetched = privateResult;
          else throw amcErr;
        } else {
          throw amcErr;
        }
      }
    }
  }

  const raw = fetched.source ?? '';
  if (!raw.trim()) {
    throw new LayoutError('SOURCE_PARSE_FAILED', '获取到的源码为空');
  }
  const normalized = options.raw ? null : dirtToIdeal(raw);
  const entry: CacheEntry = {
    v: 1,
    site,
    page,
    pageId: fetched.pageId,
    title: fetched.title,
    source: raw,
    normalizedSource: normalized?.src ?? null,
    contentHash: sha256(raw),
    fetchedAt: Date.now(),
    privateAccess: fetched.via === 'private',
    warning: [fetched.warning, ...warnings].filter(Boolean).join('；') || null,
    normalization: {
      changed: normalized?.changed ?? false,
      changes: normalized?.changes.length ?? 0,
      diagnostics: normalized?.diagnostics ?? [],
    },
  };
  if (CONFIG.source.cacheEnabled) writeCache(entry);
  return toResult(entry, false);
}

type Runner = <T>(fn: () => Promise<T>, what: string) => Promise<T>;

async function tryPrivate(
  site: string,
  page: string,
  run: Runner
): Promise<FetchedSource | null> {
  if (!privateAccessConfigured() && !CONFIG.privateAccess.cookieFile) return null;
  if (CONFIG.privateAccess.cookieFile) {
    try {
      return await run(() => fetchViaAmcFor(site, page, true), '使用 Cookie 获取私有源码');
    } catch (e) {
      log.warn(`Cookie 方式读取失败: ${(e as Error).message}`);
    }
  }
  if (privateAccessConfigured()) {
    return run(() => fetchViaPrivateLibrary(site, page), '使用服务端凭证获取私有源码');
  }
  return null;
}

/** 供 include 解析使用：失败返回 null 而不是抛出。 */
export async function tryGetPageSource(
  site: string,
  page: string
): Promise<PageSourceResult | null> {
  try {
    return await getPageSource({ site, page });
  } catch (e) {
    log.warn(`include 远程拉取失败 ${site}:${page}: ${(e as Error).message}`);
    return null;
  }
}

/** 清空进程内源码缓存（测试用）。 */
export function clearSourceMemo(): void {
  memo.clear();
}
