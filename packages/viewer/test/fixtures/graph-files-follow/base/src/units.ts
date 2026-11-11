export const INCH = 2.54;

export function toInches(cm: number): number {
  return cm / INCH;
}

export function toCentimetres(inches: number): number {
  return inches * 2.54;
}
