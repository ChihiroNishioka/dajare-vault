import { describe, expect, it } from 'vitest';
import { validateProductionRelayUrl } from '../vite.config';

describe('production relay configuration', () => {
  it('stops a production build when the relay URL is empty', () => {
    expect(() =>
      validateProductionRelayUrl({
        mode: 'production',
        forceLocal: '',
        relayUrl: '',
      }),
    ).toThrow('本番ビルドには VITE_NOTION_RELAY_URL が必要です');
  });
});
