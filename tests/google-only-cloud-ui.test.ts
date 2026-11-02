// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  const paper = {
    id: 'paper-1',
    text: '試しの駄洒落',
    scene: '試験',
    addedAt: '2026-04-01',
    addedAtNote: '',
    reading: '',
    source: '',
    rating: 2,
    favorite: false,
    tags: [] as string[],
    speakers: [] as string[],
    updatedAt: '2026-04-01T00:00:00.000Z',
    memo: '',
  };
  return {
    paper,
    mode: 'gsi-load' as 'gsi-load' | 'boot-fail' | 'credential-fail' | 'loading',
    seenReady: null as boolean | null,
  };
});

vi.mock('../src/cloud/connect', () => ({
  connectCloud: () => {
    if (harness.mode === 'boot-fail') return Promise.reject(new Error('boot'));
    return Promise.resolve({
      store: {
        subscribe(listener: () => void) {
          listener();
          return () => undefined;
        },
        getItems: () => [harness.paper],
        migrationPending: () => false,
        migrationDone: () => true,
        readError: () => null,
        hasServerSnapshot: () => true,
        create: () => Promise.resolve({ ok: true }),
        update: () => Promise.resolve({ ok: true }),
        remove: () => Promise.resolve({ ok: true }),
        bulkImport: () => Promise.resolve({ added: 0, skipped: 0 }),
        migrateSeed: () => Promise.resolve({ added: 0, skipped: 0 }),
        refreshOwnNames: () => Promise.resolve({ updated: 0, skipped: 0, failed: 0 }),
      },
      subscribe(listener: (session: { user: null; isEditor: boolean; ready: boolean }) => void) {
        const ready = harness.mode !== 'loading';
        harness.seenReady = ready;
        listener({ user: null, isEditor: false, ready });
        return () => undefined;
      },
      renderGoogleButton: (_host: HTMLElement, onStatus: (code: string) => void) => {
        if (harness.mode === 'gsi-load') onStatus('gsi-load');
        if (harness.mode === 'credential-fail') onStatus('auth/unknown');
      },
      signOut: () => Promise.resolve(),
    });
  },
}));

const loadNote =
  'Googleのログインボタンを読み込めませんでした。通信を確かめて、ページを読み込み直してください';

async function start(): Promise<HTMLElement> {
  vi.resetModules();
  harness.seenReady = null;
  localStorage.clear();
  document.body.replaceChildren();
  const { mount } = await import('../src/ui/app');
  const root = document.createElement('div');
  document.body.append(root);
  mount(root);
  return root;
}

it('shows the Google load failure on the note and no other login button', async () => {
  harness.mode = 'gsi-load';
  const root = await start();
  await vi.waitFor(() => {
    expect(root.querySelector('dajare-card')).not.toBeNull();
  });
  const host = root.querySelector('#gsi-button');
  expect(host?.childElementCount ?? 0).toBe(0);
  expect(root.querySelector('#login-note')?.textContent).toBe(loadNote);
  expect(root.querySelectorAll('.login-row button')).toHaveLength(0);
});

it('shows the preparation failure and no login button when connect rejects', async () => {
  harness.mode = 'boot-fail';
  const root = await start();
  await vi.waitFor(() => {
    expect(root.querySelector('#toast')?.textContent ?? '').toContain('共有の準備に失敗しました');
  });
  expect(root.querySelectorAll('.login-row button')).toHaveLength(0);
  expect(root.querySelector('#gsi-button')?.childElementCount ?? 0).toBe(0);
});

it('shows the credential failure on the note', async () => {
  harness.mode = 'credential-fail';
  const root = await start();
  await vi.waitFor(() => {
    expect(root.querySelector('#login-note')?.textContent).toBe('ログインできませんでした');
  });
  expect(root.querySelector('dajare-card')).not.toBeNull();
});

it('keeps the signed-out login row until the first session is ready', async () => {
  harness.mode = 'loading';
  const root = await start();
  await vi.waitFor(() => {
    expect(harness.seenReady).toBe(false);
  });
  expect(root.querySelector('.login-row')).not.toBeNull();
  expect(root.querySelector('#gsi-button')).not.toBeNull();
  expect(root.querySelector('.account-name')).toBeNull();
  expect(root.querySelector('.account-logout')).toBeNull();
  expect(root.querySelector('.mode-badge')).toBeNull();
});
