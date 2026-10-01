export interface Shape {
  kind: string;
  size: number;
  color?: string;
}

export function area(shape: Shape): number {
  return shape.size * shape.size;
}

export function perimeter(shape: Shape): number {
  return shape.size * 4;
}

export function volume(shape: Shape): number {
  return shape.size ** 3;
}

export class Canvas {
  draw(shape: Shape): string {
    return `${shape.kind}:${area(shape)}`;
  }
}

export abstract class Tool {
  abstract use(): string;
}

export class Pen extends Tool {
  use(): string {
    return 'pen';
  }
}

export const tools = [new Pen()];
