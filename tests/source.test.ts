import test from 'node:test';
import assert from 'node:assert/strict';
import { MockAgent, setGlobalDispatcher } from 'undici';
import { fetchSourceViaAmc } from '../src/wikidot/amc.ts';
import { LayoutError } from '../src/errors.ts';

const HOST = 'https://scp-wiki.wikidot.com';
const TOKEN_HEADER = { 'set-cookie': 'wikidot_token7=abc123; Path=/' };

let activeAgent: MockAgent | null = null;

test.beforeEach(() => {
  activeAgent = new MockAgent();
  activeAgent.disableNetConnect();
  setGlobalDispatcher(activeAgent);
});

test.afterEach(async () => {
  await activeAgent?.close();
  activeAgent = null;
});

function pool() {
  return activeAgent!.get(HOST);
}

test('AMC 匿名获取源码', async () => {
  const html = [
    '<html><head><title>SCP-173</title></head><body>',
    '<div id="page-title">SCP-173</div>',
    '<script>pageId = 1956234;</script>',
    '</body></html>',
  ].join('');
  pool()
    .intercept({ path: '/scp-173', method: 'GET' })
    .reply(200, html, { headers: TOKEN_HEADER });
  pool()
    .intercept({ path: '/ajax-module-connector.php', method: 'POST' })
    .reply(200, JSON.stringify({
      status: 'ok',
      body: '<div class="page-source">**Item #:** SCP-173\n\nObject Class: Euclid</div>',
    }), { headers: { 'content-type': 'application/json' } });

  const result = await fetchSourceViaAmc('scp-wiki', 'scp-173');
  assert.equal(result.pageId, 1956234);
  assert.equal(result.title, 'SCP-173');
  assert.match(result.source, /Object Class: Euclid/);
});

test('AMC wrong_token7 自动刷新并重试一次', async () => {
  const html = '<script>pageId = 42;</script>';
  for (let i = 0; i < 2; i++) {
    pool()
      .intercept({ path: '/retry-page', method: 'GET' })
      .reply(200, html, { headers: TOKEN_HEADER });
  }
  pool()
    .intercept({ path: '/ajax-module-connector.php', method: 'POST' })
    .reply(200, JSON.stringify({ status: 'wrong_token7' }), { headers: { 'content-type': 'application/json' } });
  pool()
    .intercept({ path: '/ajax-module-connector.php', method: 'POST' })
    .reply(200, JSON.stringify({ status: 'ok', body: '<div class="page-source">ok</div>' }), {
      headers: { 'content-type': 'application/json' },
    });

  const result = await fetchSourceViaAmc('scp-wiki', 'retry-page');
  assert.equal(result.source, 'ok');
});

test('AMC 无权限返回 SOURCE_FORBIDDEN', async () => {
  pool()
    .intercept({ path: '/private-page', method: 'GET' })
    .reply(200, '<script>pageId = 7;</script>', { headers: TOKEN_HEADER });
  pool()
    .intercept({ path: '/ajax-module-connector.php', method: 'POST' })
    .reply(200, JSON.stringify({ status: 'ok', body: '<div>You do not have permission to view this page.</div>' }), {
      headers: { 'content-type': 'application/json' },
    });

  await assert.rejects(
    () => fetchSourceViaAmc('scp-wiki', 'private-page'),
    (e: unknown) => e instanceof LayoutError && e.code === 'SOURCE_FORBIDDEN'
  );
});

test('AMC 404 映射为 PAGE_NOT_FOUND', async () => {
  pool().intercept({ path: '/no-such-page', method: 'GET' }).reply(404, 'not found');
  await assert.rejects(
    () => fetchSourceViaAmc('scp-wiki', 'no-such-page'),
    (e: unknown) => e instanceof LayoutError && e.code === 'PAGE_NOT_FOUND'
  );
});

test('AMC 5xx 映射为 NETWORK_ERROR', async () => {
  pool().intercept({ path: '/broken-page', method: 'GET' }).reply(503, 'busy');
  await assert.rejects(
    () => fetchSourceViaAmc('scp-wiki', 'broken-page'),
    (e: unknown) => e instanceof LayoutError && e.code === 'NETWORK_ERROR'
  );
});
