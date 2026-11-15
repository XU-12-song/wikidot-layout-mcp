import pLimit from 'p-limit';
import { LayoutError } from '../errors.js';

/** 同 host 并发限制（Wikidot 限流友好）。 */
const limiters = new Map<string, ReturnType<typeof pLimit>>();

function limiterFor(host: string, concurrency: number) {
  let limiter = limiters.get(host);
  if (!limiter) {
    limiter = pLimit(concurrency);
    limiters.set(host, limiter);
  }
  return limiter;
}

export async function withHostLimit<T>(
  host: string,
  concurrency: number,
  fn: () => Promise<T>
): Promise<T> {
  return limiterFor(host, concurrency)(fn);
}

/** 带超时的 Promise；用于包住库内部不暴露 AbortSignal 的调用。 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  what: string
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new LayoutError('NETWORK_ERROR', `${what}超时（${timeoutMs}ms）`, {
                hint: '检查网络或提高 WIKIDOT_LAYOUT_FETCH_TIMEOUT_MS。',
                retryable: true,
              })
            ),
          timeoutMs
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 可被 AbortSignal 中断的 fetch。 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new LayoutError('NETWORK_ERROR', `请求超时（${timeoutMs}ms）: ${url}`, {
        retryable: true,
      });
    }
    throw new LayoutError('NETWORK_ERROR', `请求失败: ${(e as Error).message}`, {
      retryable: true,
    });
  }
}

/** 测试用：清空限流器。 */
export function clearLimiters(): void {
  limiters.clear();
}
