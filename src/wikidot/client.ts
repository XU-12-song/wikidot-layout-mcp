/**
 * @ukwhatn/wikidot 客户端。
 *
 * 匿名：Client.createAnonymous()，绝不接收工具参数中的凭证。
 * 私有：仅在 WIKIDOT_LAYOUT_ALLOW_PRIVATE=1 且服务端环境变量提供
 *       WIKIDOT_USERNAME / WIKIDOT_PASSWORD 时创建登录客户端。
 */

import { Client } from '@ukwhatn/wikidot';
import type { Page, Site } from '@ukwhatn/wikidot';
import { CONFIG } from '../config.js';
import { LayoutError } from '../errors.js';
import { log } from '../logger.js';

let anonymous: Client | null = null;
let privateClient: Client | null = null;
let privateAttempted = false;

export function getAnonymousClient(): Client {
  anonymous ??= Client.createAnonymous();
  return anonymous;
}

export function privateAccessConfigured(): boolean {
  return Boolean(
    CONFIG.privateAccess.enabled &&
      CONFIG.privateAccess.username &&
      CONFIG.privateAccess.password
  );
}

/** 创建（或复用）登录客户端；凭证永远来自服务端环境变量。 */
export async function getPrivateClient(): Promise<Client | null> {
  if (!privateAccessConfigured()) return null;
  if (privateClient) return privateClient;
  if (privateAttempted) return null;
  privateAttempted = true;
  const result = await Client.create({
    username: CONFIG.privateAccess.username!,
    password: CONFIG.privateAccess.password!,
  });
  if (!result.isOk()) {
    log.warn(`私有访问登录失败: ${String(result.error)}`);
    return null;
  }
  privateClient = result.value;
  log.info('已启用服务端配置的私有页面凭证');
  return privateClient;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function classifyWikidotError(error: unknown): LayoutError {
  const message = errorText(error);
  if (/permission|forbidden|not allowed|access denied|无权|禁止/i.test(message)) {
    return new LayoutError('SOURCE_FORBIDDEN', `没有读取权限：${message}`);
  }
  if (/not found|does not exist|不存在|404/i.test(message)) {
    return new LayoutError('PAGE_NOT_FOUND', `页面不存在：${message}`);
  }
  return new LayoutError('NETWORK_ERROR', `Wikidot 请求失败：${message}`, { retryable: true });
}

export async function getSite(client: Client, site: string): Promise<Site> {
  const result = await client.site.get(site);
  if (!result.isOk()) throw classifyWikidotError(result.error);
  return result.value;
}

export async function getPage(site: Site, pageName: string): Promise<Page | null> {
  const result = await site.page.get(pageName);
  if (!result.isOk()) throw classifyWikidotError(result.error);
  return result.value ?? null;
}

export function sourceText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof (value as { wikiText?: unknown }).wikiText === 'string') {
    return (value as { wikiText: string }).wikiText;
  }
  return String(value ?? '');
}

/** 关闭所有客户端（MCP 退出时）。 */
export async function closeWikidotClients(): Promise<void> {
  const clients = [anonymous, privateClient].filter(Boolean) as Client[];
  anonymous = null;
  privateClient = null;
  privateAttempted = false;
  await Promise.all(
    clients.map(async (client) => {
      try {
        await client.close?.();
      } catch {
        /* 关闭失败不影响退出 */
      }
    })
  );
}
