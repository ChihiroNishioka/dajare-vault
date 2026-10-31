import type { Actor } from './types';

/** スクショ用。Firebase が無いときだけ読み、example.com 以外のメールは無視する。 */
export const PREVIEW_ACTOR_KEY = 'dajareVault:previewActor';

export function readPreviewActor(storage: Pick<Storage, 'getItem'>): Actor | null {
  try {
    const raw = storage.getItem(PREVIEW_ACTOR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { uid?: unknown; email?: unknown; name?: unknown };
    if (typeof parsed.uid !== 'string' || typeof parsed.name !== 'string') return null;
    if (parsed.uid.length < 1 || parsed.uid.length > 128) return null;
    if (parsed.name.length < 1 || parsed.name.length > 40) return null;
    if (parsed.email !== undefined) {
      if (
        typeof parsed.email !== 'string' ||
        !parsed.email.toLowerCase().endsWith('@example.com')
      ) {
        return null;
      }
    }
    return { uid: parsed.uid, name: parsed.name };
  } catch {
    return null;
  }
}
