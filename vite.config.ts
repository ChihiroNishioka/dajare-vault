import { defineConfig, loadEnv } from 'vite';

export function validateProductionRelayUrl({
  mode,
  forceLocal,
  relayUrl,
}: {
  mode: string;
  forceLocal: string;
  relayUrl: string;
}): void {
  if (mode === 'production' && forceLocal !== '1' && relayUrl.trim() === '') {
    throw new Error('本番ビルドには VITE_NOTION_RELAY_URL が必要です');
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  validateProductionRelayUrl({
    mode,
    forceLocal: env.VITE_FORCE_LOCAL ?? '',
    relayUrl: env.VITE_NOTION_RELAY_URL ?? '',
  });

  return {
    base: '/dajare-vault/',
  };
});
