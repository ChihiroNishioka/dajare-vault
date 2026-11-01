import { visibleBackupNotice } from '../domain/backup';
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
import { commitCloud } from '../cloud/commit-cloud';
import { loginFailureMessage } from '../cloud/google-identity';
import { CLOUD_NOT_READY } from '../cloud/messages';
import {
  nameRefreshButtonLabel,
  nameRefreshProgress,
  nameRefreshResultMessage,
  nameRefreshTargets,
} from '../cloud/refresh-names';
import { isFirebaseConfigured, firebaseConfig } from '../firebase-config';
import { readHeaderMock, readPreviewActor } from '../session';
import type { Actor } from '../types';
import { defineCard, type DajareCard } from './card';
import { endSave, tryBeginSave } from './save-lock';
import { SUGGESTED_SPEAKERS, SUGGESTED_TAGS } from './constants';
import { escapeHtml } from './html';
import {
  confirmUploadPanel,
  deletePanel,
  formPanel,
  changedAfterConfirmPanel,
  importPanel,
  promptPanel,
  notionPanel,
  settingsPanel,
} from './panel';
import { runNotionBackup, toNotionEntry, notionRelayUrlForBackup } from '../notion/client';
import { backupBlockReason, type BackupBlock } from '../notion/plan';
import {
  NOTION_RELAY_MISSING,
  formatBackupTime,
  notionFailureMessage,
  notionProgress,
  notionSuccessMessage,
} from '../notion/messages';
import { defineStars } from './stars';

defineCard();
defineStars();

type Panel =
  | { kind: 'closed' }
  | { kind: 'form'; mode: 'add' | 'edit'; id?: string }
  | { kind: 'settings' }
  | { kind: 'notion' }
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
const saveLock = { held: false };

const LOCAL_UPLOAD_KEY = 'dajareVault:uploadedLocal';

export function mount(
  root: HTMLElement,
  store: Store = createStore(window.localStorage, {
    seedOnEmpty: !isFirebaseConfigured(firebaseConfig),
  }),
): void {
  // 本番の共有ビルドでは右辺ごと消える。見本は Firestore に繋がない。
  const headerChrome =
    import.meta.env.PROD && import.meta.env.VITE_FORCE_LOCAL !== '1'
      ? null
      : readHeaderMock(window.location.search);
  const preview = isFirebaseConfigured(firebaseConfig)
    ? null
    : readPreviewActor(window.localStorage);
  const gate: { mode: 'local' | 'cloud'; user: Actor | null; isEditor: boolean } = {
    mode: 'local',
    user: preview,
    isEditor: true,
  };
  const canEdit = (): boolean => {
    if (headerChrome?.kind === 'signed-out') return false;
    if (headerChrome?.kind === 'signed-in') return headerChrome.editor;
    if (cloudStore?.readError() === CLOUD_NOT_READY) return false;
    return gate.mode === 'local' || gate.isEditor;
  };
  let cloudStore: DajareStore | null = null;
  let cloudSignIn: (() => Promise<void>) | null = null;
  let renderGoogleButton:
    ((container: HTMLElement, onStatus: (code: string) => void) => void) | null = null;
  let cloudSignOut: (() => Promise<void>) | null = null;
  let cloudBootError: string | null = null;
  let dismissMockSignIn = false;
  let mockAuth: { signedIn: boolean; editor: boolean } | null = null;
  let notionBusy = false;
  let notionSettled = true;
  let notionGeneration = 0;
  let notionWasAllowed = false;
  let notionMode: 'idle' | 'running' | 'confirm' | 'done' = 'idle';
  let notionText = '';
  let notionProgressText = '送っています…';
  let notionFailure = false;
  let notionUnseen: { text: string; failure: boolean } | null = null;
  let notionDismissed = false;
  let confirmArchive: ((ok: boolean) => void) | null = null;
  let lastNotionBackup: string | null = null;
  const signedIn = (): boolean => {
    if (mockAuth) return mockAuth.signedIn;
    if (headerChrome?.kind === 'signed-in') return !dismissMockSignIn;
    if (headerChrome) return false;
    return gate.user !== null;
  };
  const canNotion = (): boolean => {
    if (!signedIn()) return false;
    if (mockAuth) return mockAuth.editor;
    if (headerChrome?.kind === 'signed-in') return headerChrome.editor;
    return gate.mode === 'cloud' && gate.isEditor;
  };
  const notionBlock = (): BackupBlock | null =>
    backupBlockReason({
      mode: gate.mode === 'cloud' ? 'cloud' : 'local',
      serverReady: cloudStore ? cloudStore.hasServerSnapshot() : gate.mode !== 'cloud',
      readError: cloudStore?.readError() ?? null,
      count: listedItems().length,
    });
  const setBackupHash = (hash: '' | '#settings' | '#notion'): void => {
    const next = `${location.pathname}${location.search}${hash}`;
    if (`${location.pathname}${location.search}${location.hash}` !== next) {
      history.replaceState(null, '', next);
    }
  };
  let nameRefresh: { done: number; total: number } | null = null;
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
    const notice = visibleBackupNotice(signedIn(), state.meta, new Date());
    const cloudError = gate.mode === 'cloud' ? cloudStore?.readError() : null;
    const notReady = cloudError === CLOUD_NOT_READY;
    const bits = notReady
      ? []
      : [notice?.text, state.loadError, state.saveError, cloudError, cloudBootError].filter(
          Boolean,
        );
    const broken = signedIn() ? store.exportBroken() : null;
    banner.replaceChildren();
    banner.hidden = notReady || (bits.length === 0 && !broken);
    if (!banner.hidden) {
      if (bits.length > 0) {
        const line = document.createElement('span');
        line.textContent = bits.join(' / ');
        banner.append(line);
      }
      if (broken) {
        const recover = document.createElement('button');
        recover.type = 'button';
        recover.dataset.action = 'export-broken';
        recover.textContent = '読めなかった原文を書き出す';
        banner.append(recover);
      }
    }
    banner.classList.toggle(
      'is-warn',
      !banner.hidden &&
        (Boolean(notice?.warn) || Boolean(state.saveError) || Boolean(state.loadError)),
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

  const stopNotionRun = (): void => {
    notionGeneration += 1;
    notionDismissed = true;
    notionUnseen = null;
    confirmArchive?.(false);
    confirmArchive = null;
    notionBusy = false;
  };

  const syncAccount = (): void => {
    const allowed = canNotion();
    if (notionWasAllowed && !allowed) stopNotionRun();
    notionWasAllowed = allowed;
    const slot = root.querySelector('#account');
    if (!slot) return;
    root.querySelectorAll<HTMLElement>('[data-action="add"]').forEach((button) => {
      button.hidden = !canEdit();
    });
    root.querySelectorAll<HTMLButtonElement>('[data-action="settings"]').forEach((button) => {
      button.hidden = !signedIn();
    });
    root.querySelectorAll<HTMLButtonElement>('[data-action="notion-open"]').forEach((button) => {
      button.hidden = !canNotion();
      button.disabled = notionBusy;
    });
    const dropBackup =
      (!signedIn() &&
        (ui.panel.kind === 'settings' ||
          ui.panel.kind === 'prompt' ||
          ui.panel.kind === 'import')) ||
      (!canNotion() && ui.panel.kind === 'notion');
    if (dropBackup) {
      confirmArchive?.(false);
      confirmArchive = null;
      const hash = ui.panel.kind === 'notion' ? '#notion' : '#settings';
      ui.panel = { kind: 'closed' };
      panel.innerHTML = '';
      panel.hidden = true;
      shellEl.toggleAttribute('inert', false);
      document.body.classList.remove('panel-open');
      if (location.hash === hash) setBackupHash('');
    }
    if (!signedIn() && /バックアップ|書き出し|最終保管|Notion/.test(toast.textContent ?? '')) {
      toast.textContent = '';
      window.clearTimeout(toastTimer);
    }
    if (headerChrome?.kind === 'signed-out') {
      if (!slot.querySelector('#gsi-button')) slot.innerHTML = signedOutHtml(true);
      return;
    }
    if (headerChrome?.kind === 'signed-in') {
      slot.innerHTML = signedInHtml(headerChrome.name, headerChrome.editor);
      return;
    }
    if (gate.mode === 'local') {
      slot.innerHTML = gate.user
        ? `<div class="account-row"><b class="account-name" title="${escapeHtml(gate.user.name)}">${escapeHtml(gate.user.name)}</b><span class="mode-badge">見本のログイン</span></div>`
        : `<div class="account-row"><span class="mode-badge">この端末だけ</span></div>`;
      return;
    }
    if (!gate.user) {
      if (!slot.querySelector('#gsi-button')) slot.innerHTML = signedOutHtml(false);
      const host = slot.querySelector<HTMLElement>('#gsi-button');
      if (host && host.childElementCount === 0) {
        renderGoogleButton?.(host, (code) => {
          const note = slot.querySelector('#login-note');
          if (note) note.textContent = loginFailureMessage(code);
        });
      }
      return;
    }
    slot.innerHTML = signedInHtml(gate.user.name, gate.isEditor);
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
    if (notionBusy) notionDismissed = true;
    confirmArchive?.(false);
    confirmArchive = null;
    ui.panel = { kind: 'closed' };
    panel.innerHTML = '';
    if (location.hash === '#settings' || location.hash === '#notion') setBackupHash('');
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
    if (signedIn() && store.getState().meta.promptOnChange) {
      ui.panel = { kind: 'prompt' };
      panel.innerHTML = promptPanel();
      openPanel();
      return;
    }
    closePanel();
  };

  const saveForm = (): void => {
    if (!tryBeginSave(saveLock)) return;
    const draft = readDraft();
    if (!draft || ui.panel.kind !== 'form') {
      endSave(saveLock);
      return;
    }
    const saveButton = panel.querySelector<HTMLButtonElement>('[data-action="save"]');
    if (saveButton) saveButton.disabled = true;
    const editing = ui.panel.mode === 'edit' && ui.panel.id ? ui.panel.id : '';
    const pending = editing
      ? active().update(editing, draft, gate.user)
      : active().create(draft, gate.user);
    void pending
      .then((result) => {
        if (!result.ok) {
          showFormErrors(
            result.errors ?? [{ field: 'form', message: result.error ?? '保存できませんでした' }],
          );
          if (saveButton) saveButton.disabled = false;
          return;
        }
        showToast(editing ? '書き直しました' : '紙を足しました');
        afterWrite();
      })
      .finally(() => endSave(saveLock));
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
    if (!signedIn()) return;
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

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || ui.panel.kind === 'closed') return;
    if (ui.panel.kind === 'form' && formDirty() && !window.confirm('書いた内容を捨てますか？'))
      return;
    closePanel();
  });
  root.addEventListener('keydown', (event) => {
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

  const blockText = (block: BackupBlock): string => {
    if (block === 'loading') return '共有の紙を読み終えてから保管します';
    if (block === 'empty') return '紙が無いので保管しません';
    return '共有の紙を読めないので保管しません';
  };

  const showNotion = (
    mode: 'idle' | 'running' | 'confirm' | 'done',
    text: string,
    opts: { force?: boolean; failure?: boolean } = {},
  ): void => {
    const failure = opts.failure === true;
    const open = ui.panel.kind === 'notion';
    if (open && mode === 'running' && notionMode === 'running') {
      notionText = text;
      notionProgressText = text;
      notionFailure = false;
      const status = panel.querySelector<HTMLElement>('[data-notion-status]');
      if (status) {
        status.textContent = text;
        return;
      }
    }
    notionMode = mode;
    notionText = text;
    notionFailure = failure;
    if (mode === 'running') notionProgressText = text;
    if (!open && !opts.force) {
      if (mode === 'done') notionUnseen = { text, failure };
      return;
    }
    notionUnseen = null;
    notionDismissed = false;
    ui.panel = { kind: 'notion' };
    panel.innerHTML = notionPanel(mode, text, {
      failure,
      allowStart: mode !== 'idle' || notionBlock() === null,
    });
    openPanel();
    setBackupHash('#notion');
  };

  const openNotionPanel = (): void => {
    if (!canNotion()) {
      if (location.hash === '#notion') setBackupHash('');
      return;
    }
    notionDismissed = false;
    if (notionBusy) {
      showNotion(notionMode === 'idle' ? 'running' : notionMode, notionText, {
        force: true,
        failure: notionFailure,
      });
      return;
    }
    if (notionUnseen) {
      const unseen = notionUnseen;
      notionUnseen = null;
      showNotion('done', unseen.text, { force: true, failure: unseen.failure });
      return;
    }
    const block = notionBlock();
    showNotion(
      'idle',
      block ? blockText(block) : '紙を Notion に控えます。消えた紙の行はしまって残します。',
      { force: true },
    );
  };

  const openSettings = (): void => {
    if (!signedIn()) {
      if (location.hash === '#settings') setBackupHash('');
      return;
    }
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
    ui.panel = { kind: 'settings' };
    panel.innerHTML = settingsPanel(
      store.getState().meta.promptOnChange,
      canShare,
      canEdit(),
      lastNotionBackup ? formatBackupTime(lastNotionBackup) : null,
    );
    openPanel();
    setBackupHash('#settings');
  };

  const backupAuthToken = async (): Promise<string> => {
    if (import.meta.env.PROD && import.meta.env.VITE_FORCE_LOCAL !== '1') {
      const { getAuth } = await import('firebase/auth');
      const user = getAuth().currentUser;
      if (!user) throw new Error('ログインが必要です');
      return user.getIdToken();
    }
    try {
      const { getAuth } = await import('firebase/auth');
      const user = getAuth().currentUser;
      if (user) return user.getIdToken();
    } catch {
      /* ローカルビルドでは Firebase を開かない */
    }
    return 'test-token';
  };

  const startNotionBackup = async (): Promise<void> => {
    if (!canNotion() || notionBusy) return;
    const block = notionBlock();
    if (block) {
      showNotion('idle', blockText(block), { force: true });
      return;
    }
    const relayUrl = notionRelayUrlForBackup();
    const entries = listedItems().map(toNotionEntry);
    if (entries.length === 0) {
      showNotion('idle', blockText('empty'), { force: true });
      return;
    }
    notionBusy = true;
    notionDismissed = false;
    notionSettled = false;
    const generation = (notionGeneration += 1);
    syncAccount();
    if (!relayUrl) {
      showNotion('done', NOTION_RELAY_MISSING, { force: true, failure: true });
      notionBusy = false;
      notionSettled = true;
      syncAccount();
      return;
    }
    notionProgressText = notionProgress(0, entries.length);
    showNotion('running', notionProgressText, { force: true });
    try {
      const token = await backupAuthToken();
      if (generation !== notionGeneration) return;
      const result = await runNotionBackup({
        relayUrl,
        token,
        entries,
        shouldContinue: () => generation === notionGeneration,
        onProgress: (progress) => {
          if (generation !== notionGeneration) return;
          notionProgressText = progress.label;
          showNotion('running', progress.label);
        },
        onKnownBackup: (iso) => {
          lastNotionBackup = iso;
        },
        onConfirmArchive: (wouldArchive) =>
          new Promise((resolve) => {
            if (generation !== notionGeneration || notionDismissed) {
              resolve(false);
              return;
            }
            confirmArchive = resolve;
            showNotion('confirm', `${wouldArchive}件をNotionでしまいます。続けますか？`, {
              force: true,
            });
          }),
      });
      if (generation !== notionGeneration) return;
      lastNotionBackup = result.lastBackupAt;
      showNotion('done', notionSuccessMessage(result));
    } catch (error) {
      if (generation !== notionGeneration) return;
      const message = error instanceof Error ? error.message : 'Notionへの保管に失敗しました';
      if (message === 'しまっておく確認がありません' || message === '中止しました') return;
      showNotion('done', notionFailureMessage(message), { failure: true });
    } finally {
      notionSettled = true;
      if (generation === notionGeneration) {
        notionBusy = false;
        confirmArchive = null;
        syncAccount();
      }
    }
  };

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
      if (!signedIn()) return;
      openSettings();
      return;
    }
    if (action === 'notion-open') {
      if (!canNotion() || notionBusy) return;
      openNotionPanel();
      return;
    }
    if (action === 'notion-backup') {
      if (!canNotion() || notionBusy) return;
      void startNotionBackup();
      return;
    }
    if (action === 'notion-confirm') {
      const resolve = confirmArchive;
      confirmArchive = null;
      showNotion('running', notionProgressText, { force: true });
      resolve?.(true);
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
      if (!signedIn()) return;
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
        const message = loginFailureMessage(code);
        const note = root.querySelector('#login-note');
        if (note) note.textContent = message;
        showToast(message);
      });
      return;
    }
    if (action === 'sign-out') {
      if (headerChrome && !cloudSignOut) {
        dismissMockSignIn = true;
        syncChrome();
        renderResults();
        return;
      }
      stopNotionRun();
      void cloudSignOut?.();
      return;
    }
    if (action === 'refresh-names' && cloudStore && gate.user && gate.isEditor && !nameRefresh) {
      const person = gate.user;
      const total = nameRefreshTargets(cloudStore.getItems(), person).length;
      if (total === 0) return;
      nameRefresh = { done: 0, total };
      renderCloudNotes();
      void cloudStore
        .refreshOwnNames(person, (done, all) => {
          nameRefresh = { done, total: all };
          renderCloudNotes();
        })
        .then((result) => {
          nameRefresh = null;
          renderCloudNotes();
          showToast(nameRefreshResultMessage(result));
        });
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
      const upload = planDeviceUpload(
        store.getState().items,
        cloudStore.getItems(),
        SEED_IDS,
        seedFile.items as Dajare[],
      );
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
      if (!tryBeginSave(saveLock)) return;
      const upload = planDeviceUpload(
        store.getState().items,
        cloudStore.getItems(),
        SEED_IDS,
        seedFile.items as Dajare[],
      );
      const shown = ui.panel.sendIds.join('\n');
      const now = upload.send.map((item) => item.id).join('\n');
      if (shown !== now) {
        endSave(saveLock);
        ui.panel = { kind: 'upload-local', sendIds: upload.send.map((item) => item.id) };
        panel.innerHTML = confirmUploadPanel(upload);
        showToast('共有DBが変わったので、件数を見直してください');
        return;
      }
      if (upload.send.length === 0) {
        endSave(saveLock);
        showToast('新しく送る紙はありません');
        return;
      }
      const sendButton = panel.querySelector<HTMLButtonElement>('[data-action="confirm-upload"]');
      if (sendButton) sendButton.disabled = true;
      void cloudStore
        .bulkImport(upload.send, gate.user)
        .then((result) => {
          if (shouldMarkUploaded(result)) window.localStorage.setItem(LOCAL_UPLOAD_KEY, '1');
          showToast(result.error ?? `${result.added}件を共有DBへ送りました`);
          closePanel();
          renderCloudNotes();
        })
        .finally(() => endSave(saveLock));
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
      if (!tryBeginSave(saveLock)) return;
      const decisions: ImportDecisions = {
        idActions: ui.idActions,
        acceptTextSceneIds: ui.acceptDupes,
      };
      const blockSeed = cloudStore?.migrationDone() ? SEED_IDS : undefined;
      const prepared = prepareImportCommit(
        active().getItems(),
        ui.panel.incoming,
        ui.panel.plan,
        decisions,
        blockSeed,
      );
      if (prepared.stale) {
        endSave(saveLock);
        ui.idActions = {};
        ui.acceptDupes = [];
        ui.panel = { kind: 'import', plan: prepared.plan, incoming: ui.panel.incoming };
        panel.innerHTML = importPanel(
          prepared.plan,
          prepared.plan.fresh.filter((item) => blockSeed?.has(item.id)).length,
        );
        showToast('中身が変わったので、確認をやり直してください');
        return;
      }
      if (gate.mode === 'cloud' && cloudStore) {
        if (!gate.user) {
          endSave(saveLock);
          showToast('編集者だけが共有できます');
          return;
        }
        const importButton = panel.querySelector<HTMLButtonElement>(
          '[data-action="commit-import"]',
        );
        if (importButton) importButton.disabled = true;
        void commitCloud(cloudStore, ui.panel.incoming, prepared, gate.user)
          .then((result) => {
            if (result.error) {
              showToast(result.error);
              if (importButton) importButton.disabled = false;
              return;
            }
            const seedNote = result.seedSkipped
              ? `消した見本 ${result.seedSkipped}件は戻していません。`
              : '';
            if (result.changed.length) {
              panel.innerHTML = changedAfterConfirmPanel(result.changed);
              showToast(
                `${result.changed.length}件は、確認のあとで直されていたので上書きしませんでした。${seedNote}`,
              );
              renderResults();
              return;
            }
            showToast(
              `${result.added}件足して、${result.overwritten}件上書き、${result.skipped}件スキップしました。${seedNote}`,
            );
            closePanel();
            renderResults();
          })
          .finally(() => endSave(saveLock));
        return;
      }
      endSave(saveLock);
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
    const seedSkipped = cloudStore?.migrationDone()
      ? plan.fresh.filter((item) => SEED_IDS.has(item.id)).length
      : 0;
    panel.innerHTML = importPanel(plan, seedSkipped);
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
    if (nameRefresh) {
      notes.push(`<p>${escapeHtml(nameRefreshProgress(nameRefresh.done, nameRefresh.total))}</p>`);
    } else {
      const staleNames = nameRefreshTargets(cloudStore.getItems(), gate.user);
      if (staleNames.length > 0) {
        notes.push(
          `<p>書いた人の名前が、いまの表示と違います。</p><button type="button" data-action="refresh-names">${escapeHtml(nameRefreshButtonLabel(gate.user.name, staleNames.length))}</button>`,
        );
      }
    }
    if (cloudStore.migrationPending()) {
      notes.push(
        '<p>初期データの移行が終わっていません。途中まで入っているときは、足りない分だけ足します。</p><button type="button" data-action="seed-cloud">初期データを共有DBに入れる</button>',
      );
    }
    const uploadPlan = planDeviceUpload(
      store.getState().items,
      cloudStore.getItems(),
      SEED_IDS,
      seedFile.items as Dajare[],
    );
    if (
      (hasOwnDeviceData(store.getState().items, SEED_IDS) || uploadPlan.editedSeed > 0) &&
      !window.localStorage.getItem(LOCAL_UPLOAD_KEY)
    ) {
      const lead =
        uploadPlan.send.length === 0
          ? '<p>書き直した見本があります。共有DBへは送りません。</p>'
          : '<p>この端末だけで書いた紙があります。</p>';
      notes.push(
        `${lead}<button type="button" data-action="upload-local">この端末のデータを共有DBへ送る</button>`,
      );
    }
    slot.innerHTML = notes.length ? `<div class="cloud-note">${notes.join('')}</div>` : '';
  };

  // 見本のヘッダが付いているときは共有へ繋がない。書き込みはルールまで届かない。
  if (isFirebaseConfigured(firebaseConfig) && headerChrome === null) {
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
        renderGoogleButton = (container, onStatus) => cloud.renderGoogleButton(container, onStatus);
        syncAccount();
        cloudSignOut = () => cloud.signOut();
        cloud.subscribe((session) => {
          applyCloudSession(session);
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
        applyBackupHash();
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
  const applyBackupHash = (): void => {
    const hash = location.hash;
    if (hash !== '#settings' && hash !== '#notion') return;
    if ((hash === '#settings' && !signedIn()) || (hash === '#notion' && !canNotion())) {
      setBackupHash('');
      return;
    }
    if (hash === '#settings') openSettings();
    if (hash === '#notion') openNotionPanel();
  };
  const applyCloudSession = (session: {
    user: Actor | null;
    isEditor: boolean;
    ready: boolean;
  }): void => {
    gate.mode = 'cloud';
    gate.user = session.user;
    gate.isEditor = session.isEditor;
    syncAccount();
    renderResults();
    renderCloudNotes();
    if (session.ready) applyBackupHash();
  };
  window.addEventListener('hashchange', applyBackupHash);
  if (!(isFirebaseConfigured(firebaseConfig) && headerChrome === null)) applyBackupHash();
  if (!(import.meta.env.PROD && import.meta.env.VITE_FORCE_LOCAL !== '1')) {
    Object.assign(window, {
      __dajareTestAuth(next: { signedIn: boolean; editor: boolean }) {
        mockAuth = next;
        syncChrome();
        renderResults();
        applyBackupHash();
      },
      __dajareApplySession(session: {
        user: { uid: string; name: string } | null;
        isEditor: boolean;
        ready: boolean;
      }) {
        applyCloudSession(session);
      },
      __dajareBackupState(): { settled: boolean } {
        return { settled: notionSettled };
      },
    });
  }
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

function signedOutHtml(placeholder: boolean): string {
  const face = placeholder ? '<span class="gsi-placeholder">Google でログイン</span>' : '';
  return `<div class="login-row"><div id="gsi-button" class="gsi-slot">${face}</div><button type="button" class="quiet account-alt" data-action="sign-in">別の方法でログイン</button></div><p class="login-note" id="login-note"></p>`;
}

function signedInHtml(name: string, editor: boolean): string {
  const badge = editor
    ? '<span class="mode-badge">共有</span>'
    : `<span class="mode-badge" title="${escapeHtml(loginFailureMessage('not-editor'))}">見るだけ</span>`;
  return `<div class="account-row">${badge}<b class="account-name" title="${escapeHtml(name)}">${escapeHtml(name)}</b><button type="button" class="quiet account-logout" data-action="sign-out">ログアウト</button></div>`;
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
        <div class="mast-tools">
          <div id="account" class="account"></div>
          <div class="mast-actions">
            <button type="button" class="add-button" data-action="add">追加</button>
            <button type="button" class="texty" data-action="notion-open" hidden>Notionに保管</button>
            <button type="button" class="texty" data-action="settings" hidden>保管</button>
          </div>
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
          <div id="banner" class="banner" hidden></div>
          <p id="count" class="count-line" data-testid="count"></p>
          <div id="board"></div>
        </main>
      </div>
    </div>
    <div id="panel" hidden></div>
    <div id="toast" role="status"></div>
  `;
}
