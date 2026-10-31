import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSeed } from '../src/data/build-seed';
import { classicItems } from '../src/data/classic';
import { parseDatePrefix, parseFamilyMemo, stripBullet } from '../src/data/parse-raw';
import { validateDraft } from '../src/domain/validate';

const raw = readFileSync(
  new URL('../src/data/raw_dajare_from_chihiro.txt', import.meta.url),
  'utf8',
);
const lines = raw.endsWith('\n') ? raw.slice(0, -1).split('\n') : raw.split('\n');

const NOT_EXACT = [
  4, 8, 14, 15, 17, 19, 43, 70, 72, 88, 94, 102, 104, 106, 109, 112, 113, 116, 119, 120, 126, 127,
  128, 129, 130, 132, 135, 136,
];

describe('parseFamilyMemo', () => {
  const parsed = parseFamilyMemo(raw);

  it('covers every non-empty line once', () => {
    const nonempty: number[] = [];
    lines.forEach((line, index) => {
      if (line.trim()) nonempty.push(index + 1);
    });
    const used = parsed.map.flatMap((entry) => entry.lines);
    expect(used).toHaveLength(new Set(used).size);
    expect(used.slice().sort((a, b) => a - b)).toEqual(nonempty);
  });

  it('keeps plain lines verbatim and only rewrites classified lines', () => {
    const missing: number[] = [];
    lines.forEach((line, index) => {
      if (!line.trim()) return;
      const text = stripBullet(line);
      const found = parsed.drafts.some(
        (draft) => draft.text === text || draft.text.split('\n').includes(text),
      );
      if (!found) missing.push(index + 1);
    });
    expect(missing).toEqual(NOT_EXACT);
  });

  it('groups conversations and series, and keeps typos', () => {
    expect(parsed.drafts).toHaveLength(113);
    const byText = (snippet: string) => parsed.drafts.find((draft) => draft.text.includes(snippet));

    const summer = byText('私は夏野菜だよ。');
    expect(summer?.text).toBe('私は夏野菜だよ。\nーまだ夏じゃないのに？\nまだ夏さ！');
    expect(summer?.scene).toBe('10月21日初めて風呂上がりが寒かった日');
    expect(summer?.speakers).toEqual(['私', 'パパ']);
    expect(summer?.addedAt).toBeNull();
    expect(summer?.addedAtNote).toBe('10月21日（年不明）');

    expect(byText('よせ、妖精四世')?.text).toBe(
      'よせ、妖精四世の要請なんて\n抑制、四世、妖精、妖精、',
    );
    expect(byText('公明党ご名答')?.text).toBe('公明党ご名答！');

    expect(byText('閣下の傘')?.speakers).toEqual(['ママ']);
    expect(byText('階下、看過')?.text).toBe(
      '階下、看過・感化・開花、閣下、かすか、カサカサカジカ、\n隔靴掻痒\n神主か！',
    );

    expect(byText('大隊長は大体そう着き')?.text).toBe(
      '大隊長は大体そう着き次第大層\n相対しようなんて、\n大隊長は大体そう事大大層',
    );
    expect(byText('シックな深紅')?.text).toBe('シックな深紅のシンク');

    expect(byText('ハッカーの墓')?.text).toBe('ハッカーの墓を破壊つにせくなしりままめしあ');
    expect(byText('濃ひコーヒー')?.text).toBe('濃ひコーヒー');
    expect(byText('パルデノン')?.text).toBe('パルデノン神殿も有るでのう。');
    expect(byText('どうすぃよう')?.text).toBe('水曜はどうすぃようねぇ');
    expect(byText('どうすぃよう')?.speakers).toEqual(['パパ']);

    const bigmac = byText('ビックマック');
    expect(bigmac?.text).toBe('ビックマック！');
    expect(bigmac?.source).toBe('ビックマック＋びっくりマーク');

    expect(byText('虎を捕らえた')).toMatchObject({ text: '虎を捕らえた', scene: '文スト1話' });
    expect(byText('人々のヒントがヒット')).toMatchObject({
      text: '人々のヒントがヒット！',
      scene: 'デスゲーム中',
      addedAt: '2025-01-01',
    });

    const dialogue = byText('割れ物');
    expect(dialogue?.text).toBe('ママ「この中割れ物入ってないよね？」まひろ「我の物は入ってるよ」');
    expect(dialogue?.speakers).toEqual(['ママ', 'まひろ']);

    expect(byText('チーター')?.speakers).toEqual(['鷹']);
    expect(byText('カワウソ')?.speakers).toEqual(['ママ']);
    expect(byText('盲導犬')?.speakers).toEqual(['鷹', 'ママ', 'ひい']);
    expect(byText('まっさっかー')?.speakers).toEqual(['ママ', '鷹']);
    expect(byText('まっさっかー')?.memo).toBe('ママと鷹も参加');

    expect(byText('トークの内容')?.memo).toBe('パパとままがほめてた');
    expect(byText('トークの内容')?.speakers).toEqual([]);
    expect(byText('東京タワー')?.memo).toBe('みんな褒めてた');

    const tongue = byText('信舌');
    expect(tongue?.text).toBe('信用できる舌、略して信舌');
    expect(tongue?.reading).toBe('しんじた');
    expect(tongue?.addedAt).toBe('2025-01-16');
    expect(tongue?.memo).toBe('→ママがじわっと来るって!');

    expect(byText('ダイソー')?.memo).toBe('→ (ママ)大体そう');

    const shell = byText('ランドシェル');
    expect(shell?.text).toBe('陸の貝、その名もランドシェル');
    expect(shell?.addedAt).toBe('2025-01-18');
    expect(shell?.memo).toBe('⛰️🐚🎒\n→パパが上手いって〜');

    expect(byText('レース付きドレスレース')?.addedAt).toBe('2024-12-15');
    expect(byText('バンダナの順番だな')?.addedAt).toBe('2024-12-24');
    expect(byText('鷹春')?.addedAt).toBe('2024-12-31');
    expect(byText('魚でサッカーなんてまサッカー')?.addedAt).toBeNull();
    expect(byText('ウェイトレス')?.addedAt).toBe('2025-01-21');
    expect(byText('高名な米')?.addedAt).toBeNull();
    expect(byText('高名な米')?.scene).toBe('不明');
  });

  it('does not invent today for unknown dates', () => {
    const known = new Set([
      '2024-12-15',
      '2024-12-24',
      '2024-12-31',
      '2025-01-01',
      '2025-01-16',
      '2025-01-18',
      '2025-01-21',
    ]);
    const dated = parsed.drafts.filter((draft) => draft.addedAt !== null);
    expect(dated.map((draft) => draft.addedAt).sort()).toEqual([...known].sort());
    expect(parsed.drafts.filter((draft) => draft.addedAt === null)).toHaveLength(113 - known.size);
    for (const draft of parsed.drafts) {
      expect(draft.addedAt).not.toBe('2026-10-31');
      expect(draft.scene.trim().length).toBeGreaterThan(0);
      expect(draft.text.startsWith('・')).toBe(false);
      expect(draft.text.startsWith('→')).toBe(false);
      const validated = validateDraft({
        ...draft,
        rating: null,
        favorite: false,
        tags: [],
      });
      expect(validated.ok, validated.errors.map((error) => error.message).join(' / ')).toBe(true);
    }
  });
});

describe('parseDatePrefix', () => {
  it('maps years the way the memo asked', () => {
    expect(parseDatePrefix('24年12月15日レース付きドレスレース')).toMatchObject({
      kind: 'prefix',
      addedAt: '2024-12-15',
      rest: 'レース付きドレスレース',
    });
    expect(parseDatePrefix('2024年12月31日')).toMatchObject({
      kind: 'only',
      addedAt: '2024-12-31',
    });
    expect(parseDatePrefix('12月24日(火)バンダナの順番だな')).toMatchObject({
      addedAt: '2024-12-24',
      rest: 'バンダナの順番だな',
    });
    expect(parseDatePrefix('1月16日(木)')).toMatchObject({ kind: 'only', addedAt: '2025-01-16' });
    expect(parseDatePrefix('2025/01/01人々のヒントがヒット！')).toMatchObject({
      addedAt: '2025-01-01',
      rest: '人々のヒントがヒット！',
    });
    expect(parseDatePrefix('10月21日')).toMatchObject({
      kind: 'only',
      addedAt: null,
      addedAtNote: '10月21日（年不明）',
    });
  });
});

describe('seed file', () => {
  it('keeps the original six and matches the parser', () => {
    const built = buildSeed(raw);
    const seed = JSON.parse(
      readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'),
    );
    expect(seed).toEqual(built.file);
    expect(seed.schemaVersion).toBe(2);
    expect(seed.items).toHaveLength(classicItems().length + 113);
    expect(seed.items.slice(0, 6).map((item: { text: string }) => item.text)).toEqual(
      classicItems().map((item) => item.text),
    );
    expect(seed.items[5]).toMatchObject({
      text: 'イクラはいくら？',
      scene: '回転寿司',
      addedAt: '2026-10-06',
      rating: 5,
      favorite: true,
    });
    const family = seed.items.slice(6);
    expect(family.some((item: { addedAt: string | null }) => item.addedAt === null)).toBe(true);
    expect(family.every((item: { addedAt: string | null }) => item.addedAt !== '2026-10-31')).toBe(
      true,
    );
    expect(
      family.find(
        (item: { text: string }) => item.text === 'ハッカーの墓を破壊つにせくなしりままめしあ',
      ),
    ).toBeTruthy();
  });
});
