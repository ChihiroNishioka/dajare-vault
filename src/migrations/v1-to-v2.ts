/** v1（追加日は必須文字列、言った人なし）から v2 へ。 */
export function v1ToV2(data: { schemaVersion: number; items: unknown[] }): {
  schemaVersion: number;
  items: unknown[];
} {
  return {
    schemaVersion: 2,
    items: data.items.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const row = item as Record<string, unknown>;
      return {
        ...row,
        addedAt: row.addedAt === undefined || row.addedAt === '' ? null : row.addedAt,
        addedAtNote: typeof row.addedAtNote === 'string' ? row.addedAtNote : '',
        speakers: Array.isArray(row.speakers) ? row.speakers : [],
      };
    }),
  };
}
