export function add(a: number, b: number, c = 0): number {
  return a + b + c;
}

export function triple(a: number): number {
  return add(a, a, a);
}
