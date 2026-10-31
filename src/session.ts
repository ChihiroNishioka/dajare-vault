import type { Actor } from './types';

/** 画面確認用。Firestore には触れない。本番の共有ビルドではクエリを読まない。 */
export type HeaderChrome =
  { kind: 'signed-out' } | { kind: 'signed-in'; name: string; editor: boolean };

/**
 * `?mock=` の見た目だけを決める。editor でも書き込み権限は渡さない。
 * 名前は画面の並びを見るための見本で、編集者名簿とは無関係。
 */
export function parseHeaderMock(search: string): HeaderChrome | null {
  const query = search.startsWith('?') ? search.slice(1) : search;
  const value = new URLSearchParams(query).get('mock');
  if (value === 'signed-out') return { kind: 'signed-out' };
  if (value === 'editor') return { kind: 'signed-in', name: 'ちひろ', editor: true };
  if (value === 'viewer') return { kind: 'signed-in', name: 'ちひろ', editor: false };
  if (value === 'long') {
    return { kind: 'signed-in', name: 'とてもながいなまえのちひろ', editor: true };
  }
  return null;
}

/**
 * 本番ビルド（VITE_FORCE_LOCAL でない）では常に null。
 * 開発サーバと、テスト用のローカルビルドだけがクエリを読む。
 * そのときも Firebase には繋がない。
 */
export function readHeaderMock(search: string): HeaderChrome | null {
  if (import.meta.env.PROD && import.meta.env.VITE_FORCE_LOCAL !== '1') return null;
  return parseHeaderMock(search);
}

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
