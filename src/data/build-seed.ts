import { readFileSync } from 'node:fs';
import { seedId } from '../domain/ids';
import type { Dajare, VaultFile } from '../types';
import { CURRENT_SCHEMA_VERSION } from '../types';
import { classicItems } from './classic';
import { parseFamilyMemo, type FamilyDraft, type LineMapEntry } from './parse-raw';

const UNKNOWN_UPDATED_AT = '2026-10-31T00:00:00Z';

function toDajare(draft: FamilyDraft, n: number): Dajare {
  return {
    id: seedId(n),
    text: draft.text,
    scene: draft.scene,
    addedAt: draft.addedAt,
    addedAtNote: draft.addedAtNote,
    reading: draft.reading,
    source: draft.source,
    rating: null,
    favorite: false,
    tags: [],
    speakers: draft.speakers,
    updatedAt: draft.addedAt ? `${draft.addedAt}T00:00:00Z` : UNKNOWN_UPDATED_AT,
    memo: draft.memo,
  };
}

export interface BuiltSeed {
  file: VaultFile;
  map: (LineMapEntry & { id: string })[];
}

export function buildSeed(raw?: string): BuiltSeed {
  const text =
    raw ?? readFileSync(new URL('./raw_dajare_from_chihiro.txt', import.meta.url), 'utf8');
  const family = parseFamilyMemo(text);
  const familyItems = family.drafts.map((draft, index) => toDajare(draft, index + 7));
  return {
    file: {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      items: [...classicItems(), ...familyItems],
    },
    map: family.map.map((entry, index) => ({ ...entry, id: seedId(index + 7) })),
  };
}
