/** MCP Resources：语法/结构文档、预设、artifact。 */

import fs from 'node:fs';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LAYOUT_BLOCKS, PAGE_ANATOMY, SYNTAX_OVERVIEW, THEMES } from './docs-content.js';
import { getPreset, listPresets } from './presets/registry.js';
import { artifactDir } from './artifacts.js';
import { LayoutError } from './errors.js';
import { THEME_CATALOG } from './themes/catalog.js';

function textResource(server: McpServer, name: string, uri: string, title: string, text: string): void {
  server.registerResource(
    name,
    uri,
    { title, description: title, mimeType: 'text/markdown' },
    async (resourceUri) => ({
      contents: [{ uri: resourceUri.href, mimeType: 'text/markdown', text }],
    })
  );
}

export function registerResources(server: McpServer): void {
  textResource(server, 'syntax-overview', 'wikidot://syntax/overview', 'Wikidot 语法速览', SYNTAX_OVERVIEW);
  textResource(server, 'syntax-layout-blocks', 'wikidot://syntax/layout-blocks', '版式块与配对规则', LAYOUT_BLOCKS);
  textResource(server, 'structure-page-anatomy', 'wikidot://structure/page-anatomy', 'Wikidot 页面结构', PAGE_ANATOMY);
  textResource(server, 'structure-themes', 'wikidot://structure/themes', '主题与 CSS', THEMES);

  server.registerResource(
    'theme-catalog',
    'wikidot://themes/catalog',
    {
      title: '主题来源目录',
      description: '主题页 URL、GitHub 仓库、本地 CSS 来源与 normalize 技巧（JSON）',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify({ ok: true, catalog: THEME_CATALOG }, null, 2),
      }],
    })
  );

  server.registerResource(
    'preset-list',
    'preset://list',
    { title: '内置版式列表', description: '8 个内置版式原型的摘要', mimeType: 'application/json' },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({ ok: true, presets: listPresets() }, null, 2),
        },
      ],
    })
  );

  server.registerResource(
    'preset-detail',
    new ResourceTemplate('preset://{id}', { list: undefined }),
    { title: '版式预设详情', description: '读取指定预设的 manifest、FTML、CSS 与说明', mimeType: 'application/json' },
    async (uri, variables) => {
      const id = String(variables.id ?? '');
      const preset = getPreset(id);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(preset, null, 2),
          },
        ],
      };
    }
  );

  server.registerResource(
    'artifact-file',
    new ResourceTemplate('artifact://{artifactId}/{file}', { list: undefined }),
    { title: '渲染产物文件', description: 'artifact 的 index.html / screenshot.png / meta.json', mimeType: 'application/octet-stream' },
    async (uri, variables) => {
      const artifactId = String(variables.artifactId ?? '');
      const rawFile = decodeURIComponent(String(variables.file ?? ''));
      const file = path.basename(rawFile);
      if (!file || file !== rawFile || file.startsWith('.')) {
        throw new LayoutError('INVALID_INPUT', `非法 artifact 文件名: ${rawFile}`);
      }
      const dir = artifactDir(artifactId);
      const target = path.join(dir, file);
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        throw new LayoutError('INVALID_INPUT', `artifact 文件不存在: ${artifactId}/${file}`);
      }
      const data = fs.readFileSync(target);
      const lower = file.toLowerCase();
      if (lower.endsWith('.png')) {
        return {
          contents: [{ uri: uri.href, mimeType: 'image/png', blob: data.toString('base64') }],
        };
      }
      if (lower.endsWith('.html')) {
        return {
          contents: [{ uri: uri.href, mimeType: 'text/html; charset=utf-8', text: data.toString('utf8') }],
        };
      }
      if (lower.endsWith('.json') || lower.endsWith('.md')) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: lower.endsWith('.json') ? 'application/json' : 'text/markdown',
            text: data.toString('utf8'),
          }],
        };
      }
      return {
        contents: [{ uri: uri.href, mimeType: 'application/octet-stream', blob: data.toString('base64') }],
      };
    }
  );
}
