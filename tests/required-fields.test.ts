// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { LIMITS, REQUIRED_FIELDS, validateDraft } from '../src/domain/validate';
import { FORM_FIELDS, useFormFields } from '../src/domain/required-fields';
import { formPanel } from '../src/ui/panel';
import { mount } from '../src/ui/app';
import { defineCard, type DajareCard } from '../src/ui/card';
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

it('rejects 101 characters in the scene after the scene is removed from the required set', () => {
  const fields = FORM_FIELDS.map((item) => ({
    ...item,
    required: item.field !== 'scene' && item.required,
  }));
  useFormFields(fields, () => {
    expect(validateDraft({ ...blank(), text: '本文', scene: ' ' }).ok).toBe(true);
    expect(validateDraft({ ...blank(), text: '本文', scene: 'あ'.repeat(100) }).ok).toBe(true);
    expect(validateDraft({ ...blank(), text: '本文', scene: 'あ'.repeat(101) }).errors).toEqual([
      { field: 'scene', message: 'シーンは100文字以内にしてください' },
    ]);
  });
});

it('enforces the length limit for a field removed from the required set', () => {
  const fields = FORM_FIELDS.map((item) => ({
    ...item,
    required: item.field !== 'text' && item.required,
  }));
  useFormFields(fields, () => {
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
    const fields = FORM_FIELDS.map((item) => ({
      ...item,
      required: item.field === field ? false : item.required,
    }));
    const other = field === 'text' ? 'scene' : 'text';
    const keptMessage = other === 'text' ? '本文を書いてください' : 'シーンを書いてください';
    useFormFields(fields, () => {
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

it.each(['text', 'scene'] as const)(
  'uses a replaced %s label, empty message and limit across the form, validation and card',
  (field) => {
    const replacementLabel = 'お題';
    const replacementEmpty = 'お題がありません';
    const replacementMax = 5;
    const fields = FORM_FIELDS.map((item) =>
      item.field === field
        ? { ...item, label: replacementLabel, emptyMessage: replacementEmpty, max: replacementMax }
        : item,
    );

    useFormFields(fields, () => {
      window.history.replaceState(null, '', '/?mock=editor');
      const root = document.createElement('div');
      document.body.replaceChildren(root);
      mount(root);
      root.querySelector<HTMLButtonElement>('[data-action="add"]')?.click();

      const input = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${field}"]`);
      const label = input?.closest('label');
      const name = label?.querySelector('.field-name')?.cloneNode(true) as HTMLElement | undefined;
      name?.querySelector('.req')?.remove();
      expect(name?.textContent).toBe(replacementLabel);
      expect(input?.getAttribute('maxlength')).toBe(String(replacementMax));
      expect(label?.querySelector(`[data-count-for="${field}"]`)?.textContent).toBe(
        `残り ${replacementMax}`,
      );

      setField(root, field, '');
      expect(root.querySelector(`[data-error-for="${field}"]`)?.textContent).toBe(replacementEmpty);

      const other = field === 'text' ? 'scene' : 'text';
      const validDraft = { ...blank(), text: '本文', scene: 'シーン', [other]: '有効' };
      expect(validateDraft({ ...validDraft, [field]: ' ' }).errors).toEqual([
        { field, message: replacementEmpty },
      ]);
      expect(validateDraft({ ...validDraft, [field]: 'あ'.repeat(replacementMax) }).ok).toBe(true);
      expect(
        validateDraft({ ...validDraft, [field]: 'あ'.repeat(replacementMax + 1) }).errors,
      ).toEqual([
        {
          field,
          message: `${replacementLabel}は${replacementMax}文字以内にしてください`,
        },
      ]);

      defineCard();
      const card = document.createElement('dajare-card') as DajareCard;
      card.item = {
        ...blank(),
        text: 'カードの本文',
        scene: '会議のあと',
        id: `card-${field}`,
        updatedAt: '2026-10-01T00:00:00.000Z',
      };
      document.body.replaceChildren(card);
      expect(card.querySelector('.scene span')?.textContent).toBe(
        field === 'scene' ? replacementLabel : 'シーン',
      );
    });
  },
);
