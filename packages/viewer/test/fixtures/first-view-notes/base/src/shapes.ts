export interface Shape {
  kind: string;
  size: number;
}

export function area(shape: Shape): number {
  return shape.size * shape.size;
}
