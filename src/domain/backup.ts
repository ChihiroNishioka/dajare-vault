import type { VaultMeta } from '../types';

export interface BackupNotice {
  text: string;
  warn: boolean;
}

export function calendarDaysBetween(thenIso: string, now: Date): number {
  const then = new Date(thenIso);
  if (Number.isNaN(then.getTime())) return 0;
  const a = Date.UTC(then.getFullYear(), then.getMonth(), then.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((b - a) / 86_400_000);
}

export function backupNotice(meta: VaultMeta, now: Date): BackupNotice {
  const changes = meta.changesSinceExport;
  if (!meta.lastExportAt) {
    return {
      text:
        changes >= 10
          ? `まだバックアップしていません（未書き出しの変更が${changes}件）`
          : 'まだバックアップしていません',
      warn: changes >= 10,
    };
  }
  const days = calendarDaysBetween(meta.lastExportAt, now);
  const when = days <= 0 ? '今日' : `${days}日前`;
  const extra = changes >= 10 ? `。未書き出しの変更が${changes}件` : '';
  const stale = days >= 5 ? '。5日以上たっています' : '';
  return {
    text: `最後にバックアップしたのは${when}${extra}${stale}`,
    warn: days >= 5 || changes >= 10,
  };
}

/** ログインしていないときは、一覧の上のバックアップ案内を出さない。 */
export function visibleBackupNotice(
  signedIn: boolean,
  meta: VaultMeta,
  now: Date,
): BackupNotice | null {
  if (!signedIn) return null;
  return backupNotice(meta, now);
}
