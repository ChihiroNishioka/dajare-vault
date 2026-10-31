import './styles/app.css';
import { firebaseConfig, isFirebaseConfigured } from './firebase-config';
import { mount } from './ui/app';

if (isFirebaseConfigured(firebaseConfig)) {
  void import('./cloud/connect').then(({ connectCloud }) => {
    void connectCloud().catch(() => undefined);
  });
}

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('missing #app');
try {
  mount(root);
} catch {
  root.textContent = 'このブラウザの設定では保存できません。';
}
