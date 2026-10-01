export function add(a: number, b: number): number {
  return a + b;
}

export function legacy(): number {
  return add(1, 2);
}
