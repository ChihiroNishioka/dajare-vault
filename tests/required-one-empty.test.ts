// @vitest-environment jsdom
import { beforeAll, expect, it } from 'vitest';
import { validateDraft } from '../src/domain/validate';
import type { DajareDraft } from '../src/types';
import { mount } from '../src/ui/app';

function draftFrom(values: Record<string, string>): DajareDraft {
  return {
    text: values.text ?? '',
    scene: values.scene ?? '',
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

function setField(root: ParentNode, name: string, value: string): void {
  const input = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`);
  if (!input) throw new Error(`missing ${name}`);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
}

beforeAll(() => {
  window.history.replaceState(null, '', '/?mock=editor');
});

it('blocks save and points the check at each required field when only that one is empty', () => {
  const root = document.createElement('div');
  document.body.append(root);
  mount(root);
  const add = root.querySelector<HTMLButtonElement>('[data-action="add"]');
  if (!add || add.hidden) throw new Error('add is not available');
  add.click();
  const names = [...root.querySelectorAll<HTMLElement>('[aria-required="true"]')].map(
    (node) => (node as HTMLInputElement).name,
  );
  expect(names.length).toBeGreaterThan(1);
  const save = root.querySelector<HTMLButtonElement>('[data-action="save"]');
  if (!save) throw new Error('missing save');

  for (const emptyName of names) {
    const values: Record<string, string> = {};
    for (const name of names) {
      values[name] = name === emptyName ? ' ' : 'あり';
      setField(root, name, values[name]);
    }
    expect(save.disabled).toBe(true);
    const shown = root.querySelector(`[data-error-for="${emptyName}"]`)?.textContent ?? '';
    expect(shown.length).toBeGreaterThan(0);
    for (const other of names) {
      if (other === emptyName) continue;
      expect(root.querySelector(`[data-error-for="${other}"]`)?.textContent ?? '').toBe('');
    }
    const result = validateDraft(draftFrom(values));
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.field)).toEqual([emptyName]);
    expect(result.errors[0]?.message).toBe(shown);
  }
});
