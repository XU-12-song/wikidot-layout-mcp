/**
 * sigma 主题最小修改工作流演示。
 *
 * 通过真实 MCP stdio 服务依次调用：
 *   layout_validate → layout_render_preview → layout_screenshot
 * 分别渲染基线与最小修改版，并把截图复制到 examples/sigma-demo/。
 *
 * 运行：npm run build && node scripts/demo-sigma.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demoDir = path.join(root, 'examples', 'sigma-demo');
const ftml = fs.readFileSync(path.join(demoDir, 'page.ftml'), 'utf8');
const customCss = fs.readFileSync(path.join(demoDir, 'custom.css'), 'utf8');
const previewBase = fs.readFileSync(path.join(demoDir, 'preview-base.css'), 'utf8');

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, 'dist', 'index.js')],
  stderr: 'inherit',
});
const client = new Client({ name: 'sigma-demo', version: '0.0.0' });
await client.connect(transport);

async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    throw new Error(`${name} 失败: ${JSON.stringify(result.structuredContent)}`);
  }
  return result.structuredContent;
}

const validation = await call('layout_validate', {
  ftml,
  css: customCss,
  site: 'scpsandboxcn',
});
console.log(
  `[validate] valid=${validation.valid} errors=${validation.errors.length} warnings=${validation.warnings.length}`
);

async function shoot(label, css, viewports) {
  const preview = await call('layout_render_preview', {
    ftml,
    css,
    site: 'scpsandboxcn',
    page: 'Lab',
    viewport: 'desktop',
    shell: 'site',
  });
  console.log(
    `[render] ${label}: artifact=${preview.artifactId} shell=${preview.shell.mode}/${preview.shell.source} diagnostics=${preview.diagnostics.length} cssSources=${preview.cssSources.join('+')}`
  );
  for (const viewport of viewports) {
    const shot = await call('layout_screenshot', {
      artifactId: preview.artifactId,
      viewport,
      fullPage: true,
    });
    const out = path.join(demoDir, `${label}-${viewport}.png`);
    fs.copyFileSync(shot.screenshotPath, out);
    console.log(
      `[screenshot] ${label}/${viewport}: ${shot.width}x${shot.height} -> ${path.relative(root, out)} (console=${shot.consoleErrors.length}, page=${shot.pageErrors.length})`
    );
  }
  return preview.artifactId;
}

const baseline = await shoot('baseline', previewBase, ['desktop', 'mobile']);
const modified = await shoot('modified', `${previewBase}\n${customCss}`, ['desktop', 'mobile']);

await client.close();
console.log(JSON.stringify({ baseline, modified }, null, 2));
