/** 基于预设生成新页面：token 覆盖、区域裁剪/追加、可选落盘。 */

import fs from 'node:fs';
import path from 'node:path';
import { LayoutError } from '../errors.js';
import { resolveAllowedPath } from '../security/paths.js';
import { applyTokens, getPreset, type PresetDetail } from './registry.js';

export interface ScaffoldOptions {
  presetId: string;
  tokens?: Record<string, string>;
  regions?: string[];
  title?: string;
  addRegions?: Array<{ name: string; ftml: string; position?: 'start' | 'end' }>;
  outDir?: string;
  force?: boolean;
}

export interface ScaffoldResult {
  ok: true;
  presetId: string;
  tokens: Record<string, string>;
  regions: string[];
  files: Record<string, string>;
  written: string[];
}

const PROTECTED_REGIONS = new Set(['content']);
const REGION_NAME_RE = /^[a-z][a-z0-9-]*$/;

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 删除带 `lay-region-<name>` 的 div 块（按 div 嵌套计数）。 */
export function removeRegionBlock(ftml: string, name: string): string {
  const lines = ftml.split('\n');
  const marker = new RegExp(`lay-region-${escapeRe(name)}(?![\\w-])`);
  const start = lines.findIndex((line) => /\[\[\s*div_?\b/i.test(line) && marker.test(line));
  if (start === -1) return ftml;

  let depth = 0;
  let end = -1;
  for (let i = start; i < lines.length; i++) {
    const opens = (lines[i].match(/\[\[\s*div_?\b/gi) ?? []).length;
    const closes = (lines[i].match(/\[\[\s*\/\s*div\s*\]\]/gi) ?? []).length;
    depth += opens - closes;
    if (depth <= 0) {
      end = i;
      break;
    }
  }
  if (end === -1) return ftml;
  // 一并吃掉紧邻的空行，避免留下双空行
  const out = [...lines.slice(0, start), ...lines.slice(end + 1)];
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

function insertRegion(ftml: string, region: { name: string; ftml: string; position?: 'start' | 'end' }): string {
  if (!REGION_NAME_RE.test(region.name)) {
    throw new LayoutError('INVALID_INPUT', `非法区域名: ${region.name}`);
  }
  const block = `[[div class="lay-region lay-region-${region.name}"]]\n${region.ftml.trim()}\n[[/div]]`;
  if (region.position === 'start') {
    const newline = ftml.indexOf('\n');
    return newline === -1 ? `${ftml}\n${block}` : `${ftml.slice(0, newline + 1)}${block}\n${ftml.slice(newline + 1)}`;
  }
  const lastClose = ftml.lastIndexOf('[[/div]]');
  if (lastClose === -1) return `${ftml}\n${block}`;
  return `${ftml.slice(0, lastClose)}${block}\n${ftml.slice(lastClose)}`;
}

export function scaffold(options: ScaffoldOptions): ScaffoldResult {
  const preset: PresetDetail = getPreset(options.presetId, { tokens: options.tokens ?? {} });
  const tokens = { ...preset.tokens };
  if (options.title) tokens.pageTitle = options.title;

  let ftml = preset.files['page.ftml'];
  const manifestRegions = preset.regions;
  const selected = options.regions ?? manifestRegions;

  const unknownRegions = selected.filter((r) => !manifestRegions.includes(r));
  if (unknownRegions.length) {
    throw new LayoutError('INVALID_INPUT', `未知区域: ${unknownRegions.join(', ')}`, {
      hint: `可用区域：${manifestRegions.join(', ')}`,
    });
  }
  const missingProtected = [...PROTECTED_REGIONS].filter((r) => manifestRegions.includes(r) && !selected.includes(r));
  if (missingProtected.length) {
    throw new LayoutError('INVALID_INPUT', `区域不可移除: ${missingProtected.join(', ')}`);
  }
  for (const region of manifestRegions) {
    if (!selected.includes(region)) ftml = removeRegionBlock(ftml, region);
  }
  for (const region of options.addRegions ?? []) {
    if (manifestRegions.includes(region.name) || PROTECTED_REGIONS.has(region.name)) {
      throw new LayoutError('INVALID_INPUT', `区域已存在或受保护: ${region.name}`);
    }
    ftml = insertRegion(ftml, region);
  }

  // token 替换必须在区域裁剪之后：裁剪只依赖 class 名，不依赖 token 值。
  ftml = applyTokens(ftml, tokens);

  const files: Record<string, string> = {
    'page.ftml': ftml,
    'layout.css': preset.resolvedFiles['layout.css'],
    'notes.md': preset.resolvedFiles['notes.md'],
  };

  const written: string[] = [];
  if (options.outDir) {
    const targetDir = resolveAllowedPath(options.outDir);
    fs.mkdirSync(targetDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      const target = path.join(targetDir, name);
      if (fs.existsSync(target) && !options.force) {
        throw new LayoutError('EXPORT_FAILED', `目标文件已存在: ${target}`, {
          hint: '使用 force:true 覆盖，或换一个 outDir。',
        });
      }
      fs.writeFileSync(target, content, 'utf8');
      written.push(target);
    }
  }

  return {
    ok: true,
    presetId: preset.id,
    tokens,
    regions: selected,
    files,
    written,
  };
}
