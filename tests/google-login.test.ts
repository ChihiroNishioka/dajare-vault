import { describe, expect, it } from 'vitest';
import { firebaseConfig } from '../src/firebase-config';
import {
  gsiConfiguration,
  loginFailureMessage,
  mountGoogleButton,
  type GsiId,
} from '../src/cloud/google-identity';

describe('login messages', () => {
  it('explains a closed popup, a blocked origin, and a viewer account', () => {
    expect(loginFailureMessage('auth/popup-closed-by-user')).toBe('ログイン画面を閉じました');
    expect(loginFailureMessage('gsi-closed')).toBe('ログイン画面を閉じました');
    expect(loginFailureMessage('auth/unauthorized-domain')).toBe(
      'このページのアドレスが、ログインの許可リストに入っていません',
    );
    expect(loginFailureMessage('gsi-origin')).toBe(
      'このページのアドレスが、ログインの許可リストに入っていません',
    );
    expect(loginFailureMessage('gsi-load')).toMatch(/別の方法でログイン/);
    expect(loginFailureMessage('not-editor')).toMatch(/見るだけ/);
  });
});

describe('Google sign-in button', () => {
  it('uses a popup button and does not open One Tap', () => {
    const calls: string[] = [];
    const id: GsiId = {
      initialize: (config) => {
        calls.push('init');
        expect(config.ux_mode).toBe('popup');
        expect(config.auto_select).toBe(false);
        expect(config.use_fedcm_for_prompt).toBe(true);
        expect(config.use_fedcm_for_button).toBe(true);
        expect(config.client_id).toBe(firebaseConfig.googleClientId);
        expect(typeof config.callback).toBe('function');
      },
      renderButton: (parent) => {
        calls.push('button');
        (parent as { childElementCount: number }).childElementCount += 1;
      },
      prompt: () => calls.push('prompt'),
    };
    const host = { childElementCount: 0 } as unknown as HTMLElement;
    let token = '';
    mountGoogleButton(
      id,
      host,
      firebaseConfig.googleClientId,
      (value) => {
        token = value;
      },
      () => undefined,
    );
    expect(calls).toEqual(['init', 'button']);
    const config = gsiConfiguration(
      firebaseConfig.googleClientId,
      () => undefined,
      () => undefined,
    );
    (config.callback as (response: { credential?: string }) => void)({ credential: 'id-token' });
    expect(token).toBe('');
    (
      gsiConfiguration(
        firebaseConfig.googleClientId,
        (value) => {
          token = value;
        },
        () => undefined,
      ).callback as (response: { credential?: string }) => void
    )({ credential: 'id-token' });
    expect(token).toBe('id-token');
  });

  it('drops FedCM flags when the library rejects them', () => {
    const seen: Record<string, unknown>[] = [];
    const id: GsiId = {
      initialize: (config) => {
        seen.push(config);
        if ('use_fedcm_for_button' in config) throw new Error('unsupported');
      },
      renderButton: () => undefined,
    };
    mountGoogleButton(
      id,
      { childElementCount: 0 } as HTMLElement,
      'client',
      () => undefined,
      () => undefined,
    );
    expect(seen).toHaveLength(2);
    expect(seen[1]?.use_fedcm_for_button).toBeUndefined();
    expect(seen[1]?.ux_mode).toBe('popup');
  });
});
