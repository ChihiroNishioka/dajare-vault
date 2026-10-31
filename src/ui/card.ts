import { hashId } from '../domain/ids';
import type { Dajare } from '../types';
import { addedLabel, escapeHtml } from './html';

const TAPES = ['#f5d98b', '#a9d8c3', '#9fc9e0', '#f2a2a0'];
const WASHES = ['#fffdf8', '#fbf6ec', '#f4f8f5', '#f8f3ef', '#f7f5f1'];

function stars(rating: number | null): string {
  if (rating === null) return '';
  const bits = [1, 2, 3, 4, 5]
    .map((n) => {
      const on = n <= rating;
      return `<svg class="star${on ? ' is-on' : ''}" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.4 12 7.4h5.2l-4.2 3.2 1.6 5.2L10 13.2 5.4 15.8 7 10.6 2.8 7.4H8Z"/></svg>`;
    })
    .join('');
  return `<span class="rating" aria-label="評価 ${rating}">${bits}</span>`;
}

function stamp(): string {
  return `<svg class="oshi" viewBox="0 0 72 72" role="img" aria-label="お気に入り"><path d="M36 8c9.2-.4 18 3.2 22.4 11.2 3.6 6.6 3.2 15.2-.2 22.2-4.2 8.6-12.6 14.8-22.2 15.4-10.4.6-20.2-5.2-24.6-14.4C7.2 33.8 8 22.2 14.2 15.4 19.6 9.4 27.2 8.4 36 8Z" fill="none" stroke="#c45d5b" stroke-width="2.4"/><path d="M37 11c8 .2 15 3.4 18.6 9.6" fill="none" stroke="#e7a09a" stroke-width="1.2"/><text x="36" y="42" text-anchor="middle">推し</text></svg>`;
}

export class DajareCard extends HTMLElement {
  item: Dajare | null = null;

  connectedCallback(): void {
    this.render();
  }

  render(): void {
    const item = this.item;
    if (!item) return;
    const n = hashId(item.id);
    const tilt = (((n % 25) - 12) / 10).toFixed(2);
    this.style.setProperty('--tilt', `${tilt}deg`);
    this.style.setProperty('--wash', WASHES[n % WASHES.length]);
    this.style.setProperty('--tape', TAPES[n % TAPES.length]);
    this.dataset.cut = String(n % 4);
    this.dataset.id = item.id;

    const when = addedLabel(item);
    const date = when.unknown
      ? `<p class="when is-unknown">${escapeHtml(when.text)}</p>`
      : `<p class="when"><time datetime="${escapeHtml(item.addedAt ?? '')}">${escapeHtml(when.text)}</time></p>`;
    const speakers =
      item.speakers.length > 0
        ? `<p class="speakers"><span>言った人</span> ${item.speakers.map((name) => `<b>${escapeHtml(name)}</b>`).join(' ')}</p>`
        : '';
    const sceneClass = item.scene === '不明' ? 'scene is-unknown' : 'scene';
    const tags =
      item.tags.length > 0
        ? `<ul class="tags">${item.tags.map((tag) => `<li>${escapeHtml(tag)}</li>`).join('')}</ul>`
        : '';
    const reading = item.reading ? `<p class="reading">${escapeHtml(item.reading)}</p>` : '';
    const source = item.source ? `<p class="source">元ネタ ${escapeHtml(item.source)}</p>` : '';
    const memo = item.memo ? `<p class="memo">${escapeHtml(item.memo)}</p>` : '';
    const note =
      item.addedAt && item.addedAtNote
        ? `<p class="date-note">${escapeHtml(item.addedAtNote)}</p>`
        : '';

    this.innerHTML = `
      <article class="slip">
        <span class="tape" aria-hidden="true"></span>
        <p class="body">${escapeHtml(item.text)}</p>
        ${reading}
        ${speakers}
        <div class="slip-foot">
          <p class="${sceneClass}"><span>場面</span> <em>${escapeHtml(item.scene)}</em></p>
          ${date}
          ${note}
          ${stars(item.rating)}
          ${item.favorite ? stamp() : ''}
        </div>
        ${tags}
        ${source}
        ${memo}
        <time class="updated" datetime="${escapeHtml(item.updatedAt)}">${escapeHtml(item.updatedAt)}</time>
        <div class="actions">
          <button type="button" data-action="edit" data-id="${escapeHtml(item.id)}">編集</button>
          <button type="button" data-action="delete" data-id="${escapeHtml(item.id)}">削除</button>
        </div>
      </article>
    `;
  }
}

export function defineCard(): void {
  if (!customElements.get('dajare-card')) customElements.define('dajare-card', DajareCard);
}
