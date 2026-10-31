export function formatBackupTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function notionProgress(done: number, total: number): string {
  return `送っています… ${done}/${total}`;
}

export function notionSuccessMessage(counts: {
  created: number;
  updated: number;
  unchanged: number;
  archived: number;
  lastBackupAt: string;
}): string {
  return `新しく ${counts.created} 件、更新 ${counts.updated} 件、そのまま ${counts.unchanged} 件、しまって ${counts.archived} 件。最終保管 ${formatBackupTime(counts.lastBackupAt)}`;
}

export function notionFailureMessage(message: string): string {
  return `Notionへの保管が途中で止まりました。${message}`;
}

export const NOTION_RELAY_MISSING = 'Notion保管のリレーが未設定です';
