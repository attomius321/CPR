import { View } from './framework';

@View({ template: './card.tpl', tags: ['card'] })
export class Card {
  title = 'Card';
  count = 0;

  increment(): void {
    this.count++;
  }

  reset(): void {
    this.count = 0;
  }

  label(): string {
    return `${this.title}: ${this.count}`;
  }
}
