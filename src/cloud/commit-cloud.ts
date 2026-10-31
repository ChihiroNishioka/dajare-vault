import type { DajareStore } from '../store/dajare-store';
import type { Actor, Dajare, DajareDraft } from '../types';
import type { ImportWrite } from '../domain/transfer';

export interface CloudImportResult {
  added: number;
  overwritten: number;
  skipped: number;
  seedSkipped: number;
  changed: Dajare[];
  error?: string;
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

/** 確認した id だけ書く。見本は印をトランザクションで見て飛ばす。上書きは updatedAt が違えば飛ばす。 */
export async function commitCloud(
  cloud: DajareStore,
  incoming: Dajare[],
  write: ImportWrite,
  actor: Actor,
): Promise<CloudImportResult> {
  const byId = new Map(incoming.map((item) => [item.id, item]));
  let added = 0;
  let overwritten = 0;
  let seedSkipped = write.seedSkippedIds.length;
  const changed: Dajare[] = [];
  const skipped =
    incoming.length - write.createIds.length - write.updateIds.length - write.seedSkippedIds.length;
  for (const row of write.updateIds) {
    const item = byId.get(row.id);
    if (!item)
      return { added, overwritten, skipped, seedSkipped, changed, error: '見つかりませんでした' };
    const result = await cloud.update(row.id, draftOf(item), actor, {
      expectedUpdatedAt: row.expectedUpdatedAt,
    });
    if (!result.ok) {
      return { added, overwritten, skipped, seedSkipped, changed, error: result.error };
    }
    if (result.skipped === 'changed') {
      changed.push(item);
      continue;
    }
    overwritten += 1;
  }
  for (const id of write.createIds) {
    const item = byId.get(id);
    if (!item)
      return { added, overwritten, skipped, seedSkipped, changed, error: '見つかりませんでした' };
    const result = await cloud.create(draftOf(item), actor, id);
    if (!result.ok) {
      return { added, overwritten, skipped, seedSkipped, changed, error: result.error };
    }
    if (result.skipped === 'seed') {
      seedSkipped += 1;
      continue;
    }
    added += 1;
  }
  return { added, overwritten, skipped, seedSkipped, changed };
}
