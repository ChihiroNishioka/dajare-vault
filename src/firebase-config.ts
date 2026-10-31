/**
 * Firebase の Web 設定。ブラウザに載る値で、秘密鍵ではない。
 * テストと E2E は VITE_FORCE_LOCAL=1 でビルドし、この設定を使わずローカルモードにする。
 */
export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  /** Google Identity Services のウェブクライアント ID。公開してよい。 */
  googleClientId: string;
}

export const firebaseConfig: FirebaseWebConfig = {
  apiKey: 'AIzaSyDN85uvuF8Te7-IB6trAERkJ0USKfKUUvk',
  authDomain: 'dajare-vault.firebaseapp.com',
  projectId: 'dajare-vault',
  storageBucket: 'dajare-vault.firebasestorage.app',
  messagingSenderId: '850264162402',
  appId: '1:850264162402:web:5bcfbca3707df3bad3d13b',
  googleClientId: '850264162402-257tr97l8dthgs70nmfk9cp7lje9oc39.apps.googleusercontent.com',
};

export function isFirebaseConfigured(
  config: FirebaseWebConfig | null,
): config is FirebaseWebConfig {
  if (import.meta.env.VITE_FORCE_LOCAL === '1') return false;
  if (!config) return false;
  return Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
}
