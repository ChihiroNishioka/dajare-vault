/** 本番サイトのオリジンだけ。パスは見ない（プレビューも同じオリジン）。 */
export const ALLOWED_ORIGIN = 'https://chihironishioka.github.io';

export function backupCors(origin: string | null): Record<string, string> | null {
  if (origin !== ALLOWED_ORIGIN) return null;
  return {
    'access-control-allow-origin': ALLOWED_ORIGIN,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}
