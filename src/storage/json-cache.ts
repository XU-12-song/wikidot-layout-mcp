/** 磁盘 JSON 缓存：原子写入，损坏时按未命中处理。 */

import fs from 'node:fs';
import path from 'node:path';
import { log } from '../logger.js';

export function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function writeJsonFile(filePath: string, value: unknown): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value), 'utf8');
    fs.renameSync(tmp, filePath);
  } catch (e) {
    log.warn(`写入缓存失败 ${filePath}: ${(e as Error).message}`);
  }
}
