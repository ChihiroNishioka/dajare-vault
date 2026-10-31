import { v1ToV2 } from './v1-to-v2';

export interface SchemaFile {
  schemaVersion: number;
  items: unknown[];
}

export type Migration = (data: SchemaFile) => SchemaFile;

/** キーは「移行前」の版。1 を渡すと v2 になる。 */
export const migrations: Record<number, Migration> = {
  1: v1ToV2,
};

export function applyMigrations(
  data: SchemaFile,
  target: number,
  steps: Record<number, Migration> = migrations,
): SchemaFile {
  let current: SchemaFile = {
    schemaVersion: data.schemaVersion,
    items: data.items.slice(),
  };
  while (current.schemaVersion < target) {
    const step = steps[current.schemaVersion];
    if (!step) {
      throw new Error(`schema ${current.schemaVersion} から移行できません`);
    }
    const next = step(current);
    if (next.schemaVersion !== current.schemaVersion + 1) {
      throw new Error('migration must bump schemaVersion by 1');
    }
    current = next;
  }
  return current;
}
