import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT_MARKER,
  TITLE_MARKER,
  applyShell,
  parseTemplateHtml,
  resolveShell,
} from '../src/render/shell.ts';
import { renderPreview } from '../src/render/renderer.ts';

test('内置外壳包含完整 Wikidot 区域', async () => {
  const shell = await resolveShell({ mode: 'builtin' });
  assert.equal(shell.mode, 'builtin');
  assert.equal(shell.source, 'builtin');
  assert.ok(shell.html);
  for (const id of [
    'container',
    'header',
    'top-bar',
    'side-bar',
    'main-content',
    'page-title',
    'page-content',
    'page-options-container',
    'footer',
    'license-area',
  ]) {
    assert.ok(shell.html!.includes(`id="${id}"`), `缺少 #${id}`);
  }
  assert.ok(shell.html!.includes(TITLE_MARKER));
  assert.ok(shell.html!.includes(CONTENT_MARKER));
});

test('普通 FTML 默认套整页外壳并注入标题/正文', async () => {
  const rendered = await renderPreview({
    ftml: '+ 正文标题\n\n正文内容',
    page: 'Lab',
    title: 'Lab',
    site: 'scpsandboxcn',
    shell: 'builtin',
    includeTheme: false,
  });
  assert.equal(rendered.shell.mode, 'builtin');
  const html = rendered.documentHtml;
  assert.match(html, /id="container"/);
  assert.match(html, /id="header"/);
  assert.match(html, /id="top-bar"/);
  assert.match(html, /id="side-bar"/);
  assert.match(html, /id="main-content"/);
  assert.match(html, /<div id="page-title">Lab<\/div>/);
  assert.match(html, /<div id="page-content"><h1[^>]*><span>正文标题<\/span><\/h1>/);
  assert.equal(html.includes(TITLE_MARKER), false);
  assert.equal(html.includes(CONTENT_MARKER), false);
});

test('lay-page 完整原型默认不套外壳，可显式覆盖', async () => {
  const presetish = '[[div class="lay-page"]]\n内容\n[[/div]]';
  const auto = await renderPreview({ ftml: presetish, includeTheme: false });
  assert.equal(auto.shell.mode, 'none');
  assert.equal(auto.documentHtml.includes('id="top-bar"'), false);

  const forced = await renderPreview({
    ftml: presetish,
    includeTheme: false,
    shell: 'builtin',
  });
  assert.equal(forced.shell.mode, 'builtin');
  assert.ok(forced.documentHtml.includes('id="top-bar"'));
});

test('_template 解析：marker、去脚本、相对链接绝对化', () => {
  const template = `<!doctype html><html><body><div id="container">
    <div id="header"><div id="top-bar"><ul><li>主页</li></ul></div></div>
    <div id="content-wrap"><div id="side-bar"></div><div id="main-content">
      <div id="page-content">正文</div>
    </div></div>
    <script>alert(1)</script>
    <a id="x" href="/nav:side" onclick="bad()">x</a>
  </div></body></html>`;
  const html = parseTemplateHtml('scpsandboxcn', template);
  assert.ok(html.includes(TITLE_MARKER));
  assert.ok(html.includes(CONTENT_MARKER));
  assert.equal(html.includes('<script'), false);
  assert.equal(html.includes('onclick'), false);
  assert.ok(html.includes('https://scpsandboxcn.wikidot.com/nav:side'));
  assert.ok(html.includes('<li><a href="#">主页</a></li>'), '顶栏文本应被 <a> 包裹');
  assert.equal(applyShell('<div><!--LAYOUT_TITLE--></div><div><!--LAYOUT_CONTENT--></div>', 'T', 'C'), '<div>T</div><div>C</div>');
});
