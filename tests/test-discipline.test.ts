import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return [path];
  });
}

function readCalls(source: string): string[] {
  const calls: string[] = [];
  const pattern = /readFileSync\s*\([^;]*?\)/g;
  for (const match of source.matchAll(pattern)) calls.push(match[0]);
  return calls;
}

describe('test discipline', () => {
  it('e2e does not wait with waitForTimeout', () => {
    const hits = files('e2e')
      .filter((path) => path.endsWith('.ts'))
      .filter((path) => /waitForTimeout\s*\(/.test(readFileSync(path, 'utf8')));
    expect(hits).toEqual([]);
  });

  it('tests do not read TypeScript source as text', () => {
    const roots = ['tests', 'e2e'];
    const hits: string[] = [];
    for (const path of roots.flatMap((dir) => files(dir))) {
      if (!path.endsWith('.ts')) continue;
      if (path.endsWith('test-discipline.test.ts')) continue;
      for (const call of readCalls(readFileSync(path, 'utf8'))) {
        if (/\.tsx?['"`]/.test(call)) hits.push(`${path}: ${call}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
