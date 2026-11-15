/**
 * 工具输入/输出 schema。
 *
 * 安全约束：源码工具的输入 schema 中不得出现 username / password / token / cookie。
 * 私有页面凭证只从服务端环境变量或预配置 Cookie 文件读取。
 */

import { z } from 'zod';

export const errorSchema = z.object({
  code: z.string(),
  message: z.string(),
  hint: z.string().nullable(),
  retryable: z.boolean(),
});

export const viewportSchema = z.union([
  z.enum(['desktop', 'tablet', 'mobile']),
  z.object({ width: z.number().int(), height: z.number().int() }),
]);

export const diagnosticSchema = z.object({
  severity: z.enum(['error', 'warning', 'info']),
  code: z.string(),
  message: z.string(),
  line: z.number().nullable(),
  column: z.number().nullable(),
});

export const sourceInput = {
  site: z.string().describe('站点子域名，如 scp-wiki-cn 或 scp-wiki'),
  page: z.string().describe('页面名，如 scp-173、theme:bedrock'),
  raw: z.boolean().optional().describe('只返回原始源码，不做规范化'),
  forceRefresh: z.boolean().optional().describe('跳过 5 分钟缓存，强制重新抓取'),
};

export const sourceOutput = z
  .object({
    ok: z.boolean(),
    site: z.string(),
    page: z.string(),
    pageId: z.number().nullable(),
    title: z.string().nullable(),
    source: z.string(),
    normalizedSource: z.string().nullable(),
    contentHash: z.string(),
    fetchedAt: z.string(),
    cached: z.boolean(),
    privateAccess: z.boolean(),
    warning: z.string().nullable(),
    normalization: z.object({
      changed: z.boolean(),
      changes: z.number(),
      diagnostics: z.array(z.object({
        code: z.string(),
        message: z.string(),
        line: z.number(),
        column: z.number(),
      })),
    }),
  })
  .partial()
  .passthrough();

export const analyzeInput = {
  site: z.string().describe('站点子域名'),
  page: z.string().describe('页面名'),
  forceRefresh: z.boolean().optional(),
  includeDom: z.boolean().optional().describe('是否再抓一次公开 HTML 做渲染层结构分析（默认 true）'),
};

export const analyzeOutput = z
  .object({
    ok: z.boolean(),
    site: z.string(),
    page: z.string(),
    title: z.string().nullable(),
    pageType: z.enum(['article', 'theme', 'nav', 'component', 'system', 'fragment']),
    category: z.string().nullable(),
    sourceMeta: z.object({
      contentHash: z.string(),
      cached: z.boolean(),
      fetchedAt: z.string(),
    }),
    headings: z.array(z.object({ level: z.number(), text: z.string(), line: z.number() })),
    blocks: z.array(z.object({
      tag: z.string(),
      variant: z.string().nullable(),
      classes: z.array(z.string()),
      id: z.string().nullable(),
      depth: z.number(),
      line: z.number(),
      closed: z.boolean(),
    })),
    includes: z.array(z.object({
      target: z.string(),
      site: z.string().nullable(),
      page: z.string().nullable(),
      kind: z.enum(['local', 'cross-site']),
      arguments: z.record(z.string()),
      line: z.number(),
    })),
    modules: z.array(z.object({ name: z.string(), raw: z.string(), line: z.number() })),
    dom: z.object({
      fetched: z.boolean(),
      title: z.string().nullable(),
      pageTitle: z.boolean(),
      pageContent: z.boolean(),
      pageOptions: z.boolean(),
      ratingModule: z.boolean(),
      breadcrumbs: z.boolean(),
      toc: z.boolean(),
      topBar: z.boolean(),
      sideBar: z.boolean(),
      contentColumnWidth: z.string().nullable(),
    }).nullable(),
    layoutHints: z.object({
      hasTopBar: z.boolean(),
      hasSideBar: z.boolean(),
      hasToc: z.boolean(),
      contentColumnWidth: z.string().nullable(),
    }),
    warnings: z.array(z.object({
      code: z.string(),
      message: z.string(),
      line: z.number().nullable(),
    })),
  })
  .partial()
  .passthrough();

export const listPresetsInput = {};

export const listPresetsOutput = z.object({
  ok: z.boolean(),
  total: z.number(),
  presets: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    tags: z.array(z.string()),
    regions: z.array(z.string()),
    responsive: z.record(z.string()),
    tokens: z.record(z.string()),
  })),
}).partial().passthrough();

export const getPresetInput = {
  id: z.string().describe('预设 id，例如 docs-sidebar'),
  tokens: z.record(z.string()).optional().describe('覆盖默认 token'),
};

export const getPresetOutput = z.object({
  ok: z.boolean(),
  preset: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    tags: z.array(z.string()),
    regions: z.array(z.string()),
    responsive: z.record(z.string()),
    tokens: z.record(z.string()),
    files: z.record(z.string()),
    resolvedFiles: z.record(z.string()),
  }),
}).partial().passthrough();

export const scaffoldInput = {
  presetId: z.string().describe('预设 id'),
  tokens: z.record(z.string()).optional().describe('覆盖 token'),
  regions: z.array(z.string()).optional().describe('保留的区域；content 不可移除'),
  title: z.string().optional().describe('覆盖 {{pageTitle}}'),
  addRegions: z.array(z.object({
    name: z.string(),
    ftml: z.string(),
    position: z.enum(['start', 'end']).optional(),
  })).optional(),
  outDir: z.string().optional().describe('写入目录（必须在允许根目录内）'),
  force: z.boolean().optional(),
};

export const scaffoldOutput = z.object({
  ok: z.boolean(),
  presetId: z.string(),
  tokens: z.record(z.string()),
  regions: z.array(z.string()),
  files: z.record(z.string()),
  written: z.array(z.string()),
}).partial().passthrough();

export const validateInput = {
  ftml: z.string().describe('要校验的 FTML 源码'),
  css: z.string().optional(),
  site: z.string().optional(),
};

export const validateOutput = z.object({
  ok: z.boolean(),
  valid: z.boolean(),
  errors: z.array(diagnosticSchema),
  warnings: z.array(diagnosticSchema),
  diagnostics: z.array(diagnosticSchema),
}).partial().passthrough();

export const shellSchema = z
  .enum(['site', 'builtin', 'none', 'auto'])
  .optional()
  .describe(
    '页面外壳：site=匿名抓取 _template（真实 header/topbar/sidebar），builtin=内置沙盒结构，none=只渲染正文。默认 auto（含 lay-page 的完整原型用 none，其余用 builtin）。'
  );

export const renderPreviewInput = {
  ftml: z.string().describe('FTML 源码'),
  css: z.string().optional().describe('自定义 CSS（追加在主题与模块样式之后）'),
  site: z.string().optional().describe('站点子域名，用于 include 解析和链接上下文'),
  page: z.string().optional().describe('页面名，用于渲染上下文'),
  viewport: viewportSchema.optional().describe('记录到 artifact 元数据的视口'),
  shell: shellSchema,
  forceRefreshShell: z.boolean().optional().describe('强制刷新 _template 外壳缓存'),
};

export const renderPreviewOutput = z.object({
  ok: z.boolean(),
  artifactId: z.string(),
  htmlPath: z.string(),
  resourceUri: z.string(),
  title: z.string(),
  diagnostics: z.array(diagnosticSchema),
  warnings: z.array(diagnosticSchema),
  cssSources: z.array(z.string()),
  includes: z.array(z.object({
    site: z.string().nullable(),
    page: z.string(),
    from: z.enum(['local', 'remote', 'miss']),
    path: z.string().optional(),
  })),
  viewport: z.object({ width: z.number(), height: z.number() }),
  shell: z.object({
    mode: z.string(),
    source: z.string().nullable(),
    warning: z.string().nullable(),
  }),
}).partial().passthrough();

export const screenshotInput = {
  artifactId: z.string().optional().describe('layout_render_preview 返回的 artifactId'),
  html: z.string().optional().describe('直接提供完整 HTML'),
  url: z.string().optional().describe('公开 http/https URL（拒绝内网地址）'),
  viewport: viewportSchema.optional(),
  fullPage: z.boolean().optional(),
  selector: z.string().optional().describe('只截取匹配元素'),
  waitForSelector: z.string().optional(),
  waitMs: z.number().int().min(0).max(60_000).optional(),
  colorScheme: z.enum(['light', 'dark', 'no-preference']).optional(),
  reducedMotion: z.enum(['reduce', 'no-preference']).optional(),
  clip: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }).optional(),
  title: z.string().optional(),
};

export const screenshotOutput = z.object({
  ok: z.boolean(),
  artifactId: z.string(),
  screenshotPath: z.string(),
  resourceUri: z.string(),
  url: z.string(),
  width: z.number(),
  height: z.number(),
  fullPage: z.boolean(),
  viewport: z.object({ width: z.number(), height: z.number() }),
  consoleErrors: z.array(z.object({ type: z.string(), text: z.string() })),
  pageErrors: z.array(z.string()),
  durationMs: z.number(),
}).partial().passthrough();

export const previewAndScreenshotInput = {
  ftml: z.string(),
  css: z.string().optional(),
  site: z.string().optional(),
  page: z.string().optional(),
  viewport: viewportSchema.optional(),
  fullPage: z.boolean().optional(),
  selector: z.string().optional(),
  waitForSelector: z.string().optional(),
  waitMs: z.number().int().min(0).max(60_000).optional(),
  colorScheme: z.enum(['light', 'dark', 'no-preference']).optional(),
  shell: shellSchema,
  forceRefreshShell: z.boolean().optional(),
};

export const previewAndScreenshotOutput = z.object({
  ok: z.boolean(),
  artifactId: z.string(),
  htmlPath: z.string(),
  screenshotPath: z.string(),
  resourceUri: z.string(),
  title: z.string(),
  viewport: z.object({ width: z.number(), height: z.number() }),
  fullPage: z.boolean(),
  consoleErrors: z.array(z.object({ type: z.string(), text: z.string() })),
  pageErrors: z.array(z.string()),
  diagnostics: z.array(diagnosticSchema),
  warnings: z.array(diagnosticSchema),
  cssSources: z.array(z.string()),
  durationMs: z.number(),
  shell: z.object({
    mode: z.string(),
    source: z.string().nullable(),
    warning: z.string().nullable(),
  }),
}).partial().passthrough();

export const themeCatalogInput = {};

export const themeCatalogOutput = z.object({
  ok: z.boolean(),
  catalog: z.object({
    defaults: z.record(z.any()),
    themes: z.array(z.object({
      id: z.string(),
      name: z.string(),
      page: z.string(),
      url: z.string(),
      repo: z.string().nullable(),
      notes: z.array(z.string()),
    }).passthrough()),
    guidance: z.array(z.string()),
  }).passthrough(),
}).partial().passthrough();

export const exportInput = {
  presetId: z.string().optional(),
  artifactId: z.string().optional(),
  files: z.array(z.string()).optional().describe('只导出指定文件'),
  outDir: z.string().describe('目标目录（必须在允许根目录内）'),
  tokens: z.record(z.string()).optional(),
  force: z.boolean().optional(),
};

export const exportOutput = z.object({
  ok: z.boolean(),
  outDir: z.string(),
  written: z.array(z.string()),
}).partial().passthrough();

/** 测试用：所有工具输入 schema 的字段名集合。 */
export const TOOL_INPUT_SCHEMAS = {
  wikidot_get_page_source: sourceInput,
  wikidot_analyze_page_structure: analyzeInput,
  wikidot_list_theme_sources: themeCatalogInput,
  layout_list_presets: listPresetsInput,
  layout_get_preset: getPresetInput,
  layout_scaffold: scaffoldInput,
  layout_validate: validateInput,
  layout_export: exportInput,
  layout_render_preview: renderPreviewInput,
  layout_screenshot: screenshotInput,
  layout_preview_and_screenshot: previewAndScreenshotInput,
} as const;
