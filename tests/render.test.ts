import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCss, validateFtmlAndCss } from '../src/render/validate.ts';
import { renderPreview, readLocalTheme } from '../src/render/renderer.ts';

test('CSS 校验：花括号、import 顺序与 style 逃逸', () => {
  assert.deepEqual(validateCss('.a { color: red; }').errors, []);
  const unbalanced = validateCss('.a { color: red;');
  assert.ok(unbalanced.errors.some((e) => e.code === 'css-unclosed-brace'));

  const extra = validateCss('.a { } }');
  assert.ok(extra.errors.some((e) => e.code === 'css-unbalanced-brace'));

  const breakout = validateCss('body { content: "</style>"; }');
  assert.ok(breakout.errors.some((e) => e.code === 'css-style-breakout'));

  const order = validateCss('.a { color: red; }\n@import url("x.css");');
  assert.ok(order.warnings.some((w) => w.code === 'css-import-order'));
});

test('validate 报告未闭合块', async () => {
  const result = await validateFtmlAndCss('[[div class="x"]]\n未闭合');
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.code === 'unclosed-block'));
});

test('renderPreview 生成完整文档并内联 runtime', async () => {
  const rendered = await renderPreview({
    ftml: '+ 标题\n\n正文 **加粗**。',
    css: '.lay-test { color: red; }',
    page: 'demo',
    includeTheme: false,
  });
  assert.match(rendered.documentHtml, /<!DOCTYPE html>/);
  assert.match(rendered.documentHtml, /<meta charset="utf-8">/);
  assert.match(rendered.documentHtml, /name="viewport"/);
  assert.match(rendered.documentHtml, /initWdprRuntime/);
  assert.match(rendered.documentHtml, /\.lay-test \{ color: red; \}/);
  assert.match(rendered.fragmentHtml, /<h1[^>]*><span>标题<\/span><\/h1>/);
  assert.equal(rendered.diagnostics.filter((d) => d.severity === 'error').length, 0);
});

test('renderPreview 解析本地 include', async () => {
  const rendered = await renderPreview({
    ftml: '[[include example]]',
    page: 'demo',
    includeTheme: false,
  });
  assert.equal(rendered.includes.length, 1);
  assert.equal(rendered.includes[0].from, 'local');
  assert.match(rendered.fragmentHtml, /本地 include 示例/);
});

test('主题样式从 wikidot.css 与 sigma.css 内联', () => {
  const theme = readLocalTheme();
  assert.ok(theme.sources.includes('wikidot.css'));
  assert.ok(theme.sources.includes('sigma.css'));
  assert.ok(theme.css.length > 1000);
  assert.ok(!/@charset/i.test(theme.css), '@charset 不应出现在内联样式中');
});
