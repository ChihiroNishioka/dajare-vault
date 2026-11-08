import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConfig, validateProductionRelayUrl } from '../vite.config';

const message = '本番ビルドには VITE_NOTION_RELAY_URL が必要です';
const base = { command: 'build', mode: 'production', forceLocal: '', relayUrl: '' };

describe('production relay validation', () => {
  it('stops a production build when the relay URL is empty', () => {
    expect(() => validateProductionRelayUrl(base)).toThrow(message);
  });

  it('stops a production build when the relay URL is only whitespace', () => {
    expect(() => validateProductionRelayUrl({ ...base, relayUrl: '  ' })).toThrow(message);
  });

  it('passes a production build when VITE_FORCE_LOCAL is 1', () => {
    expect(() => validateProductionRelayUrl({ ...base, forceLocal: '1' })).not.toThrow();
  });

  it('passes a production build when the relay URL is set', () => {
    expect(() =>
      validateProductionRelayUrl({ ...base, relayUrl: 'https://relay.example.test' }),
    ).not.toThrow();
  });

  it('passes a build in a mode other than production', () => {
    expect(() => validateProductionRelayUrl({ ...base, mode: 'staging' })).not.toThrow();
  });

  it.each(['serve', 'preview'])('allows %s without a relay URL', (command) => {
    expect(() => validateProductionRelayUrl({ ...base, command })).not.toThrow();
  });

  it('tells the reader where to look and how to build locally', () => {
    expect(() => validateProductionRelayUrl(base)).toThrow('README の「公開」');
    expect(() => validateProductionRelayUrl(base)).toThrow('VITE_FORCE_LOCAL=1');
  });
});

describe('vite config wiring', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const clearEnv = () => {
    vi.stubEnv('VITE_NOTION_RELAY_URL', '');
    vi.stubEnv('VITE_FORCE_LOCAL', '');
  };

  it('stops build/production without environment variables', () => {
    clearEnv();
    expect(() => createConfig({ command: 'build', mode: 'production' })).toThrow(message);
  });

  it('stops build/production when the relay URL is only whitespace', () => {
    clearEnv();
    vi.stubEnv('VITE_NOTION_RELAY_URL', '  ');
    expect(() => createConfig({ command: 'build', mode: 'production' })).toThrow(message);
  });

  it('passes build/production with VITE_FORCE_LOCAL=1', () => {
    clearEnv();
    vi.stubEnv('VITE_FORCE_LOCAL', '1');
    expect(createConfig({ command: 'build', mode: 'production' }).base).toBe('/dajare-vault/');
  });

  it('passes build/production with a relay URL', () => {
    clearEnv();
    vi.stubEnv('VITE_NOTION_RELAY_URL', 'https://relay.example.test');
    expect(createConfig({ command: 'build', mode: 'production' }).base).toBe('/dajare-vault/');
  });

  it('passes build in a mode other than production', () => {
    clearEnv();
    expect(createConfig({ command: 'build', mode: 'staging' }).base).toBe('/dajare-vault/');
  });
});
