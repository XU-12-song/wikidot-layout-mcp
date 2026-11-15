/** 统一错误码与 MCP 工具错误结构。 */

export type ErrorCode =
  | 'INVALID_INPUT'
  | 'PAGE_NOT_FOUND'
  | 'SOURCE_FORBIDDEN'
  | 'SOURCE_PARSE_FAILED'
  | 'NETWORK_ERROR'
  | 'RENDER_FAILED'
  | 'SCREENSHOT_TIMEOUT'
  | 'BROWSER_NOT_FOUND'
  | 'PATH_NOT_ALLOWED'
  | 'PRESET_NOT_FOUND'
  | 'EXPORT_FAILED'
  | 'INTERNAL_ERROR';

export interface ToolErrorPayload {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    hint: string | null;
    retryable: boolean;
  };
}

const RETRYABLE = new Set<ErrorCode>(['NETWORK_ERROR', 'SCREENSHOT_TIMEOUT']);

const HINTS: Partial<Record<ErrorCode, string>> = {
  INVALID_INPUT: '检查参数类型、站点名与页面名格式。',
  PAGE_NOT_FOUND: '确认页面名与站点子域名；私有页面需要服务端预配置凭证。',
  SOURCE_FORBIDDEN: '该页面不允许匿名读取。不要尝试绕过权限；如需访问，请在服务端配置凭证。',
  SOURCE_PARSE_FAILED: 'Wikidot 返回了无法解析的源码弹层，可稍后重试或检查页面是否被删除。',
  NETWORK_ERROR: '检查网络或稍后重试；Wikidot 可能临时限流。',
  RENDER_FAILED: '检查 FTML 块闭合与 CSS 语法；先用 layout_validate 定位。',
  SCREENSHOT_TIMEOUT: '增大 waitMs 之外先检查页面资源；可尝试缩小视口或稍后重试。',
  BROWSER_NOT_FOUND: '设置 CHROME_PATH 指向本机 Chrome/Edge/Chromium 可执行文件。',
  PATH_NOT_ALLOWED: '只能写入 WIKIDOT_LAYOUT_ALLOWED_ROOTS 内的相对路径。',
  PRESET_NOT_FOUND: '调用 layout_list_presets 查看可用 id。',
  EXPORT_FAILED: '确认目标目录可写且磁盘空间充足。',
  INTERNAL_ERROR: '查看服务端 stderr 日志。',
};

export class LayoutError extends Error {
  readonly code: ErrorCode;
  readonly hint: string | null;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, options: { hint?: string; retryable?: boolean } = {}) {
    super(message);
    this.name = 'LayoutError';
    this.code = code;
    this.hint = options.hint ?? HINTS[code] ?? null;
    this.retryable = options.retryable ?? RETRYABLE.has(code);
  }
}

export function toLayoutError(e: unknown): LayoutError {
  if (e instanceof LayoutError) return e;
  const message = e instanceof Error ? e.message : String(e);
  return new LayoutError('INTERNAL_ERROR', message);
}

export function errorPayload(e: unknown): ToolErrorPayload {
  const err = toLayoutError(e);
  return {
    ok: false,
    error: {
      code: err.code,
      message: err.message,
      hint: err.hint,
      retryable: err.retryable,
    },
  };
}

/** MCP 工具错误返回；isError=true 时 SDK 不校验 outputSchema。 */
export function toolError(e: unknown) {
  const payload = errorPayload(e);
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: `[${payload.error.code}] ${payload.error.message}${
          payload.error.hint ? `\n提示：${payload.error.hint}` : ''
        }`,
      },
    ],
    structuredContent: payload,
  };
}
