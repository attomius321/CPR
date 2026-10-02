import { View } from './framework';

@View({ template: './card.tpl', tags: ['card', 'panel'] })
export class Card {
  title = 'Card';
  count = 0;

  onStart(): void {
    this.count = 1;
  }

  increment(): void {
    this.count++;
  }

  double(): void {
    this.count *= 2;
  }

  label(): string {
    return `${this.title}: ${this.count}`;
  }
}
