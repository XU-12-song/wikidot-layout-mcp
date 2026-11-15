/**
 * FTML → 完整预览 HTML。
 *
 * processWikitext → renderWikitext(styleMode: 'separate')
 * 文档包含：charset / viewport / 主题 CSS（wikidot.css + sigma.css）/
 * [[module CSS]] 收集的样式 / 调用方 CSS / @wdprlib/runtime 内联脚本。
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { processWikitext } from '@wdprlib/parser';
import { renderWikitext, createSettings } from '@wdprlib/render';
import type { PageRef } from '@wdprlib/parser';
import { CONFIG, PACKAGE_ROOT } from '../config.js';
import { LayoutError } from '../errors.js';
import { log } from '../logger.js';
import { tryGetPageSource } from '../wikidot/source.js';
import { safeJoin } from '../security/paths.js';
import { applyShell, resolveShell, type ShellMode } from './shell.js';

export interface NormalizedDiagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  line: number | null;
  column: number | null;
}

export interface IncludeResolution {
  site: string | null;
  page: string;
  from: 'local' | 'remote' | 'miss';
  path?: string;
}

export interface RenderOptions {
  ftml: string;
  css?: string;
  site?: string | null;
  page?: string | null;
  title?: string;
  includeTheme?: boolean;
  /** 页面外壳：site=_template，builtin=内置沙盒结构，none=只渲染正文。默认自动判断。 */
  shell?: ShellMode | 'auto';
  forceRefreshShell?: boolean;
}

export interface RenderResult {
  documentHtml: string;
  fragmentHtml: string;
  moduleStyles: string[];
  diagnostics: NormalizedDiagnostic[];
  warnings: NormalizedDiagnostic[];
  includes: IncludeResolution[];
  cssSources: string[];
  htmlBlocks: number;
  title: string;
  shell: { mode: ShellMode; source: 'site' | 'builtin' | null; warning: string | null };
}

const require = createRequire(import.meta.url);
let runtimeSourceCache: string | null = null;

/**
 * 读取 @wdprlib/runtime 的 **ESM** 构建。
 * 包同时提供 CJS（main）与 ESM（module / exports.import）；内联进
 * <script type="module"> 必须用 ESM，否则会出现 "module is not defined"。
 */
function resolveRuntimeEntry(): string {
  try {
    // Node 的 ESM 解析会走 exports.import → dist/index.js
    return fileURLToPath(import.meta.resolve('@wdprlib/runtime'));
  } catch {
    const entry = require.resolve('@wdprlib/runtime');
    // 回退：把 CJS 路径换成同目录 ESM 路径（dist/index.cjs → dist/index.js）
    if (entry.endsWith('.cjs')) {
      const esm = entry.slice(0, -4) + '.js';
      if (fs.existsSync(esm)) return esm;
    }
    return entry;
  }
}

function runtimeSource(): string {
  if (runtimeSourceCache == null) {
    runtimeSourceCache = fs.readFileSync(resolveRuntimeEntry(), 'utf8');
  }
  return runtimeSourceCache;
}

let themeSourceCache: { css: string; sources: string[] } | null = null;

const ABSOLUTE_REF = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

/** 把相对 url(...) 重写为绝对地址（主题内联后基准会变成预览文档）。 */
export function absolutizeCssUrls(css: string, baseUrl: string): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (whole, _quote, ref: string) => {
    if (ABSOLUTE_REF.test(ref)) return whole;
    try {
      return `url("${new URL(ref, baseUrl).href}")`;
    } catch {
      return whole;
    }
  });
}

/** 本地主题文件对应的线上基准地址，用于补全相对资源。 */
const THEME_BASE_URLS: Record<string, string> = {
  'wikidot.css':
    'https://d3g0gp89917ko0.cloudfront.net/v--7690939296dc/common--theme/base/css/style.css',
  'sigma.css': 'https://sigma9.scpwikicn.com/cn/cn/sigma9_ch_sandbox.min.css',
};

/** 读取本地主题样式表；把所有 @import 提到最前，避免内联后被浏览器丢弃。 */
export function readLocalTheme(): { css: string; sources: string[] } {
  if (themeSourceCache) return themeSourceCache;
  const sources: string[] = [];
  const imports: string[] = [];
  const bodies: string[] = [];
  for (const name of ['wikidot.css', 'sigma.css']) {
    const file = path.join(PACKAGE_ROOT, name);
    let raw: string;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    sources.push(name);
    raw = raw.replace(/@charset\s+[^;]+;/gi, '');
    raw = raw.replace(/@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)\s*([^;]*);/gi, (_whole, _q1, _r1, _q2, _r2, media) => {
      const ref = _r1 ?? _r2;
      if (ref && !imports.includes(ref)) imports.push(ref);
      return media?.trim() ? `/* @import ${ref} ${media.trim()} */` : `/* @import ${ref} */`;
    });
    const base = THEME_BASE_URLS[name];
    if (base) raw = absolutizeCssUrls(raw, base);
    bodies.push(raw);
  }
  const css = [
    imports.length ? imports.map((ref) => `@import url("${ref}");`).join('\n') : '',
    ...bodies,
  ].filter(Boolean).join('\n');
  themeSourceCache = { css, sources };
  return themeSourceCache;
}

/** 在允许目录内解析本地 include（.ftml 文件）。 */
function resolveLocalInclude(pageRef: PageRef, currentSite: string | null): { file: string; source: string } | null {
  const candidates: string[] = [];
  const pageName = pageRef.page.replace(/^:+/, '');
  const site = pageRef.site ?? currentSite;
  for (const dir of CONFIG.includeDirs) {
    candidates.push(safeJoin(dir, `/${pageName}.ftml`) ?? '');
    if (site) candidates.push(safeJoin(dir, `/${site}/${pageName}.ftml`) ?? '');
  }
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (fs.statSync(candidate).isFile()) {
        return { file: candidate, source: fs.readFileSync(candidate, 'utf8') };
      }
    } catch {
      /* 继续找下一个 */
    }
  }
  return null;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeStyle(text: string): string {
  return text.replace(/<\/style/gi, '<\\/style');
}

function escapeScript(text: string): string {
  return text.replace(/<\/script/gi, '<\\/script');
}

function normalizeDiagnostics(items: unknown[]): NormalizedDiagnostic[] {
  return items.map((raw) => {
    const d = (raw ?? {}) as {
      severity?: string;
      code?: string;
      message?: string;
      position?: { start?: { line?: number; column?: number } };
    };
    const severity = d.severity === 'error' || d.severity === 'info' ? d.severity : 'warning';
    return {
      severity,
      code: d.code ?? 'diagnostic',
      message: d.message ?? String(raw),
      line: d.position?.start?.line ?? null,
      column: d.position?.start?.column ?? null,
    };
  });
}

export function buildPreviewDocument({
  title,
  fragmentHtml,
  themeCss,
  moduleStyles,
  customCss,
  shellHtml = null,
}: {
  title: string;
  fragmentHtml: string;
  themeCss: string;
  moduleStyles: string[];
  customCss: string;
  shellHtml?: string | null;
}): string {
  const runtime = escapeScript(runtimeSource());
  const titleEscaped = escapeHtml(title);
  const bodyHtml = shellHtml
    ? applyShell(shellHtml, titleEscaped, fragmentHtml)
    : `<div id="page-content" class="lay-preview-root">\n${fragmentHtml}\n</div>`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<link rel="icon" href="data:,">
<title>${titleEscaped}</title>
<style id="wikidot-theme">${escapeStyle(themeCss)}</style>
<style id="module-styles">${escapeStyle(moduleStyles.join('\n'))}</style>
<style id="custom-css">${escapeStyle(customCss)}</style>
</head>
<body class="lay-preview-body">
${bodyHtml}
<script type="module">
${runtime}
// ---- init ----
try {
  const root = document.getElementById('container') || document.getElementById('page-content');
  if (root && typeof initWdprRuntime === 'function') {
    window.__wdprDestroy = initWdprRuntime({ root });
  }
} catch (error) {
  console.error('wdpr runtime init failed', error);
}
</script>
</body>
</html>`;
}

export async function renderPreview(options: RenderOptions): Promise<RenderResult> {
  const ftml = String(options.ftml ?? '');
  if (!ftml.trim()) throw new LayoutError('INVALID_INPUT', 'ftml 不能为空');
  const site = options.site?.trim() || CONFIG.defaultSite;
  const pageName = options.page?.trim() || 'preview';
  const title = options.title || pageName;
  const settings = { ...createSettings('page'), allowStyleElements: true };
  const pageContext = {
    fullName: pageName,
    unixName: pageName,
    tags: [] as string[],
    site,
    domain: `${site}.wikidot.com`,
  };
  const includes: IncludeResolution[] = [];
  const remoteWarnings: NormalizedDiagnostic[] = [];

  let doc: Awaited<ReturnType<typeof processWikitext>>;
  try {
    doc = await processWikitext(ftml, {
      page: pageContext as never,
      settings,
      dataProvider: {
        fetchInclude: async (pageRef: PageRef) => {
          const local = resolveLocalInclude(pageRef, site);
          if (local) {
            includes.push({ site: pageRef.site ?? site, page: pageRef.page, from: 'local', path: local.file });
            return local.source;
          }
          const targetSite = pageRef.site ?? site;
          const fetched = await tryGetPageSource(targetSite, pageRef.page);
          if (fetched) {
            includes.push({ site: targetSite, page: pageRef.page, from: 'remote' });
            return fetched.normalizedSource ?? fetched.source;
          }
          includes.push({ site: targetSite, page: pageRef.page, from: 'miss' });
          remoteWarnings.push({
            severity: 'warning',
            code: 'include-miss',
            message: `include 未找到（本地与远程均失败）：${targetSite}:${pageRef.page}`,
            line: null,
            column: null,
          });
          return null;
        },
      } as never,
    });
  } catch (e) {
    throw new LayoutError('RENDER_FAILED', `FTML 解析失败: ${(e as Error).message}`, {
      hint: '先用 layout_validate 检查块闭合与语法。',
    });
  }

  let rendered: Awaited<ReturnType<typeof renderWikitext>>;
  try {
    rendered = await renderWikitext(doc, {
      styleMode: 'separate',
      resolvers: {
        // 版式预览把所有站内链接视为已存在，避免整页红链影响观感
        resolvePageExistence: async (targets: string[]) => new Set(targets),
      },
    } as never);
  } catch (e) {
    throw new LayoutError('RENDER_FAILED', `FTML 渲染失败: ${(e as Error).message}`);
  }

  const theme = options.includeTheme === false
    ? { css: '', sources: [] as string[] }
    : readLocalTheme();
  const cssSources = [...theme.sources];
  if (options.css?.trim()) cssSources.push('custom');

  // 默认：完整页面原型（lay-page）保持自带外壳；普通 FTML 使用整页 Wikidot 外壳。
  const shellMode: ShellMode =
    options.shell && options.shell !== 'auto'
      ? options.shell
      : /class="[^"]*\blay-page\b/.test(ftml)
        ? 'none'
        : 'builtin';
  const shell = await resolveShell({
    mode: shellMode,
    site,
    forceRefresh: options.forceRefreshShell,
  });

  const documentHtml = buildPreviewDocument({
    title,
    fragmentHtml: rendered.html,
    themeCss: theme.css,
    moduleStyles: rendered.styles ?? [],
    customCss: options.css ?? '',
    shellHtml: shell.html,
  });

  const diagnostics = [
    ...normalizeDiagnostics(doc.diagnostics ?? []),
    ...remoteWarnings,
    ...(shell.warning
      ? [{
          severity: 'warning' as const,
          code: 'shell-fallback',
          message: shell.warning,
          line: null,
          column: null,
        }]
      : []),
  ];
  for (const d of diagnostics) {
    if (d.severity === 'error') log.warn(`render diagnostic ${d.code}: ${d.message}`);
  }

  return {
    documentHtml,
    fragmentHtml: rendered.html,
    moduleStyles: rendered.styles ?? [],
    diagnostics,
    warnings: diagnostics.filter((d) => d.severity !== 'error'),
    includes,
    cssSources,
    htmlBlocks: rendered.htmlBlocks?.length ?? 0,
    title,
    shell: { mode: shell.mode, source: shell.source, warning: shell.warning },
  };
}
