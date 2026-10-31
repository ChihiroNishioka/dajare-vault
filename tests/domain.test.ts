import { describe, expect, it } from 'vitest';
import { backupNotice, visibleBackupNotice } from '../src/domain/backup';
import { seedId } from '../src/domain/ids';
import { timestampToIso } from '../src/domain/time';
import { queryItems } from '../src/domain/query';
import {
  applyImport,
  emptyDecisions,
  exportFilename,
  hasOwnDeviceData,
  importWriteSet,
  parseVault,
  planDeviceUpload,
  planImport,
  planSignature,
  prepareImportCommit,
  serialize,
  shouldMarkUploaded,
} from '../src/domain/transfer';
import { normalizeTags, validateDraft } from '../src/domain/validate';
import { applyMigrations } from '../src/migrations/runner';
import { classicItems } from '../src/data/classic';
import { buildSeed } from '../src/data/build-seed';
import type { Dajare, DajareDraft } from '../src/types';

function draft(partial: Partial<DajareDraft> = {}): DajareDraft {
  return {
    text: 'テスト',
    scene: '場面',
    addedAt: '2026-10-01',
    addedAtNote: '',
    reading: '',
    source: '',
    rating: null,
    favorite: false,
    tags: [],
    speakers: [],
    memo: '',
    ...partial,
  };
}

function item(partial: Partial<Dajare> & Pick<Dajare, 'id' | 'text' | 'scene'>): Dajare {
  return {
    addedAt: '2026-01-01',
    addedAtNote: '',
    reading: '',
    source: '',
    rating: null,
    favorite: false,
    tags: [],
    speakers: [],
    updatedAt: '2026-01-01T00:00:00Z',
    memo: '',
    ...partial,
  };
}

describe('validateDraft', () => {
  it('requires text and scene, and trims them', () => {
    expect(validateDraft(draft({ text: '  ', scene: '  ' })).ok).toBe(false);
    const result = validateDraft(draft({ text: '  あ  ', scene: '  い  ' }));
    expect(result.ok).toBe(true);
    expect(result.value.text).toBe('あ');
    expect(result.value.scene).toBe('い');
  });

  it('allows an unknown added date and rejects a bad one', () => {
    expect(validateDraft(draft({ addedAt: null })).ok).toBe(true);
    expect(validateDraft(draft({ addedAt: '2026-02-31' })).ok).toBe(false);
  });

  it('caps length and warns on reading without blocking', () => {
    expect(validateDraft(draft({ text: 'あ'.repeat(201) })).ok).toBe(false);
    expect(validateDraft(draft({ scene: 'あ'.repeat(101) })).ok).toBe(false);
    const warned = validateDraft(draft({ reading: 'カタカナ' }));
    expect(warned.ok).toBe(true);
    expect(warned.warnings.length).toBeGreaterThan(0);
    expect(validateDraft(draft({ reading: 'ひらがなー、' })).warnings).toEqual([]);
  });

  it('merges duplicate tags and stops at 10', () => {
    expect(normalizeTags([' 朝 ', '朝', '家族']).tags).toEqual(['朝', '家族']);
    expect(normalizeTags(['あ'.repeat(21)]).error).toMatch(/20文字/);
    expect(normalizeTags(['😀'.repeat(20)]).error).toBeNull();
    expect(normalizeTags(['😀'.repeat(21)]).error).toMatch(/20文字/);
    expect(validateDraft(draft({ addedAt: '2026-04-31' })).ok).toBe(false);
    expect(validateDraft(draft({ addedAt: '2026-11-31' })).ok).toBe(false);
    const tooMany = Array.from({ length: 11 }, (_, index) => `t${index}`);
    expect(normalizeTags(tooMany).error).toMatch(/10個/);
    expect(validateDraft(draft({ rating: 6 as unknown as 1 })).ok).toBe(false);
    expect(validateDraft(draft({ rating: 5 })).value.rating).toBe(5);
  });
});

describe('queryItems', () => {
  const seed = buildSeed().file.items;

  it('finds イクラ once and filters tags, scene, rating, speakers', () => {
    const base = {
      q: '',
      scene: '',
      tags: [] as string[],
      tagMode: 'and' as const,
      speakers: [] as string[],
      favoriteOnly: false,
      unknownDateOnly: false,
      minRating: null,
      sort: 'addedDesc' as const,
    };
    expect(queryItems(seed, { ...base, q: 'いくら' }).map((row) => row.text)).toEqual([
      'イクラはいくら？',
    ]);
    expect(queryItems(seed, { ...base, scene: '回転寿司' })).toHaveLength(1);
    expect(queryItems(seed, { ...base, tags: ['食べ物'] })).toHaveLength(3);
    expect(queryItems(seed, { ...base, tags: ['食べ物', '寿司'], tagMode: 'and' })).toHaveLength(1);
    expect(queryItems(seed, { ...base, tags: ['朝', '寿司'], tagMode: 'or' })).toHaveLength(2);
    expect(queryItems(seed, { ...base, favoriteOnly: true })).toHaveLength(3);
    expect(queryItems(seed, { ...base, minRating: 5 }).map((row) => row.text)).toEqual([
      'イクラはいくら？',
    ]);
    expect(queryItems(seed, { ...base, speakers: ['パパ'] }).length).toBeGreaterThan(0);
    expect(queryItems(seed, { ...base, q: 'ハッカーの墓' })).toHaveLength(1);
  });

  it('sorts known dates ahead of unknown ones', () => {
    const dated = queryItems(classicItems(), {
      q: '',
      scene: '',
      tags: [],
      tagMode: 'and',
      speakers: [],
      favoriteOnly: false,
      unknownDateOnly: false,
      minRating: null,
      sort: 'addedAsc',
    });
    expect(dated[0]?.text).toBe('このファッションのネックはネックレス');
    const mixed = queryItems(
      [
        item({ id: seedId(20), text: '不明の件', scene: '不明', addedAt: null }),
        item({ id: seedId(21), text: '古い', scene: '不明', addedAt: '2024-12-15' }),
      ],
      {
        q: '',
        scene: '',
        tags: [],
        tagMode: 'and',
        speakers: [],
        favoriteOnly: false,
        unknownDateOnly: false,
        minRating: null,
        sort: 'addedDesc',
      },
    );
    expect(mixed.map((row) => row.text)).toEqual(['古い', '不明の件']);
    const yomi = queryItems(classicItems(), {
      q: '',
      scene: '',
      tags: [],
      tagMode: 'and',
      speakers: [],
      favoriteOnly: false,
      unknownDateOnly: false,
      minRating: null,
      sort: 'reading',
    });
    expect(yomi[0]?.text).toBe('アルミ缶の上にあるミカン');
  });
});

describe('transfer', () => {
  const sample = classicItems()[0];
  if (!sample) throw new Error('missing classic');

  it('serializes schemaVersion and names the file', () => {
    const parsed = JSON.parse(serialize([sample])) as { schemaVersion: number; items: Dajare[] };
    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.items[0]?.text).toBe(sample.text);
    expect(exportFilename(new Date('2026-10-31T01:02:00Z'))).toMatch(
      /^dajare-vault-\d{8}-\d{4}\.json$/,
    );
  });

  it('drops an email from an older attribution and does not invent a timestamp', () => {
    const parsed = parseVault({
      schemaVersion: 2,
      items: [
        {
          ...sample,
          createdBy: { uid: 'u1', email: 'person@example.com', name: 'ママ' },
          updatedBy: { uid: 'u1', email: 'person@example.com', name: 'ママ' },
        },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.items[0]?.createdBy).toEqual({ uid: 'u1', name: 'ママ' });
    expect(parsed.items[0]?.updatedBy).toEqual({ uid: 'u1', name: 'ママ' });
    expect(serialize(parsed.items)).not.toContain('person@example.com');
    expect(timestampToIso(undefined)).toBeNull();
    expect(timestampToIso('not-a-date')).toBeNull();
    expect(timestampToIso('2026-10-31T00:00:00Z')).toBe('2026-10-31T00:00:00Z');
    expect(timestampToIso({ toDate: () => new Date('2026-10-31T00:00:00.000Z') })).toBe(
      '2026-10-31T00:00:00Z',
    );
  });

  it('migrates v1 and rejects a newer schema', () => {
    const v1 = {
      schemaVersion: 1,
      items: [
        {
          id: sample.id,
          text: sample.text,
          scene: sample.scene,
          addedAt: sample.addedAt,
          reading: '',
          source: '',
          rating: null,
          favorite: false,
          tags: [],
          updatedAt: sample.updatedAt,
          memo: '',
        },
      ],
    };
    const migrated = parseVault(v1);
    expect(migrated.ok).toBe(true);
    if (migrated.ok) {
      expect(migrated.items[0]?.speakers).toEqual([]);
      expect(migrated.items[0]?.addedAtNote).toBe('');
    }
    expect(parseVault({ schemaVersion: 9, items: [] })).toMatchObject({
      ok: false,
      error: '対応していないバージョンです',
    });
  });

  it('rejects a file that repeats an id, and flags text+scene duplicates inside the file', () => {
    const first = item({ id: seedId(3), text: '同じ', scene: '場面' });
    const sameId = item({ id: seedId(3), text: '別の本文', scene: '別' });
    const repeated = parseVault({ schemaVersion: 2, items: [first, sameId] });
    expect(repeated.ok).toBe(false);
    if (!repeated.ok) expect(repeated.error).toMatch(/同じID/);

    const twin = item({ id: seedId(4), text: '同じ', scene: '場面' });
    const plan = planImport([], [first, twin]);
    expect(plan.fresh).toHaveLength(1);
    expect(plan.textSceneDupes).toHaveLength(1);
    const applied = applyImport([], plan, emptyDecisions());
    expect(applied.items).toHaveLength(1);
    expect(applied.added).toBe(1);
    expect(applied.skipped).toBe(1);
  });

  it('rejects values whose types do not match the fields', () => {
    const base = {
      id: sample.id,
      text: sample.text,
      scene: sample.scene,
      addedAt: sample.addedAt,
      updatedAt: sample.updatedAt,
    };
    expect(parseVault({ schemaVersion: 2, items: [{ ...base, favorite: 'false' }] }).ok).toBe(
      false,
    );
    expect(parseVault({ schemaVersion: 2, items: [{ ...base, rating: true }] }).ok).toBe(false);
    expect(parseVault({ schemaVersion: 2, items: [{ ...base, tags: '朝' }] }).ok).toBe(false);
    expect(parseVault({ schemaVersion: 2, items: [{ ...base, memo: 123 }] }).ok).toBe(false);
    expect(parseVault({ schemaVersion: 2, items: [{ ...base, addedAt: 123 }] }).ok).toBe(false);
    expect(
      parseVault({
        schemaVersion: 2,
        items: [{ ...base, updatedAt: '2025-02-30T99:99:99Z' }],
      }).ok,
    ).toBe(false);
    const tricky = parseVault({
      schemaVersion: 2,
      items: [{ ...base, tags: [{ toString: null }] }],
    });
    expect(tricky.ok).toBe(false);
  });

  it('rejects an import that is too large', () => {
    const many = Array.from({ length: 2001 }, (_, index) =>
      item({ id: seedId(1000 + index), text: `件${index}`, scene: '場面' }),
    );
    expect(parseVault({ schemaVersion: 2, items: many }).ok).toBe(false);
  });

  it('plans id conflicts and text+scene duplicates', () => {
    const existing = [sample];
    const sameId = { ...sample, text: '書き直した' };
    const sameWords = { ...sample, id: seedId(90) };
    const fresh = { ...sample, id: seedId(91), text: '別の件', scene: '別の場面' };
    const plan = planImport(existing, [sameId, sameWords, fresh]);
    expect(plan.idConflicts).toHaveLength(1);
    expect(plan.textSceneDupes).toHaveLength(1);
    expect(plan.fresh).toHaveLength(1);
    const skipped = applyImport(existing, plan, emptyDecisions());
    expect(skipped.added).toBe(1);
    expect(skipped.skipped).toBe(2);
    expect(skipped.items.find((row) => row.id === sample.id)?.text).toBe(sample.text);
    const overwritten = applyImport(existing, plan, {
      idActions: { [sample.id]: 'overwrite' },
      acceptTextSceneIds: [seedId(90)],
    });
    expect(overwritten.overwritten).toBe(1);
    expect(overwritten.items.find((row) => row.id === sample.id)?.text).toBe('書き直した');
    expect(overwritten.added).toBe(2);
  });

  it('uses the same ids for the confirmation and the write', () => {
    const shared = [sample];
    const fresh = item({ id: seedId(91), text: '別の件', scene: '別の場面' });
    const incoming = [{ ...sample, text: '書き直した' }, fresh];
    const shown = planImport(shared, incoming);
    const decisions = {
      idActions: { [sample.id]: 'overwrite' as const },
      acceptTextSceneIds: [] as string[],
    };
    const prepared = prepareImportCommit(shared, incoming, shown, decisions);
    expect(prepared.stale).toBe(false);
    if (prepared.stale) return;
    expect(prepared.createIds).toEqual([fresh.id]);
    expect(prepared.updateIds.map((row) => row.id)).toEqual([sample.id]);
    expect(prepared.updateIds[0]?.expectedUpdatedAt).toBe(sample.updatedAt);
    const applied = applyImport(shared, shown, decisions);
    expect(applied.added).toBe(prepared.createIds.length);
    expect(applied.overwritten).toBe(prepared.updateIds.length);
    expect(applied.items.find((row) => row.id === fresh.id)?.text).toBe(fresh.text);
    expect(applied.items.find((row) => row.id === sample.id)?.text).toBe('書き直した');

    const localThatAlreadyHasFresh = [sample, fresh];
    const againstLocal = planImport(localThatAlreadyHasFresh, incoming);
    expect(planSignature(againstLocal)).not.toBe(planSignature(shown));
    expect(importWriteSet(againstLocal, decisions).createIds).toEqual([]);

    const drifted = prepareImportCommit(localThatAlreadyHasFresh, incoming, shown, decisions);
    expect(drifted.stale).toBe(true);
    if (!drifted.stale) return;
    expect(importWriteSet(drifted.plan, decisions).createIds).not.toEqual(prepared.createIds);

    const moved = { ...sample, updatedAt: '2026-10-31T01:02:03Z' };
    const afterEdit = planImport([moved], incoming);
    expect(planSignature(afterEdit)).not.toBe(planSignature(shown));
  });

  it('counts deleted seed rows on an import and leaves edited seed rows out of a send', () => {
    const seedIds = new Set([seedId(1), seedId(2)]);
    const canonical = item({ id: seedId(2), text: '見本のまま', scene: '場面' });
    const deleted = item({ id: seedId(1), text: '消した見本', scene: '場面' });
    const edited = item({ id: seedId(2), text: '端末で直した', scene: '場面' });
    const shared = [canonical];
    const incoming = [deleted, edited];
    const shown = planImport(shared, incoming);
    const prepared = prepareImportCommit(shared, incoming, shown, emptyDecisions(), seedIds);
    expect(prepared.stale).toBe(false);
    if (prepared.stale) return;
    expect(prepared.seedSkippedIds).toEqual([deleted.id]);
    expect(prepared.createIds).not.toContain(deleted.id);
    const upload = planDeviceUpload([edited], shared, seedIds, [canonical]);
    expect(upload.send).toEqual([]);
    expect(upload.editedSeed).toBe(1);
    expect(upload.seedMissing).toBe(0);
  });

  it('sends only this device’s own puns, never a missing seed row', () => {
    const seedIds = new Set([seedId(1), seedId(2)]);
    const kept = item({ id: seedId(1), text: '見本', scene: '場面' });
    const missing = item({ id: seedId(2), text: '消した見本', scene: '場面' });
    const own = item({ id: seedId(90), text: '自分の', scene: '食卓' });
    expect(hasOwnDeviceData([kept, missing], seedIds)).toBe(false);
    expect(hasOwnDeviceData([kept, own], seedIds)).toBe(true);
    const plan = planDeviceUpload([kept, missing, own], [kept], seedIds);
    expect(plan.send.map((row) => row.id)).toEqual([own.id]);
    expect(plan.seedMissing).toBe(1);
    expect(plan.already).toBe(0);
    const edited = { ...own, text: '直した' };
    const clash = planDeviceUpload([edited], [own], seedIds);
    expect(clash.send).toEqual([]);
    expect(clash.already).toBe(1);
    expect(clash.different).toBe(1);
    expect(shouldMarkUploaded({ added: 0 })).toBe(false);
    expect(shouldMarkUploaded({ added: 1 })).toBe(true);
    expect(shouldMarkUploaded({ added: 1, error: 'だめ' })).toBe(false);
  });
});

describe('migrations', () => {
  it('walks a dummy v2 to v3 step after the real v1 migration', () => {
    const start = { schemaVersion: 1, items: [{ id: 'x' }] };
    const result = applyMigrations(start, 3, {
      1: (data) => ({
        schemaVersion: 2,
        items: data.items.map((row) => ({ ...(row as object), speakers: [] })),
      }),
      2: (data) => ({
        schemaVersion: 3,
        items: data.items.map((row) => ({ ...(row as object), legacy: true })),
      }),
    });
    expect(result.schemaVersion).toBe(3);
    expect(result.items[0]).toMatchObject({ id: 'x', speakers: [], legacy: true });
  });
});

describe('backupNotice', () => {
  const now = new Date('2026-10-31T12:00:00+09:00');

  it('warns after five days or ten unsaved changes', () => {
    expect(
      backupNotice({ lastExportAt: null, changesSinceExport: 0, promptOnChange: false }, now),
    ).toMatchObject({
      warn: false,
      text: 'まだバックアップしていません',
    });
    expect(
      backupNotice({ lastExportAt: null, changesSinceExport: 10, promptOnChange: false }, now).warn,
    ).toBe(true);
    expect(
      backupNotice(
        { lastExportAt: '2026-10-26T00:00:00Z', changesSinceExport: 0, promptOnChange: false },
        now,
      ).warn,
    ).toBe(true);
    expect(
      backupNotice(
        { lastExportAt: '2026-10-31T00:00:00Z', changesSinceExport: 1, promptOnChange: false },
        now,
      ).text,
    ).toContain('今日');
  });

  it('hides the status line until someone is signed in', () => {
    const meta = { lastExportAt: null, changesSinceExport: 12, promptOnChange: false };
    expect(visibleBackupNotice(false, meta, now)).toBeNull();
    expect(visibleBackupNotice(true, meta, now)?.text).toContain('まだバックアップしていません');
    expect(visibleBackupNotice(false, meta, now)).toBeNull();
  });
});
