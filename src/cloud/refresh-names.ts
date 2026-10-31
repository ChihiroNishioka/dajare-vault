import type { NameRefreshResult } from '../store/dajare-store';
import type { Actor, Dajare } from '../types';

export interface NameRefreshPatch {
  createdBy?: Actor;
  updatedBy?: Actor;
}

function stale(actor: Actor | null | undefined, current: Actor): boolean {
  return Boolean(actor && actor.uid === current.uid && actor.name !== current.name);
}

/** 自分の uid で、表示名だけがいまの publicName と違う紙。 */
export function nameRefreshTargets(items: Dajare[], current: Actor): Dajare[] {
  return items.filter((item) => stale(item.createdBy, current) || stale(item.updatedBy, current));
}

/**
 * 変えるのは自分の createdBy / updatedBy の name だけ。
 * uid は元のまま。本文も日時も入れない。すでに同じなら null。
 */
export function nameRefreshPatch(
  createdBy: Actor | null,
  updatedBy: Actor | null,
  current: Actor,
): NameRefreshPatch | null {
  const patch: NameRefreshPatch = {};
  if (stale(createdBy, current) && createdBy) {
    patch.createdBy = { uid: createdBy.uid, name: current.name };
  }
  if (stale(updatedBy, current) && updatedBy) {
    patch.updatedBy = { uid: updatedBy.uid, name: current.name };
  }
  return patch.createdBy || patch.updatedBy ? patch : null;
}

export function nameRefreshButtonLabel(publicName: string, count: number): string {
  return `書いた人の表示を「${publicName}」にそろえる（${count}件）`;
}

export function nameRefreshProgress(done: number, total: number): string {
  return `そろえています… ${done}/${total}`;
}

export function nameRefreshResultMessage(result: NameRefreshResult): string {
  if (result.error && result.updated === 0) return result.error;
  if (result.error) return `${result.updated}件そろえました。残りはもう一度押せます`;
  if (result.updated === 0) return 'すでにそろっていました';
  if (result.skipped > 0) {
    return `${result.updated}件の表示をそろえました。${result.skipped}件はすでに同じ名前でした`;
  }
  return `${result.updated}件の表示をそろえました`;
}
