export function button(label: string, size: 'small' | 'large' = 'large'): string {
  return `<button class="${size}">${label}</button>`;
}
