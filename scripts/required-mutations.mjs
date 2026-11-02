import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requiredTests = [
  'tests/domain.test.ts',
  'tests/required-fields.test.ts',
  'tests/required-one-empty.test.ts',
];

const mutations = [
  {
    name: 'M8 保存判定を固定する',
    file: 'src/ui/app.ts',
    needle: `    save.disabled = currentRequiredFields().some(
      (item) => String(data.get(item.field) ?? '').trim().length === 0,
    );`,
    replacement: `    const fixed = ['text', 'scene'];
    save.disabled = fixed.some(
      (field) => String(data.get(field) ?? '').trim().length === 0,
    );`,
  },
  {
    name: 'M7 blur の文言を固定する',
    file: 'src/ui/app.ts',
    needle: `    const message = requiredEmptyMessage(target.name);
    const slot = panel.querySelector<HTMLElement>(\`[data-error-for="\${target.name}"]\`);
    if (!message || !slot) return;
    paintFieldError(slot, target.value.trim() ? '' : message);`,
    replacement: `    if (target.name !== 'text' && target.name !== 'scene') return;
    const slot = panel.querySelector<HTMLElement>(\`[data-error-for="\${target.name}"]\`);
    if (!slot) return;
    const message =
      target.name === 'text' ? '本文を書いてください' : 'シーンを書いてください';
    paintFieldError(slot, target.value.trim() ? '' : message);`,
  },
  {
    name: 'a aria-invalid を常に false にする',
    file: 'src/ui/app.ts',
    needle: `    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');`,
    replacement: `    if (input) input.setAttribute('aria-invalid', 'false');`,
  },
  {
    name: 'b 上限ちょうどを拒否する',
    file: 'src/domain/validate.ts',
    needle: '    if (value.length > max) {',
    replacement: '    if (value.length >= max) {',
  },
  {
    name: 'c 編集フォームから必須印を消す',
    file: 'src/ui/panel.ts',
    transform(source) {
      const replacements = [
        [
          "${named('text')}",
          "${mode === 'edit' ? fieldName(FORM_FIELDS[0].label, false) : named('text')}",
        ],
        [
          "${named('scene')}",
          "${mode === 'edit' ? fieldName(FORM_FIELDS[1].label, false) : named('scene')}",
        ],
      ];
      let result = source;
      for (const [needle, replacement] of replacements) {
        if (!result.includes(needle)) return null;
        result = result.replace(needle, replacement);
      }
      return result;
    },
  },
  {
    name: 'd 必須項目だけ長さを検査する',
    file: 'src/domain/validate.ts',
    needle: '    if (value.length > max) {',
    replacement:
      '    if (requiredFields.some((row) => row.field === item.field) && value.length > max) {',
  },
];

const activeOriginals = new Map();

function restoreAll() {
  for (const [file, original] of activeOriginals) {
    writeFileSync(resolve(root, file), original);
  }
  activeOriginals.clear();
}

process.on('exit', restoreAll);
for (const [signal, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
]) {
  process.once(signal, () => {
    restoreAll();
    process.exit(code);
  });
}

function readReport(reportFile, expectedFiles) {
  let report;
  try {
    report = JSON.parse(readFileSync(reportFile, 'utf8'));
  } catch {
    return { ok: false, reason: 'Vitest の JSON レポートを読めません' };
  }

  const suites = report.testResults;
  if (!Array.isArray(suites) || suites.length !== expectedFiles.length) {
    return { ok: false, reason: '対象テストの読み込みに失敗しました' };
  }
  const expected = new Set(expectedFiles.map((file) => resolve(root, file)));
  if (suites.some((suite) => !expected.delete(resolve(suite.name)))) {
    return { ok: false, reason: '対象テストの読み込みに失敗しました' };
  }
  if (expected.size !== 0) return { ok: false, reason: '対象テストの読み込みに失敗しました' };

  const failedAssertions = suites.flatMap((suite) =>
    (suite.assertionResults ?? [])
      .filter((assertion) => assertion.status === 'failed')
      .map((assertion) => assertion.fullName || assertion.title || basename(suite.name)),
  );
  const suiteErrors = suites.some(
    (suite) =>
      suite.status !== 'passed' &&
      !(
        suite.status === 'failed' &&
        (suite.assertionResults ?? []).some((assertion) => assertion.status === 'failed')
      ),
  );

  return {
    ok: !suiteErrors,
    reason: suiteErrors ? 'テストファイルの読み込みまたは実行に失敗しました' : '',
    failedAssertions,
    totalTests: report.numTotalTests ?? 0,
    failedTests: report.numFailedTests ?? 0,
    failedSuites: report.numFailedTestSuites ?? 0,
  };
}

function runVitest(testFiles) {
  const tempDir = mkdtempSync(resolve(tmpdir(), 'dajare-required-mutations-'));
  const reportFile = resolve(tempDir, 'vitest.json');
  try {
    const result = spawnSync(
      'npx',
      ['vitest', 'run', ...testFiles, '--reporter=json', `--outputFile=${reportFile}`],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    if (result.error) return { ok: false, reason: `npx を起動できません: ${result.error.message}` };
    if (result.signal)
      return { ok: false, reason: `Vitest が signal ${result.signal} で終了しました` };
    if (result.status === null) return { ok: false, reason: 'Vitest の終了状態を取得できません' };
    const report = readReport(reportFile, testFiles);
    if (!report.ok) return report;
    if (report.totalTests === 0) return { ok: false, reason: '対象テストが実行されませんでした' };
    return { ...report, status: result.status };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function baselinePasses(name, testFiles) {
  const result = runVitest(testFiles);
  if (
    !result.ok ||
    result.status !== 0 ||
    result.failedTests !== 0 ||
    result.failedSuites !== 0 ||
    result.totalTests === 0
  ) {
    console.error(
      `${name}: 変異前のテストが通りません: ${result.reason || '失敗テストがあります'}`,
    );
    return false;
  }
  return true;
}

function check(mutation) {
  const file = resolve(root, mutation.file);
  const original = readFileSync(file, 'utf8');
  let changed;
  if (mutation.transform) {
    changed = mutation.transform(original);
  } else {
    if (!original.includes(mutation.needle)) {
      console.error(`${mutation.name}: 壊す場所がソースにありません`);
      return false;
    }
    changed = original.replace(mutation.needle, mutation.replacement);
  }
  if (changed === null || changed === undefined || changed === original) {
    console.error(`${mutation.name}: 変異を適用できませんでした`);
    return false;
  }

  if (!baselinePasses(mutation.name, requiredTests)) return false;

  activeOriginals.set(mutation.file, original);
  try {
    writeFileSync(file, changed);
    const result = runVitest(requiredTests);
    if (
      result.ok &&
      result.status !== 0 &&
      result.failedTests > 0 &&
      result.failedAssertions.length > 0 &&
      result.failedSuites > 0
    ) {
      console.log(`${mutation.name}: assertion failure を確認しました`);
      return true;
    }

    const reason = !result.ok
      ? result.reason
      : result.status === 0
        ? 'テストが通り、変異が残りました'
        : 'assertion failure と確認できませんでした';
    console.error(`${mutation.name}: ${reason}`);
    return false;
  } finally {
    writeFileSync(file, original);
    activeOriginals.delete(mutation.file);
  }
}

const results = mutations.map((mutation) => check(mutation));
if (results.some((result) => !result)) process.exitCode = 1;
