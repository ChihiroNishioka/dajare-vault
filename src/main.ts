import './styles/app.css';
import { mount } from './ui/app';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('missing #app');
mount(root);
