// @vitest-environment jsdom
// 仕様の値（表示名・空欄の文言・上限）は定義から読まず、ここに文字で書く。
// 定義を書き換えたら、ここが落ちることで仕様の変更に気づく。
import { describe, expect, it, vi } from 'vitest';
import { validateDraft } from '../src/domain/validate';
import { formPanel } from '../src/ui/panel';
import { mount } from '../src/ui/app';
import { defineCard, type DajareCard } from '../src/ui/card';
import type { Dajare, DajareDraft } from '../src/types';

const SPEC = [
  {
    field: 'text',
    label: '本文',
    max: 200,
    empty: '本文を書いてください',
    tooLong: '本文は200文字以内にしてください',
    afterThree: '残り 197',
  },
  {
    field: 'scene',
    label: 'シーン',
    max: 100,
    empty: 'シーンを書いてください',
    tooLong: 'シーンは100文字以内にしてください',
    afterThree: '残り 97',
  },
] as const;

function draft(partial: Partial<DajareDraft> = {}): DajareDraft {
  return {
    text: '本文',
    scene: 'シーン',
    addedAt: null,
    addedAtNote: '',
    reading: '',
    source: '',
    rating: null,
    favorite: false,
    tags: [],
    speakers: [],
    memo: '',
    ...partial,
  };
}

function openAdd(): HTMLElement {
  window.history.replaceState(null, '', '/?mock=editor');
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  mount(root);
  root.querySelector<HTMLButtonElement>('[data-action="add"]')?.click();
  return root;
}

function setField(root: ParentNode, name: string, value: string): void {
  const input = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`);
  if (!input) throw new Error(`missing ${name}`);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
}

describe.each(SPEC)('form spec for $field', (spec) => {
  it('shows the spec label, maxlength and counter', () => {
    document.body.innerHTML = formPanel('add', null, [], []);
    const input = document.querySelector<HTMLElement>(`[name="${spec.field}"]`);
    const label = input?.closest('label');
    const name = label?.querySelector('.field-name')?.cloneNode(true) as HTMLElement | undefined;
    name?.querySelector('.req')?.remove();
    expect(name?.textContent).toBe(spec.label);
    expect(input?.getAttribute('maxlength')).toBe(String(spec.max));
    expect(label?.querySelector(`[data-count-for="${spec.field}"]`)?.textContent).toBe(
      `残り ${spec.max}`,
    );
  });

  it('accepts exactly the limit and rejects one more with the spec message', () => {
    expect(validateDraft(draft({ [spec.field]: 'あ'.repeat(spec.max) })).ok).toBe(true);
    expect(validateDraft(draft({ [spec.field]: 'あ'.repeat(spec.max + 1) })).errors).toEqual([
      { field: spec.field, message: spec.tooLong },
    ]);
  });

  it('rejects an empty value with the spec message', () => {
    expect(validateDraft(draft({ [spec.field]: ' ' })).errors).toEqual([
      { field: spec.field, message: spec.empty },
    ]);
  });

  it('shows the spec message on blur and links it to the field with aria-describedby', () => {
    const root = openAdd();
    const input = root.querySelector<HTMLElement>(`[name="${spec.field}"]`);
    const id = input?.getAttribute('aria-describedby') ?? '';
    expect(id).not.toBe('');
    const described = root.querySelector(`[id="${id}"]`);
    expect(described?.getAttribute('data-error-for')).toBe(spec.field);
    setField(root, spec.field, '');
    expect(described?.textContent).toBe(spec.empty);
    expect(input?.getAttribute('aria-invalid')).toBe('true');
    setField(root, spec.field, 'あり');
    expect(described?.textContent).toBe('');
  });

  it('updates the counter on input and shows 上限です at the limit', () => {
    const root = openAdd();
    const counter = root.querySelector(`[data-count-for="${spec.field}"]`);
    setField(root, spec.field, 'あいう');
    expect(counter?.textContent).toBe(spec.afterThree);
    setField(root, spec.field, 'あ'.repeat(spec.max));
    expect(counter?.textContent).toBe('上限です');
    setField(root, spec.field, 'あ'.repeat(spec.max - 1));
    expect(counter?.textContent).toBe('残り 1');
  });

  it('marks the field invalid on save and clears it after the fix', async () => {
    const root = openAdd();
    setField(root, 'text', '保存の本文');
    setField(root, 'scene', '保存のシーン');
    setField(root, spec.field, 'あ'.repeat(spec.max + 1));
    const input = root.querySelector<HTMLElement>(`[name="${spec.field}"]`);
    const slot = root.querySelector(`[data-error-for="${spec.field}"]`);
    expect(input?.getAttribute('aria-invalid')).toBe('false');
    root.querySelector<HTMLButtonElement>('[data-action="save"]')?.click();
    await vi.waitFor(() => expect(slot?.textContent).toBe(spec.tooLong));
    expect(input?.getAttribute('aria-invalid')).toBe('true');
    setField(root, spec.field, 'あり');
    expect(slot?.textContent).toBe('');
    expect(input?.getAttribute('aria-invalid')).toBe('false');
  });

  it('gives each error slot its own id', () => {
    document.body.innerHTML = formPanel('edit', null, [], []);
    const ids = [...document.querySelectorAll('[aria-describedby]')].map((node) =>
      node.getAttribute('aria-describedby'),
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(document.querySelector(`[name="${spec.field}"]`)?.hasAttribute('aria-describedby')).toBe(
      true,
    );
  });
});

it('the card names the scene with the same label as the form', () => {
  defineCard();
  const card = document.createElement('dajare-card') as DajareCard;
  const item: Dajare = {
    ...draft({ text: 'カードの本文', scene: '会議のあと' }),
    id: 'card-scene',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
  card.item = item;
  document.body.replaceChildren(card);
  expect(card.querySelector('.scene span')?.textContent).toBe('シーン');
  expect(card.querySelector('.scene em')?.textContent).toBe('会議のあと');
});
