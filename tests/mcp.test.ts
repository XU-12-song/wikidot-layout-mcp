import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.ts';
import { PACKAGE_ROOT } from '../src/config.ts';

const FORBIDDEN_KEYS = new Set(['username', 'password', 'token', 'cookie']);

function collectPropertyNames(schema: unknown, out: Set<string>): void {
  if (!schema || typeof schema !== 'object') return;
  const obj = schema as Record<string, unknown>;
  const properties = obj.properties;
  if (properties && typeof properties === 'object') {
    for (const [key, value] of Object.entries(properties as Record<string, unknown>)) {
      out.add(key);
      collectPropertyNames(value, out);
    }
  }
  for (const key of ['items', 'additionalProperties', 'anyOf', 'oneOf', 'allOf']) {
    const value = obj[key];
    if (Array.isArray(value)) value.forEach((item) => collectPropertyNames(item, out));
    else if (value && typeof value === 'object') collectPropertyNames(value, out);
  }
}

test('MCP 工具注册、schema 安全与基本调用', async () => {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);

  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 11);
    const names = tools.map((t) => t.name);
    for (const expected of [
      'wikidot_list_theme_sources',
      'layout_list_presets',
      'layout_get_preset',
      'layout_scaffold',
      'layout_validate',
      'layout_export',
      'layout_render_preview',
      'layout_screenshot',
      'layout_preview_and_screenshot',
      'wikidot_get_page_source',
      'wikidot_analyze_page_structure',
    ]) {
      assert.ok(names.includes(expected), `缺少工具 ${expected}`);
    }

    for (const tool of tools) {
      const keys = new Set<string>();
      collectPropertyNames(tool.inputSchema, keys);
      for (const key of keys) {
        assert.equal(
          FORBIDDEN_KEYS.has(key.toLowerCase()),
          false,
          `${tool.name} 的 inputSchema 不应包含凭据字段 ${key}`
        );
      }
    }

    const sourceTool = tools.find((t) => t.name === 'wikidot_get_page_source');
    assert.ok(sourceTool);
    assert.equal(sourceTool?.annotations?.readOnlyHint, true);

    const listResult: any = await client.callTool({ name: 'layout_list_presets', arguments: {} });
    assert.equal(listResult.isError ?? false, false);
    assert.equal(listResult.structuredContent.total, 8);
    assert.equal(listResult.structuredContent.presets.length, 8);

    const themesResult: any = await client.callTool({
      name: 'wikidot_list_theme_sources',
      arguments: {},
    });
    assert.equal(themesResult.isError ?? false, false);
    const catalog = themesResult.structuredContent.catalog;
    assert.equal(catalog.themes.length, 3);
    assert.ok(catalog.themes.some((t: any) => t.id === 'bedrock' && t.url.includes('theme:bedrock')));
    assert.ok(catalog.themes.some((t: any) => t.repo === 'https://github.com/Basalt-Team/Basalt'));
    assert.ok(catalog.defaults.normalizeOverride.css.includes('cdn.scpwiki.com'));
    assert.ok(catalog.guidance.some((g: string) => g.includes('clone')));

    const validateResult: any = await client.callTool({
      name: 'layout_validate',
      arguments: { ftml: '[[div class="x"]]\n**ok**\n[[/div]]' },
    });
    assert.equal(validateResult.structuredContent.valid, true);
    assert.deepEqual(validateResult.structuredContent.errors, []);

    const badResult: any = await client.callTool({
      name: 'layout_get_preset',
      arguments: { id: 'not-a-preset' },
    });
    assert.equal(badResult.isError, true);
    assert.equal(badResult.structuredContent.ok, false);
    assert.equal(badResult.structuredContent.error.code, 'PRESET_NOT_FOUND');

    const exportDir = `.test-export-${process.pid}`;
    const absoluteExportDir = path.join(PACKAGE_ROOT, exportDir);
    try {
      const scaffolded: any = await client.callTool({
        name: 'layout_scaffold',
        arguments: { presetId: 'blank', outDir: exportDir, title: '导出测试' },
      });
      assert.equal(scaffolded.isError ?? false, false);
      assert.ok(fs.existsSync(path.join(absoluteExportDir, 'page.ftml')));
      assert.match(fs.readFileSync(path.join(absoluteExportDir, 'page.ftml'), 'utf8'), /导出测试/);

      const overwrite: any = await client.callTool({
        name: 'layout_scaffold',
        arguments: { presetId: 'blank', outDir: exportDir },
      });
      assert.equal(overwrite.isError, true);
      assert.equal(overwrite.structuredContent.error.code, 'EXPORT_FAILED');

      const exported: any = await client.callTool({
        name: 'layout_export',
        arguments: { presetId: 'article-single', outDir: exportDir, force: true },
      });
      assert.equal(exported.isError ?? false, false);
      assert.ok(exported.structuredContent.written.length >= 3);

      const traversal: any = await client.callTool({
        name: 'layout_export',
        arguments: { presetId: 'blank', outDir: '../../outside-dir' },
      });
      assert.equal(traversal.isError, true);
      assert.equal(traversal.structuredContent.error.code, 'PATH_NOT_ALLOWED');
    } finally {
      fs.rmSync(absoluteExportDir, { recursive: true, force: true });
    }
  } finally {
    await client.close();
    await server.close();
  }
});

test('MCP Resources 可读取语法文档与预设', async () => {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-resources', version: '0.0.0' });
  await client.connect(clientTransport);
  try {
    const syntax = await client.readResource({ uri: 'wikidot://syntax/layout-blocks' });
    assert.match((syntax.contents[0] as any).text, /div_/);

    const preset = await client.readResource({ uri: 'preset://docs-sidebar' });
    const data = JSON.parse((preset.contents[0] as any).text);
    assert.equal(data.id, 'docs-sidebar');
    assert.ok(data.files['page.ftml'].includes('lay-sidebar'));

    const listResources = await client.listResources();
    assert.ok(listResources.resources.some((r) => r.uri === 'wikidot://structure/page-anatomy'));

    const catalog = await client.readResource({ uri: 'wikidot://themes/catalog' });
    const catalogData = JSON.parse((catalog.contents[0] as any).text);
    assert.ok(catalogData.catalog.themes.some((t: any) => t.id === 'basalt'));
  } finally {
    await client.close();
    await server.close();
  }
});
