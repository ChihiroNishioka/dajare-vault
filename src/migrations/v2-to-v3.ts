/** v2 から v3 へ。書いた人は {uid, name} だけ残し、メールアドレスは落とす。 */
export function v2ToV3(data: { schemaVersion: number; items: unknown[] }): {
  schemaVersion: number;
  items: unknown[];
} {
  return {
    schemaVersion: 3,
    items: data.items.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const row = item as Record<string, unknown>;
      return {
        ...row,
        createdBy: publicActor(row.createdBy),
        updatedBy: publicActor(row.updatedBy),
      };
    }),
  };
}

function publicActor(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value ?? null;
  const row = value as Record<string, unknown>;
  if (typeof row.uid !== 'string' || typeof row.name !== 'string') return null;
  return { uid: row.uid, name: row.name };
}
