import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const file = 'src/ui/app.ts';
const original = readFileSync(file, 'utf8');

const saveNeedle = `    save.disabled = REQUIRED_FIELDS.some(
      (item) => String(data.get(item.field) ?? '').trim().length === 0,
    );`;

const saveBroken = `    const fixed = ['text', 'scene'];
    save.disabled = fixed.some(
      (field) => String(data.get(field) ?? '').trim().length === 0,
    );`;

const blurNeedle = `    const message = requiredEmptyMessage(target.name);
    if (!message) return;
    const slot = panel.querySelector<HTMLElement>(\`[data-error-for="\${target.name}"]\`);
    if (!slot) return;
    slot.textContent = target.value.trim() ? '' : message;`;

const blurBroken = `    if (target.name !== 'text' && target.name !== 'scene') return;
    const slot = panel.querySelector<HTMLElement>(\`[data-error-for="\${target.name}"]\`);
    if (!slot) return;
    slot.textContent =
      target.value.trim() === ''
        ? target.name === 'text'
          ? '本文を書いてください'
          : 'シーンを書いてください'
        : '';`;

function runTests() {
  const result = spawnSync(
    'npx',
    ['vitest', 'run', 'tests/required-fields.test.ts', 'tests/required-one-empty.test.ts'],
    { stdio: 'inherit' },
  );
  return result.status ?? 1;
}

function check(name, needle, broken) {
  if (!original.includes(needle)) {
    console.error(`${name}: 壊す場所がソースにありません`);
    return false;
  }
  writeFileSync(file, original.replace(needle, broken));
  const status = runTests();
  writeFileSync(file, original);
  if (status === 0) {
    console.error(`${name}: 壊してもテストが通りました`);
    return false;
  }
  console.log(`${name}: テストが落ちました`);
  return true;
}

const killed = [check('M8', saveNeedle, saveBroken), check('M7', blurNeedle, blurBroken)].every(
  Boolean,
);

if (!killed) process.exit(1);
