/**
 * Wikidot 宽松源码 → 理想 FTML 的最小规范化。
 *
 * 规则 close-inline-at-block-end：行内标签必须在所属块内闭合。
 * 直接复用 @wdprlib/parser 的 tokenize 做词法配对，跳过 [[code]]/注释中的伪标签，
 * 只增不删，幂等。参考 ftml-cli 的同名实现。
 */

import { tokenize } from '@wdprlib/parser';
import type { Token } from '@wdprlib/parser';

const INLINE_TAGS = new Set([
  'span', 'size', 'color', 'u', 's', 'sup', 'sub', 'tt',
  'em', 'strong', 'mark', 'ruby', 'del', 'ins',
]);

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export interface CompatWarning {
  code: string;
  message: string;
  line: number;
  column: number;
}

export interface NormalizeResult {
  src: string;
  changed: boolean;
  changes: Array<{ tag: string; line: number; column: number }>;
  diagnostics: CompatWarning[];
}

interface Event {
  kind: 'open' | 'close';
  name: string;
  start: number;
}

interface Frame {
  name: string;
  inline: boolean;
  start: number;
}

function makeLocator(src: string): (offset: number) => { line: number; column: number } {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - starts[lo] + 1 };
  };
}

function elementEvents(tokens: Token[]): Event[] {
  const events: Event[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.type === 'BLOCK_OPEN') {
      let depth = 1;
      let j = i + 1;
      let name: string | null = null;
      while (j < tokens.length && depth > 0) {
        const u = tokens[j];
        if (u.type === 'BLOCK_OPEN') depth++;
        else if (u.type === 'BLOCK_CLOSE') depth--;
        else if (depth === 1 && name === null && u.type === 'IDENTIFIER') name = u.value;
        j++;
      }
      if (depth !== 0) break;
      if (name && NAME_RE.test(name)) {
        events.push({ kind: 'open', name, start: t.position.start.offset });
      }
      i = j;
      continue;
    }
    if (t.type === 'BLOCK_END_OPEN') {
      let j = i + 1;
      let name: string | null = null;
      while (j < tokens.length && tokens[j].type !== 'BLOCK_CLOSE') {
        if (name === null && tokens[j].type === 'IDENTIFIER') name = tokens[j].value;
        j++;
      }
      if (j < tokens.length && name && NAME_RE.test(name)) {
        events.push({ kind: 'close', name, start: t.position.start.offset });
      }
      i = j + 1;
      continue;
    }
    i++;
  }
  return events;
}

export function dirtToIdeal(src: string): NormalizeResult {
  if (!src) return { src: '', changed: false, changes: [], diagnostics: [] };
  let tokens: Token[];
  try {
    tokens = tokenize(src);
  } catch {
    // tokenize 失败时不要阻断源码展示；渲染阶段会给出结构化诊断
    return { src, changed: false, changes: [], diagnostics: [] };
  }
  const locate = makeLocator(src);
  const events = elementEvents(tokens);
  const stack: Frame[] = [];
  const changes: NormalizeResult['changes'] = [];
  const diagnostics: CompatWarning[] = [];
  const insertions = new Map<number, string[]>();

  const queueClose = (frame: Frame, at: number) => {
    const arr = insertions.get(at) ?? [];
    arr.push(frame.name);
    insertions.set(at, arr);
    const loc = locate(at);
    changes.push({ tag: frame.name, line: loc.line, column: loc.column });
  };

  const noteUnclosed = (frame: Frame, reason: string) => {
    const loc = locate(frame.start);
    diagnostics.push({
      code: 'unclosed-block',
      message: `[[${frame.name}]] ${reason}`,
      line: loc.line,
      column: loc.column,
    });
  };

  for (const ev of events) {
    if (ev.kind === 'open') {
      stack.push({ name: ev.name, inline: INLINE_TAGS.has(ev.name), start: ev.start });
      continue;
    }
    let k = -1;
    for (let p = stack.length - 1; p >= 0; p--) {
      if (stack[p].name === ev.name) { k = p; break; }
    }
    if (k === -1) {
      const loc = locate(ev.start);
      diagnostics.push({
        code: 'stray-inline-close',
        message: `闭合标签 [[/${ev.name}]] 没有匹配的开标签`,
        line: loc.line,
        column: loc.column,
      });
      continue;
    }
    const crossing = stack.splice(k);
    const matched = crossing.shift()!;
    for (let p = crossing.length - 1; p >= 0; p--) {
      const f = crossing[p];
      if (f.inline) queueClose(f, ev.start);
      else noteUnclosed(f, `在 [[/${matched.name}]] 之前仍未闭合`);
    }
  }
  for (let p = stack.length - 1; p >= 0; p--) {
    const f = stack[p];
    if (f.inline) queueClose(f, src.length);
    else noteUnclosed(f, '未闭合');
  }

  let out = src;
  for (const off of [...insertions.keys()].sort((a, b) => b - a)) {
    const text = insertions.get(off)!.map((name) => `[[/${name}]]`).join('');
    out = out.slice(0, off) + text + out.slice(off);
  }
  return { src: out, changed: out !== src, changes, diagnostics };
}
