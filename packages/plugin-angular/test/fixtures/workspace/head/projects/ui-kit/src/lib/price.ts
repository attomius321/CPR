export function price(amount: number, currency = 'EUR'): string {
  return `${amount.toFixed(2)} ${currency}`;
}
