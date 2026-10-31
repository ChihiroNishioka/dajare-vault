export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function addedLabel(item: { addedAt: string | null; addedAtNote: string }): {
  text: string;
  unknown: boolean;
} {
  if (item.addedAt) {
    return { text: item.addedAt.replaceAll('-', '.'), unknown: false };
  }
  if (item.addedAtNote) return { text: item.addedAtNote, unknown: true };
  return { text: '追加日不明', unknown: true };
}
