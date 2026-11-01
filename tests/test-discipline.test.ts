import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { disciplineViolations } from './discipline';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return [path];
  });
}

const skip = new Set(['tests/test-discipline.test.ts', 'tests/discipline.ts']);

describe('test discipline', () => {
  it('tests and e2e do not sleep or read source text', () => {
    const hits: string[] = [];
    for (const path of ['e2e', 'tests', 'scripts'].flatMap((dir) => files(dir))) {
      if (!path.endsWith('.ts')) continue;
      if (skip.has(path)) continue;
      const found = disciplineViolations(readFileSync(path, 'utf8'));
      if (found.length > 0) hits.push(`${path}: ${found.join(', ')}`);
    }
    expect(hits).toEqual([]);
  });

  it('flags each forbidden pattern', () => {
    expect(disciplineViolations('await page.waitForTimeout(800);')).toContain('waitForTimeout');
    expect(disciplineViolations("await page['waitForTimeout'](800);")).toContain('waitForTimeout');
    expect(disciplineViolations('await page["waitForTimeout"](1);')).toContain('waitForTimeout');
    expect(disciplineViolations('const method = `waitForTimeout`; page[method]();')).toContain(
      'waitForTimeout',
    );
    expect(
      disciplineViolations('await new Promise((resolve) => setTimeout(resolve, 50));'),
    ).toContain('setTimeout');
    expect(
      disciplineViolations('await new Promise((resolve) => setImmediate(resolve));'),
    ).toContain('setImmediate');
    expect(
      disciplineViolations(
        "import { readFile } from 'node:fs/promises';\nconst file = '../src/ui/app.ts';\nawait readFile(file, 'utf8');",
      ),
    ).toContain('source-read');
    expect(
      disciplineViolations(
        "import { readFileSync } from 'node:fs';\nreadFileSync(new URL(path, import.meta.url));\nconst path = 'panel.tsx';",
      ),
    ).toContain('source-read');
    expect(disciplineViolations("import panel from '../src/ui/panel.ts?raw';")).toContain(
      'raw-import',
    );
    expect(
      disciplineViolations(
        "import { readFileSync } from 'node:fs';\nreadFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8');",
      ),
    ).toEqual([]);
    expect(
      disciplineViolations(
        "readFileSync(path, 'utf8');\nif (path.endsWith('src/firebase-config.ts')) continue;",
      ),
    ).toEqual([]);
    expect(
      disciplineViolations(
        "import { setTimeout as sleep } from 'node:timers/promises';\nawait sleep(800);",
      ),
    ).toContain('timers-promises');
    expect(
      disciplineViolations(
        "import { setTimeout as delay } from 'timers/promises';\nawait delay(1);",
      ),
    ).toContain('timers-promises');
    expect(
      disciplineViolations(
        "import { readdirSync, readFileSync } from 'node:fs';\nfor (const name of readdirSync('src/ui')) readFileSync(name, 'utf8');",
      ),
    ).toContain('source-walk');
    expect(
      disciplineViolations(
        "import { readdirSync, readFileSync } from 'node:fs';\nconst body = readFileSync(path, 'utf8'); // discipline-allow\n",
      ),
    ).toEqual([]);
  });
});
