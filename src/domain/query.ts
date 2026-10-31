import type { Dajare } from '../types';

export type SortKey = 'addedDesc' | 'addedAsc' | 'updatedDesc' | 'ratingDesc' | 'reading';
export type TagMode = 'and' | 'or';

export interface ItemQuery {
  q: string;
  scene: string;
  tags: string[];
  tagMode: TagMode;
  speakers: string[];
  favoriteOnly: boolean;
  unknownDateOnly: boolean;
  minRating: number | null;
  sort: SortKey;
}

export const defaultQuery = (): ItemQuery => ({
  q: '',
  scene: '',
  tags: [],
  tagMode: 'and',
  speakers: [],
  favoriteOnly: false,
  unknownDateOnly: false,
  minRating: null,
  sort: 'addedDesc',
});

function fold(value: string): string {
  return value.normalize('NFKC').toLowerCase();
}

function searchHay(item: Dajare): string {
  return fold(
    [item.text, item.reading, item.source, item.memo, item.speakers.join(' ')].join('\n'),
  );
}

function yomi(item: Dajare): string {
  return fold(item.reading);
}

export function queryItems(items: Dajare[], query: ItemQuery): Dajare[] {
  const q = fold(query.q.trim());
  const scene = fold(query.scene.trim());
  const filtered = items.filter((item) => {
    if (q && !searchHay(item).includes(q)) return false;
    if (scene && !fold(item.scene).includes(scene)) return false;
    if (query.favoriteOnly && !item.favorite) return false;
    if (query.unknownDateOnly && item.addedAt !== null) return false;
    if (query.minRating !== null && (item.rating === null || item.rating < query.minRating)) {
      return false;
    }
    if (query.tags.length > 0) {
      const has = (tag: string) => item.tags.includes(tag);
      if (query.tagMode === 'and' && !query.tags.every(has)) return false;
      if (query.tagMode === 'or' && !query.tags.some(has)) return false;
    }
    if (query.speakers.length > 0 && !query.speakers.some((name) => item.speakers.includes(name))) {
      return false;
    }
    return true;
  });

  const sorted = filtered.slice();
  sorted.sort((a, b) => compare(a, b, query.sort));
  return sorted;
}

function compareAdded(a: Dajare, b: Dajare, direction: 'asc' | 'desc'): number {
  if (a.addedAt === null && b.addedAt === null) return a.id.localeCompare(b.id);
  if (a.addedAt === null) return 1;
  if (b.addedAt === null) return -1;
  if (a.addedAt !== b.addedAt) {
    const cmp = a.addedAt < b.addedAt ? -1 : 1;
    return direction === 'asc' ? cmp : -cmp;
  }
  return a.id.localeCompare(b.id);
}

function compare(a: Dajare, b: Dajare, sort: SortKey): number {
  switch (sort) {
    case 'addedAsc':
      return compareAdded(a, b, 'asc');
    case 'addedDesc':
      return compareAdded(a, b, 'desc');
    case 'updatedDesc':
      if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
      return a.id.localeCompare(b.id);
    case 'ratingDesc': {
      const ra = a.rating ?? -1;
      const rb = b.rating ?? -1;
      if (ra !== rb) return rb - ra;
      return a.id.localeCompare(b.id);
    }
    case 'reading': {
      const ya = yomi(a);
      const yb = yomi(b);
      if (!ya && !yb) return a.id.localeCompare(b.id);
      if (!ya) return 1;
      if (!yb) return -1;
      const cmp = ya.localeCompare(yb, 'ja');
      return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
    }
    default:
      return 0;
  }
}
