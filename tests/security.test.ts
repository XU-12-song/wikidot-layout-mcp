import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertPublicHttpUrl,
  normalizePage,
  normalizeSite,
  resolveAllowedPath,
  safeJoin,
} from '../src/security/paths.ts';
import { startStaticServer } from '../src/screenshot/static-server.ts';

test('站点名归一化与非法输入', () => {
  assert.equal(normalizeSite('https://www.SCP-Wiki-CN.wikidot.com/scp-173'), 'scp-wiki-cn');
  assert.equal(normalizeSite('scp-wiki'), 'scp-wiki');
  assert.throws(() => normalizeSite('../etc'), /非法站点名/);
  assert.throws(() => normalizeSite('foo bar'), /非法站点名/);
});

test('页面名拒绝 URL 与路径穿越', () => {
  assert.equal(normalizePage('/scp-173'), 'scp-173');
  assert.equal(normalizePage('theme:bedrock'), 'theme:bedrock');
  assert.throws(() => normalizePage('https://evil.example/x'), /不能是 URL/);
  assert.throws(() => normalizePage('../secret'), /非法字符/);
  assert.throws(() => normalizePage('a?b=1'), /非法字符/);
});

test('resolveAllowedPath 阻止越界与绝对路径逃逸', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-outside-'));
  const inside = resolveAllowedPath('sub/page.ftml', [root]);
  assert.equal(inside, path.join(root, 'sub', 'page.ftml'));
  assert.throws(() => resolveAllowedPath('../escape.txt', [root]), /不在允许目录内/);
  assert.throws(() => resolveAllowedPath(path.join(outside, 'x.txt'), [root]), /不在允许目录内/);
  assert.throws(() => resolveAllowedPath('', [root]), /不能为空/);
});

test('safeJoin 拒绝编码后的路径穿越', () => {
  const root = path.resolve(os.tmpdir());
  assert.ok(safeJoin(root, '/a/b.css'));
  assert.equal(safeJoin(root, '/../etc/passwd'), null);
  assert.equal(safeJoin(root, '/%2e%2e/%2e%2e/etc/passwd'), null);
  assert.equal(safeJoin(root, '/a%5c..%5cb'), null);
});

test('截图 URL 拒绝协议与非公网地址', async () => {
  await assert.rejects(() => assertPublicHttpUrl('file:///etc/passwd'), /只允许 http\/https/);
  await assert.rejects(() => assertPublicHttpUrl('http://127.0.0.1:8080/'), /拒绝内网地址/);
  await assert.rejects(() => assertPublicHttpUrl('http://10.1.2.3/'), /拒绝内网地址/);
  await assert.rejects(() => assertPublicHttpUrl('http://192.168.1.1/'), /拒绝内网地址/);
  await assert.rejects(() => assertPublicHttpUrl('http://localhost/'), /拒绝本机\/内网主机/);
  await assert.rejects(() => assertPublicHttpUrl('http://user:pass@example.com/'), /不能内嵌凭证/);
  const ok = await assertPublicHttpUrl('https://93.184.216.34/');
  assert.equal(ok.protocol, 'https:');
});

test('静态服务只读 localhost 且路径受限', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-artifacts-'));
  fs.writeFileSync(path.join(root, 'style.css'), 'body{color:red}', 'utf8');
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>ok</h1>', 'utf8');
  fs.writeFileSync(path.join(path.dirname(root), 'outside.txt'), 'outside', 'utf8');
  const server = await startStaticServer(root);
  try {
    const css = await fetch(`${server.origin}/style.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type') ?? '', /text\/css/);

    const index = await fetch(`${server.origin}/`);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /<h1>ok<\/h1>/);

    const missing = await fetch(`${server.origin}/missing.txt`);
    assert.equal(missing.status, 404);

    const traversal = await fetch(`${server.origin}/..%2Foutside.txt`);
    assert.ok([403, 404].includes(traversal.status), `unexpected ${traversal.status}`);
  } finally {
    await server.close();
  }
});
