import { describe, expect, it } from 'vitest';
import {
  nameRefreshButtonLabel,
  nameRefreshPatch,
  nameRefreshProgress,
  nameRefreshResultMessage,
  nameRefreshTargets,
} from '../src/cloud/refresh-names';
import type { Dajare } from '../src/types';

const current = { uid: 'editor-uid', name: 'まひろ' };

function item(id: string, createdBy: Dajare['createdBy'], updatedBy: Dajare['updatedBy']): Dajare {
  return {
    id,
    text: '本文は残す',
    scene: '朝',
    addedAt: '2026-10-02',
    addedAtNote: '',
    reading: '',
    source: '',
    rating: null,
    favorite: false,
    tags: [],
    speakers: [],
    memo: '',
    updatedAt: '2026-10-02T00:00:00Z',
    createdBy,
    updatedBy,
  };
}

describe('name refresh patch', () => {
  it('rewrites only the caller’s stale display name', () => {
    expect(
      nameRefreshPatch(
        { uid: 'editor-uid', name: 'ContextOS' },
        { uid: 'editor-uid', name: 'ContextOS' },
        current,
      ),
    ).toEqual({
      createdBy: { uid: 'editor-uid', name: 'まひろ' },
      updatedBy: { uid: 'editor-uid', name: 'まひろ' },
    });
    expect(
      nameRefreshPatch(
        { uid: 'editor-uid', name: 'まひろ' },
        { uid: 'editor-uid', name: 'ContextOS' },
        current,
      ),
    ).toEqual({ updatedBy: { uid: 'editor-uid', name: 'まひろ' } });
    expect(
      nameRefreshPatch(
        { uid: 'other-uid', name: 'ContextOS' },
        { uid: 'editor-uid', name: 'ContextOS' },
        current,
      ),
    ).toEqual({ updatedBy: { uid: 'editor-uid', name: 'まひろ' } });
  });

  it('leaves someone else and an already-correct name alone', () => {
    expect(
      nameRefreshPatch(
        { uid: 'other-uid', name: 'ContextOS' },
        { uid: 'other-uid', name: 'ContextOS' },
        current,
      ),
    ).toBeNull();
    expect(
      nameRefreshPatch(
        { uid: 'editor-uid', name: 'まひろ' },
        { uid: 'editor-uid', name: 'まひろ' },
        current,
      ),
    ).toBeNull();
    expect(nameRefreshPatch(null, null, current)).toBeNull();
  });

  it('counts a document once even when both actor fields are stale', () => {
    const rows = [
      item('a', { uid: 'editor-uid', name: 'ContextOS' }, { uid: 'editor-uid', name: 'ContextOS' }),
      item('b', { uid: 'other-uid', name: 'ContextOS' }, { uid: 'editor-uid', name: 'まひろ' }),
      item('c', { uid: 'editor-uid', name: 'まひろ' }, { uid: 'other-uid', name: 'ほか' }),
      item('d', { uid: 'other-uid', name: 'ほか' }, { uid: 'editor-uid', name: 'ContextOS' }),
    ];
    expect(nameRefreshTargets(rows, current).map((row) => row.id)).toEqual(['a', 'd']);
  });

  it('uses the owner’s button wording', () => {
    expect(nameRefreshButtonLabel('まひろ', 119)).toBe(
      '書いた人の表示を「まひろ」にそろえる（119件）',
    );
    expect(nameRefreshProgress(3, 119)).toBe('そろえています… 3/119');
    expect(nameRefreshResultMessage({ updated: 12, skipped: 0, failed: 0 })).toBe(
      '12件の表示をそろえました',
    );
    expect(nameRefreshResultMessage({ updated: 0, skipped: 4, failed: 0 })).toBe(
      'すでにそろっていました',
    );
  });
});
