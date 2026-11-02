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
  return { paper };
});

vi.mock('../src/cloud/connect', () => ({
  connectCloud: () =>
    Promise.resolve({
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
        listener({ user: null, isEditor: false, ready: true });
        return () => undefined;
      },
      signIn: () => Promise.resolve(),
      renderGoogleButton: (_host: HTMLElement, onStatus: (code: string) => void) => {
        onStatus('gsi-load');
      },
      signOut: () => Promise.resolve(),
    }),
}));

const loadNote =
  'Googleのログインボタンを読み込めませんでした。通信を確かめて、ページを読み込み直してください';

it('shows the Google load failure on the note and no other login button', async () => {
  const { mount } = await import('../src/ui/app');
  const root = document.createElement('div');
  document.body.append(root);
  mount(root);
  await vi.waitFor(() => {
    expect(root.querySelector('dajare-card')).not.toBeNull();
  });
  const host = root.querySelector('#gsi-button');
  expect(host?.childElementCount ?? 0).toBe(0);
  expect(root.querySelector('#login-note')?.textContent).toBe(loadNote);
  expect(root.querySelectorAll('.login-row button')).toHaveLength(0);
});
