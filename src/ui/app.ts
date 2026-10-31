import { backupNotice } from '../domain/backup';
import {
  exportFilename,
  serialize,
  type ImportDecisions,
  type ImportPlan,
} from '../domain/transfer';
import { LIMITS, READING_RE } from '../domain/validate';
import { defaultQuery, queryItems, type SortKey, type TagMode } from '../domain/query';
import { createStore, type Store } from '../store/store';
import type { Dajare, DajareDraft } from '../types';
import { defineCard, type DajareCard } from './card';
import { SUGGESTED_SPEAKERS, SUGGESTED_TAGS } from './constants';
import { escapeHtml } from './html';
import { deletePanel, formPanel, importPanel, promptPanel, settingsPanel } from './panel';
import { defineStars } from './stars';

defineCard();
defineStars();

type Panel =
  | { kind: 'closed' }
  | { kind: 'form'; mode: 'add' | 'edit'; id?: string }
  | { kind: 'settings' }
  | { kind: 'import'; plan: ImportPlan; incoming: Dajare[] }
  | { kind: 'delete'; id: string }
  | { kind: 'prompt' };

const ui = {
  ...defaultQuery(),
  filtersOpen: false,
  panel: { kind: 'closed' } as Panel,
  draftTags: [] as string[],
  draftSpeakers: [] as string[],
  idActions: {} as Record<string, 'skip' | 'overwrite'>,
  acceptDupes: [] as string[],
};

let toastTimer = 0;

export function mount(root: HTMLElement, store: Store = createStore(window.localStorage)): void {
  root.innerHTML = shell();
  const shellEl = root.querySelector<HTMLElement>('.app');
  const panel = root.querySelector<HTMLElement>('#panel');
  const board = root.querySelector<HTMLElement>('#board');
  const banner = root.querySelector<HTMLElement>('#banner');
  const count = root.querySelector<HTMLElement>('#count');
  const tagList = root.querySelector<HTMLElement>('#tag-list');
  const speakerList = root.querySelector<HTMLElement>('#speaker-list');
  const filters = root.querySelector<HTMLElement>('#filters');
  const toast = root.querySelector<HTMLElement>('#toast');
  if (
    !shellEl ||
    !panel ||
    !board ||
    !banner ||
    !count ||
    !tagList ||
    !speakerList ||
    !filters ||
    !toast
  ) {
    throw new Error('shell failed');
  }

  const showToast = (message: string): void => {
    toast.textContent = message;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.textContent = '';
    }, 4200);
  };

  const renderResults = (): void => {
    const state = store.getState();
    const items = queryItems(state.items, {
      q: ui.q,
      scene: ui.scene,
      tags: ui.tags,
      tagMode: ui.tagMode,
      speakers: ui.speakers,
      favoriteOnly: ui.favoriteOnly,
      unknownDateOnly: ui.unknownDateOnly,
      minRating: ui.minRating,
      sort: ui.sort,
    });
    const notice = backupNotice(state.meta, new Date());
    const bits = [notice.text, state.loadError, state.saveError].filter(Boolean);
    banner.textContent = bits.join(' / ');
    banner.classList.toggle(
      'is-warn',
      notice.warn || Boolean(state.saveError) || Boolean(state.loadError),
    );
    const filtered = items.length !== state.items.length;
    count.textContent = filtered
      ? `${items.length} / ${state.items.length}枚`
      : `${state.items.length}枚`;
    board.replaceChildren();
    if (items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-note';
      empty.textContent = 'その条件の紙は、まだ挟んでいない。';
      board.append(empty);
      return;
    }
    for (const item of items) {
      const card = document.createElement('dajare-card') as DajareCard;
      card.item = item;
      board.append(card);
    }
  };

  const renderChoices = (): void => {
    const tags = new Set<string>(SUGGESTED_TAGS);
    const speakers = new Set<string>(SUGGESTED_SPEAKERS);
    for (const item of store.getState().items) {
      item.tags.forEach((tag) => tags.add(tag));
      item.speakers.forEach((name) => speakers.add(name));
    }
    tagList.innerHTML = [...tags]
      .map((tag) => {
        const on = ui.tags.includes(tag);
        return `<button type="button" class="tag-pick${on ? ' is-on' : ''}" data-tag="${escapeHtml(tag)}" aria-pressed="${on}">${escapeHtml(tag)}</button>`;
      })
      .join('');
    speakerList.innerHTML = [...speakers]
      .map((name) => {
        const on = ui.speakers.includes(name);
        return `<button type="button" class="tag-pick speaker-pick${on ? ' is-on' : ''}" data-speaker="${escapeHtml(name)}" aria-pressed="${on}">${escapeHtml(name)}</button>`;
      })
      .join('');
  };

  const syncChrome = (): void => {
    filters.classList.toggle('is-open', ui.filtersOpen);
    const toggle = root.querySelector<HTMLButtonElement>('[data-action="toggle-filters"]');
    if (toggle) {
      toggle.textContent = ui.filtersOpen ? '絞り込みを閉じる' : '絞り込みを開く';
      toggle.setAttribute('aria-expanded', String(ui.filtersOpen));
    }
    const open = ui.panel.kind !== 'closed';
    panel.hidden = !open;
    shellEl.toggleAttribute('inert', open);
    document.body.classList.toggle('panel-open', open);
  };

  const closePanel = (): void => {
    ui.panel = { kind: 'closed' };
    panel.innerHTML = '';
    syncChrome();
  };

  const openPanel = (): void => {
    syncChrome();
    const focus = panel.querySelector<HTMLElement>('textarea, input, button');
    focus?.focus();
  };

  const refreshChips = (): void => {
    const tags = panel.querySelector('#draft-tags');
    const speakers = panel.querySelector('#draft-speakers');
    if (tags) tags.innerHTML = chipHtml('draft-tags', ui.draftTags);
    if (speakers) speakers.innerHTML = chipHtml('draft-speakers', ui.draftSpeakers);
  };

  const showFormErrors = (errors: { field: string; message: string }[]): void => {
    panel.querySelectorAll<HTMLElement>('[data-error-for]').forEach((node) => {
      node.textContent = '';
    });
    for (const error of errors) {
      const slot = panel.querySelector<HTMLElement>(`[data-error-for="${error.field}"]`);
      if (slot) slot.textContent = error.message;
      else {
        const formSlot = panel.querySelector<HTMLElement>('[data-error-for="form"]');
        if (formSlot) formSlot.textContent = error.message;
      }
    }
  };

  const readDraft = (): DajareDraft | null => {
    const form = panel.querySelector<HTMLFormElement>('#dajare-form');
    if (!form) return null;
    const data = new FormData(form);
    const unknown = data.get('dateUnknown') === 'on';
    const addedRaw = String(data.get('addedAt') ?? '');
    const star = panel.querySelector('star-rating');
    const starRaw = star?.getAttribute('value');
    return {
      text: String(data.get('text') ?? ''),
      scene: String(data.get('scene') ?? ''),
      addedAt: unknown || addedRaw === '' ? null : addedRaw,
      addedAtNote: String(data.get('addedAtNote') ?? ''),
      reading: String(data.get('reading') ?? ''),
      source: String(data.get('source') ?? ''),
      rating: starRaw ? (Number(starRaw) as DajareDraft['rating']) : null,
      favorite: data.get('favorite') === 'on',
      tags: ui.draftTags,
      speakers: ui.draftSpeakers,
      memo: String(data.get('memo') ?? ''),
    };
  };

  const syncSave = (): void => {
    const form = panel.querySelector<HTMLFormElement>('#dajare-form');
    const save = panel.querySelector<HTMLButtonElement>('[data-action="save"]');
    if (!form || !save) return;
    const text = String(new FormData(form).get('text') ?? '').trim();
    const scene = String(new FormData(form).get('scene') ?? '').trim();
    save.disabled = text.length === 0 || scene.length === 0;
    updateCounters(form);
    const reading = String(new FormData(form).get('reading') ?? '').trim();
    const warn = panel.querySelector('#reading-warn');
    if (warn) {
      warn.textContent =
        reading && !READING_RE.test(reading)
          ? '読みはひらがな・長音（ー）・読点だけにしておくと検索しやすいです'
          : '';
    }
  };

  const afterWrite = (): void => {
    renderResults();
    renderChoices();
    if (store.getState().meta.promptOnChange) {
      ui.panel = { kind: 'prompt' };
      panel.innerHTML = promptPanel();
      openPanel();
      return;
    }
    closePanel();
  };

  const saveForm = (): void => {
    const draft = readDraft();
    if (!draft || ui.panel.kind !== 'form') return;
    const result =
      ui.panel.mode === 'edit' && ui.panel.id ? store.update(ui.panel.id, draft) : store.add(draft);
    if (!result.ok) {
      showFormErrors(result.errors);
      return;
    }
    showToast(ui.panel.mode === 'edit' ? '書き直しました' : '紙を足しました');
    afterWrite();
  };

  const download = (filename: string, contents: string): void => {
    const blob = new Blob([contents], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const doExport = (): void => {
    const items = store.exportItems();
    const filename = exportFilename(new Date());
    download(filename, serialize(items));
    store.markExported();
    showToast('書き出しました');
    renderResults();
    if (ui.panel.kind === 'prompt') closePanel();
  };

  const doShare = async (): Promise<void> => {
    const items = store.exportItems();
    const filename = exportFilename(new Date());
    const contents = serialize(items);
    const file = new File([contents], filename, { type: 'application/json' });
    if (!navigator.canShare?.({ files: [file] })) {
      doExport();
      return;
    }
    try {
      await navigator.share({ files: [file], title: filename });
      store.markExported();
      showToast('共有シートへ渡しました');
      renderResults();
    } catch {
      showToast('共有はキャンセルされました');
    }
  };

  root.addEventListener('submit', (event) => event.preventDefault());

  root.addEventListener('input', (event) => {
    const target = event.target as HTMLElement;
    if (target.id === 'q') {
      ui.q = (target as HTMLInputElement).value;
      renderResults();
    } else if (target.id === 'scene-filter') {
      ui.scene = (target as HTMLInputElement).value;
      renderResults();
    } else if (target.closest('#dajare-form')) {
      syncSave();
    }
  });

  root.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    if (target.id === 'sort') {
      ui.sort = target.value as SortKey;
      renderResults();
    } else if (target.id === 'tag-mode') {
      ui.tagMode = target.value as TagMode;
      renderResults();
    } else if (target.id === 'min-rating') {
      ui.minRating = target.value ? Number(target.value) : null;
      renderResults();
    } else if (target.id === 'favorite-only') {
      ui.favoriteOnly = target.checked;
      renderResults();
    } else if (target.id === 'unknown-date') {
      ui.unknownDateOnly = target.checked;
      renderResults();
    } else if (target.id === 'prompt-on-change') {
      store.setPromptOnChange(target.checked);
    } else if (target.name === 'dateUnknown') {
      const date = panel.querySelector<HTMLInputElement>('input[name="addedAt"]');
      if (date) {
        date.disabled = target.checked;
        if (target.checked) date.value = '';
      }
    } else if (target.dataset.idChoice) {
      ui.idActions[target.dataset.idChoice] = target.value === 'overwrite' ? 'overwrite' : 'skip';
    } else if (target.dataset.dupeId) {
      const id = target.dataset.dupeId;
      ui.acceptDupes = target.checked
        ? [...ui.acceptDupes, id]
        : ui.acceptDupes.filter((row) => row !== id);
    } else if (target.id === 'import-file' && target.files?.[0]) {
      void readImport(target.files[0]);
      target.value = '';
    }
  });

  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && ui.panel.kind !== 'closed') {
      closePanel();
      return;
    }
    if (event.key !== 'Enter' || event.isComposing) return;
    const target = event.target as HTMLElement;
    if (target.id === 'tag-draft') {
      event.preventDefault();
      pushChip('tags', (target as HTMLInputElement).value);
      (target as HTMLInputElement).value = '';
    } else if (target.id === 'speaker-draft') {
      event.preventDefault();
      pushChip('speakers', (target as HTMLInputElement).value);
      (target as HTMLInputElement).value = '';
    }
  });

  root.addEventListener('focusout', (event) => {
    const target = event.target as HTMLElement;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    if (!target.closest('#dajare-form')) return;
    const name = target.name;
    if (name !== 'text' && name !== 'scene') return;
    const slot = panel.querySelector<HTMLElement>(`[data-error-for="${name}"]`);
    if (!slot) return;
    slot.textContent = target.value.trim()
      ? ''
      : name === 'text'
        ? '本文を書いてください'
        : 'シーンを書いてください';
  });

  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const actionEl = target.closest<HTMLElement>(
      '[data-action], [data-tag], [data-speaker], [data-suggest-tag], [data-suggest-speaker], [data-remove-chip]',
    );
    if (!actionEl) return;
    const action = actionEl.dataset.action;

    if (actionEl.dataset.tag) {
      const tag = actionEl.dataset.tag;
      ui.tags = ui.tags.includes(tag) ? ui.tags.filter((row) => row !== tag) : [...ui.tags, tag];
      renderChoices();
      renderResults();
      return;
    }
    if (actionEl.dataset.speaker) {
      const name = actionEl.dataset.speaker;
      ui.speakers = ui.speakers.includes(name)
        ? ui.speakers.filter((row) => row !== name)
        : [...ui.speakers, name];
      renderChoices();
      renderResults();
      return;
    }
    if (actionEl.dataset.suggestTag) {
      pushChip('tags', actionEl.dataset.suggestTag);
      return;
    }
    if (actionEl.dataset.suggestSpeaker) {
      pushChip('speakers', actionEl.dataset.suggestSpeaker);
      return;
    }
    if (actionEl.dataset.removeChip && actionEl.dataset.value) {
      if (actionEl.dataset.removeChip === 'draft-tags') {
        ui.draftTags = ui.draftTags.filter((row) => row !== actionEl.dataset.value);
      } else {
        ui.draftSpeakers = ui.draftSpeakers.filter((row) => row !== actionEl.dataset.value);
      }
      refreshChips();
      return;
    }

    if (action === 'toggle-filters') {
      ui.filtersOpen = !ui.filtersOpen;
      syncChrome();
      return;
    }
    if (action === 'add') {
      ui.draftTags = [];
      ui.draftSpeakers = [];
      ui.panel = { kind: 'form', mode: 'add' };
      panel.innerHTML = formPanel('add', null, [], []);
      openPanel();
      syncSave();
      return;
    }
    if (action === 'settings') {
      ui.panel = { kind: 'settings' };
      let canShare = false;
      try {
        canShare = Boolean(
          navigator.canShare?.({
            files: [new File(['{}'], 'dajare.json', { type: 'application/json' })],
          }),
        );
      } catch {
        canShare = false;
      }
      panel.innerHTML = settingsPanel(store.getState().meta.promptOnChange, canShare);
      openPanel();
      return;
    }
    if (action === 'close-panel') {
      closePanel();
      return;
    }
    if (action === 'scene-unknown') {
      const scene = panel.querySelector<HTMLInputElement>('input[name="scene"]');
      if (scene) scene.value = '不明';
      syncSave();
      return;
    }
    if (action === 'save') {
      saveForm();
      return;
    }
    if (action === 'edit') {
      const item = store.getState().items.find((row) => row.id === actionEl.dataset.id);
      if (!item) return;
      ui.draftTags = [...item.tags];
      ui.draftSpeakers = [...item.speakers];
      ui.panel = { kind: 'form', mode: 'edit', id: item.id };
      panel.innerHTML = formPanel('edit', item, ui.draftTags, ui.draftSpeakers);
      openPanel();
      syncSave();
      return;
    }
    if (action === 'delete') {
      if (!actionEl.dataset.id) return;
      ui.panel = { kind: 'delete', id: actionEl.dataset.id };
      const item = store.getState().items.find((row) => row.id === actionEl.dataset.id);
      if (!item) return;
      panel.innerHTML = deletePanel(item);
      openPanel();
      return;
    }
    if (action === 'confirm-delete' && ui.panel.kind === 'delete') {
      store.remove(ui.panel.id);
      showToast('捨てました');
      afterWrite();
      return;
    }
    if (action === 'export') {
      doExport();
      return;
    }
    if (action === 'share') {
      void doShare();
      return;
    }
    if (action === 'pick-import') {
      panel.querySelector<HTMLInputElement>('#import-file')?.click();
      return;
    }
    if (action === 'load-samples') {
      const result = store.loadSamples();
      showToast(`${result.added}件足しました。${result.skipped}件はスキップしました`);
      renderResults();
      renderChoices();
      return;
    }
    if (action === 'commit-import' && ui.panel.kind === 'import') {
      const decisions: ImportDecisions = {
        idActions: ui.idActions,
        acceptTextSceneIds: ui.acceptDupes,
      };
      const result = store.commitImport(ui.panel.incoming, decisions);
      if ('error' in result) {
        showToast(result.error);
        return;
      }
      showToast(
        `${result.added}件足して、${result.overwritten}件上書き、${result.skipped}件スキップしました`,
      );
      closePanel();
      renderResults();
      renderChoices();
    }
  });

  const pushChip = (kind: 'tags' | 'speakers', raw: string): void => {
    const value = raw.trim();
    if (!value) return;
    if (kind === 'tags') {
      if (value.length > LIMITS.tag) {
        showFormErrors([{ field: 'tags', message: `タグは${LIMITS.tag}文字までです` }]);
        return;
      }
      if (!ui.draftTags.includes(value) && ui.draftTags.length >= LIMITS.tags) {
        showFormErrors([{ field: 'tags', message: `タグは${LIMITS.tags}個までです` }]);
        return;
      }
      if (!ui.draftTags.includes(value)) ui.draftTags = [...ui.draftTags, value];
    } else {
      if (value.length > LIMITS.speaker) {
        showFormErrors([{ field: 'speakers', message: `言った人は${LIMITS.speaker}文字までです` }]);
        return;
      }
      if (!ui.draftSpeakers.includes(value) && ui.draftSpeakers.length >= LIMITS.speakers) {
        showFormErrors([{ field: 'speakers', message: `言った人は${LIMITS.speakers}人までです` }]);
        return;
      }
      if (!ui.draftSpeakers.includes(value)) ui.draftSpeakers = [...ui.draftSpeakers, value];
    }
    refreshChips();
  };

  const readImport = async (file: File): Promise<void> => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text()) as unknown;
    } catch {
      showToast('JSONとして読めませんでした');
      return;
    }
    const preview = store.previewImport(parsed);
    if (!preview.ok || !preview.plan) {
      showToast(preview.ok ? '読み込めませんでした' : preview.error);
      return;
    }
    ui.idActions = {};
    ui.acceptDupes = [];
    ui.panel = { kind: 'import', plan: preview.plan, incoming: preview.items };
    panel.innerHTML = importPanel(preview.plan);
    openPanel();
  };

  store.subscribe(() => {
    renderResults();
  });
  renderChoices();
  renderResults();
  syncChrome();
}

function chipHtml(id: string, values: string[]): string {
  return values
    .map(
      (value) =>
        `<button type="button" class="chip" data-remove-chip="${id}" data-value="${escapeHtml(value)}" aria-label="${escapeHtml(value)} を外す">${escapeHtml(value)}</button>`,
    )
    .join('');
}

function updateCounters(form: HTMLFormElement): void {
  const pairs: [string, number][] = [
    ['text', LIMITS.text],
    ['scene', LIMITS.scene],
    ['reading', LIMITS.reading],
    ['source', LIMITS.source],
    ['memo', LIMITS.memo],
    ['addedAtNote', LIMITS.addedAtNote],
  ];
  for (const [name, max] of pairs) {
    const field = form.elements.namedItem(name);
    const slot = form.querySelector<HTMLElement>(`[data-count-for="${name}"]`);
    if (!slot || !(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement))
      continue;
    const left = max - field.value.length;
    slot.textContent = left === 0 ? '上限です' : `残り ${left}`;
    slot.classList.toggle('is-max', left === 0);
  }
}

function shell(): string {
  return `
    <div class="paper-fiber" aria-hidden="true"></div>
    <div class="app">
      <header class="masthead">
        <div class="brand">
          <span class="seal" aria-hidden="true">洒</span>
          <div>
            <p class="eyebrow">ちいさな紙束</p>
            <h1><span class="title-mark">駄洒落保管庫</span></h1>
            <p class="lede">思いついた端から、紙に残す。</p>
          </div>
        </div>
        <div class="mast-actions">
          <button type="button" class="add-button" data-action="add">追加</button>
          <button type="button" class="texty" data-action="settings">保管</button>
        </div>
      </header>
      <div class="search-row">
        <label class="search">
          <span class="sr-only">検索</span>
          <input id="q" type="search" placeholder="検索" autocomplete="off" enterkeyhint="search" />
        </label>
        <button type="button" class="filter-open" data-action="toggle-filters" aria-expanded="false" aria-controls="filters">絞り込みを開く</button>
      </div>
      <div class="layout">
        <aside id="filters" class="filters">
          <div class="pin" aria-hidden="true"></div>
          <h2>絞り込み</h2>
          <label>シーンで絞る
            <input id="scene-filter" type="search" autocomplete="off" />
          </label>
          <label>並び替え
            <select id="sort">
              <option value="addedDesc">追加日が新しい順</option>
              <option value="addedAsc">追加日が古い順</option>
              <option value="updatedDesc">更新が新しい順</option>
              <option value="ratingDesc">評価が高い順</option>
              <option value="reading">読みの五十音順</option>
            </select>
          </label>
          <label class="check"><input id="favorite-only" type="checkbox" /> お気に入りだけ</label>
          <label class="check"><input id="unknown-date" type="checkbox" /> 追加日が不明だけ</label>
          <label>評価の下限
            <select id="min-rating">
              <option value="">問わない</option>
              <option value="1">1以上</option>
              <option value="2">2以上</option>
              <option value="3">3以上</option>
              <option value="4">4以上</option>
              <option value="5">5だけ</option>
            </select>
          </label>
          <label>タグの条件
            <select id="tag-mode">
              <option value="and">すべて含む</option>
              <option value="or">どれか含む</option>
            </select>
          </label>
          <div id="tag-list" class="pick-list"></div>
          <h3>言った人</h3>
          <div id="speaker-list" class="pick-list"></div>
          <button type="button" class="filter-close" data-action="toggle-filters">閉じる</button>
        </aside>
        <main>
          <p id="banner" class="banner"></p>
          <p id="count" class="count-line" data-testid="count"></p>
          <div id="board"></div>
        </main>
      </div>
    </div>
    <div id="panel" hidden></div>
    <div id="toast" role="status"></div>
  `;
}
