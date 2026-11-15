/** 运行期配置：路径、缓存、限流、浏览器与安全边界。 */

import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** 包根目录（源码运行时为仓库根，打包后为 dist 的上一级）。 */
export const PACKAGE_ROOT = path.resolve(moduleDir, '..');

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

function envInt(name: string, fallback: number): number {
  const raw = env(name);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const CONFIG = {
  /** 默认站点（未给 site 时用于 include 解析）。 */
  defaultSite: env('WIKIDOT_LAYOUT_DEFAULT_SITE') ?? 'scp-wiki-cn',

  source: {
    ttlMs: envInt('WIKIDOT_LAYOUT_SOURCE_TTL_MS', 5 * 60 * 1000),
    timeoutMs: envInt('WIKIDOT_LAYOUT_FETCH_TIMEOUT_MS', 15_000),
    perHostConcurrency: envInt('WIKIDOT_LAYOUT_CONCURRENCY', 2),
    cacheDir:
      env('WIKIDOT_LAYOUT_CACHE_DIR') ??
      path.join(os.homedir(), '.wikidot-layout-mcp', 'cache', 'source'),
    cacheEnabled: env('WIKIDOT_LAYOUT_DISABLE_CACHE') !== '1',
  },

  layout: {
    /** `_template` 外壳缓存；与 ftml-cli 的 30 天策略一致。 */
    cacheDir:
      env('WIKIDOT_LAYOUT_LAYOUT_CACHE_DIR') ??
      path.join(os.homedir(), '.wikidot-layout-mcp', 'cache', 'layout'),
    ttlMs: envInt('WIKIDOT_LAYOUT_LAYOUT_TTL_MS', 30 * 24 * 60 * 60 * 1000),
  },

  artifacts: {
    dir: path.resolve(env('WIKIDOT_LAYOUT_ARTIFACT_DIR') ?? path.join(PACKAGE_ROOT, 'artifacts')),
    keep: envInt('WIKIDOT_LAYOUT_ARTIFACT_KEEP', 100),
  },

  screenshots: {
    timeoutMs: envInt('WIKIDOT_LAYOUT_SCREENSHOT_TIMEOUT_MS', 30_000),
    defaultViewport: { width: 1440, height: 900 },
    viewports: {
      desktop: { width: 1440, height: 900 },
      tablet: { width: 1024, height: 768 },
      mobile: { width: 390, height: 844 },
    },
  },

  browser: {
    executablePath: env('CHROME_PATH') ?? null,
    headless: env('WIKIDOT_LAYOUT_HEADLESS') !== '0',
  },

  security: {
    /** layout_export 允许写入的根目录。 */
    allowedRoots: (() => {
      const configured = env('WIKIDOT_LAYOUT_ALLOWED_ROOTS');
      const roots = configured
        ? configured.split(path.delimiter).filter(Boolean)
        : [];
      roots.push(PACKAGE_ROOT, process.cwd());
      return [...new Set(roots.map((p) => path.resolve(p)))];
    })(),
    allowRemoteScreenshots: env('WIKIDOT_LAYOUT_ALLOW_REMOTE_URL') !== '0',
  },

  /** 本地 include 查找目录（可多个，使用 path.delimiter 分隔）。 */
  includeDirs: (() => {
    const configured = env('WIKIDOT_LAYOUT_INCLUDE_DIRS');
    const dirs = configured
      ? configured.split(path.delimiter).filter(Boolean)
      : [path.join(PACKAGE_ROOT, 'includes')];
    return dirs.map((p) => path.resolve(p));
  })(),

  /** 私有页面凭证：只从服务端环境变量或显式 Cookie 文件读取。 */
  privateAccess: {
    enabled: env('WIKIDOT_LAYOUT_ALLOW_PRIVATE') === '1',
    username: env('WIKIDOT_USERNAME') ?? null,
    password: env('WIKIDOT_PASSWORD') ?? null,
    cookieFile: env('WIKIDOT_COOKIE_FILE') ?? null,
  },
} as const;
