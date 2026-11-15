/**
 * Node 的内置 fetch 默认不读取 HTTPS_PROXY；Wikidot 在部分网络环境下必须走代理。
 *
 * 策略：
 * - WIKIDOT_LAYOUT_PROXY 显式指定代理时使用 ProxyAgent；
 * - 否则检测到 HTTP(S)_PROXY 时使用 EnvHttpProxyAgent（自动遵守 NO_PROXY）；
 * - WIKIDOT_LAYOUT_DISABLE_PROXY=1 时完全跳过。
 *
 * 只影响 Node 发出的请求；Playwright 使用系统代理设置。
 */

import { EnvHttpProxyAgent, ProxyAgent, setGlobalDispatcher } from 'undici';
import { log } from '../logger.js';

let installed = false;

export function installProxyFromEnv(): void {
  if (installed) return;
  installed = true;
  if (process.env.WIKIDOT_LAYOUT_DISABLE_PROXY === '1') return;

  const explicit = process.env.WIKIDOT_LAYOUT_PROXY?.trim();
  if (explicit) {
    setGlobalDispatcher(new ProxyAgent(explicit));
    log.info('Wikidot 请求使用显式代理 WIKIDOT_LAYOUT_PROXY');
    return;
  }

  const hasEnvProxy = Boolean(
    process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy
  );
  if (!hasEnvProxy) return;
  if (process.env.WIKIDOT_LAYOUT_USE_ENV_PROXY === '0') return;

  setGlobalDispatcher(new EnvHttpProxyAgent());
  log.info('Wikidot 请求使用环境代理（HTTP(S)_PROXY，遵守 NO_PROXY）');
}
