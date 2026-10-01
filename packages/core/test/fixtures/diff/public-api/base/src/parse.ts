export function parse(input: string): string[] {
  return input.split(',');
}

export class Parser {
  run(input: string): string[] {
    return parse(input);
  }

  reset(): void {}

  private cache(): void {}
}

export function internalHelper(value: string): string {
  return value.trim();
}
