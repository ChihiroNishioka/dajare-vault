import { isUtcSeconds, toUtcSeconds } from './ids';

/**
 * Firestore の Timestamp と、書き出し用の `YYYY-MM-DDTHH:mm:ssZ` を行き来する唯一の場所。
 * 値が無いときに「今」は入れない。
 */
export function timestampToIso(value: unknown): string | null {
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof value.toDate === 'function'
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    return toUtcSeconds(date);
  }
  if (typeof value === 'string' && isUtcSeconds(value)) return value;
  return null;
}
