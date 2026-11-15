import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESET_IDS, getPreset, listPresets, loadPresetAssets } from '../src/presets/registry.ts';
import { scaffold } from '../src/presets/scaffold.ts';
import { renderPreview } from '../src/render/renderer.ts';
import { validateCss } from '../src/render/validate.ts';
import { scanFtml } from '../src/wikidot/analyze.ts';

test('内置预设共 8 个，id 与清单一致', () => {
  const presets = listPresets();
  assert.equal(presets.length, 8);
  assert.deepEqual(
    presets.map((p) => p.id),
    [...PRESET_IDS]
  );
  for (const preset of presets) {
    assert.ok(preset.name);
    assert.ok(preset.description);
    assert.ok(preset.regions.length > 0);
    assert.ok(Object.keys(preset.tokens).length > 0);
  }
});

for (const id of PRESET_IDS) {
  test(`预设 ${id} 渲染成功且无错误`, async () => {
    const detail = getPreset(id);
    assert.equal(detail.id, id);
    assert.ok(detail.resolvedFiles['page.ftml'].includes('lay-page'));
    assert.equal(detail.resolvedFiles['page.ftml'].includes('{{'), false, 'token 必须全部替换');
    assert.ok(detail.resolvedFiles['layout.css'].includes('.lay-topbar'), '共享基座 CSS 必须内联');
    assert.equal(
      detail.resolvedFiles['layout.css'].includes('../_shared/base.css'),
      false,
      '不得残留本地 @import'
    );

    const css = validateCss(detail.resolvedFiles['layout.css']);
    assert.deepEqual(css.errors, []);

    const scan = scanFtml(detail.resolvedFiles['page.ftml'], 'scp-wiki-cn');
    assert.deepEqual(
      scan.warnings.filter((w) => w.code === 'unclosed-block' || w.code === 'stray-close'),
      []
    );

    const rendered = await renderPreview({
      ftml: detail.resolvedFiles['page.ftml'],
      css: detail.resolvedFiles['layout.css'],
      site: 'scp-wiki-cn',
      page: id,
      includeTheme: false,
    });
    const errors = rendered.diagnostics.filter((d) => d.severity === 'error');
    assert.deepEqual(errors, []);
    assert.match(rendered.documentHtml, /<meta charset="utf-8">/);
    assert.match(rendered.documentHtml, /initWdprRuntime/);
    assert.match(rendered.documentHtml, /id="custom-css"/);
    assert.ok(rendered.fragmentHtml.length > 200);
  });
}

test('token 覆盖生效', () => {
  const detail = getPreset('docs-sidebar', { tokens: { contentWidth: '940px', accent: '#123456' } });
  assert.match(detail.resolvedFiles['layout.css'], /--lay-content-width: 940px/);
  assert.match(detail.resolvedFiles['layout.css'], /--lay-accent: #123456/);
  assert.throws(() => getPreset('docs-sidebar', { tokens: { nope: 'x' } }), /未知 token/);
});

test('scaffold 裁剪区域并拒绝移除 content', () => {
  const result = scaffold({
    presetId: 'docs-sidebar',
    regions: ['sidebar', 'content'],
    title: '测试页面',
  });
  assert.equal(result.ok, true);
  assert.equal(result.regions.includes('topbar'), false);
  assert.equal(result.files['page.ftml'].includes('lay-region-topbar'), false);
  assert.match(result.files['page.ftml'], /测试页面/);

  assert.throws(
    () => scaffold({ presetId: 'docs-sidebar', regions: ['topbar'] }),
    /区域不可移除/
  );
  assert.throws(() => scaffold({ presetId: 'nope' }), /未知版式预设/);
});

test('scaffold 支持追加自定义区域', () => {
  const result = scaffold({
    presetId: 'article-single',
    addRegions: [{ name: 'notice', ftml: '**新公告**', position: 'end' }],
  });
  assert.match(result.files['page.ftml'], /lay-region-notice/);
  assert.match(result.files['page.ftml'], /新公告/);
});
