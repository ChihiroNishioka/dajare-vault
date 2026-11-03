import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backupFile = resolve(root, '.mutation-backup.json');
const testFiles = [
  'tests/domain.test.ts',
  'tests/required-fields.test.ts',
  'tests/required-one-empty.test.ts',
  'tests/form-spec.test.ts',
];

const mutations = [
  {
    name: 'M8 保存ボタンの判定を固定の名前で行う',
    file: 'src/ui/app.ts',
    needle: `    save.disabled = currentRequiredFields().some(
      (item) => String(data.get(item.field) ?? '').trim().length === 0,
    );`,
    replacement: `    const fixed = ['text', 'scene'] as const;
    save.disabled = currentRequiredFields().length > 0 && fixed.some(
      (field) => String(data.get(field) ?? '').trim().length === 0,
    );`,
    catchers: [
      'swapping the required entry drops text from the mark, the save button, blur, and the save check',
      'swapping the required entry drops scene from the mark, the save button, blur, and the save check',
    ],
  },
  {
    name: 'M7 blur の文言を固定する',
    file: 'src/ui/app.ts',
    needle: `    const message = requiredEmptyMessage(target.name);
    const slot = panel.querySelector<HTMLElement>(\`[data-error-for="\${target.name}"]\`);
    if (!message || !slot) return;
    paintFieldError(slot, target.value.trim() ? '' : message);`,
    replacement: `    const definedMessage = requiredEmptyMessage(target.name);
    const message = !definedMessage
      ? null
      : target.name === 'text'
        ? '本文を書いてください'
        : 'シーンを書いてください';
    const slot = panel.querySelector<HTMLElement>(\`[data-error-for="\${target.name}"]\`);
    if (!message || !slot) return;
    paintFieldError(slot, target.value.trim() ? '' : message);`,
    catchers: [
      'uses a replaced text label, empty message and limit across the form, validation and card',
      'uses a replaced scene label, empty message and limit across the form, validation and card',
    ],
  },
  {
    name: 'a aria-invalid を常に false にする',
    file: 'src/ui/app.ts',
    needle: `    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');`,
    replacement: `    if (input) input.setAttribute('aria-invalid', 'false');`,
    catchers: [
      "form spec for 'text' shows the spec message on blur and links it to the field with aria-describedby",
      "form spec for 'scene' shows the spec message on blur and links it to the field with aria-describedby",
    ],
  },
  {
    name: 'b 上限ちょうどを拒否する',
    file: 'src/domain/validate.ts',
    needle: '    if (value.length > item.max) {',
    replacement: '    if (value.length >= item.max) {',
    catchers: [
      "form spec for 'text' accepts exactly the limit and rejects one more with the spec message",
      "form spec for 'scene' accepts exactly the limit and rejects one more with the spec message",
    ],
  },
  {
    name: 'c 編集フォームから必須の＊を消す',
    file: 'src/ui/panel.ts',
    needle: "<label>${named('text')} ${counter('text', textField.max)}",
    replacement:
      "<label>${mode === 'edit' ? fieldName(textField.label, false) : named('text')} ${counter('text', textField.max)}",
    catchers: ['shows the required mark on each required field in the edit form'],
  },
  {
    name: 'd 必須項目だけ長さを検査する',
    file: 'src/domain/validate.ts',
    needle: '    if (value.length > item.max) {',
    replacement: '    if (item.required && value.length > item.max) {',
    catchers: ['enforces the length limit for a field removed from the required set'],
  },
  {
    name: 'e シーンの表示名を「場面」に変える',
    file: 'src/domain/required-fields.ts',
    needle: "    label: 'シーン',",
    replacement: "    label: '場面',",
    catchers: [
      "form spec for 'scene' shows the spec label, maxlength and counter",
      'the card names the scene with the same label as the form',
      'uses a replaced text label, empty message and limit across the form, validation and card',
    ],
  },
  {
    name: 'f シーンの空欄の文言を変える',
    file: 'src/domain/required-fields.ts',
    needle: "    emptyMessage: 'シーンを書いてください',",
    replacement: "    emptyMessage: 'シーンを入力してください',",
    catchers: [
      "form spec for 'scene' rejects an empty value with the spec message",
      "form spec for 'scene' shows the spec message on blur and links it to the field with aria-describedby",
    ],
  },
  {
    name: 'g 本文の上限を 150 に変える',
    file: 'src/domain/required-fields.ts',
    needle: '    max: 200,',
    replacement: '    max: 150,',
    catchers: [
      "form spec for 'text' shows the spec label, maxlength and counter",
      "form spec for 'text' accepts exactly the limit and rejects one more with the spec message",
    ],
  },
  {
    name: 'h 本文の空欄の文言を変える',
    file: 'src/domain/required-fields.ts',
    needle: "    emptyMessage: '本文を書いてください',",
    replacement: "    emptyMessage: '本文を入力してください',",
    catchers: [
      "form spec for 'text' rejects an empty value with the spec message",
      "form spec for 'text' shows the spec message on blur and links it to the field with aria-describedby",
    ],
  },
  {
    name: 'i パネルの表示名を定義から読まず直書きする',
    file: 'src/ui/panel.ts',
    needle: '  return fieldName(definition.label, required);',
    replacement: "  return fieldName(definition.field === 'text' ? '本文' : 'シーン', required);",
    catchers: [
      'uses a replaced text label, empty message and limit across the form, validation and card',
      'uses a replaced scene label, empty message and limit across the form, validation and card',
    ],
  },
  {
    name: 'j aria-describedby を外す',
    file: 'src/ui/panel.ts',
    needle: `function describedBy(field: FormFieldName): string {
  return \` aria-describedby="\${errorId(field)}"\`;
}`,
    replacement: `function describedBy(_field: FormFieldName): string {
  return '';
}`,
    catchers: [
      "form spec for 'text' shows the spec message on blur and links it to the field with aria-describedby",
    ],
  },
  {
    name: 'k カードのシーン表示名を「場面」に固定する',
    file: 'src/ui/card.ts',
    needle: "formField('scene').label",
    replacement: "formField('scene').field === 'scene' ? '場面' : formField('scene').label",
    catchers: [
      'uses a replaced scene label, empty message and limit across the form, validation and card',
      'the card names the scene with the same label as the form',
    ],
  },
  {
    name: 'l 長すぎの文言を「本文」「200」に固定する',
    file: 'src/domain/validate.ts',
    needle: '        message: `${item.label}は${item.max}文字以内にしてください`,',
    replacement: "        message: '本文は200文字以内にしてください',",
    catchers: [
      "form spec for 'scene' accepts exactly the limit and rejects one more with the spec message",
    ],
  },
  {
    name: 'm panel の maxlength を定義から読まず直書きする',
    file: 'src/ui/panel.ts',
    needle: 'maxlength="${textField.max}"',
    replacement: 'maxlength="200"',
    catchers: [
      'uses a replaced text label, empty message and limit across the form, validation and card',
      'uses a replaced scene label, empty message and limit across the form, validation and card',
    ],
  },
  {
    name: 'n 入力してもカウンタを更新しない',
    file: 'src/ui/app.ts',
    needle: '    const left = max - field.value.length;',
    replacement: '    const left = max;',
    catchers: [
      "form spec for 'text' updates the counter on input and shows 上限です at the limit",
      "form spec for 'scene' updates the counter on input and shows 上限です at the limit",
    ],
  },
  {
    name: 'o 上限で「上限です」を出さない',
    file: 'src/ui/app.ts',
    needle: "left === 0 ? '上限です' : `残り ${left}`",
    replacement: "left === 0 ? '残り 0' : `残り ${left}`",
    catchers: [
      "form spec for 'text' updates the counter on input and shows 上限です at the limit",
      "form spec for 'scene' updates the counter on input and shows 上限です at the limit",
    ],
  },
  {
    name: 'p 保存のエラーで aria-invalid を付けない',
    file: 'src/ui/app.ts',
    needle: '      if (slot) paintFieldError(slot, error.message);',
    replacement: '      if (slot) slot.textContent = error.message;',
    catchers: [
      "form spec for 'text' marks the field invalid on save and clears it after the fix",
      "form spec for 'scene' marks the field invalid on save and clears it after the fix",
    ],
  },
  {
    name: 'q シーンを直しても aria-invalid を外さない',
    file: 'src/ui/app.ts',
    needle: "    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');",
    replacement:
      "    if (input) input.setAttribute('aria-invalid', message || field === 'scene' ? 'true' : 'false');",
    catchers: ["form spec for 'scene' marks the field invalid on save and clears it after the fix"],
  },
  {
    name: 'r 必須から外したシーンの長さを検査しない',
    file: 'src/domain/validate.ts',
    needle: '    if (value.length > item.max) {',
    replacement: "    if ((item.required || item.field === 'text') && value.length > item.max) {",
    catchers: [
      'rejects 101 characters in the scene after the scene is removed from the required set',
    ],
  },
];

// 検出と数えてはいけない変異。狙ったテストは AssertionError で落ちるが、
// その前に実行時例外が起きている。これを「検出」と数えたらスクリプトを失敗させる。
const mustReject = [
  {
    name: 'X1 blur の処理の中で ReferenceError を起こす',
    file: 'src/ui/app.ts',
    needle: "    paintFieldError(slot, target.value.trim() ? '' : message);",
    replacement:
      "    paintFieldError(slot, target.value.trim() ? '' : String(new Function('return notDefinedAnywhere')()));",
    catchers: [
      "form spec for 'text' shows the spec message on blur and links it to the field with aria-describedby",
      "form spec for 'scene' shows the spec message on blur and links it to the field with aria-describedby",
    ],
  },
  {
    name: 'X2 検証の中で TypeError を起こす',
    file: 'src/domain/validate.ts',
    needle: '    if (value.length > item.max) {',
    replacement: '    if (value.length > (null as unknown as { max: number }).max) {',
    catchers: [
      "form spec for 'text' accepts exactly the limit and rejects one more with the spec message",
    ],
  },
];

let currentChild = null;
let handlingSignal = false;

function restoreBackup() {
  if (!existsSync(backupFile)) return;
  try {
    const backup = JSON.parse(readFileSync(backupFile, 'utf8'));
    if (typeof backup.file !== 'string' || typeof backup.original !== 'string') {
      throw new Error('バックアップの形式が正しくありません');
    }
    writeFileSync(resolve(root, backup.file), backup.original);
    unlinkSync(backupFile);
  } catch (error) {
    process.exitCode = 1;
    console.error(
      `書き換えを戻せません: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

if (process.argv.includes('--restore')) {
  if (!existsSync(backupFile)) {
    console.log('戻す書き換えはありません');
    process.exit(0);
  }
  restoreBackup();
  process.exit(existsSync(backupFile) ? 1 : 0);
}

if (existsSync(backupFile)) {
  console.error(
    '前回の書き換えが残っています。node scripts/required-mutations.mjs --restore で戻してください',
  );
  process.exit(1);
}

process.on('exit', restoreBackup);
for (const [signal, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
  ['SIGHUP', 129],
]) {
  process.once(signal, () => {
    if (handlingSignal) return;
    handlingSignal = true;
    if (currentChild?.pid) {
      try {
        process.kill(-currentChild.pid, 'SIGKILL');
      } catch {
        // 子プロセスが先に終了していても復元を続ける。
      }
    }
    restoreBackup();
    process.exit(code);
  });
}

function run(command, args, timeoutMs = 300_000, env = process.env) {
  return new Promise((resolveRun) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn(command, args, {
      cwd: root,
      detached: true,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    currentChild = child;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // close イベントに任せる。
        }
      }
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', (error) => {
      clearTimeout(timer);
      currentChild = null;
      resolveRun({ status: null, signal: null, timedOut, stdout, stderr, error });
    });
    child.once('close', (status, signal) => {
      clearTimeout(timer);
      currentChild = null;
      resolveRun({ status, signal, timedOut, stdout, stderr, error: null });
    });
  });
}

function childFailure(result, label) {
  if (result.error) return `${label} を起動できません: ${result.error.message}`;
  if (result.timedOut) return `${label} が300秒でタイムアウトしました`;
  if (result.signal) return `${label} が signal ${result.signal} で終了しました`;
  if (result.status === null) return `${label} の終了状態を取得できません`;
  return null;
}

async function runTsc(label) {
  const result = await run('npx', ['tsc', '--noEmit', '-p', '.']);
  const failure = childFailure(result, 'tsc');
  if (failure) return { ok: false, reason: failure };
  if (result.status !== 0) {
    return {
      ok: false,
      reason: `${label}: 型が通らない変異（tsc exit ${result.status}）\n${result.stdout}${result.stderr}`,
    };
  }
  return { ok: true };
}

function readReport(reportFile) {
  let report;
  try {
    report = JSON.parse(readFileSync(reportFile, 'utf8'));
  } catch {
    return { ok: false, reason: 'Vitest の JSON レポートを読めません' };
  }

  const suites = report.testResults;
  if (!Array.isArray(suites) || suites.length !== testFiles.length) {
    return { ok: false, reason: '対象テストファイルがすべて読み込まれませんでした' };
  }
  const expected = new Set(testFiles.map((file) => resolve(root, file)));
  if (suites.some((suite) => !expected.delete(resolve(root, suite.name)))) {
    return { ok: false, reason: '対象テストファイルがすべて読み込まれませんでした' };
  }
  if (expected.size !== 0) {
    return { ok: false, reason: '対象テストファイルがすべて読み込まれませんでした' };
  }
  if (
    suites.some(
      (suite) =>
        !Array.isArray(suite.assertionResults) ||
        (suite.message && suite.message.trim() !== '') ||
        (suite.status !== 'passed' &&
          !suite.assertionResults.some((assertion) => assertion.status === 'failed')),
    )
  ) {
    return { ok: false, reason: 'テストファイルに収集・読み込みなどの suite エラーがあります' };
  }

  const assertions = suites.flatMap((suite) => suite.assertionResults);
  const failed = assertions.filter((assertion) => assertion.status === 'failed');
  if (failed.some((assertion) => !Array.isArray(assertion.failureMessages))) {
    return { ok: false, reason: '失敗テストの failureMessages がありません' };
  }
  return {
    ok: true,
    totalTests: report.numTotalTests ?? assertions.length,
    failed: failed.map((assertion) => ({
      fullName: assertion.fullName,
      failureMessages: assertion.failureMessages,
    })),
    passedNames: assertions
      .filter((assertion) => assertion.status === 'passed')
      .map((assertion) => assertion.fullName),
  };
}

function readErrorReport(errorReportFile) {
  let report;
  try {
    report = JSON.parse(readFileSync(errorReportFile, 'utf8'));
  } catch {
    return { ok: false, kind: 'reporter', reason: 'Vitest のエラーレポートを読めません' };
  }
  if (!Array.isArray(report.stderr) || !Array.isArray(report.unhandledErrors)) {
    return {
      ok: false,
      kind: 'reporter',
      reason: 'Vitest のエラーレポートの形式が正しくありません',
    };
  }
  return { ok: true, ...report };
}

function describeRuntimeErrors(report, limit = 3) {
  const details = [
    ...report.stderr.map((log) => {
      const testName = log.testName ? ` (${log.testName})` : log.origin ? ` (${log.origin})` : '';
      return `stderr${testName}: ${log.content}`;
    }),
    ...report.unhandledErrors.map((error) => {
      const location = error.testName ?? error.moduleId;
      const testName = location ? ` (${location})` : '';
      const description = error.message ?? JSON.stringify(error);
      return `unhandled error${testName}: ${error.name ? `${error.name}: ` : ''}${description}`;
    }),
  ];
  return details.slice(0, limit).map((detail) => detail.replace(/\s+/g, ' ').slice(0, 280));
}

async function runVitest() {
  const tempDir = mkdtempSync(resolve(tmpdir(), 'dajare-required-mutations-'));
  const reportFile = resolve(tempDir, 'vitest.json');
  const errorReportFile = resolve(tempDir, 'vitest-errors.json');
  try {
    const result = await run(
      'npx',
      [
        'vitest',
        'run',
        ...testFiles,
        '--reporter=json',
        `--reporter=${resolve(root, 'scripts/mutation-error-reporter.mjs')}`,
        `--outputFile=${reportFile}`,
      ],
      300_000,
      { ...process.env, MUTATION_ERROR_REPORT_FILE: errorReportFile },
    );
    const failure = childFailure(result, 'Vitest');
    if (failure) return { ok: false, reason: failure };
    const report = readReport(reportFile);
    if (!report.ok) return report;
    const errorReport = readErrorReport(errorReportFile);
    if (!errorReport.ok) return errorReport;
    if (report.totalTests === 0) return { ok: false, reason: '対象テストが実行されませんでした' };
    return { ...report, ...errorReport, status: result.status };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function assertCatchersPassed(report) {
  const passed = new Set(report.passedNames);
  for (const mutation of [...mutations, ...mustReject]) {
    for (const catcher of mutation.catchers) {
      if (!passed.has(catcher)) {
        return `${mutation.name}: 基準実行で catcher が passed ではありません: ${catcher}`;
      }
    }
  }
  return null;
}

function restoreOne(file, original) {
  writeFileSync(backupFile, JSON.stringify({ file, original }), 'utf8');
  writeFileSync(resolve(root, file), original, 'utf8');
  unlinkSync(backupFile);
}

async function checkMutation(mutation) {
  const file = resolve(root, mutation.file);
  const original = readFileSync(file, 'utf8');
  const count = original.split(mutation.needle).length - 1;
  if (count !== 1) {
    return { ok: false, reason: `needle が元ソースに1回ではなく${count}回あります` };
  }
  const changed = original.replace(mutation.needle, mutation.replacement);
  if (changed === original) return { ok: false, reason: '変異を適用できませんでした' };

  writeFileSync(backupFile, JSON.stringify({ file: mutation.file, original }), 'utf8');
  try {
    writeFileSync(file, changed, 'utf8');
    const typecheck = await runTsc(mutation.name);
    if (!typecheck.ok) return { ok: false, reason: typecheck.reason };

    const report = await runVitest();
    if (!report.ok) return { ok: false, kind: report.kind, reason: report.reason };
    if (report.status === 0 || report.failed.length === 0) {
      return { ok: false, reason: 'テストが失敗せず、変異が残りました' };
    }

    const catcher = report.failed.find((assertion) =>
      mutation.catchers.includes(assertion.fullName),
    );
    if (!catcher) {
      return { ok: false, reason: '狙った catcher が失敗しませんでした' };
    }
    if (report.stderr.length > 0 || report.unhandledErrors.length > 0) {
      const [first] = describeRuntimeErrors(report, 1);
      return {
        ok: false,
        kind: 'runtime',
        reason: `実行中に例外やページのエラーが出ました: ${first}`,
      };
    }
    const nonAssertions = report.failed.flatMap((assertion) =>
      assertion.failureMessages.filter((message) => !message.startsWith('AssertionError')),
    );
    if (
      nonAssertions.length > 0 ||
      report.failed.some((assertion) => assertion.failureMessages.length === 0)
    ) {
      return {
        ok: false,
        kind: 'runtime',
        reason: '実行時例外など AssertionError 以外の失敗があります',
      };
    }
    return { ok: true, caught: report.failed.map((assertion) => assertion.fullName) };
  } finally {
    restoreOne(mutation.file, original);
  }
}

async function main() {
  const baselineTsc = await run('npx', ['tsc', '--noEmit', '-p', '.']);
  const tscFailure = childFailure(baselineTsc, 'tsc');
  if (tscFailure || baselineTsc.status !== 0) {
    console.error(`基準の型検査に失敗しました: ${tscFailure ?? baselineTsc.stderr}`);
    process.exitCode = 1;
    return;
  }
  const baseline = await runVitest();
  if (baseline.ok && (baseline.stderr.length > 0 || baseline.unhandledErrors.length > 0)) {
    const errors = describeRuntimeErrors(baseline);
    console.error(
      `基準の実行でエラーが出ています:\n${errors.map((error) => `- ${error}`).join('\n')}`,
    );
    process.exitCode = 1;
    return;
  }
  if (
    !baseline.ok ||
    baseline.status !== 0 ||
    baseline.failed.length > 0 ||
    baseline.totalTests === 0
  ) {
    console.error(`基準の対象テストが通りません: ${baseline.reason ?? '失敗テストがあります'}`);
    process.exitCode = 1;
    return;
  }
  const catcherError = assertCatchersPassed(baseline);
  if (catcherError) {
    console.error(catcherError);
    process.exitCode = 1;
    return;
  }

  let failed = false;
  for (const mutation of mutations) {
    const result = await checkMutation(mutation);
    if (result.ok) {
      console.log(`${mutation.name}：検出（${result.caught.join('、')}）`);
    } else {
      failed = true;
      console.error(`${mutation.name}：失敗（${result.reason}）`);
    }
  }
  for (const mutation of mustReject) {
    const result = await checkMutation(mutation);
    if (!result.ok && result.kind === 'runtime') {
      console.log(`${mutation.name}：検出と数えない（${result.reason}）`);
    } else {
      failed = true;
      console.error(
        `${mutation.name}：失敗（${result.ok ? `検出と数えました: ${result.caught.join('、')}` : result.reason}）`,
      );
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  restoreBackup();
  console.error(
    `変異チェックに失敗しました: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
