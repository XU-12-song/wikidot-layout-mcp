import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, resolveExecutable } from '../src/screenshot/browser.ts';
import { captureScreenshot } from '../src/screenshot/capture.ts';
import { LayoutError } from '../src/errors.ts';

let browserAvailable = true;
try {
  resolveExecutable();
} catch {
  browserAvailable = false;
}

test.after(async () => {
  await closeBrowser();
});

test('截图 URL 安全校验先于浏览器启动', async () => {
  await assert.rejects(
    () => captureScreenshot({ url: 'http://127.0.0.1:9000/' }),
    (e: unknown) => e instanceof LayoutError && e.code === 'PATH_NOT_ALLOWED'
  );
});

test('无来源时报 INVALID_INPUT', async () => {
  await assert.rejects(
    () => captureScreenshot({}),
    (e: unknown) => e instanceof LayoutError && e.code === 'INVALID_INPUT'
  );
});

test('桌面视口截图尺寸与 console 错误回传', { skip: !browserAvailable }, async () => {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}</style></head>
<body>
<div style="height:600px;background:#eee">viewport</div>
<div class="target" style="width:200px;height:100px;background:#c33">target</div>
<script>console.error('boom-from-page')</script>
</body></html>`;
  const result = await captureScreenshot({
    html,
    viewport: { width: 390, height: 844 },
    fullPage: false,
  });
  assert.equal(result.width, 390);
  assert.equal(result.height, 844);
  assert.ok(result.screenshotPath.endsWith('screenshot.png'));
  assert.ok(result.resourceUri.startsWith('artifact://'));
  assert.ok(result.consoleErrors.some((e) => e.text.includes('boom-from-page')));
});

test('fullPage 高度覆盖长页面', { skip: !browserAvailable }, async () => {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}</style></head>
<body><div style="height:1600px;background:#eee"></div></body></html>`;
  const result = await captureScreenshot({
    html,
    viewport: 'mobile',
    fullPage: true,
  });
  assert.equal(result.width, 390);
  assert.ok(result.height >= 1550, `expected tall screenshot, got ${result.height}`);
  assert.equal(result.fullPage, true);
});

test('selector 截图只包含目标元素', { skip: !browserAvailable }, async () => {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}</style></head>
<body><div style="height:900px"></div>
<div class="target" style="width:240px;height:120px;background:#369"></div>
</body></html>`;
  const result = await captureScreenshot({
    html,
    viewport: 'desktop',
    selector: '.target',
  });
  assert.equal(result.width, 240);
  assert.equal(result.height, 120);
});
