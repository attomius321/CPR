export interface Shape {
  kind: string;
  size: number;
}

export function area(shape: Shape): number {
  return shape.size * shape.size;
}

export class Canvas {
  draw(shape: Shape): string {
    return `${shape.kind}:${area(shape)}`;
  }

  clear(): void {}
}

export abstract class Tool {
  abstract use(): string;
}
