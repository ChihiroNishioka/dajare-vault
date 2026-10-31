import seedFile from '../data/seed.json';
import {
  parseVault,
  planImport,
  applyImport,
  emptyDecisions,
  type ImportDecisions,
} from '../domain/transfer';
import { toUtcSeconds } from '../domain/ids';
import { validateDraft } from '../domain/validate';
import {
  BROKEN_PREFIX,
  DATA_KEY,
  META_KEY,
  type Dajare,
  type DajareDraft,
  type VaultFile,
  type VaultMeta,
} from '../types';
import type { KeyValueStorage } from './memory';

export interface StoreState {
  items: Dajare[];
  meta: VaultMeta;
  loadError: string | null;
  saveError: string | null;
}

export interface Store {
  getState(): StoreState;
  subscribe(listener: () => void): () => void;
  add(
    draft: DajareDraft,
  ): { ok: true; item: Dajare } | { ok: false; errors: { field: string; message: string }[] };
  update(
    id: string,
    draft: DajareDraft,
  ): { ok: true; item: Dajare } | { ok: false; errors: { field: string; message: string }[] };
  remove(id: string): boolean;
  exportItems(): Dajare[];
  markExported(at?: Date): void;
  setPromptOnChange(value: boolean): void;
  previewImport(
    raw: unknown,
  ): ReturnType<typeof parseVault> & { plan?: ReturnType<typeof planImport> };
  commitImport(
    incoming: Dajare[],
    decisions: ImportDecisions,
  ): { added: number; overwritten: number; skipped: number } | { error: string };
  loadSamples(): { added: number; skipped: number };
  exportBroken(): string | null;
  reload(): void;
}

export interface StoreOptions {
  now?: () => Date;
  uuid?: () => string;
  seed?: VaultFile;
}

const SAVE_FAILED = '保存できませんでした。エクスポートしてください';
const STORAGE_BLOCKED = 'このブラウザの設定では保存できません';
const UNREADABLE = '保存データが読めませんでした。書き出したJSONがあれば読み込んでください';

function emptyMeta(): VaultMeta {
  return { lastExportAt: null, changesSinceExport: 0, promptOnChange: false };
}

function readMeta(storage: KeyValueStorage): VaultMeta {
  const raw = storage.getItem(META_KEY);
  if (!raw) return emptyMeta();
  try {
    const parsed = JSON.parse(raw) as Partial<VaultMeta>;
    return {
      lastExportAt: typeof parsed.lastExportAt === 'string' ? parsed.lastExportAt : null,
      changesSinceExport:
        typeof parsed.changesSinceExport === 'number' && parsed.changesSinceExport > 0
          ? parsed.changesSinceExport
          : 0,
      promptOnChange: Boolean(parsed.promptOnChange),
    };
  } catch {
    return emptyMeta();
  }
}

function cloneSeed(seed: VaultFile): Dajare[] {
  return structuredClone(seed.items);
}

export function createStore(storage: KeyValueStorage, options: StoreOptions = {}): Store {
  const now = options.now ?? (() => new Date());
  const uuid = options.uuid ?? (() => crypto.randomUUID());
  const seed = options.seed ?? (seedFile as VaultFile);
  const listeners = new Set<() => void>();

  const state: StoreState = {
    items: [],
    meta: emptyMeta(),
    loadError: null,
    saveError: null,
  };

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  let writesBlocked = false;
  let brokenRaw: string | null = null;

  const persist = (): boolean => {
    if (writesBlocked) {
      state.saveError = state.loadError ?? '保存データが読めないので、書き込みを止めています';
      return false;
    }
    let previous: string | null = null;
    try {
      previous = storage.getItem(DATA_KEY);
    } catch {
      state.saveError = STORAGE_BLOCKED;
      return false;
    }
    const next = JSON.stringify({ schemaVersion: seed.schemaVersion, items: state.items });
    try {
      storage.setItem(DATA_KEY, next);
    } catch {
      state.saveError = SAVE_FAILED;
      return false;
    }
    try {
      storage.setItem(META_KEY, JSON.stringify(state.meta));
    } catch {
      try {
        if (previous === null) storage.removeItem(DATA_KEY);
        else storage.setItem(DATA_KEY, previous);
      } catch {
        // 戻せないときは、次の読み込みで退避キーを見る。
      }
      state.saveError = SAVE_FAILED;
      return false;
    }
    state.saveError = null;
    return true;
  };

  const rememberBroken = (raw: string, message: string): void => {
    writesBlocked = true;
    brokenRaw = raw;
    state.loadError = message;
    state.items = [];
    try {
      storage.setItem(`${BROKEN_PREFIX}${toUtcSeconds(now()).replaceAll(':', '')}`, raw);
    } catch {
      // 退避に失敗しても、メモリ上の原文は書き出せる。元のキーは上書きしない。
    }
  };

  const mutate = (change: () => void): boolean => {
    const prevItems = state.items;
    const prevMeta = state.meta;
    change();
    if (!persist()) {
      state.items = prevItems;
      state.meta = prevMeta;
      notify();
      return false;
    }
    notify();
    return true;
  };

  const bump = (): void => {
    state.meta = { ...state.meta, changesSinceExport: state.meta.changesSinceExport + 1 };
  };

  const load = (): void => {
    let raw: string | null;
    try {
      state.meta = readMeta(storage);
      raw = storage.getItem(DATA_KEY);
    } catch {
      writesBlocked = true;
      brokenRaw = null;
      state.items = [];
      state.loadError = STORAGE_BLOCKED;
      return;
    }
    if (raw === null) {
      writesBlocked = false;
      brokenRaw = null;
      state.loadError = null;
      state.items = cloneSeed(seed);
      persist();
      return;
    }
    try {
      const parsed = parseVault(JSON.parse(raw) as unknown);
      if (!parsed.ok) {
        rememberBroken(raw, parsed.error);
        return;
      }
      writesBlocked = false;
      brokenRaw = null;
      state.loadError = null;
      state.items = parsed.items;
      if (
        !raw.includes(`"schemaVersion":${seed.schemaVersion}`) &&
        !raw.includes(`"schemaVersion": ${seed.schemaVersion}`)
      ) {
        persist();
      }
    } catch {
      rememberBroken(raw, UNREADABLE);
    }
  };

  load();

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    add(draft) {
      const validated = validateDraft(draft);
      if (!validated.ok) return { ok: false, errors: validated.errors };
      const item: Dajare = { ...validated.value, id: uuid(), updatedAt: toUtcSeconds(now()) };
      const saved = mutate(() => {
        state.items = [item, ...state.items];
        bump();
      });
      if (!saved)
        return { ok: false, errors: [{ field: 'form', message: state.saveError ?? SAVE_FAILED }] };
      return { ok: true, item };
    },
    update(id, draft) {
      const current = state.items.find((item) => item.id === id);
      if (!current)
        return { ok: false, errors: [{ field: 'form', message: '見つかりませんでした' }] };
      const validated = validateDraft(draft);
      if (!validated.ok) return { ok: false, errors: validated.errors };
      const item: Dajare = { ...validated.value, id, updatedAt: toUtcSeconds(now()) };
      const saved = mutate(() => {
        state.items = state.items.map((row) => (row.id === id ? item : row));
        bump();
      });
      if (!saved)
        return { ok: false, errors: [{ field: 'form', message: state.saveError ?? SAVE_FAILED }] };
      return { ok: true, item };
    },
    remove(id) {
      if (!state.items.some((item) => item.id === id)) return false;
      return mutate(() => {
        state.items = state.items.filter((item) => item.id !== id);
        bump();
      });
    },
    exportItems: () => state.items.map((item) => ({ ...item })),
    markExported(at) {
      mutate(() => {
        state.meta = {
          ...state.meta,
          lastExportAt: toUtcSeconds(at ?? now()),
          changesSinceExport: 0,
        };
      });
    },
    setPromptOnChange(value) {
      mutate(() => {
        state.meta = { ...state.meta, promptOnChange: value };
      });
    },
    previewImport(rawInput) {
      try {
        const parsed = parseVault(rawInput);
        if (!parsed.ok) return parsed;
        return { ...parsed, plan: planImport(state.items, parsed.items) };
      } catch {
        return { ok: false as const, error: 'JSONの形が正しくありません' };
      }
    },
    commitImport(incoming, decisions) {
      const plan = planImport(state.items, incoming);
      const result = applyImport(state.items, plan, decisions);
      const saved = mutate(() => {
        state.items = result.items;
        const delta = result.added + result.overwritten;
        if (delta > 0) {
          state.meta = { ...state.meta, changesSinceExport: state.meta.changesSinceExport + delta };
        }
      });
      if (!saved) return { error: state.saveError ?? SAVE_FAILED };
      return { added: result.added, overwritten: result.overwritten, skipped: result.skipped };
    },
    loadSamples() {
      const plan = planImport(state.items, cloneSeed(seed));
      const result = applyImport(state.items, plan, emptyDecisions());
      const saved = mutate(() => {
        state.items = result.items;
        if (result.added > 0) {
          state.meta = {
            ...state.meta,
            changesSinceExport: state.meta.changesSinceExport + result.added,
          };
        }
      });
      if (!saved)
        return { added: 0, skipped: plan.idConflicts.length + plan.textSceneDupes.length };
      return { added: result.added, skipped: result.skipped };
    },
    exportBroken: () => brokenRaw,
    reload() {
      load();
      notify();
    },
  };
}
