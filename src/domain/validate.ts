import type { DajareDraft, Rating } from '../types';
import { isIsoDate } from './ids';

export const LIMITS = {
  text: 200,
  scene: 100,
  reading: 200,
  source: 100,
  memo: 500,
  tag: 20,
  tags: 10,
  speaker: 30,
  speakers: 10,
  addedAtNote: 80,
} as const;

/** ひらがな・長音・読点・空白だけを推奨。外れていても保存はできる。 */
export const READING_RE = /^[\u3041-\u3096\u30fc\u3001\s]*$/u;

/**
 * タグと話者のルールはコードポイントで数える。本文などの `size()` は UTF-16 なので `.length` のまま。
 */
export function codePointLength(value: string): number {
  return [...value].length;
}

export interface FieldError {
  field: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  value: DajareDraft;
  errors: FieldError[];
  warnings: string[];
}

function asRating(value: number | null): Rating | null {
  if (value === 1 || value === 2 || value === 3 || value === 4 || value === 5) return value;
  return null;
}

export function normalizeTags(tags: string[]): { tags: string[]; error: string | null } {
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    if (!tag) continue;
    if (codePointLength(tag) > LIMITS.tag) {
      return { tags: out, error: `タグは${LIMITS.tag}文字までです` };
    }
    if (!out.includes(tag)) out.push(tag);
  }
  if (out.length > LIMITS.tags) {
    return { tags: out.slice(0, LIMITS.tags), error: `タグは${LIMITS.tags}個までです` };
  }
  return { tags: out, error: null };
}

export function normalizeSpeakers(speakers: string[]): {
  speakers: string[];
  error: string | null;
} {
  const out: string[] = [];
  for (const raw of speakers) {
    const name = raw.trim();
    if (!name) continue;
    if (codePointLength(name) > LIMITS.speaker) {
      return { speakers: out, error: `言った人は${LIMITS.speaker}文字までです` };
    }
    if (!out.includes(name)) out.push(name);
  }
  if (out.length > LIMITS.speakers) {
    return {
      speakers: out.slice(0, LIMITS.speakers),
      error: `言った人は${LIMITS.speakers}人までです`,
    };
  }
  return { speakers: out, error: null };
}

export function validateDraft(input: DajareDraft): ValidationResult {
  const errors: FieldError[] = [];
  const warnings: string[] = [];
  const text = input.text.trim();
  const scene = input.scene.trim();
  const reading = input.reading.trim();
  const source = input.source.trim();
  const memo = input.memo.trim();
  const addedAtNote = input.addedAtNote.trim();
  const addedAt = input.addedAt === null ? null : input.addedAt.trim() || null;

  if (!text) errors.push({ field: 'text', message: '本文を書いてください' });
  else if (text.length > LIMITS.text) {
    errors.push({ field: 'text', message: `本文は${LIMITS.text}文字以内にしてください` });
  }

  if (!scene) errors.push({ field: 'scene', message: 'シーンを書いてください' });
  else if (scene.length > LIMITS.scene) {
    errors.push({ field: 'scene', message: `シーンは${LIMITS.scene}文字以内にしてください` });
  }

  if (reading.length > LIMITS.reading) {
    errors.push({ field: 'reading', message: `読みは${LIMITS.reading}文字以内にしてください` });
  } else if (reading && !READING_RE.test(reading)) {
    warnings.push('読みはひらがな・長音（ー）・読点だけにしておくと検索しやすいです');
  }

  if (source.length > LIMITS.source) {
    errors.push({ field: 'source', message: `元ネタは${LIMITS.source}文字以内にしてください` });
  }
  if (memo.length > LIMITS.memo) {
    errors.push({ field: 'memo', message: `メモは${LIMITS.memo}文字以内にしてください` });
  }
  if (addedAtNote.length > LIMITS.addedAtNote) {
    errors.push({
      field: 'addedAtNote',
      message: `日付メモは${LIMITS.addedAtNote}文字以内にしてください`,
    });
  }
  if (addedAt !== null && !isIsoDate(addedAt)) {
    errors.push({ field: 'addedAt', message: '追加日の形式が正しくありません' });
  }

  let rating: Rating | null = null;
  if (input.rating !== null) {
    rating = asRating(input.rating);
    if (rating === null) errors.push({ field: 'rating', message: '評価は1から5です' });
  }

  const tags = normalizeTags(input.tags);
  if (tags.error) errors.push({ field: 'tags', message: tags.error });
  const speakers = normalizeSpeakers(input.speakers);
  if (speakers.error) errors.push({ field: 'speakers', message: speakers.error });

  const value: DajareDraft = {
    text,
    scene,
    addedAt,
    addedAtNote,
    reading,
    source,
    rating,
    favorite: Boolean(input.favorite),
    tags: tags.tags,
    speakers: speakers.speakers,
    memo,
  };

  return { ok: errors.length === 0, value, errors, warnings };
}
