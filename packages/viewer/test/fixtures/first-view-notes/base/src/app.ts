import { area, type Shape } from './shapes';

export function report(shape: Shape): string {
  return `${shape.kind}: ${area(shape)}`;
}
