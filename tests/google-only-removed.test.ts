import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const forbidden = [
  '別の方法でログイン',
  'account-alt',
  'data-action="sign-in"',
  'signInWithPopup',
  'cloudSignIn',
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return [path];
  });
}

function hitsIn(paths: string[]): string[] {
  const hits: string[] = [];
  for (const path of paths) {
    const body = readFileSync(path, 'utf8'); // discipline-allow source-walk
    for (const word of forbidden) {
      if (body.includes(word)) hits.push(`${path}: ${word}`);
    }
  }
  return hits;
}

describe('alternate Google login is gone from the sources', () => {
  it('does not name the removed entry in src, docs, or the design note', () => {
    const paths = [
      ...files('src'),
      ...files('docs'),
      ...['sharing-design.md'].filter((path) => existsSync(path)),
    ];
    expect(hitsIn(paths)).toEqual([]);
  });
});

function runBuild(forceLocal: boolean): void {
  execFileSync('npm', ['run', 'build'], {
    env: { ...process.env, VITE_FORCE_LOCAL: forceLocal ? '1' : '' },
    stdio: 'pipe',
  });
}

function bundleHits(): string[] {
  const words = ['別の方法でログイン', 'account-alt'];
  const hits: string[] = [];
  for (const path of files('dist')) {
    if (!/\.(?:js|css|html)$/.test(path)) continue;
    const body = readFileSync(path, 'utf8'); // discipline-allow source-walk
    for (const word of words) {
      if (body.includes(word)) hits.push(`${path}: ${word}`);
    }
  }
  return hits;
}

describe('alternate Google login is gone from the build', () => {
  it('stays out of the cloud build and the local build', () => {
    runBuild(false);
    const cloud = bundleHits();
    runBuild(true);
    const local = bundleHits();
    expect({ cloud, local }).toEqual({ cloud: [], local: [] });
  }, 180_000);
});
