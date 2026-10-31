/**
 * 家族メモの行を駄洒落へ分ける。
 *
 * - 原則1行1件。行頭の「・」は箇条書きとして外す。
 * - 夏野菜のやり取り、妖精四世・閣下の連鎖・大隊長の連作は1件にまとめる。
 * - 「→」で始まる行は直前の件のメモ。絵文字だけの行も直後の件のメモ。
 * - 日付だけの行は、直後の1件だけに付ける。年のない12月は2024年、1月は2025年。
 *   それ以外（10月21日を含む）は年を推測せず addedAt は null。
 * - 本文の誤字は直さない。括弧は言った人・場面・メモ・読み・元ネタへ振り分ける。
 */

export interface FamilyDraft {
  text: string;
  scene: string;
  addedAt: string | null;
  addedAtNote: string;
  reading: string;
  source: string;
  speakers: string[];
  memo: string;
}

export interface LineMapEntry {
  lines: number[];
  text: string;
}

export interface DatePrefix {
  kind: 'none' | 'only' | 'prefix';
  addedAt: string | null;
  addedAtNote: string;
  rest: string;
}

const KNOWN_SPEAKERS = ['鷹', 'ママ', 'パパ', '私', 'まひろ', 'ひい'];
const WEEKDAY = '(?:[（(][月火水木金土日][）)])?';

function iso(year: number, month: number, day: number): string {
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    throw new Error(`invalid date ${year}-${month}-${day}`);
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dated(year: number | null, month: number, day: number, rest: string): DatePrefix {
  const kind = rest ? 'prefix' : 'only';
  if (year === null) {
    return { kind, addedAt: null, addedAtNote: `${month}月${day}日（年不明）`, rest };
  }
  return { kind, addedAt: iso(year, month, day), addedAtNote: '', rest };
}

export function parseDatePrefix(line: string): DatePrefix {
  const slash = /^(\d{4})\/(\d{2})\/(\d{2})/.exec(line);
  if (slash) {
    const rest = line.slice(slash[0].length).trim();
    return dated(Number(slash[1]), Number(slash[2]), Number(slash[3]), rest);
  }

  const ymd = /^(\d{2,4})年(\d{1,2})月(\d{1,2})日/.exec(line);
  if (ymd) {
    let year = Number(ymd[1]);
    if (year < 100) year += 2000;
    const rest = line.slice(ymd[0].length).trim();
    return dated(year, Number(ymd[2]), Number(ymd[3]), rest);
  }

  const md = new RegExp(`^(\\d{1,2})月(\\d{1,2})日${WEEKDAY}`).exec(line);
  if (md) {
    const month = Number(md[1]);
    const day = Number(md[2]);
    const rest = line.slice(md[0].length).trim();
    const year = month === 12 ? 2024 : month === 1 ? 2025 : null;
    return dated(year, month, day, rest);
  }

  return { kind: 'none', addedAt: null, addedAtNote: '', rest: line };
}

export function stripBullet(line: string): string {
  return line.trim().replace(/^・\s*/, '');
}

export function parseSpeakers(inner: string): string[] | null {
  const trimmed = inner.trim();
  if (!trimmed) return null;
  if (trimmed === '鷹ママひい') return ['鷹', 'ママ', 'ひい'];
  const parts = trimmed
    .split(/[&＆、,]/)
    .flatMap((part) => part.split('と'))
    .map((part) =>
      part
        .trim()
        .replace(/も参加$/, '')
        .trim(),
    )
    .filter(Boolean);
  if (parts.length > 0 && parts.every((name) => KNOWN_SPEAKERS.includes(name))) return parts;
  return null;
}

interface Classified {
  text: string;
  scene?: string;
  speakers?: string[];
  memo?: string;
  reading?: string;
  source?: string;
}

function classifyLine(text: string): Classified {
  const matched = /^(.*?)[（(]([^（）()]+)[）)]\s*$/.exec(text);
  if (!matched) return { text: text.trim() };
  const body = matched[1].trim();
  const inner = matched[2].trim();
  if (!body) return { text: text.trim() };

  if (inner === '文スト1話' || inner === 'デスゲーム中') return { text: body, scene: inner };
  if (inner.includes('褒め') || inner.includes('ほめ')) return { text: body, memo: inner };
  if (/^[\u3041-\u3096\u30fc]+$/u.test(inner)) return { text: body, reading: inner };
  if (inner === 'びっくりマーク') return { text: body, source: 'ビックマック＋びっくりマーク' };

  const speakers = parseSpeakers(inner);
  if (speakers) {
    return { text: body, speakers, memo: inner.includes('参加') ? inner : undefined };
  }
  return { text: body, memo: inner };
}

function blankDraft(): FamilyDraft {
  return {
    text: '',
    scene: '',
    addedAt: null,
    addedAtNote: '',
    reading: '',
    source: '',
    speakers: [],
    memo: '',
  };
}

function mergeClass(draft: FamilyDraft, classified: Classified): void {
  if (classified.scene && !draft.scene) draft.scene = classified.scene;
  if (classified.reading && !draft.reading) draft.reading = classified.reading;
  if (classified.source && !draft.source) draft.source = classified.source;
  if (classified.speakers) {
    for (const name of classified.speakers) {
      if (!draft.speakers.includes(name)) draft.speakers.push(name);
    }
  }
  if (classified.memo) draft.memo = [draft.memo, classified.memo].filter(Boolean).join('\n');
}

function isEmojiOnly(line: string): boolean {
  const rest = line.replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, '').trim();
  return line.trim() !== '' && rest === '';
}

function isReaction(line: string): boolean {
  return line.startsWith('→');
}

interface PendingDate {
  line: number;
  addedAt: string | null;
  addedAtNote: string;
}

export function parseFamilyMemo(raw: string): { drafts: FamilyDraft[]; map: LineMapEntry[] } {
  const lines = raw.split(/\r?\n/);
  const drafts: FamilyDraft[] = [];
  const map: LineMapEntry[] = [];
  let pendingDate: PendingDate | null = null;
  let pendingEmoji: { line: number; text: string }[] = [];

  const push = (draft: FamilyDraft, sourceLines: number[]): void => {
    if (!draft.text.trim()) throw new Error(`empty text at lines ${sourceLines.join(',')}`);
    if (!draft.scene) draft.scene = '不明';
    drafts.push(draft);
    map.push({ lines: sourceLines, text: draft.text });
  };

  const consumePending = (draft: FamilyDraft): number[] => {
    const prefixes: number[] = [];
    if (pendingDate && draft.addedAt === null && draft.addedAtNote === '') {
      draft.addedAt = pendingDate.addedAt;
      draft.addedAtNote = pendingDate.addedAtNote;
      prefixes.push(pendingDate.line);
      pendingDate = null;
    } else if (pendingDate) {
      prefixes.push(pendingDate.line);
      pendingDate = null;
    }
    if (pendingEmoji.length > 0) {
      const emojiText = pendingEmoji.map((row) => row.text).join('\n');
      draft.memo = [emojiText, draft.memo].filter(Boolean).join('\n');
      prefixes.push(...pendingEmoji.map((row) => row.line));
      pendingEmoji = [];
    }
    return prefixes;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const original = lines[i] ?? '';
    if (original.trim() === '') continue;
    const stripped = stripBullet(original);

    if (isEmojiOnly(stripped)) {
      pendingEmoji.push({ line: lineNo, text: stripped });
      continue;
    }

    if (isReaction(stripped)) {
      const last = drafts.at(-1);
      const lastMap = map.at(-1);
      if (!last || !lastMap) throw new Error(`reaction without item at line ${lineNo}`);
      last.memo = [last.memo, stripped].filter(Boolean).join('\n');
      lastMap.lines.push(lineNo);
      continue;
    }

    if (stripped.includes('10月21日初めて風呂上がりが寒かった日')) {
      const sourceLines = [lineNo];
      const inner = stripped.replace(/^[（(]/, '').replace(/[）)]$/, '');
      const comma = inner.indexOf(',');
      const scene = (comma >= 0 ? inner.slice(0, comma) : inner).trim();
      const people = comma >= 0 ? inner.slice(comma + 1).trim() : '';
      const body: string[] = [];
      while (i + 1 < lines.length) {
        const next = lines[i + 1] ?? '';
        if (next.trim() === '' || /^\s*・/.test(next)) break;
        i += 1;
        sourceLines.push(i + 1);
        body.push((lines[i] ?? '').trim());
      }
      const draft = blankDraft();
      draft.text = body.join('\n');
      draft.scene = scene;
      draft.speakers = parseSpeakers(people) ?? [];
      draft.addedAt = null;
      draft.addedAtNote = '10月21日（年不明）';
      const prefixes = consumePending(draft);
      push(draft, [...prefixes, ...sourceLines]);
      continue;
    }

    const datedLine = parseDatePrefix(stripped);
    if (datedLine.kind === 'only') {
      pendingDate = {
        line: lineNo,
        addedAt: datedLine.addedAt,
        addedAtNote: datedLine.addedAtNote,
      };
      continue;
    }

    const group: { line: number; text: string }[] = [
      { line: lineNo, text: datedLine.kind === 'prefix' ? datedLine.rest : stripped },
    ];

    if (stripped.includes('妖精四世') || stripped.startsWith('階下、看過')) {
      while (i + 1 < lines.length && (lines[i + 1] ?? '').trim() !== '') {
        const peek = lines[i + 1] ?? '';
        if (/^\s*・/.test(peek) || isReaction(stripBullet(peek))) break;
        i += 1;
        group.push({ line: i + 1, text: stripBullet(lines[i] ?? '') });
      }
    } else if (stripped.includes('大隊長は大体そう')) {
      while (i + 1 < lines.length && (lines[i + 1] ?? '').trim() !== '') {
        const peek = stripBullet(lines[i + 1] ?? '');
        const after = stripBullet(lines[i + 2] ?? '');
        const continues =
          peek.includes('大隊長は大体そう') ||
          (after.includes('大隊長は大体そう') && !/^\s*・/.test(lines[i + 1] ?? ''));
        if (!continues) break;
        i += 1;
        group.push({ line: i + 1, text: peek });
      }
    }

    const draft = blankDraft();
    const contentLines: number[] = [];
    const textParts: string[] = [];
    if (datedLine.kind === 'prefix') {
      draft.addedAt = datedLine.addedAt;
      draft.addedAtNote = datedLine.addedAtNote;
    }
    for (const row of group) {
      contentLines.push(row.line);
      const classified = classifyLine(row.text);
      textParts.push(classified.text);
      mergeClass(draft, classified);
    }
    draft.text = textParts.filter((part) => part.length > 0).join('\n');
    if (
      draft.speakers.length === 0 &&
      draft.text.includes('ママ「') &&
      draft.text.includes('まひろ「')
    ) {
      draft.speakers = ['ママ', 'まひろ'];
    }
    const prefixes = consumePending(draft);
    push(draft, [...prefixes, ...contentLines]);
  }

  if (pendingDate) throw new Error(`unused date at line ${pendingDate.line}`);
  if (pendingEmoji.length > 0) throw new Error(`unused emoji at line ${pendingEmoji[0].line}`);

  return { drafts, map };
}
