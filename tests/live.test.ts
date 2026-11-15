/**
 * 真实网络集成测试，默认跳过：
 *   LIVE=1 [WIKIDOT_LAYOUT_PROXY=http://127.0.0.1:PORT] node --import tsx --test tests/live.test.ts
 *
 * 使用公开页面验证匿名客户端 + 缓存 + contentHash。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { installProxyFromEnv } from '../src/net/proxy.ts';
import { getPageSource, clearSourceMemo } from '../src/wikidot/source.ts';
import { analyzePageStructure } from '../src/wikidot/analyze.ts';
import { closeWikidotClients } from '../src/wikidot/client.ts';

test.after(async () => {
  await closeWikidotClients();
});

test(
  'LIVE：匿名获取公开页面源码（客户端 + AMC）',
  { skip: process.env.LIVE !== '1', timeout: 120_000 },
  async () => {
    installProxyFromEnv();
    clearSourceMemo();
    const data = await getPageSource({
      site: 'scp-wiki',
      page: 'scp-173',
      forceRefresh: true,
    });
    assert.equal(data.site, 'scp-wiki');
    assert.equal(data.page, 'scp-173');
    assert.ok(data.source.length > 100, '源码长度应大于 100');
    assert.ok(data.pageId, '应获取到 pageId');
    assert.match(data.contentHash, /^sha256:[a-f0-9]{64}$/);
    assert.ok(data.fetchedAt);
    assert.ok(data.normalizedSource !== null);
  }
);

test(
  'LIVE：公开页面结构分析（源码层 + 渲染层）',
  { skip: process.env.LIVE !== '1', timeout: 120_000 },
  async () => {
    installProxyFromEnv();
    const data = await analyzePageStructure({
      site: 'scp-wiki',
      page: 'scp-173',
      forceRefresh: true,
    });
    assert.equal(data.pageType, 'article');
    assert.equal(data.title, 'SCP-173');
    assert.ok(data.blocks.length > 0, '应解析出块结构');
    assert.ok(data.includes.length > 0, 'SCP-173 含 license-box include');
    assert.ok(data.modules.some((m) => m.name.toLowerCase() === 'rate'), '应识别 Rate 模块');
    assert.ok(data.dom?.fetched, '渲染层应抓取成功');
    assert.equal(data.dom?.pageContent, true);
    assert.ok(data.sourceMeta.contentHash.startsWith('sha256:'));
  }
);
