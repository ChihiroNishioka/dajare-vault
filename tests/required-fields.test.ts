// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { LIMITS, REQUIRED_FIELDS, validateDraft } from '../src/domain/validate';
import { useRequiredFields } from '../src/domain/required-fields';
import { formPanel } from '../src/ui/panel';
import { mount } from '../src/ui/app';
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

it('shows the required mark on each required field in the edit form', () => {
  document.body.innerHTML = formPanel('edit', null, [], []);
  for (const field of REQUIRED_FIELDS) {
    const input = document.querySelector(`[name="${field.field}"]`);
    expect(input?.closest('label')?.querySelector('.req')?.textContent).toBe('＊');
  }
});

function setField(root: ParentNode, name: string, value: string): void {
  const input = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`);
  if (!input) throw new Error(`missing ${name}`);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
}

it('marks an invalid required field and clears aria-invalid after it is fixed', () => {
  window.history.replaceState(null, '', '/?mock=editor');
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  mount(root);
  root.querySelector<HTMLButtonElement>('[data-action="add"]')?.click();

  setField(root, 'text', '');
  const text = root.querySelector<HTMLTextAreaElement>('[name="text"]');
  expect(text?.getAttribute('aria-invalid')).toBe('true');

  setField(root, 'text', '本文');
  expect(text?.getAttribute('aria-invalid')).toBe('false');
});

it('enforces the length limit for a field removed from the required set', () => {
  const fields = REQUIRED_FIELDS.filter((item) => item.field !== 'text');
  useRequiredFields(fields, () => {
    const result = validateDraft({ ...blank(), text: 'あ'.repeat(LIMITS.text + 1), scene: '場面' });
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({
      field: 'text',
      message: `本文は${LIMITS.text}文字以内にしてください`,
    });
  });
});

it.each(['text', 'scene'] as const)(
  'swapping the required entry drops %s from the mark, the save button, blur, and the save check',
  (field) => {
    const fields = REQUIRED_FIELDS.filter((item) => item.field !== field);
    const other = field === 'text' ? 'scene' : 'text';
    const keptMessage = fields.find((item) => item.field === other)?.emptyMessage ?? '';
    useRequiredFields(fields, () => {
      window.history.replaceState(null, '', '/?mock=editor');
      const root = document.createElement('div');
      document.body.replaceChildren(root);
      mount(root);
      root.querySelector<HTMLButtonElement>('[data-action="add"]')?.click();
      const dropped = root.querySelector<HTMLElement>(`[name="${field}"]`);
      const kept = root.querySelector<HTMLElement>(`[name="${other}"]`);
      expect(dropped?.closest('label')?.querySelector('.req')).toBeNull();
      expect(dropped?.hasAttribute('aria-required')).toBe(false);
      expect(kept?.getAttribute('aria-required')).toBe('true');
      setField(root, other, 'あり');
      setField(root, field, '');
      const save = root.querySelector<HTMLButtonElement>('[data-action="save"]');
      expect(save?.disabled).toBe(false);
      expect(root.querySelector(`[data-error-for="${field}"]`)?.textContent ?? '').toBe('');
      setField(root, other, '');
      expect(root.querySelector(`[data-error-for="${other}"]`)?.textContent).toBe(keptMessage);
      expect(save?.disabled).toBe(true);
      expect(validateDraft({ ...blank(), [other]: 'あり' }).ok).toBe(true);
      expect(
        validateDraft({ ...blank(), [other]: ' ' }).errors.map((error) => error.field),
      ).toEqual([other]);
    });
    expect(REQUIRED_FIELDS.map((item) => item.field)).toEqual(['text', 'scene']);
  },
);
