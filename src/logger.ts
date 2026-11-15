/**
 * 只写 stderr。stdout 是 MCP JSON-RPC 通道，任何日志都不能进入。
 * 输出前统一遮蔽 Cookie / token / Authorization / password。
 */

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/((?:wikidot_token7|cookie|authorization|password|token)\s*[=:]\s*)([^\s;,]+)/gi, '$1[REDACTED]'],
  [/((?:set-cookie|Cookie):\s*)(.+)$/gim, '$1[REDACTED]'],
  [/(--(?:cookie|password|token)[=\s]+)(\S+)/gi, '$1[REDACTED]'],
];

export function redact(value: unknown): string {
  let text = typeof value === 'string' ? value : String(value);
  for (const [re, replacement] of SECRET_PATTERNS) text = text.replace(re, replacement);
  return text;
}

function write(level: string, args: unknown[]): void {
  const line = args.map((a) => (a instanceof Error ? a.stack ?? a.message : redact(a))).join(' ');
  process.stderr.write(`[wikidot-layout][${level}] ${line}\n`);
}

export const log = {
  debug: (...args: unknown[]) => {
    if (process.env.WIKIDOT_LAYOUT_DEBUG === '1') write('debug', args);
  },
  info: (...args: unknown[]) => write('info', args),
  warn: (...args: unknown[]) => write('warn', args),
  error: (...args: unknown[]) => write('error', args),
};
