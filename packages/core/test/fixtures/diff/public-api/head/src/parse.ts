export function parse(input: string, separator: string): string[] {
  return input.split(separator);
}

export class Parser {
  run(input: string): string[] {
    return parse(input, ',');
  }
}

export function internalHelper(value: string, lower: boolean): string {
  return lower ? value.trim().toLowerCase() : value.trim();
}
