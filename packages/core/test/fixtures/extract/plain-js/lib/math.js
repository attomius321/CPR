export function add(a, b) {
  return a + b;
}

export class Counter {
  count = 0;
  increment() {
    this.count += 1;
  }
}
