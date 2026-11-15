/**
 * 内置版式原型注册表。
 *
 * 预设由数据文件构成：src/presets/<id>/{preset.json,page.ftml,layout.css,notes.md}。
 * 工具函数只负责读取、token 替换、区域裁剪与本地 @import 内联，不硬编码 HTML。
 */

import fs from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT } from '../config.js';
import { LayoutError } from '../errors.js';

export const PRESET_IDS = [
  'article-single',
  'docs-sidebar',
  'docs-toc',
  'card-grid',
  'scp-article',
  'component-gallery',
  'longform-reading',
  'blank',
] as const;

export type PresetId = (typeof PRESET_IDS)[number];

export interface PresetManifest {
  id: PresetId;
  name: string;
  description: string;
  tags: string[];
  regions: string[];
  responsive: Record<string, string>;
  tokens: Record<string, string>;
  files: { 'page.ftml': string; 'layout.css': string; 'notes.md': string };
}

export interface PresetSummary {
  id: string;
  name: string;
  description: string;
  tags: string[];
  regions: string[];
  responsive: Record<string, string>;
  tokens: Record<string, string>;
}

export interface PresetDetail extends PresetSummary {
  files: Record<string, string>;
  resolvedFiles: Record<string, string>;
  directory: string;
}

export const PRESETS_DIR =
  process.env.WIKIDOT_LAYOUT_PRESETS_DIR
    ? path.resolve(process.env.WIKIDOT_LAYOUT_PRESETS_DIR)
    : path.join(PACKAGE_ROOT, 'src', 'presets');

function presetDir(id: string): string {
  if (!(PRESET_IDS as readonly string[]).includes(id)) {
    throw new LayoutError('PRESET_NOT_FOUND', `未知版式预设: ${id}`, {
      hint: `可用预设：${PRESET_IDS.join(', ')}`,
    });
  }
  return path.join(PRESETS_DIR, id);
}

function readManifest(id: string): PresetManifest {
  const file = path.join(presetDir(id), 'preset.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as PresetManifest;
  } catch (e) {
    throw new LayoutError('PRESET_NOT_FOUND', `无法读取预设 ${id}: ${(e as Error).message}`);
  }
}

function readFile(id: string, name: string): string {
  const file = path.join(presetDir(id), name);
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new LayoutError('PRESET_NOT_FOUND', `预设 ${id} 缺少文件 ${name}: ${(e as Error).message}`);
  }
}

/**
 * 递归内联预设目录内的本地 `@import`。
 * 允许引用 `src/presets/_shared/base.css`，但不得逃出 PRESETS_DIR。
 */
export function inlineLocalImports(
  css: string,
  baseDir: string,
  seen = new Set<string>(),
  rootDir = PRESETS_DIR
): string {
  return css.replace(
    /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)\s*([^;]*);/gi,
    (whole, _q1, ref1: string, _q2, ref2: string, media: string) => {
      const ref = ref1 ?? ref2;
      if (!ref || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) return whole;
      const target = path.resolve(baseDir, ref);
      const rel = path.relative(path.resolve(rootDir), target);
      if (rel.startsWith('..') || path.isAbsolute(rel)) return whole;
      if (seen.has(target)) return '';
      seen.add(target);
      let inner: string;
      try {
        inner = fs.readFileSync(target, 'utf8');
      } catch {
        return `/* 本地 @import 缺失: ${ref} */`;
      }
      const expanded = inlineLocalImports(inner, path.dirname(target), seen, rootDir);
      return media.trim() ? `@media ${media.trim()}{${expanded}}` : expanded;
    }
  );
}

export function applyTokens(text: string, tokens: Record<string, string>): string {
  return text.replace(/\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : whole
  );
}

export function listPresets(): PresetSummary[] {
  return PRESET_IDS.map((id) => {
    const m = readManifest(id);
    return {
      id: m.id,
      name: m.name,
      description: m.description,
      tags: m.tags,
      regions: m.regions,
      responsive: m.responsive,
      tokens: m.tokens,
    };
  });
}

export function getPreset(
  idInput: string,
  { tokens: overrides = {} }: { tokens?: Record<string, string> } = {}
): PresetDetail {
  const id = idInput as PresetId;
  const manifest = readManifest(id);
  const pageRaw = readFile(id, manifest.files['page.ftml']);
  const cssRaw = readFile(id, manifest.files['layout.css']);
  const notes = readFile(id, manifest.files['notes.md']);

  const unknown = Object.keys(overrides).filter((k) => !(k in manifest.tokens));
  if (unknown.length) {
    throw new LayoutError('INVALID_INPUT', `未知 token: ${unknown.join(', ')}`, {
      hint: `可用 token：${Object.keys(manifest.tokens).join(', ')}`,
    });
  }
  const tokens = { ...manifest.tokens, ...overrides };
  const resolvedCss = inlineLocalImports(applyTokens(cssRaw, tokens), presetDir(id));

  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    tags: manifest.tags,
    regions: manifest.regions,
    responsive: manifest.responsive,
    tokens,
    directory: presetDir(id),
    files: {
      'page.ftml': pageRaw,
      'layout.css': cssRaw,
      'notes.md': notes,
    },
    resolvedFiles: {
      'page.ftml': applyTokens(pageRaw, tokens),
      'layout.css': resolvedCss,
      'notes.md': applyTokens(notes, tokens),
    },
  };
}

/** 预设渲染用：返回已替换 token 的 FTML + 已内联基础样式的 CSS。 */
export function loadPresetAssets(
  id: string,
  tokenOverrides: Record<string, string> = {}
): { ftml: string; css: string; manifest: PresetManifest } {
  const detail = getPreset(id, { tokens: tokenOverrides });
  return {
    ftml: detail.resolvedFiles['page.ftml'],
    css: detail.resolvedFiles['layout.css'],
    manifest: {
      id: detail.id as PresetId,
      name: detail.name,
      description: detail.description,
      tags: detail.tags,
      regions: detail.regions,
      responsive: detail.responsive,
      tokens: detail.tokens,
      files: detail.files as PresetManifest['files'],
    },
  };
}
