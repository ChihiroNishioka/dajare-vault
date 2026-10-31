/** ログイン失敗を、画面に出す日本語にする。 */
export function loginFailureMessage(code: string): string {
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
    case 'gsi-closed':
      return 'ログイン画面を閉じました';
    case 'auth/popup-blocked':
      return 'ログイン画面が開けませんでした。もう一度タップしてください';
    case 'auth/unauthorized-domain':
    case 'gsi-origin':
      return 'このページのアドレスが、ログインの許可リストに入っていません';
    case 'gsi-load':
      return 'Googleのログインボタンを読み込めませんでした。別の方法でログインしてください';
    case 'not-editor':
      return 'このアカウントは編集者の名簿に無いので、見るだけです';
    default:
      return 'ログインできませんでした';
  }
}

export interface GsiId {
  initialize: (config: Record<string, unknown>) => void;
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
  prompt?: () => void;
}

export interface CredentialResponse {
  credential?: string;
}

/** One Tap は出さない。ボタンのポップアップだけ。FedCM は対応しているライブラリだけが使う。 */
export function gsiConfiguration(
  clientId: string,
  onCredential: (idToken: string) => void,
  onClose: () => void,
): Record<string, unknown> {
  return {
    client_id: clientId,
    callback: (response: CredentialResponse) => {
      if (response.credential) onCredential(response.credential);
      else onClose();
    },
    ux_mode: 'popup',
    auto_select: false,
    use_fedcm_for_prompt: true,
    use_fedcm_for_button: true,
    intermediate_iframe_close_callback: onClose,
  };
}

const BUTTON = {
  type: 'standard',
  theme: 'outline',
  size: 'medium',
  text: 'signin_with',
  shape: 'rectangular',
  locale: 'ja',
  width: 220,
} as const;

/**
 * Google のボタンを描く。prompt() は呼ばない。
 * FedCM の指定で初期化できないときは、その2つを外してもう一度試す。
 */
export function mountGoogleButton(
  id: GsiId,
  container: HTMLElement,
  clientId: string,
  onCredential: (idToken: string) => void,
  onClose: () => void,
): void {
  if (container.childElementCount > 0) return;
  const config = gsiConfiguration(clientId, onCredential, onClose);
  try {
    id.initialize(config);
  } catch {
    const plain = { ...config };
    delete plain.use_fedcm_for_prompt;
    delete plain.use_fedcm_for_button;
    id.initialize(plain);
  }
  id.renderButton(container, { ...BUTTON });
}

const GSI_SRC = 'https://accounts.google.com/gsi/client';

let watchingOrigin = false;

/** Google のスクリプトは、許可されていない生成元を console.error で知らせる。 */
export function watchGoogleOriginError(onOrigin: () => void): void {
  if (watchingOrigin) return;
  watchingOrigin = true;
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const text = args.map((part) => String(part)).join(' ');
    if (text.includes('origin is not allowed') || text.includes('origin_mismatch')) onOrigin();
    original(...args);
  };
}

let loading: Promise<GsiId> | null = null;

/** 共有モードのときだけ読む。ローカルモードでは呼ばない。 */
export function loadGoogleIdentity(doc: Document = document): Promise<GsiId> {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const ready = (): GsiId | null => {
      const google = (window as Window & { google?: { accounts?: { id?: GsiId } } }).google;
      return google?.accounts?.id ?? null;
    };
    const existing = ready();
    if (existing) {
      resolve(existing);
      return;
    }
    const script = doc.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.onload = () => {
      const id = ready();
      if (id) resolve(id);
      else reject(new Error('gsi-load'));
    };
    script.onerror = () => reject(new Error('gsi-load'));
    doc.head.append(script);
  });
  loading.catch(() => {
    loading = null;
  });
  return loading;
}
