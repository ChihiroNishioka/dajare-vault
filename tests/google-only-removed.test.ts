// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { loginFailureMessage } from '../src/cloud/google-identity';
import { mount } from '../src/ui/app';

it('does not offer another way to sign in on the signed-out screen', () => {
  window.history.replaceState(null, '', '/?mock=signed-out');
  const root = document.createElement('div');
  document.body.append(root);
  mount(root);
  expect(root.textContent ?? '').not.toContain('別の方法でログイン');
  expect(root.querySelector('[data-action="sign-in"]')).toBeNull();
  expect(root.querySelector('.account-alt')).toBeNull();
  expect(root.querySelector('.gsi-placeholder')?.textContent).toBe('Google でログイン');
  expect(loginFailureMessage('gsi-load')).not.toContain('別の方法');
});
