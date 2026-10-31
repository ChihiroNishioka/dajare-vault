import { backupNotice } from '../domain/backup';
import {
  exportFilename,
  hasOwnDeviceData,
  parseVault,
  planDeviceUpload,
  planImport,
  prepareImportCommit,
  serialize,
  shouldMarkUploaded,
  type ImportDecisions,
  type ImportPlan,
} from '../domain/transfer';
import { codePointLength, LIMITS, READING_RE } from '../domain/validate';
import { defaultQuery, queryItems, type SortKey, type TagMode } from '../domain/query';
import type { DajareStore } from '../store/dajare-store';
import { adaptLocalStore } from '../store/local-dajare-store';
import { createStore, type Store } from '../store/store';
import { SEED_IDS } from '../data/seed-ids';
import seedFile from '../data/seed.json';
import { DATA_KEY, META_KEY, type Dajare, type DajareDraft } from '../types';
import { CLOUD_NOT_READY } from '../cloud/messages';
import { isFirebaseConfigured, firebaseConfig } from '../firebase-config';
import { readPreviewActor } from '../session';
import type { Actor } from '../types';
import { defineCard, type DajareCard } from './card';
import { SUGGESTED_SPEAKERS, SUGGESTED_TAGS } from './constants';
import { escapeHtml } from './html';
import {
  confirmUploadPanel,
  deletePanel,
  formPanel,
  importPanel,
  promptPanel,
  settingsPanel,
} from './panel';
import { defineStars } from './stars';

defineCard();
defineStars();

type Panel =
  | { kind: 'closed' }
  | { kind: 'form'; mode: 'add' | 'edit'; id?: string }
  | { kind: 'settings' }
  | { kind: 'import'; plan: ImportPlan; incoming: Dajare[] }
  | { kind: 'delete'; id: string }
  | { kind: 'upload-local'; sendIds: string[] }
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

const LOCAL_UPLOAD_KEY = 'dajareVault:uploadedLocal';

export function mount(
  root: HTMLElement,
  store: Store = createStore(window.localStorage, {
    seedOnEmpty: !isFirebaseConfigured(firebaseConfig),
  }),
): void {
  const preview = isFirebaseConfigured(firebaseConfig)
    ? null
    : readPreviewActor(window.localStorage);
  const gate: { mode: 'local' | 'cloud'; user: Actor | null; isEditor: boolean } = {
    mode: 'local',
    user: preview,
    isEditor: true,
  };
  const canEdit = (): boolean => {
    if (cloudStore?.readError() === CLOUD_NOT_READY) return false;
    return gate.mode === 'local' || gate.isEditor;
  };
  let cloudStore: DajareStore | null = null;
  let cloudSignIn: (() => Promise<void>) | null = null;
  let cloudSignOut: (() => Promise<void>) | null = null;
  let cloudBootError: string | null = null;
  const localApi = adaptLocalStore(store);
  const active = (): DajareStore => (gate.mode === 'cloud' && cloudStore ? cloudStore : localApi);
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
    const items = queryItems(listedItems(), {
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
    const cloudError = gate.mode === 'cloud' ? cloudStore?.readError() : null;
    const notReady = cloudError === CLOUD_NOT_READY;
    const bits = notReady
      ? []
      : [notice.text, state.loadError, state.saveError, cloudError, cloudBootError].filter(Boolean);
    banner.replaceChildren();
    banner.hidden = notReady;
    if (!notReady) {
      const line = document.createElement('span');
      line.textContent = bits.join(' / ');
      banner.append(line);
    }
    if (store.exportBroken()) {
      const recover = document.createElement('button');
      recover.type = 'button';
      recover.dataset.action = 'export-broken';
      recover.textContent = '読めなかった原文を書き出す';
      banner.append(recover);
    }
    banner.classList.toggle(
      'is-warn',
      !notReady && (notice.warn || Boolean(state.saveError) || Boolean(state.loadError)),
    );
    const total = listedItems().length;
    const filtered = items.length !== total;
    count.hidden = notReady;
    count.textContent = notReady ? '' : filtered ? `${items.length} / ${total}枚` : `${total}枚`;
    board.replaceChildren();
    if (notReady) {
      const waiting = document.createElement('p');
      waiting.className = 'empty-note';
      waiting.textContent = CLOUD_NOT_READY;
      board.append(waiting);
      syncAccount();
      return;
    }
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
      card.editable = canEdit();
      board.append(card);
    }
  };

  const renderChoices = (): void => {
    const tags = new Set<string>(SUGGESTED_TAGS);
    const speakers = new Set<string>(SUGGESTED_SPEAKERS);
    for (const item of listedItems()) {
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

  const syncAccount = (): void => {
    const slot = root.querySelector('#account');
    if (!slot) return;
    root.querySelectorAll<HTMLElement>('[data-action="add"]').forEach((button) => {
      button.hidden = !canEdit();
    });
    if (gate.mode === 'local') {
      slot.innerHTML = gate.user
        ? `<p class="who"><b>${escapeHtml(gate.user.name)}</b><span>見本のログイン</span></p>`
        : `<p class="who"><span>この端末だけ</span></p>`;
      return;
    }
    if (!gate.user) {
      slot.innerHTML = `<p class="who"><span>共有</span></p><button type="button" class="texty" data-action="sign-in">ログイン</button>`;
      return;
    }
    const viewer = gate.isEditor ? '<span>共有</span>' : '<span>閲覧のみ</span>';
    slot.innerHTML = `<p class="who"><b>${escapeHtml(gate.user.name)}</b>${viewer}<button type="button" class="quiet" data-action="sign-out">ログアウト</button></p>`;
  };

  const listedItems = (): Dajare[] =>
    gate.mode === 'cloud' ? (cloudStore ? cloudStore.getItems() : []) : store.getState().items;

  const syncChrome = (): void => {
    syncAccount();
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
    const editing = ui.panel.mode === 'edit' && ui.panel.id ? ui.panel.id : '';
    const pending = editing
      ? active().update(editing, draft, gate.user)
      : active().create(draft, gate.user);
    void pending.then((result) => {
      if (!result.ok) {
        showFormErrors(
          result.errors ?? [{ field: 'form', message: result.error ?? '保存できませんでした' }],
        );
        return;
      }
      showToast(editing ? '書き直しました' : '紙を足しました');
      afterWrite();
    });
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
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const doExport = (): void => {
    const items = gate.mode === 'cloud' && cloudStore ? cloudStore.getItems() : store.exportItems();
    const filename = exportFilename(new Date());
    download(filename, serialize(items));
    window.setTimeout(() => {
      store.markExported();
      showToast('書き出しました');
      renderResults();
      if (ui.panel.kind === 'prompt') closePanel();
    }, 1000);
  };

  const doShare = async (): Promise<void> => {
    const items = gate.mode === 'cloud' && cloudStore ? cloudStore.getItems() : store.exportItems();
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
      if (ui.panel.kind === 'form' && formDirty() && !window.confirm('書いた内容を捨てますか？'))
        return;
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
      panel.innerHTML = settingsPanel(store.getState().meta.promptOnChange, canShare, canEdit());
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
      const item = listedItems().find((row) => row.id === actionEl.dataset.id);
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
      const item = listedItems().find((row) => row.id === actionEl.dataset.id);
      if (!item) return;
      panel.innerHTML = deletePanel(item);
      openPanel();
      return;
    }
    if (action === 'confirm-delete' && ui.panel.kind === 'delete') {
      const id = ui.panel.id;
      void active()
        .remove(id)
        .then((result) => {
          if (!result.ok) {
            showToast(result.error ?? '捨てられませんでした');
            renderResults();
            return;
          }
          showToast('捨てました');
          afterWrite();
        });
      return;
    }
    if (action === 'export-broken') {
      const raw = store.exportBroken();
      if (!raw) return;
      download(
        `dajare-vault-broken-${exportFilename(new Date()).slice('dajare-vault-'.length)}`,
        raw,
      );
      showToast('読めなかった原文を書き出しました');
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
    if (action === 'sign-in') {
      if (!cloudSignIn) {
        showToast('共有の準備ができていません');
        return;
      }
      void cloudSignIn().catch((error: unknown) => {
        const code =
          error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
        if (code === 'auth/popup-blocked') {
          showToast('ログイン画面が開けませんでした。もう一度タップしてください');
          return;
        }
        showToast('ログインできませんでした');
      });
      return;
    }
    if (action === 'sign-out') {
      void cloudSignOut?.();
      return;
    }
    if (action === 'seed-cloud' && cloudStore && gate.user) {
      void cloudStore.migrateSeed(seedFile.items as Dajare[], gate.user).then((result) => {
        showToast(
          result.error ??
            (result.added === 0
              ? '新しく入れる紙はありませんでした'
              : `${result.added}件を共有DBに入れました`),
        );
        renderCloudNotes();
      });
      return;
    }
    if (action === 'upload-local' && cloudStore && gate.user) {
      const upload = planDeviceUpload(store.getState().items, cloudStore.getItems(), SEED_IDS);
      ui.panel = { kind: 'upload-local', sendIds: upload.send.map((item) => item.id) };
      panel.innerHTML = confirmUploadPanel(upload);
      openPanel();
      return;
    }
    if (
      action === 'confirm-upload' &&
      ui.panel.kind === 'upload-local' &&
      cloudStore &&
      gate.user
    ) {
      const upload = planDeviceUpload(store.getState().items, cloudStore.getItems(), SEED_IDS);
      const shown = ui.panel.sendIds.join('\n');
      const now = upload.send.map((item) => item.id).join('\n');
      if (shown !== now) {
        ui.panel = { kind: 'upload-local', sendIds: upload.send.map((item) => item.id) };
        panel.innerHTML = confirmUploadPanel(upload);
        showToast('共有DBが変わったので、件数を見直してください');
        return;
      }
      if (upload.send.length === 0) {
        showToast('新しく送る紙はありません');
        return;
      }
      void cloudStore.bulkImport(upload.send, gate.user).then((result) => {
        if (shouldMarkUploaded(result)) window.localStorage.setItem(LOCAL_UPLOAD_KEY, '1');
        showToast(result.error ?? `${result.added}件を共有DBへ送りました`);
        closePanel();
        renderCloudNotes();
      });
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
      const prepared = prepareImportCommit(
        active().getItems(),
        ui.panel.incoming,
        ui.panel.plan,
        decisions,
      );
      if (prepared.stale) {
        ui.idActions = {};
        ui.acceptDupes = [];
        ui.panel = { kind: 'import', plan: prepared.plan, incoming: ui.panel.incoming };
        panel.innerHTML = importPanel(prepared.plan);
        showToast('中身が変わったので、確認をやり直してください');
        return;
      }
      if (gate.mode === 'cloud' && cloudStore) {
        if (!gate.user) {
          showToast('編集者だけが共有できます');
          return;
        }
        void commitCloud(cloudStore, ui.panel.incoming, prepared, gate.user).then((result) => {
          if ('error' in result && result.error) {
            showToast(result.error);
            return;
          }
          showToast(
            `${result.added}件足して、${result.overwritten}件上書き、${result.skipped}件スキップしました`,
          );
          closePanel();
          renderResults();
        });
        return;
      }
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
      if (codePointLength(value) > LIMITS.tag) {
        showFormErrors([{ field: 'tags', message: `タグは${LIMITS.tag}文字までです` }]);
        return;
      }
      if (!ui.draftTags.includes(value) && ui.draftTags.length >= LIMITS.tags) {
        showFormErrors([{ field: 'tags', message: `タグは${LIMITS.tags}個までです` }]);
        return;
      }
      if (!ui.draftTags.includes(value)) ui.draftTags = [...ui.draftTags, value];
    } else {
      if (codePointLength(value) > LIMITS.speaker) {
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

  const formDirty = (): boolean => {
    const panelState = ui.panel;
    if (panelState.kind !== 'form') return false;
    const draft = readDraft();
    if (!draft) return false;
    if (panelState.mode === 'add') {
      return Boolean(
        draft.text.trim() || draft.scene.trim() || draft.memo.trim() || draft.reading.trim(),
      );
    }
    const current = listedItems().find((item) => item.id === panelState.id);
    if (!current) return true;
    return (
      draft.text.trim() !== current.text ||
      draft.scene.trim() !== current.scene ||
      draft.memo.trim() !== current.memo
    );
  };

  const readImport = async (file: File): Promise<void> => {
    if (file.size > 5 * 1024 * 1024) {
      showToast('ファイルが大きすぎます（5MBまで）');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text()) as unknown;
    } catch {
      showToast('JSONとして読めませんでした');
      return;
    }
    const preview = parseVault(parsed);
    if (!preview.ok) {
      showToast(preview.error);
      return;
    }
    const plan = planImport(active().getItems(), preview.items);
    ui.idActions = {};
    ui.acceptDupes = [];
    ui.panel = { kind: 'import', plan, incoming: preview.items };
    panel.innerHTML = importPanel(plan);
    openPanel();
  };

  store.subscribe(() => {
    renderResults();
  });
  const renderCloudNotes = (): void => {
    const slot = root.querySelector('#cloud-notes');
    if (!slot) return;
    if (gate.mode !== 'cloud' || !gate.isEditor || !cloudStore || !gate.user) {
      slot.replaceChildren();
      return;
    }
    const notes: string[] = [];
    if (cloudStore.migrationPending()) {
      notes.push(
        '<p>初期データの移行が終わっていません。途中まで入っているときは、足りない分だけ足します。</p><button type="button" data-action="seed-cloud">初期データを共有DBに入れる</button>',
      );
    }
    if (
      hasOwnDeviceData(store.getState().items, SEED_IDS) &&
      !window.localStorage.getItem(LOCAL_UPLOAD_KEY)
    ) {
      notes.push(
        '<p>この端末だけで書いた紙があります。</p><button type="button" data-action="upload-local">この端末のデータを共有DBへ送る</button>',
      );
    }
    slot.innerHTML = notes.length ? `<div class="cloud-note">${notes.join('')}</div>` : '';
  };

  if (isFirebaseConfigured(firebaseConfig)) {
    gate.mode = 'cloud';
    gate.user = null;
    gate.isEditor = false;
    syncAccount();
    renderResults();
    void import('../cloud/connect')
      .then(({ connectCloud }) => connectCloud())
      .then((cloud) => {
        cloudStore = cloud.store;
        cloudSignIn = () => cloud.signIn();
        cloudSignOut = () => cloud.signOut();
        cloud.subscribe((session) => {
          gate.user = session.user;
          gate.isEditor = session.isEditor;
          syncAccount();
          renderResults();
          renderCloudNotes();
        });
        cloud.store.subscribe(() => {
          renderResults();
          renderChoices();
          renderCloudNotes();
        });
      })
      .catch(() => {
        cloudBootError = '共有の準備に失敗しました。この端末の保存には切り替えていません';
        showToast(cloudBootError);
        syncAccount();
        renderResults();
      });
  }

  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== DATA_KEY && event.key !== META_KEY) {
      return;
    }
    store.reload();
    renderChoices();
    renderResults();
  });
  renderChoices();
  renderResults();
  syncChrome();
}

function draftOf(item: Dajare): DajareDraft {
  return {
    text: item.text,
    scene: item.scene,
    addedAt: item.addedAt,
    addedAtNote: item.addedAtNote,
    reading: item.reading,
    source: item.source,
    rating: item.rating,
    favorite: item.favorite,
    tags: item.tags,
    speakers: item.speakers,
    memo: item.memo,
  };
}

async function commitCloud(
  cloud: DajareStore,
  incoming: Dajare[],
  write: { createIds: string[]; updateIds: string[] },
  actor: Actor,
): Promise<{ added: number; overwritten: number; skipped: number; error?: string }> {
  const byId = new Map(incoming.map((item) => [item.id, item]));
  let added = 0;
  let overwritten = 0;
  const skipped = incoming.length - write.createIds.length - write.updateIds.length;
  for (const id of write.updateIds) {
    const item = byId.get(id);
    if (!item) return { added, overwritten, skipped, error: '見つかりませんでした' };
    const result = await cloud.update(id, draftOf(item), actor);
    if (!result.ok) return { added, overwritten, skipped, error: result.error };
    overwritten += 1;
  }
  for (const id of write.createIds) {
    const item = byId.get(id);
    if (!item) return { added, overwritten, skipped, error: '見つかりませんでした' };
    const result = await cloud.create(draftOf(item), actor, id);
    if (!result.ok) return { added, overwritten, skipped, error: result.error };
    added += 1;
  }
  return { added, overwritten, skipped };
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
          <div id="account" class="account"></div>
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
            <input id="scene-filter" type="search" autocomplete="off" placeholder="夕飯、通勤中" />
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
          <div id="cloud-notes"></div>
          <div id="banner" class="banner"></div>
          <p id="count" class="count-line" data-testid="count"></p>
          <div id="board"></div>
        </main>
      </div>
    </div>
    <div id="panel" hidden></div>
    <div id="toast" role="status"></div>
  `;
}
