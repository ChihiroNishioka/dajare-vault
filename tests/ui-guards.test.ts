// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { endSave, tryBeginSave } from '../src/ui/save-lock';
import { formPanel } from '../src/ui/panel';

describe('save lock', () => {
  it('makes a second save a no-op until the first finishes', () => {
    const lock = { held: false };
    expect(tryBeginSave(lock)).toBe(true);
    expect(tryBeginSave(lock)).toBe(false);
    expect(lock.held).toBe(true);
    endSave(lock);
    expect(tryBeginSave(lock)).toBe(true);
  });
});

describe('tag and speaker inputs', () => {
  it('allows a full row of emoji before the code-point check', () => {
    document.body.innerHTML = formPanel('add', null, [], []);
    expect(document.querySelector('#tag-draft')?.getAttribute('maxlength')).toBe('40');
    expect(document.querySelector('#speaker-draft')?.getAttribute('maxlength')).toBe('60');
  });
});
