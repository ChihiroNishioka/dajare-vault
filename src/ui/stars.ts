export class StarRating extends HTMLElement {
  connectedCallback(): void {
    this.render();
    this.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest('button');
      if (!button?.dataset.value) return;
      const next = Number(button.dataset.value);
      const current = Number(this.getAttribute('value') || '0');
      if (current === next) this.removeAttribute('value');
      else this.setAttribute('value', String(next));
      this.render();
    });
  }

  render(): void {
    const current = Number(this.getAttribute('value') || '0');
    const buttons = [1, 2, 3, 4, 5]
      .map((n) => {
        const on = n <= current ? ' is-on' : '';
        return `<button type="button" class="star-btn${on}" data-value="${n}" aria-label="評価 ${n}" aria-pressed="${n === current}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.4 12 7.4h5.2l-4.2 3.2 1.6 5.2L10 13.2 5.4 15.8 7 10.6 2.8 7.4H8Z"/></svg></button>`;
      })
      .join('');
    this.innerHTML = `<div class="star-pick" role="group" aria-label="評価">${buttons}</div>`;
  }
}

export function defineStars(): void {
  if (!customElements.get('star-rating')) customElements.define('star-rating', StarRating);
}
