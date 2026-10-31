import type { Actor, Dajare, DajareDraft } from '../types';

export interface WriteResult {
  ok: boolean;
  item?: Dajare;
  error?: string;
}

/** ローカル保存と共有DBで同じ操作に見せるための窓口。 */
export interface DajareStore {
  subscribe(listener: (items: Dajare[]) => void): () => void;
  getItems(): Dajare[];
  create(draft: DajareDraft, actor: Actor | null, id?: string): Promise<WriteResult>;
  update(id: string, draft: DajareDraft, actor: Actor | null): Promise<WriteResult>;
  remove(id: string): Promise<WriteResult>;
  /** すでにある id は飛ばす。何回やっても同じ結果になる。 */
  bulkImport(
    items: Dajare[],
    actor: Actor,
  ): Promise<{ added: number; skipped: number; error?: string }>;
}
