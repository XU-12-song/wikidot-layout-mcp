/** FTML / CSS 校验。 */

import { scanFtml } from '../wikidot/analyze.js';
import { LayoutError } from '../errors.js';
import { renderPreview, type NormalizedDiagnostic } from './renderer.js';

export interface CssValidation {
  errors: NormalizedDiagnostic[];
  warnings: NormalizedDiagnostic[];
}

/** 忽略注释与字符串后的花括号平衡 + @import 位置检查。 */
export function validateCss(css: string): CssValidation {
  const errors: NormalizedDiagnostic[] = [];
  const warnings: NormalizedDiagnostic[] = [];
  if (!css.trim()) return { errors, warnings };

  let depth = 0;
  let line = 1;
  let inComment = false;
  let quote: string | null = null;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    const next = css[i + 1];
    if (ch === '\n') line++;
    if (inComment) {
      if (ch === '*' && next === '/') { inComment = false; i++; }
      continue;
    }
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '*') { inComment = true; i++; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth < 0) {
        errors.push({ severity: 'error', code: 'css-unbalanced-brace', message: 'CSS 出现多余的 }', line, column: null });
        depth = 0;
      }
    }
  }
  if (depth > 0) {
    errors.push({ severity: 'error', code: 'css-unclosed-brace', message: `CSS 有 ${depth} 个未闭合的 {`, line: null, column: null });
  }
  if (/<\/style/i.test(css)) {
    errors.push({ severity: 'error', code: 'css-style-breakout', message: 'CSS 中不允许出现 </style', line: null, column: null });
  }

  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let seenRule = false;
  withoutComments.split('\n').forEach((text, index) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (/^@import\b/i.test(trimmed)) {
      if (seenRule) {
        warnings.push({
          severity: 'warning',
          code: 'css-import-order',
          message: '@import 必须位于所有普通规则之前，否则会被浏览器忽略',
          line: index + 1,
          column: null,
        });
      }
      return;
    }
    if (/^@charset\b/i.test(trimmed)) return;
    seenRule = true;
  });

  return { errors, warnings };
}

export interface ValidateResult {
  ok: true;
  valid: boolean;
  errors: NormalizedDiagnostic[];
  warnings: NormalizedDiagnostic[];
  diagnostics: NormalizedDiagnostic[];
}

export async function validateFtmlAndCss(
  ftml: string,
  css?: string,
  site?: string | null
): Promise<ValidateResult> {
  const errors: NormalizedDiagnostic[] = [];
  const warnings: NormalizedDiagnostic[] = [];
  if (!ftml.trim()) {
    throw new LayoutError('INVALID_INPUT', 'ftml 不能为空');
  }

  const scan = scanFtml(ftml, site ?? 'preview');
  for (const w of scan.warnings) {
    const diagnostic: NormalizedDiagnostic = {
      severity: w.code === 'unclosed-block' || w.code === 'stray-close' ? 'error' : 'warning',
      code: w.code,
      message: w.message,
      line: w.line,
      column: null,
    };
    if (diagnostic.severity === 'error') errors.push(diagnostic);
    else warnings.push(diagnostic);
  }

  const cssResult = validateCss(css ?? '');
  errors.push(...cssResult.errors);
  warnings.push(...cssResult.warnings);

  try {
    const rendered = await renderPreview({
      ftml,
      css,
      site: site ?? undefined,
      page: 'validation',
      includeTheme: false,
      title: 'validation',
    });
    for (const d of rendered.diagnostics) {
      if (d.severity === 'error') errors.push(d);
      else if (d.severity === 'warning') warnings.push(d);
    }
  } catch (e) {
    errors.push({
      severity: 'error',
      code: e instanceof LayoutError ? e.code : 'RENDER_FAILED',
      message: (e as Error).message,
      line: null,
      column: null,
    });
  }

  const dedupe = (list: NormalizedDiagnostic[]) => {
    const seen = new Set<string>();
    return list.filter((d) => {
      const key = `${d.severity}|${d.code}|${d.message}|${d.line}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const uniqueErrors = dedupe(errors);
  const uniqueWarnings = dedupe(warnings);
  return {
    ok: true,
    valid: uniqueErrors.length === 0,
    errors: uniqueErrors,
    warnings: uniqueWarnings,
    diagnostics: [...uniqueErrors, ...uniqueWarnings],
  };
}
