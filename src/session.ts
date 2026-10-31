import type { Actor } from './types';

/** スクショ用。Firebase が無いときだけ読み、example.com 以外は無視する。 */
export const PREVIEW_ACTOR_KEY = 'dajareVault:previewActor';

export function readPreviewActor(storage: Pick<Storage, 'getItem'>): Actor | null {
  try {
    const raw = storage.getItem(PREVIEW_ACTOR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Actor>;
    if (
      typeof parsed.uid !== 'string' ||
      typeof parsed.email !== 'string' ||
      typeof parsed.name !== 'string'
    ) {
      return null;
    }
    if (!parsed.email.endsWith('@example.com')) return null;
    return { uid: parsed.uid, email: parsed.email, name: parsed.name };
  } catch {
    return null;
  }
}
