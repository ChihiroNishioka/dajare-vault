import { defineConfig, loadEnv, type UserConfig } from 'vite';

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
    throw new Error(
      '本番ビルドには VITE_NOTION_RELAY_URL が必要です。README の「公開」の手順で設定してください。ローカルで確認するだけなら VITE_FORCE_LOCAL=1 を付けます。',
    );
  }
}

export function createConfig({ command, mode }: { command: string; mode: string }): UserConfig {
  // 読むのは VITE_ で始まる値だけにする。ほかの環境変数（秘密を含みうる）は取り込まない。
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  validateProductionRelayUrl({
    command,
    mode,
    forceLocal: env.VITE_FORCE_LOCAL ?? '',
    relayUrl: env.VITE_NOTION_RELAY_URL ?? '',
  });

  return {
    base: '/dajare-vault/',
  };
}

export default defineConfig(createConfig);
