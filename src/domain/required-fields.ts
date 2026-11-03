/** 名前で引けるフォーム項目の仕様。 */
export type FormFieldName = 'text' | 'scene';

export interface FieldSpec {
  field: FormFieldName;
  label: string;
  max: number;
  emptyMessage: string;
  required: boolean;
}

export const FIELD_SPECS: Record<FormFieldName, FieldSpec> = {
  text: {
    field: 'text',
    label: '本文',
    max: 200,
    emptyMessage: '本文を書いてください',
    required: true,
  },
  scene: {
    field: 'scene',
    label: 'シーン',
    max: 100,
    emptyMessage: 'シーンを書いてください',
    required: true,
  },
};

/** 表示順を保ったフォーム項目一覧。 */
export const FORM_FIELDS: readonly FieldSpec[] = [FIELD_SPECS.text, FIELD_SPECS.scene];

/** 初期仕様で必須の項目。互換用途の静的な一覧。 */
export const REQUIRED_FIELDS: readonly FieldSpec[] = FORM_FIELDS.filter((spec) => spec.required);

let activeFields: readonly FieldSpec[] = FORM_FIELDS;

export function currentFormFields(): readonly FieldSpec[] {
  return activeFields;
}

export function formField(name: FormFieldName): FieldSpec {
  const spec = activeFields.find((item) => item.field === name);
  if (!spec) throw new Error(`フォーム項目の定義がありません: ${name}`);
  return spec;
}

export function currentRequiredFields(): readonly FieldSpec[] {
  return currentFormFields().filter((spec) => spec.required);
}

/** テスト用に有効なフォーム定義を一時的に差し替える。 */
export function useFormFields<T>(fields: readonly FieldSpec[], run: () => T): T {
  const previous = activeFields;
  activeFields = fields;
  try {
    return run();
  } finally {
    activeFields = previous;
  }
}

export function requiredEmptyMessage(field: string): string | null {
  return currentRequiredFields().find((item) => item.field === field)?.emptyMessage ?? null;
}
