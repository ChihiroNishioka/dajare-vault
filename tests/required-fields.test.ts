// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { validateDraft } from '../src/domain/validate';
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
  expect(
    document
      .querySelector('textarea[name="text"]')
      ?.closest('label')
      ?.querySelector('.req')
      ?.getAttribute('aria-label'),
  ).toBe('必須');
});
