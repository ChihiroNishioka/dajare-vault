export type Rating = 1 | 2 | 3 | 4 | 5;

/** Google アカウントなど、誰が書いたかを残すときの最小情報。 */
export interface Actor {
  uid: string;
  email: string;
  name: string;
}

/** 駄洒落1件。追加日が分からないときは addedAt を null にし、今日の日付では埋めない。 */
export interface Dajare {
  id: string;
  text: string;
  scene: string;
  addedAt: string | null;
  /** 年だけ不明、など日付に添えたいメモ。空文字可。 */
  addedAtNote: string;
  reading: string;
  source: string;
  rating: Rating | null;
  favorite: boolean;
  tags: string[];
  /** 言った人。いないときは空配列。 */
  speakers: string[];
  updatedAt: string;
  memo: string;
  /** 共有DBに入れたときだけ付く。ローカルだけの件にはない。 */
  createdAt?: string;
  createdBy?: Actor | null;
  updatedBy?: Actor | null;
}

export interface VaultFile {
  schemaVersion: number;
  items: Dajare[];
}

export const CURRENT_SCHEMA_VERSION = 2;

/** 仕様の localStorage キー。中身の schemaVersion とは別に、置き場の名前として固定する。 */
export const DATA_KEY = 'dajareVault:v1';
export const META_KEY = 'dajareVault:meta:v1';
/** 読めなかった保存文字列を退避するキーの接頭辞。後ろに日時を付ける。 */
export const BROKEN_PREFIX = 'dajareVault:broken:';

export interface VaultMeta {
  lastExportAt: string | null;
  changesSinceExport: number;
  promptOnChange: boolean;
}

export interface DajareDraft {
  text: string;
  scene: string;
  addedAt: string | null;
  addedAtNote: string;
  reading: string;
  source: string;
  rating: Rating | null;
  favorite: boolean;
  tags: string[];
  speakers: string[];
  memo: string;
}
