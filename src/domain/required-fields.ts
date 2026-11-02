/** 本文とシーンの表示名・長さ上限・空欄メッセージをまとめた定義。 */
export const FORM_FIELDS = [
  { field: 'text', label: '本文', max: 200, emptyMessage: '本文を書いてください' },
  { field: 'scene', label: 'シーン', max: 100, emptyMessage: 'シーンを書いてください' },
] as const;

export type FormFieldName = (typeof FORM_FIELDS)[number]['field'];

/** 空では保存できない項目。印・保存ボタン・離れたとき・保存時のチェックは、この定義だけを見る。 */
export const REQUIRED_FIELDS = FORM_FIELDS;

export type RequiredField = (typeof FORM_FIELDS)[number];

let active: readonly RequiredField[] = REQUIRED_FIELDS;

/** いま有効な必須の定義。 */
export function currentRequiredFields(): readonly RequiredField[] {
  return active;
}

/**
 * テストが定義を差し替える入口。
 * 印、保存ボタン、入力欄から離れたとき、保存時のチェックは、この入口の返す配列だけを見る。
 */
export function useRequiredFields<T>(fields: readonly RequiredField[], run: () => T): T {
  const previous = active;
  active = fields;
  try {
    return run();
  } finally {
    active = previous;
  }
}

export function requiredEmptyMessage(field: string): string | null {
  return currentRequiredFields().find((item) => item.field === field)?.emptyMessage ?? null;
}
