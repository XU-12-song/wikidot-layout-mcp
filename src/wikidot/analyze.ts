/**
 * Wikidot 页面结构分析。
 *
 * 源码层：轻量 FTML 块扫描器（栈配对、跳过 code/html/embed 体内伪标签），
 *        识别 [[div]]/[[div_]]、[[span]]、[[collapsible]]、[[tabview]]、
 *        [[tab]]、[[code]]、[[html]]、[[embed]]、[[include]]、[[module]]。
 * 渲染层：cheerio 解析公开页面 HTML，检查 #page-title / #page-content /
 *        #page-options / 评分模块 / 面包屑 / 侧栏 / 顶栏。
 */

import * as cheerio from 'cheerio';
import { getPageSource, type PageSourceResult } from './source.js';
import { fetchPageHtml } from './amc.js';
import { LayoutError } from '../errors.js';
import { log } from '../logger.js';
import { normalizePage, normalizeSite } from '../security/paths.js';

export interface StructureWarning {
  code: string;
  message: string;
  line: number | null;
}

export interface BlockNode {
  tag: string;
  variant: string | null;
  classes: string[];
  id: string | null;
  depth: number;
  line: number;
  closed: boolean;
}

export interface IncludeNode {
  target: string;
  site: string | null;
  page: string | null;
  kind: 'local' | 'cross-site';
  arguments: Record<string, string>;
  line: number;
}

export interface ModuleNode {
  name: string;
  raw: string;
  line: number;
}

export interface DomStructure {
  fetched: boolean;
  title: string | null;
  pageTitle: boolean;
  pageContent: boolean;
  pageOptions: boolean;
  ratingModule: boolean;
  breadcrumbs: boolean;
  toc: boolean;
  topBar: boolean;
  sideBar: boolean;
  contentColumnWidth: string | null;
}

export interface AnalyzeResult {
  ok: true;
  site: string;
  page: string;
  title: string | null;
  pageType: 'article' | 'theme' | 'nav' | 'component' | 'system' | 'fragment';
  category: string | null;
  sourceMeta: { contentHash: string; cached: boolean; fetchedAt: string };
  headings: Array<{ level: number; text: string; line: number }>;
  blocks: BlockNode[];
  includes: IncludeNode[];
  modules: ModuleNode[];
  dom: DomStructure | null;
  layoutHints: {
    hasTopBar: boolean;
    hasSideBar: boolean;
    hasToc: boolean;
    contentColumnWidth: string | null;
  };
  warnings: StructureWarning[];
}

const BLOCK_TAGS = new Set([
  'div', 'div_', 'span', 'span_', 'collapsible', 'tabview', 'tab', 'code', 'html', 'embed',
]);
const RAW_TAGS = new Set(['code', 'html', 'embed']);
/** 行内标签：不参与块嵌套栈，闭合与否只看同一行。 */
const INLINE_SCAN_TAGS = new Set(['span']);

const OPEN_RE = /^\s*\[\[\s*([A-Za-z_][\w-]*)\b([^\]]*)\]\]/;
const CLOSE_RE = /^\s*\[\[\s*\/\s*([A-Za-z_][\w-]*)\s*\]\]/;
const INCLUDE_RE = /^\s*\[\[\s*include\b([^\]]*)\]\]/i;
const MODULE_RE = /^\s*\[\[\s*module\b([^\]]*)\]\]/i;
const HEADING_RE = /^(\+{1,6})\s+(.*\S)\s*$/;

function attrs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return out;
}

function parseInclude(args: string, currentSite: string, line: number): IncludeNode | null {
  const trimmed = args.trim();
  if (!trimmed) return null;
  // 变量以 | 分隔；目标名是第一个非变量 token
  const parts = trimmed.split('|');
  const head = parts[0].trim().split(/\s+/);
  const target = head[0] ?? '';
  if (!target) return null;
  const vars: Record<string, string> = {};
  const varText = [head.slice(1).join(' '), ...parts.slice(1)].join('|');
  for (const piece of varText.split('|')) {
    const eq = piece.indexOf('=');
    if (eq > 0) vars[piece.slice(0, eq).trim()] = piece.slice(eq + 1).trim();
  }
  let site: string | null = null;
  let page: string | null = target;
  let kind: IncludeNode['kind'] = 'local';
  if (target.startsWith(':')) {
    const m = /^:([a-z0-9-]+):(.+)$/i.exec(target);
    if (m) {
      site = m[1].toLowerCase();
      page = m[2];
      kind = site === currentSite ? 'local' : 'cross-site';
    } else {
      page = target.slice(1);
    }
  }
  return { target, site, page, kind, arguments: vars, line };
}

function classifyPage(page: string): { pageType: AnalyzeResult['pageType']; category: string | null } {
  const lower = page.toLowerCase();
  const colon = lower.indexOf(':');
  const category = colon > 0 ? lower.slice(0, colon) : null;
  if (category === 'theme') return { pageType: 'theme', category };
  if (category === 'nav') return { pageType: 'nav', category };
  if (category === 'component') return { pageType: 'component', category };
  if (category === 'system') return { pageType: 'system', category };
  if (lower.startsWith('_') || lower.includes(':_')) return { pageType: 'fragment', category };
  return { pageType: 'article', category };
}

interface ScanResult {
  headings: AnalyzeResult['headings'];
  blocks: BlockNode[];
  includes: IncludeNode[];
  modules: ModuleNode[];
  warnings: StructureWarning[];
}

export function scanFtml(source: string, site: string): ScanResult {
  const lines = source.split(/\r\n|\r|\n/);
  const stack: Array<{ tag: string; variant: string | null; line: number; block: BlockNode }> = [];
  const blocks: BlockNode[] = [];
  const headings: AnalyzeResult['headings'] = [];
  const includes: IncludeNode[] = [];
  const modules: ModuleNode[] = [];
  const warnings: StructureWarning[] = [];
  let rawTag: string | null = null;
  let inComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    if (inComment) {
      if (line.includes('--]')) inComment = false;
      continue;
    }
    if (/\[!--/.test(line) && !line.includes('--]')) inComment = true;

    if (rawTag) {
      if (CLOSE_RE.exec(line)?.[1].toLowerCase() === rawTag) {
        const frame = stack[stack.length - 1];
        if (frame) frame.block.closed = true;
        stack.pop();
        rawTag = null;
      }
      continue;
    }

    const close = CLOSE_RE.exec(line);
    if (close) {
      const name = close[1].toLowerCase();
      // 找最近的同名帧（div_ 解析为 div）
      let idx = -1;
      for (let p = stack.length - 1; p >= 0; p--) {
        if (stack[p].tag === name) { idx = p; break; }
      }
      if (idx === -1) {
        warnings.push({ code: 'stray-close', message: `闭合标签 [[/${name}]] 没有匹配的开标签`, line: lineNo });
      } else {
        for (let p = stack.length - 1; p > idx; p--) {
          const orphan = stack[p];
          warnings.push({
            code: 'unclosed-block',
            message: `[[${orphan.block.variant ?? orphan.tag}]] 在 [[/${name}]] 之前仍未闭合`,
            line: orphan.line,
          });
        }
        stack[idx].block.closed = true;
        stack.length = idx;
      }
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      headings.push({ level: heading[1].length, text: heading[2].trim(), line: lineNo });
      continue;
    }

    const include = INCLUDE_RE.exec(line);
    if (include) {
      const parsed = parseInclude(include[1], site, lineNo);
      if (parsed) includes.push(parsed);
      else warnings.push({ code: 'include-parse-failed', message: '无法解析 [[include]] 目标', line: lineNo });
      continue;
    }

    const module = MODULE_RE.exec(line);
    if (module) {
      const name = module[1].trim().split(/\s+/)[0] ?? '';
      if (name) modules.push({ name, raw: module[1].trim(), line: lineNo });
      else warnings.push({ code: 'module-parse-failed', message: '无法解析 [[module]] 名称', line: lineNo });
      continue;
    }

    const open = OPEN_RE.exec(line);
    if (!open) continue;
    const rawName = open[1].toLowerCase();
    if (!BLOCK_TAGS.has(rawName)) continue;
    const tag = rawName.endsWith('_') ? rawName.slice(0, -1) : rawName;
    const at = attrs(open[2]);
    const classes = (at.class ?? '').split(/\s+/).filter(Boolean);
    const rest = line.slice((open.index ?? 0) + open[0].length);
    const sameLineClose = new RegExp(`\\[\\[\\s*\\/\\s*${tag}\\s*\\]\\]`, 'i').test(rest);
    const block: BlockNode = {
      tag,
      variant: rawName.endsWith('_') ? rawName : null,
      classes,
      id: at.id ?? null,
      depth: stack.length + 1,
      line: lineNo,
      closed: sameLineClose,
    };
    blocks.push(block);
    if (INLINE_SCAN_TAGS.has(tag)) {
      // 跨行的 span 仍然入栈，交给闭合标签处理；同行闭合则不参与块嵌套。
      if (!sameLineClose) stack.push({ tag, variant: block.variant, line: lineNo, block });
      continue;
    }
    // Wikidot 要求块标签独占一行；同一行即闭合时只记录，不进入栈。
    if (sameLineClose) continue;
    stack.push({ tag, variant: block.variant, line: lineNo, block });
    if (RAW_TAGS.has(tag)) rawTag = tag;
  }

  for (const frame of stack) {
    warnings.push({
      code: 'unclosed-block',
      message: `[[${frame.block.variant ?? frame.tag}]] 未闭合`,
      line: frame.line,
    });
  }
  return { headings, blocks, includes, modules, warnings };
}

export function analyzeDom(html: string): DomStructure {
  const $ = cheerio.load(html);
  const styleOf = (selector: string): string | null => {
    const el = $(selector).first();
    if (!el.length) return null;
    const style = el.attr('style') ?? '';
    const m = /(?:max-)?width\s*:\s*([^;]+)/i.exec(style);
    return m?.[1]?.trim() ?? null;
  };
  const title =
    $('#page-title').first().text().trim() ||
    $('title').first().text().trim() ||
    null;
  return {
    fetched: true,
    title,
    pageTitle: $('#page-title').length > 0,
    pageContent: $('#page-content').length > 0,
    pageOptions: $('#page-options-container, #page-options-bottom, .page-options-bottom').length > 0,
    ratingModule:
      $('#page-rate-widget-box, .page-rate-widget-box, .rate-box-with-credit-button, [id^="page-rate"]').length > 0,
    breadcrumbs: $('#breadcrumbs').length > 0,
    toc: $('#toc, #toc-action-bar, .toc').length > 0,
    topBar: $('#top-bar, .mobile-top-bar').length > 0,
    sideBar: $('#side-bar').length > 0 && $('#side-bar').text().trim().length > 0,
    contentColumnWidth:
      styleOf('#page-content') ?? styleOf('#main-content') ?? styleOf('#content-wrap') ?? null,
  };
}

export interface AnalyzeOptions {
  site: string;
  page: string;
  forceRefresh?: boolean;
  includeDom?: boolean;
}

export async function analyzePageStructure(options: AnalyzeOptions): Promise<AnalyzeResult> {
  const site = normalizeSite(options.site);
  const page = normalizePage(options.page);
  let source: PageSourceResult;
  try {
    source = await getPageSource({ site, page, forceRefresh: options.forceRefresh });
  } catch (e) {
    throw e instanceof LayoutError ? e : new LayoutError('NETWORK_ERROR', (e as Error).message);
  }

  const scan = scanFtml(source.source, site);
  const { pageType, category } = classifyPage(page);
  const warnings = [...scan.warnings];

  let dom: DomStructure | null = null;
  if (options.includeDom !== false) {
    try {
      const fetched = await fetchPageHtml(site, page);
      dom = analyzeDom(fetched.html);
    } catch (e) {
      log.warn(`DOM 结构获取失败 ${site}:${page}: ${(e as Error).message}`);
      warnings.push({
        code: 'dom-fetch-failed',
        message: `渲染层结构获取失败（源码分析仍然有效）：${(e as Error).message}`,
        line: null,
      });
    }
  }

  const sourceLower = source.source.toLowerCase();
  const hasTopBarSource =
    sourceLower.includes('nav:top') || sourceLower.includes('id="top-bar"');
  const hasSideBarSource =
    sourceLower.includes('nav:side') || sourceLower.includes('id="side-bar"');
  const hasTocSource =
    /^\s*\[\[\s*toc\s*\]\]/im.test(source.source) || /\bmodule\s+toc\b/i.test(source.source);
  const cssWidth =
    /#page-content[^{]*\{[^}]*?(?:max-)?width\s*:\s*([^;}\n]+)/i.exec(source.source)?.[1]?.trim() ?? null;

  return {
    ok: true,
    site,
    page,
    title: source.title ?? dom?.title ?? null,
    pageType,
    category,
    sourceMeta: {
      contentHash: source.contentHash,
      cached: source.cached,
      fetchedAt: source.fetchedAt,
    },
    headings: scan.headings,
    blocks: scan.blocks,
    includes: scan.includes,
    modules: scan.modules,
    dom,
    layoutHints: {
      hasTopBar: Boolean(dom?.topBar || hasTopBarSource),
      hasSideBar: Boolean(dom?.sideBar || hasSideBarSource),
      hasToc: Boolean(dom?.toc || hasTocSource),
      contentColumnWidth: dom?.contentColumnWidth ?? cssWidth,
    },
    warnings,
  };
}
