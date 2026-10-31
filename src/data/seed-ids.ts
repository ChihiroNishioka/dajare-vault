import seedFile from './seed.json';

/** 見本119件の id。共有の印があるあいだ、この id は送り直しで作らない。 */
export const SEED_IDS: ReadonlySet<string> = new Set(
  (seedFile as { items: { id: string }[] }).items.map((item) => item.id),
);
