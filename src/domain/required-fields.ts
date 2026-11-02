const LABELS = {
  text: '本文',
  scene: 'シーン',
} as const;

export type RequiredName = keyof typeof LABELS;

/** フォームの項目名。印や文言は、ここから取る。 */
export function formLabel(field: RequiredName): string {
  return LABELS[field];
}

/** 空では保存できない項目。印・保存ボタン・離れたとき・保存時のチェックは、この定義だけを見る。 */
export const REQUIRED_FIELDS = [
  {
    field: 'text',
    label: LABELS.text,
    emptyMessage: `${LABELS.text}を書いてください`,
  },
  {
    field: 'scene',
    label: LABELS.scene,
    emptyMessage: `${LABELS.scene}を書いてください`,
  },
] as const;

export type RequiredField = (typeof REQUIRED_FIELDS)[number];

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
