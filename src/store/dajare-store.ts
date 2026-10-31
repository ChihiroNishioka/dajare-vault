import type { Actor, Dajare, DajareDraft } from '../types';

export interface WriteResult {
  ok: boolean;
  item?: Dajare;
  error?: string;
  errors?: { field: string; message: string }[];
  /** 印がある見本、または確認のあとで直されていた紙。書かなかった。 */
  skipped?: 'seed' | 'changed';
}

export interface UpdateOptions {
  /** 確認画面で見た updatedAt。違っていたら上書きしない。 */
  expectedUpdatedAt?: string;
}

export interface ImportTally {
  added: number;
  skipped: number;
  error?: string;
}

export interface NameRefreshResult {
  updated: number;
  skipped: number;
  failed: number;
  error?: string;
}

/** ローカル保存と共有DBで同じ操作に見せるための窓口。呼び出し側は同期・非同期を区別しない。 */
export interface DajareStore {
  subscribe(listener: (items: Dajare[]) => void): () => void;
  getItems(): Dajare[];
  /** 共有DBの初期移行が終わっていないとき true。ローカルは常に false。 */
  migrationPending(): boolean;
  /** meta/seedMigration があるとき true。 */
  migrationDone(): boolean;
  readError(): string | null;
  /** 共有DBをサーバーから一度読んだあと true。ローカルは常に true。 */
  hasServerSnapshot(): boolean;
  create(draft: DajareDraft, actor: Actor | null, id?: string): Promise<WriteResult>;
  update(
    id: string,
    draft: DajareDraft,
    actor: Actor | null,
    options?: UpdateOptions,
  ): Promise<WriteResult>;
  remove(id: string): Promise<WriteResult>;
  /** すでにある id は作らない。既存の本文は上書きしない。 */
  bulkImport(items: Dajare[], actor: Actor): Promise<ImportTally>;
  /**
   * 初期データ用。無い id だけ作り、終わったら meta/seedMigration を作る。
   * 印がすでにあるときは何も書かない（消した初期データは戻さない）。
   */
  migrateSeed(items: Dajare[], actor: Actor): Promise<ImportTally>;
  /**
   * 自分の uid の表示名だけを、いまの publicName に書き直す。
   * 本文や日時は変えない。読み直してすでに同じなら書かない。
   */
  refreshOwnNames(
    actor: Actor,
    onProgress?: (done: number, total: number) => void,
  ): Promise<NameRefreshResult>;
}
