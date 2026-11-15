import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanFtml, analyzeDom } from '../src/wikidot/analyze.ts';
import { dirtToIdeal } from '../src/compat/ideal.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

test('scanFtml 配对 div_ 与 /div，且不把 div_ 当成独立标签', () => {
  const src = [
    '[[div class="outer"]]',
    '[[div_ class="inner"]]',
    '文本',
    '[[/div]]',
    '[[/div]]',
  ].join('\n');
  const result = scanFtml(src, 'scp-wiki-cn');
  assert.equal(result.warnings.length, 0);
  assert.equal(result.blocks.length, 2);
  assert.equal(result.blocks[0].tag, 'div');
  assert.equal(result.blocks[0].depth, 1);
  assert.equal(result.blocks[1].tag, 'div');
  assert.equal(result.blocks[1].variant, 'div_');
  assert.equal(result.blocks[1].depth, 2);
  assert.equal(result.blocks[1].closed, true);
});

test('scanFtml 报告未闭合块与游离闭合标签', () => {
  const src = [
    '[[div class="outer"]]',
    '[[/span]]',
  ].join('\n');
  const result = scanFtml(src, 'scp-wiki');
  assert.ok(result.warnings.some((w) => w.code === 'stray-close'));
  assert.ok(result.warnings.some((w) => w.code === 'unclosed-block'));
});

test('scanFtml 跳过 code/html/embed 体内的伪块标签', () => {
  const src = [
    '[[code]]',
    '[[div class="fake"]]',
    '[[/div]]',
    '[[/code]]',
    '[[div class="real"]]',
    '[[/div]]',
  ].join('\n');
  const result = scanFtml(src, 'site');
  assert.equal(result.blocks.length, 2);
  assert.equal(result.blocks[0].tag, 'code');
  assert.equal(result.blocks[1].classes[0], 'real');
  assert.equal(result.warnings.length, 0);
});

test('scanFtml 识别标题、include、module 与站内/跨站区别', () => {
  const src = [
    '+ 一级标题',
    '++ 二级标题',
    '[[include component:info-panel name=示例]]',
    '[[include :scp-wiki:component:info-panel]]',
    '[[module Rate]]',
    '[[module CSS]]',
    'body { color: red; }',
    '[[/module]]',
  ].join('\n');
  const result = scanFtml(src, 'scp-wiki-cn');
  assert.deepEqual(result.headings.map((h) => h.level), [1, 2]);
  assert.equal(result.headings[0].text, '一级标题');
  assert.equal(result.includes.length, 2);
  assert.equal(result.includes[0].kind, 'local');
  assert.equal(result.includes[0].target, 'component:info-panel');
  assert.equal(result.includes[0].arguments.name, '示例');
  assert.equal(result.includes[1].kind, 'cross-site');
  assert.equal(result.includes[1].site, 'scp-wiki');
  assert.deepEqual(result.modules.map((m) => m.name), ['Rate', 'CSS']);
});

test('dirtToIdeal 在块闭合前补齐未闭合的行内标签', () => {
  const src = '[[div]]\n[[span class="x"]]未闭合\n[[/div]]';
  const result = dirtToIdeal(src);
  assert.equal(result.changed, true);
  assert.equal(result.src, '[[div]]\n[[span class="x"]]未闭合\n[[/span]][[/div]]');
});

test('analyzeDom 检测页级节点', () => {
  const html = fs.readFileSync(path.join(here, 'fixtures', 'structure-page.html'), 'utf8');
  const dom = analyzeDom(html);
  assert.equal(dom.fetched, true);
  assert.equal(dom.pageTitle, true);
  assert.equal(dom.pageContent, true);
  assert.equal(dom.pageOptions, true);
  assert.equal(dom.ratingModule, true);
  assert.equal(dom.breadcrumbs, true);
  assert.equal(dom.toc, true);
  assert.equal(dom.topBar, true);
  assert.equal(dom.sideBar, true);
  assert.equal(dom.title, '示例页面');
});
