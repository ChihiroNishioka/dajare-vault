import { localDateString } from '../domain/ids';
import type { ImportPlan } from '../domain/transfer';
import { LIMITS } from '../domain/validate';
import type { Dajare } from '../types';
import { SUGGESTED_SPEAKERS, SUGGESTED_TAGS } from './constants';
import { escapeHtml } from './html';

function counter(name: string, max: number): string {
  return `<span class="count" data-count-for="${name}">残り ${max}</span>`;
}

function chips(id: string, values: string[]): string {
  if (values.length === 0) return `<div class="chips" id="${id}"></div>`;
  return `<div class="chips" id="${id}">${values
    .map(
      (value) =>
        `<button type="button" class="chip" data-remove-chip="${id}" data-value="${escapeHtml(value)}" aria-label="${escapeHtml(value)} を外す">${escapeHtml(value)}</button>`,
    )
    .join('')}</div>`;
}

function suggestions(kind: 'tag' | 'speaker', labels: string[]): string {
  return `<div class="suggests">${labels
    .map(
      (label) =>
        `<button type="button" class="suggest" data-suggest-${kind}="${escapeHtml(label)}">${escapeHtml(label)}</button>`,
    )
    .join('')}</div>`;
}

export function formPanel(
  mode: 'add' | 'edit',
  item: Dajare | null,
  tags: string[],
  speakers: string[],
): string {
  const today = localDateString(new Date());
  const added = item?.addedAt ?? today;
  const unknown = item ? item.addedAt === null : false;
  const title = mode === 'add' ? '紙を足す' : '書き直す';
  return `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="panel-title">
      <header class="sheet-head">
        <h2 id="panel-title">${title}</h2>
        <button type="button" data-action="close-panel">閉じる</button>
      </header>
      <form class="entry" id="dajare-form" novalidate>
        <label>本文 ${counter('text', LIMITS.text)}
          <textarea name="text" maxlength="${LIMITS.text}" rows="3">${escapeHtml(item?.text ?? '')}</textarea>
        </label>
        <p class="field-error" data-error-for="text"></p>
        <label>シーン ${counter('scene', LIMITS.scene)}
          <input name="scene" maxlength="${LIMITS.scene}" value="${escapeHtml(item?.scene ?? '')}" />
        </label>
        <p class="field-error" data-error-for="scene"></p>
        <button type="button" class="quiet" data-action="scene-unknown">分からなければ「不明」</button>
        <div class="date-row">
          <label>追加日
            <input name="addedAt" type="date" value="${unknown ? '' : escapeHtml(added)}" ${unknown ? 'disabled' : ''} />
          </label>
          <label class="check"><input name="dateUnknown" type="checkbox" ${unknown ? 'checked' : ''} /> 日付は不明</label>
        </div>
        <label>日付メモ ${counter('addedAtNote', LIMITS.addedAtNote)}
          <input name="addedAtNote" maxlength="${LIMITS.addedAtNote}" value="${escapeHtml(item?.addedAtNote ?? '')}" placeholder="年が分からないときなど" />
        </label>
        <p class="field-error" data-error-for="addedAt"></p>
        <label>読み ${counter('reading', LIMITS.reading)}
          <input name="reading" maxlength="${LIMITS.reading}" value="${escapeHtml(item?.reading ?? '')}" placeholder="ひらがな" />
        </label>
        <p class="warn" id="reading-warn"></p>
        <label>元ネタ ${counter('source', LIMITS.source)}
          <input name="source" maxlength="${LIMITS.source}" value="${escapeHtml(item?.source ?? '')}" />
        </label>
        <fieldset>
          <legend>言った人</legend>
          ${chips('draft-speakers', speakers)}
          <input id="speaker-draft" maxlength="${LIMITS.speaker * 2}" placeholder="名前を書いて Enter" />
          ${suggestions('speaker', SUGGESTED_SPEAKERS)}
        </fieldset>
        <p class="field-error" data-error-for="speakers"></p>
        <div class="rate-row">
          <span>評価</span>
          <star-rating ${item?.rating ? `value="${item.rating}"` : ''}></star-rating>
          <label class="check"><input name="favorite" type="checkbox" ${item?.favorite ? 'checked' : ''} /> お気に入り</label>
        </div>
        <fieldset>
          <legend>タグ</legend>
          ${chips('draft-tags', tags)}
          <input id="tag-draft" maxlength="${LIMITS.tag * 2}" placeholder="タグを書いて Enter" />
          ${suggestions('tag', SUGGESTED_TAGS)}
        </fieldset>
        <p class="field-error" data-error-for="tags"></p>
        <label>メモ ${counter('memo', LIMITS.memo)}
          <textarea name="memo" maxlength="${LIMITS.memo}" rows="3">${escapeHtml(item?.memo ?? '')}</textarea>
        </label>
        <p class="field-error" data-error-for="form"></p>
        <div class="sheet-actions">
          <button type="button" class="primary" data-action="save" disabled>保存</button>
          ${
            mode === 'edit' && item
              ? `<button type="button" class="danger" data-action="delete" data-id="${escapeHtml(item.id)}">削除する</button>`
              : ''
          }
          <button type="button" data-action="close-panel">やめる</button>
        </div>
      </form>
    </div>
  `;
}

export function settingsPanel(
  prompt: boolean,
  canShare: boolean,
  canImport = true,
  lastNotion: string | null = null,
): string {
  return `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="panel-title">
      <header class="sheet-head">
        <h2 id="panel-title">保管</h2>
        <button type="button" data-action="close-panel">閉じる</button>
      </header>
      <div class="settings">
        <section>
          <h3>書き出す・読み込む</h3>
          <p>端末のあいだは自動では揃えない。JSONをやり取りする。</p>
          <p>共有DBの無料プランには自動バックアップがありません。消した紙は戻せないので、定期的に JSON を書き出してください。</p>
          ${lastNotion ? `<p>前回の Notion 保管: ${escapeHtml(lastNotion)}</p>` : ''}
          <div class="sheet-actions">
            <button type="button" class="primary" data-action="export">書き出す</button>
            ${canShare ? '<button type="button" data-action="share">共有シートで渡す</button>' : ''}
            ${canImport ? '<button type="button" data-action="pick-import">読み込む</button>' : '<p>閲覧だけなので、書き出しだけできます。</p>'}
          </div>
          <input id="import-file" type="file" accept="application/json,.json" hidden />
        </section>
        <section>
          <h3>サンプル</h3>
          <p>はじめの6件と家族メモを足す。同じIDはスキップする。</p>
          <button type="button" data-action="load-samples">サンプルを読み込む</button>
        </section>
        <section>
          <h3>iPhoneで消えないように</h3>
          <ol>
            <li>Safariでこのページを開く。</li>
            <li>共有ボタンから「ホーム画面に追加」を選ぶ。</li>
            <li>以後はそのアイコンから開く。タブのまま何日も置いておくと、中身が消えることがある。</li>
            <li>書いたあとは「書き出す」でファイルアプリに残す。</li>
          </ol>
          <label class="check"><input id="prompt-on-change" type="checkbox" ${prompt ? 'checked' : ''} /> 変更のたびに書き出しをうながす</label>
        </section>
      </div>
    </div>
  `;
}

export function notionPanel(text: string, bad: boolean): string {
  return `
    <div class="sheet sheet-narrow" role="dialog" aria-modal="true" aria-labelledby="panel-title">
      <h2 id="panel-title">Notionに保管</h2>
      <p class="${bad ? 'field-error' : ''}" data-notion-status>${escapeHtml(text)}</p>
      <div class="sheet-actions">
        <button type="button" data-action="close-panel">閉じる</button>
      </div>
    </div>
  `;
}

export function deletePanel(item: Dajare): string {
  const preview = item.text.split('\n')[0] ?? item.text;
  return `
    <div class="sheet sheet-narrow" role="dialog" aria-modal="true" aria-labelledby="panel-title">
      <h2 id="panel-title">この紙を捨てますか</h2>
      <p class="confirm-text">${escapeHtml(preview)}</p>
      <p>捨てると戻せません。書き出してあれば、そのファイルからは読めます。共有DBの無料プランには自動バックアップがないので、消した紙はデータベースには残りません。</p>
      <div class="sheet-actions">
        <button type="button" class="danger" data-action="confirm-delete">削除する</button>
        <button type="button" data-action="close-panel">やめる</button>
      </div>
    </div>
  `;
}

export function confirmUploadPanel(counts: {
  send: { length: number };
  already: number;
  different: number;
  seedMissing: number;
  editedSeed: number;
}): string {
  const send =
    counts.send.length > 0
      ? `<button type="button" class="primary" data-action="confirm-upload">送る</button>`
      : '';
  return `
    <div class="sheet sheet-narrow" role="dialog" aria-modal="true" aria-labelledby="panel-title">
      <h2 id="panel-title">この端末の紙を共有しますか</h2>
      <p>この端末で書いた紙のうち、${counts.send.length}件を共有DBに送ります。送った内容は、URLを知っている人なら誰でも読めます。</p>
      <p>すでに同じIDがある ${counts.already}件は飛ばします。中身が違う ${counts.different}件も上書きしません。</p>
      <p>初期データで、共有DBに無い ${counts.seedMissing}件は送りません。消した見本は戻りません。</p>
      ${
        counts.editedSeed
          ? `<p>書き直した見本 ${counts.editedSeed}件は送りません。必要なら書き出してください。</p>`
          : ''
      }
      <div class="sheet-actions">
        ${send}
        <button type="button" data-action="close-panel">やめる</button>
      </div>
    </div>
  `;
}

export function promptPanel(): string {
  return `
    <div class="sheet sheet-narrow" role="dialog" aria-modal="true" aria-labelledby="panel-title">
      <h2 id="panel-title">書き出しておきますか</h2>
      <p>紙が増えました。JSONにして残しておくと、あとから戻せます。</p>
      <div class="sheet-actions">
        <button type="button" class="primary" data-action="export">書き出す</button>
        <button type="button" data-action="close-panel">今はしない</button>
      </div>
    </div>
  `;
}

function listConflicts(plan: ImportPlan, seedSkipped = 0): string {
  const idRows = plan.idConflicts
    .map((row) => {
      const label = escapeHtml(row.incoming.text.split('\n')[0] ?? '');
      const id = escapeHtml(row.incoming.id);
      return `<li>
        <span>${label}</span>
        <label><input type="radio" name="id-${id}" data-id-choice="${id}" value="skip" checked /> スキップ</label>
        <label><input type="radio" name="id-${id}" data-id-choice="${id}" value="overwrite" /> 上書き</label>
      </li>`;
    })
    .join('');
  const textRows = plan.textSceneDupes
    .map((row) => {
      const label = escapeHtml(row.incoming.text.split('\n')[0] ?? '');
      return `<li><label><input type="checkbox" data-dupe-id="${escapeHtml(row.incoming.id)}" /> それでも取り込む ${label}</label></li>`;
    })
    .join('');
  return `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="panel-title">
      <header class="sheet-head">
        <h2 id="panel-title">読み込みの確認</h2>
        <button type="button" data-action="close-panel">閉じる</button>
      </header>
      <p>新規 ${plan.fresh.length - seedSkipped} 件。同じIDが ${plan.idConflicts.length} 件あります。標準ではスキップします。</p>
      <p>本文とシーンが同じものは ${plan.textSceneDupes.length} 件。選んだものだけ足します。</p>
      ${seedSkipped ? `<p>消した見本 ${seedSkipped} 件は戻しません。</p>` : ''}
      ${
        plan.idConflicts.length
          ? `<details open><summary>同じID</summary><ul class="conflict-list">${idRows}</ul></details>`
          : ''
      }
      ${
        plan.textSceneDupes.length
          ? `<details open><summary>本文とシーンが同じ</summary><ul class="conflict-list">${textRows}</ul></details>`
          : ''
      }
      <div class="sheet-actions">
        <button type="button" class="primary" data-action="commit-import">取り込む</button>
        <button type="button" data-action="close-panel">やめる</button>
      </div>
    </div>
  `;
}

export function importPanel(plan: ImportPlan, seedSkipped = 0): string {
  return listConflicts(plan, seedSkipped);
}

export function changedAfterConfirmPanel(items: { text: string }[]): string {
  const rows = items
    .map((item) => `<li>${escapeHtml(item.text.split('\n')[0] ?? '')}</li>`)
    .join('');
  return `
    <div class="sheet sheet-narrow" role="dialog" aria-modal="true" aria-labelledby="panel-title">
      <h2 id="panel-title">上書きしませんでした</h2>
      <p>確認のあとで直されていたので、次の紙はそのままにしました。</p>
      <ul class="conflict-list">${rows}</ul>
      <div class="sheet-actions">
        <button type="button" data-action="close-panel">閉じる</button>
      </div>
    </div>
  `;
}
