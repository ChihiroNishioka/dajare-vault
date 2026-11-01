import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const roots = ['src', 'public', 'tests', 'e2e', 'scripts', '.github', 'docs', 'relay'];
const extra = ['index.html', 'README.md', 'package.json'];
const skip = new Set(['scripts/make-icons.mjs']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return [path];
  });
}

const textFiles = [...roots.flatMap((dir) => files(dir)), ...extra].filter(
  (path) => !skip.has(path) && !path.endsWith('.png'),
);

const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const mobile = /(?:\+81[-\s]?|0)[789]0[-\s]?\d{4}[-\s]?\d{4}/;
const secret = /(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]+['"]/i;
const privateKey = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

describe('no secrets in the tree', () => {
  it('has no email, phone, or credential material', () => {
    const hits: string[] = [];
    for (const path of textFiles) {
      const body = readFileSync(path, 'utf8'); // discipline-allow source-walk
      const emails = body.match(new RegExp(email, 'g')) ?? [];
      if (emails.some((address) => !address.toLowerCase().endsWith('@example.com'))) {
        hits.push(`${relative('.', path)} matched an email`);
      }
      for (const pattern of [mobile, secret, privateKey]) {
        if (pattern === secret && path.endsWith('src/firebase-config.ts')) continue;
        if (pattern.test(body)) hits.push(`${relative('.', path)} matched ${pattern}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
