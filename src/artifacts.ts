/** 渲染产物与截图的本地存储；默认保留最近 100 个。 */

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { CONFIG } from './config.js';
import { LayoutError } from './errors.js';
import { log } from './logger.js';

export interface ArtifactMeta {
  id: string;
  createdAt: string;
  title: string;
  site: string | null;
  page: string | null;
  viewport: { width: number; height: number } | null;
  htmlBytes: number;
  cssSources: string[];
  screenshots: Array<{ file: string; width: number | null; height: number | null }>;
  diagnostics: unknown[];
}

const ID_RE = /^art-[a-z0-9]+-[a-f0-9]{8}$/;

export function artifactDir(id: string): string {
  if (!ID_RE.test(id)) throw new LayoutError('INVALID_INPUT', `非法 artifactId: ${id}`);
  return path.join(CONFIG.artifacts.dir, id);
}

export function createArtifact(input: {
  html: string;
  title?: string;
  site?: string | null;
  page?: string | null;
  viewport?: { width: number; height: number } | null;
  cssSources?: string[];
  diagnostics?: unknown[];
  extraFiles?: Record<string, string>;
}): { id: string; dir: string; htmlPath: string; metaPath: string; meta: ArtifactMeta } {
  const id = `art-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  const dir = artifactDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const htmlPath = path.join(dir, 'index.html');
  fs.writeFileSync(htmlPath, input.html, 'utf8');
  for (const [name, content] of Object.entries(input.extraFiles ?? {})) {
    const target = path.join(dir, path.basename(name));
    fs.writeFileSync(target, content, 'utf8');
  }
  const meta: ArtifactMeta = {
    id,
    createdAt: new Date().toISOString(),
    title: input.title ?? 'preview',
    site: input.site ?? null,
    page: input.page ?? null,
    viewport: input.viewport ?? null,
    htmlBytes: Buffer.byteLength(input.html, 'utf8'),
    cssSources: input.cssSources ?? [],
    screenshots: [],
    diagnostics: input.diagnostics ?? [],
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  pruneArtifacts();
  return { id, dir, htmlPath, metaPath: path.join(dir, 'meta.json'), meta };
}

export function readArtifact(id: string): { dir: string; htmlPath: string; metaPath: string; meta: ArtifactMeta } {
  const dir = artifactDir(id);
  const htmlPath = path.join(dir, 'index.html');
  if (!fs.existsSync(htmlPath)) {
    throw new LayoutError('INVALID_INPUT', `artifact 不存在: ${id}`);
  }
  let meta: ArtifactMeta;
  try {
    meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) as ArtifactMeta;
  } catch {
    meta = {
      id,
      createdAt: fs.statSync(dir).birthtime.toISOString(),
      title: 'preview',
      site: null,
      page: null,
      viewport: null,
      htmlBytes: fs.statSync(htmlPath).size,
      cssSources: [],
      screenshots: [],
      diagnostics: [],
    };
  }
  return { dir, htmlPath, metaPath: path.join(dir, 'meta.json'), meta };
}

export function addScreenshot(
  id: string,
  file: string,
  info: { width: number | null; height: number | null }
): string {
  const { dir, metaPath, meta } = readArtifact(id);
  const safeFile = path.basename(file);
  const entry = { file: safeFile, width: info.width, height: info.height };
  meta.screenshots = [...meta.screenshots.filter((s) => s.file !== safeFile), entry];
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
  return path.join(dir, safeFile);
}

export function artifactUri(id: string, file: string): string {
  return `artifact://${id}/${path.basename(file)}`;
}

/** 只保留最近 N 个 artifact（按目录创建时间）。 */
export function pruneArtifacts(): void {
  const root = CONFIG.artifacts.dir;
  let entries: string[];
  try {
    entries = fs.readdirSync(root).filter((name) => ID_RE.test(name));
  } catch {
    return;
  }
  if (entries.length <= CONFIG.artifacts.keep) return;
  const withTime = entries.map((name) => {
    const dir = path.join(root, name);
    try {
      return { name, dir, time: fs.statSync(dir).mtimeMs };
    } catch {
      return { name, dir, time: 0 };
    }
  });
  withTime.sort((a, b) => b.time - a.time);
  for (const entry of withTime.slice(CONFIG.artifacts.keep)) {
    try {
      fs.rmSync(entry.dir, { recursive: true, force: true });
    } catch (e) {
      log.warn(`清理 artifact 失败 ${entry.name}: ${(e as Error).message}`);
    }
  }
}
