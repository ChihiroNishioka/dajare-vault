// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { REQUIRED_FIELDS, validateDraft } from '../src/domain/validate';
import { formPanel } from '../src/ui/panel';
import type { DajareDraft } from '../src/types';

function blank(): DajareDraft {
  return {
    text: ' ',
    scene: ' ',
    addedAt: null,
    addedAtNote: '',
    reading: '',
    source: '',
    rating: null,
    favorite: false,
    tags: [],
    speakers: [],
    memo: '',
  };
}

function markedFields(): string[] {
  return [...document.querySelectorAll('.req')]
    .map((mark) => mark.closest('label')?.querySelector('textarea, input')?.getAttribute('name'))
    .filter((name): name is string => typeof name === 'string')
    .sort();
}

it('marks exactly the fields that the check rejects when they are empty', () => {
  document.body.innerHTML = formPanel('add', null, [], []);
  const rejected = validateDraft(blank())
    .errors.map((error) => error.field)
    .sort();
  expect(markedFields()).toEqual(rejected);
  expect(document.querySelector('.req-legend')?.textContent).toBe('＊は必須');
  expect(document.querySelector('textarea[name="text"]')?.getAttribute('aria-required')).toBe(
    'true',
  );
  expect(document.querySelector('input[name="scene"]')?.getAttribute('aria-required')).toBe('true');
  expect(document.querySelector('input[name="reading"]')?.hasAttribute('aria-required')).toBe(
    false,
  );
  const star = document
    .querySelector('textarea[name="text"]')
    ?.closest('label')
    ?.querySelector('.req');
  expect(star?.getAttribute('aria-hidden')).toBe('true');
  expect(star?.hasAttribute('aria-label')).toBe(false);
});

it.each(['text', 'scene'] as const)(
  'drops %s from the mark and the empty check together without editing the list',
  (field) => {
    const fields = REQUIRED_FIELDS.filter((item) => item.field !== field);
    const other = field === 'text' ? 'scene' : 'text';
    document.body.innerHTML = formPanel('add', null, [], [], fields);
    const dropped = document.querySelector(`[name="${field}"]`);
    expect(dropped?.closest('label')?.querySelector('.req')).toBeNull();
    expect(dropped?.hasAttribute('aria-required')).toBe(false);
    expect(document.querySelector(`[name="${other}"]`)?.getAttribute('aria-required')).toBe('true');
    const kept = validateDraft({ ...blank(), [other]: ' ' }, fields);
    expect(kept.ok).toBe(false);
    expect(kept.errors.map((error) => error.field)).toEqual([other]);
    const released = validateDraft({ ...blank(), [other]: 'ある' }, fields);
    expect(released.errors.some((error) => error.field === field)).toBe(false);
    expect(released.ok).toBe(true);
    expect(REQUIRED_FIELDS.map((item) => item.field)).toEqual(['text', 'scene']);
  },
);
