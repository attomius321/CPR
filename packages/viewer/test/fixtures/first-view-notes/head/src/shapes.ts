export interface Shape {
  kind: string;
  size: number;
  color?: string;
}

export function area(shape: Shape): number {
  return Math.abs(shape.size * shape.size);
}

export function volume(shape: Shape): number {
  return shape.size ** 3;
}
