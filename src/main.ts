import './styles/app.css';
import { mount } from './ui/app';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('missing #app');
try {
  mount(root);
} catch {
  root.textContent = 'このブラウザの設定では保存できません。';
}
