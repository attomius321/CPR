import { price } from 'ui-kit';

export function report(total: number): string {
  return `Total: ${price(total)}`;
}
