#!/usr/bin/env node
/**
 * wikidot-layout MCP server（stdio）。
 * stdout 只用于 JSON-RPC；所有日志写 stderr。
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { closeBrowser } from './screenshot/browser.js';
import { closeWikidotClients } from './wikidot/client.js';
import { installProxyFromEnv } from './net/proxy.js';
import { log } from './logger.js';

async function main(): Promise<void> {
  installProxyFromEnv();
  const server = createServer();
  await server.connect(new StdioServerTransport());
  log.info('wikidot-layout MCP 已启动（stdio）');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`收到 ${signal}，正在关闭`);
    try {
      await server.close();
    } catch {
      /* ignore */
    }
    await Promise.allSettled([closeBrowser(), closeWikidotClients()]);
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('uncaughtException', (error) => log.error('uncaughtException', error));
  process.on('unhandledRejection', (reason) => log.error('unhandledRejection', reason));
}

main().catch((error) => {
  log.error('启动失败', error);
  process.exit(1);
});
