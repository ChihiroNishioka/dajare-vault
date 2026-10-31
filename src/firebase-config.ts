/**
 * Firebase の Web 設定。値は公開してよい種類のものだが、まだプロジェクトがない。
 * 空のあいだはローカルモード（この端末の localStorage）のまま動く。
 * 値が届いたら apiKey / authDomain / projectId / appId を入れる。
 */
export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

export const firebaseConfig: FirebaseWebConfig | null = null;

export function isFirebaseConfigured(
  config: FirebaseWebConfig | null,
): config is FirebaseWebConfig {
  if (!config) return false;
  return Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
}
