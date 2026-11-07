import { defineConfig, loadEnv } from 'vite';

export function validateProductionRelayUrl({
  command,
  mode,
  forceLocal,
  relayUrl,
}: {
  command: string;
  mode: string;
  forceLocal: string;
  relayUrl: string;
}): void {
  if (
    command === 'build' &&
    mode === 'production' &&
    forceLocal !== '1' &&
    relayUrl.trim() === ''
  ) {
    throw new Error('本番ビルドには VITE_NOTION_RELAY_URL が必要です');
  }
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  validateProductionRelayUrl({
    command,
    mode,
    forceLocal: env.VITE_FORCE_LOCAL ?? '',
    relayUrl: env.VITE_NOTION_RELAY_URL ?? '',
  });

  return {
    base: '/dajare-vault/',
  };
});
