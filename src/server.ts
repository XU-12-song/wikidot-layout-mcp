/** MCP Server：注册全部工具、资源与 Prompt。 */

import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { LayoutError, toolError } from './errors.js';
import { log } from './logger.js';
import { createArtifact, readArtifact } from './artifacts.js';
import { listPresets, getPreset } from './presets/registry.js';
import { scaffold } from './presets/scaffold.js';
import { renderPreview } from './render/renderer.js';
import { validateFtmlAndCss } from './render/validate.js';
import { captureScreenshot, resolveViewport } from './screenshot/capture.js';
import { getPageSource } from './wikidot/source.js';
import { analyzePageStructure } from './wikidot/analyze.js';
import { resolveAllowedPath } from './security/paths.js';
import { registerResources } from './resources.js';
import { registerPrompts } from './prompts.js';
import {
  analyzeInput,
  analyzeOutput,
  exportInput,
  exportOutput,
  getPresetInput,
  getPresetOutput,
  listPresetsInput,
  listPresetsOutput,
  previewAndScreenshotInput,
  previewAndScreenshotOutput,
  renderPreviewInput,
  renderPreviewOutput,
  scaffoldInput,
  scaffoldOutput,
  screenshotInput,
  screenshotOutput,
  sourceInput,
  sourceOutput,
  themeCatalogInput,
  themeCatalogOutput,
  validateInput,
  validateOutput,
} from './tool-schemas.js';
import { THEME_CATALOG } from './themes/catalog.js';

type Extra = {
  _meta?: { progressToken?: string | number };
  // SDK 的 notification 类型是具体联合类型；这里用 any 保持回调参数可逆变。
  sendNotification?: (notification: any) => Promise<void>;
  signal?: AbortSignal;
};

async function progress(extra: Extra | undefined, value: number, total: number, message: string): Promise<void> {
  const token = extra?._meta?.progressToken;
  if (token === undefined || !extra?.sendNotification) return;
  try {
    await extra.sendNotification({
      method: 'notifications/progress',
      params: { progressToken: token, progress: value, total, message },
    });
  } catch {
    /* 进度通知失败不影响主流程 */
  }
}

function success(text: string, structured: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text }],
    structuredContent: structured,
  };
}

function guarded<T extends unknown[]>(
  fn: (...args: T) => Promise<ReturnType<typeof success> | any>
) {
  return async (...args: T) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (!(e instanceof LayoutError)) log.error((e as Error)?.stack ?? String(e));
      return toolError(e);
    }
  };
}

function checkAborted(extra: Extra | undefined): void {
  if (extra?.signal?.aborted) {
    throw new LayoutError('INVALID_INPUT', '请求已取消');
  }
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'wikidot-layout',
    version: '0.1.0',
  });

  /* ------------------------------------------------------------------ */
  /* Wikidot 源码与结构                                                  */
  /* ------------------------------------------------------------------ */

  server.registerTool(
    'wikidot_get_page_source',
    {
      title: '匿名获取 Wikidot 页面源码',
      description:
        '匿名获取公开 Wikidot 页面源码（不接收任何凭据）。优先使用 @ukwhatn/wikidot，失败时回退 AMC；缓存 5 分钟。',
      inputSchema: sourceInput,
      outputSchema: sourceOutput,
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: false },
    },
    guarded(async (args: z.infer<z.ZodObject<typeof sourceInput>>, extra: Extra) => {
      checkAborted(extra);
      await progress(extra, 1, 2, '获取页面源码');
      const data = await getPageSource(args);
      await progress(extra, 2, 2, '完成');
      return success(
        `已获取 ${data.site}:${data.page}（${data.source.length} 字符${data.cached ? '，缓存命中' : ''}）`,
        data as unknown as Record<string, unknown>
      );
    })
  );

  server.registerTool(
    'wikidot_analyze_page_structure',
    {
      title: '分析 Wikidot 页面结构',
      description:
        '分析公开页面的 FTML 块结构、标题、include/module、嵌套深度，并用 cheerio 检查渲染层页级节点。',
      inputSchema: analyzeInput,
      outputSchema: analyzeOutput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guarded(async (args: z.infer<z.ZodObject<typeof analyzeInput>>, extra: Extra) => {
      checkAborted(extra);
      await progress(extra, 1, 3, '获取源码');
      const data = await analyzePageStructure(args);
      await progress(extra, 3, 3, '完成');
      return success(
        `已分析 ${data.site}:${data.page}：${data.headings.length} 个标题、${data.blocks.length} 个块、` +
          `${data.includes.length} 个 include、${data.modules.length} 个 module` +
          (data.warnings.length ? `，${data.warnings.length} 条警告` : ''),
        data as unknown as Record<string, unknown>
      );
    })
  );

  /* ------------------------------------------------------------------ */
  /* 预设                                                                */
  /* ------------------------------------------------------------------ */

  server.registerTool(
    'wikidot_list_theme_sources',
    {
      title: '列出主题来源',
      description:
        '返回主题页 URL、GitHub 仓库、本地 CSS 来源与 normalize 覆盖技巧；不确定实现时按 repo clone 后检索。',
      inputSchema: themeCatalogInput,
      outputSchema: themeCatalogOutput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guarded(async () => {
      const themes = THEME_CATALOG.themes.map((t) => `${t.name}=${t.url}`).join('；');
      return success(`主题来源 ${THEME_CATALOG.themes.length} 个：${themes}`, {
        ok: true,
        catalog: THEME_CATALOG,
      });
    })
  );

  server.registerTool(
    'layout_list_presets',
    {
      title: '列出内置版式',
      description: '返回 8 个内置版式原型的摘要、区域与 token。',
      inputSchema: listPresetsInput,
      outputSchema: listPresetsOutput,
      annotations: { readOnlyHint: true },
    },
    guarded(async () => {
      const presets = listPresets();
      return success(
        `内置版式 ${presets.length} 个：${presets.map((p) => p.id).join(', ')}`,
        { ok: true, total: presets.length, presets }
      );
    })
  );

  server.registerTool(
    'layout_get_preset',
    {
      title: '获取完整版式',
      description: '读取预设的 manifest、FTML、CSS、notes，以及按 token 解析后的文件。',
      inputSchema: getPresetInput,
      outputSchema: getPresetOutput,
      annotations: { readOnlyHint: true },
    },
    guarded(async (args: { id: string; tokens?: Record<string, string> }) => {
      const preset = getPreset(args.id, { tokens: args.tokens });
      return success(
        `已读取预设 ${preset.id}（${preset.name}）：${preset.regions.join(', ')}`,
        {
          ok: true,
          preset: {
            id: preset.id,
            name: preset.name,
            description: preset.description,
            tags: preset.tags,
            regions: preset.regions,
            responsive: preset.responsive,
            tokens: preset.tokens,
            files: preset.files,
            resolvedFiles: preset.resolvedFiles,
          },
        }
      );
    })
  );

  server.registerTool(
    'layout_scaffold',
    {
      title: '基于预设生成页面',
      description: '覆盖 token、裁剪/追加区域，生成 FTML + CSS + notes；可写入允许目录。',
      inputSchema: scaffoldInput,
      outputSchema: scaffoldOutput,
      annotations: { readOnlyHint: false },
    },
    guarded(async (args: z.infer<z.ZodObject<typeof scaffoldInput>>) => {
      const result = scaffold(args);
      return success(
        `已生成 ${result.presetId} 版式（区域：${result.regions.join(', ')}）` +
          (result.written.length ? `，写入 ${result.written.length} 个文件` : ''),
        result as unknown as Record<string, unknown>
      );
    })
  );

  server.registerTool(
    'layout_validate',
    {
      title: '校验 FTML / CSS',
      description: '检查块闭合、渲染诊断、CSS 花括号和 @import 顺序。',
      inputSchema: validateInput,
      outputSchema: validateOutput,
      annotations: { readOnlyHint: true },
    },
    guarded(async (args: { ftml: string; css?: string; site?: string }) => {
      const result = await validateFtmlAndCss(args.ftml, args.css, args.site);
      return success(
        result.valid
          ? `校验通过：${result.warnings.length} 条警告`
          : `校验失败：${result.errors.length} 个错误，${result.warnings.length} 条警告`,
        result as unknown as Record<string, unknown>
      );
    })
  );

  server.registerTool(
    'layout_export',
    {
      title: '导出预设或渲染产物',
      description: '把预设文件或 artifact 文件写入允许目录；拒绝 ..、绝对路径越界与符号链接逃逸。',
      inputSchema: exportInput,
      outputSchema: exportOutput,
      annotations: { readOnlyHint: false },
    },
    guarded(async (args: z.infer<z.ZodObject<typeof exportInput>>) => {
      if (!args.presetId && !args.artifactId) {
        throw new LayoutError('INVALID_INPUT', '必须提供 presetId 或 artifactId');
      }
      if (args.presetId && args.artifactId) {
        throw new LayoutError('INVALID_INPUT', 'presetId 与 artifactId 只能提供一个');
      }
      const outDir = resolveAllowedPath(args.outDir);
      fs.mkdirSync(outDir, { recursive: true });
      const written: string[] = [];
      const write = (name: string, content: string | Buffer) => {
        const target = path.join(outDir, path.basename(name));
        if (fs.existsSync(target) && !args.force) {
          throw new LayoutError('EXPORT_FAILED', `目标文件已存在: ${target}`, {
            hint: '设置 force:true 覆盖。',
          });
        }
        fs.writeFileSync(target, content);
        written.push(target);
      };

      if (args.presetId) {
        const preset = getPreset(args.presetId, { tokens: args.tokens });
        const names = args.files ?? Object.keys(preset.resolvedFiles);
        for (const name of names) {
          const content = preset.resolvedFiles[name];
          if (content === undefined) {
            throw new LayoutError('INVALID_INPUT', `预设没有文件: ${name}`, {
              hint: `可用文件：${Object.keys(preset.resolvedFiles).join(', ')}`,
            });
          }
          write(name, content);
        }
      } else {
        const artifact = readArtifact(args.artifactId!);
        const available = fs.readdirSync(artifact.dir).filter((f) => fs.statSync(path.join(artifact.dir, f)).isFile());
        const names = args.files ?? available;
        for (const name of names) {
          const base = path.basename(name);
          if (base !== name || !available.includes(base)) {
            throw new LayoutError('INVALID_INPUT', `artifact 没有文件: ${name}`);
          }
          write(base, fs.readFileSync(path.join(artifact.dir, base)));
        }
      }
      return success(`已导出 ${written.length} 个文件到 ${outDir}`, { ok: true, outDir, written });
    })
  );

  /* ------------------------------------------------------------------ */
  /* 渲染与截图                                                          */
  /* ------------------------------------------------------------------ */

  server.registerTool(
    'layout_render_preview',
    {
      title: '渲染 FTML 预览',
      description: 'FTML → 完整 HTML（主题 CSS、模块 CSS、自定义 CSS、内联 runtime），写入 artifact。',
      inputSchema: renderPreviewInput,
      outputSchema: renderPreviewOutput,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    guarded(async (args: z.infer<z.ZodObject<typeof renderPreviewInput>>, extra: Extra) => {
      checkAborted(extra);
      await progress(extra, 1, 2, '渲染 FTML');
      const viewport = resolveViewport(args.viewport);
      const rendered = await renderPreview({
        ftml: args.ftml,
        css: args.css,
        site: args.site,
        page: args.page,
        shell: args.shell,
        forceRefreshShell: args.forceRefreshShell,
      });
      const artifact = createArtifact({
        html: rendered.documentHtml,
        title: rendered.title,
        site: args.site ?? null,
        page: args.page ?? null,
        viewport,
        cssSources: rendered.cssSources,
        diagnostics: rendered.diagnostics,
      });
      await progress(extra, 2, 2, '生成 artifact');
      return success(
        `已渲染 ${artifact.id}：${rendered.diagnostics.length} 条诊断，${rendered.includes.length} 个 include`,
        {
          ok: true,
          artifactId: artifact.id,
          htmlPath: artifact.htmlPath,
          resourceUri: `artifact://${artifact.id}/index.html`,
          title: rendered.title,
          diagnostics: rendered.diagnostics,
          warnings: rendered.warnings,
          cssSources: rendered.cssSources,
          includes: rendered.includes,
          viewport,
          shell: rendered.shell,
        }
      );
    })
  );

  server.registerTool(
    'layout_screenshot',
    {
      title: '截图',
      description: '对 artifact / HTML / 公开 URL 截图；拒绝内网地址，返回本地路径与 resource URI。',
      inputSchema: screenshotInput,
      outputSchema: screenshotOutput,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    guarded(async (args: z.infer<z.ZodObject<typeof screenshotInput>>, extra: Extra) => {
      checkAborted(extra);
      await progress(extra, 1, 3, '启动浏览器');
      const result = await captureScreenshot(args);
      await progress(extra, 3, 3, '完成');
      return success(
        `已截图 ${result.artifactId}：${result.width}×${result.height}，` +
          `${result.consoleErrors.length} 个 console 错误`,
        result as unknown as Record<string, unknown>
      );
    })
  );

  server.registerTool(
    'layout_preview_and_screenshot',
    {
      title: '渲染并截图',
      description: '一步完成 FTML → HTML → PNG，形成“生成 → 截图 → 评估 → 调整”闭环。',
      inputSchema: previewAndScreenshotInput,
      outputSchema: previewAndScreenshotOutput,
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    guarded(async (args: z.infer<z.ZodObject<typeof previewAndScreenshotInput>>, extra: Extra) => {
      checkAborted(extra);
      await progress(extra, 1, 3, '渲染 FTML');
      const viewport = resolveViewport(args.viewport);
      const rendered = await renderPreview({
        ftml: args.ftml,
        css: args.css,
        site: args.site,
        page: args.page,
        shell: args.shell,
        forceRefreshShell: args.forceRefreshShell,
      });
      const artifact = createArtifact({
        html: rendered.documentHtml,
        title: rendered.title,
        site: args.site ?? null,
        page: args.page ?? null,
        viewport,
        cssSources: rendered.cssSources,
        diagnostics: rendered.diagnostics,
      });
      await progress(extra, 2, 3, '截图');
      const shot = await captureScreenshot({
        existingArtifactId: artifact.id,
        viewport: args.viewport,
        fullPage: args.fullPage,
        selector: args.selector,
        waitForSelector: args.waitForSelector,
        waitMs: args.waitMs,
        colorScheme: args.colorScheme,
      });
      await progress(extra, 3, 3, '完成');
      return success(
        `已渲染并截图 ${artifact.id}：${shot.width}×${shot.height}，` +
          `${rendered.diagnostics.length} 条诊断`,
        {
          ok: true,
          artifactId: artifact.id,
          htmlPath: artifact.htmlPath,
          screenshotPath: shot.screenshotPath,
          resourceUri: shot.resourceUri,
          title: rendered.title,
          viewport: shot.viewport,
          fullPage: shot.fullPage,
          consoleErrors: shot.consoleErrors,
          pageErrors: shot.pageErrors,
          diagnostics: rendered.diagnostics,
          warnings: rendered.warnings,
          cssSources: rendered.cssSources,
          durationMs: shot.durationMs,
          shell: rendered.shell,
        }
      );
    })
  );

  registerResources(server);
  registerPrompts(server);
  return server;
}
