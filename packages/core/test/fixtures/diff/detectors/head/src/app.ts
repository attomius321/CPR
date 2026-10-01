import { Canvas } from './shapes';

export function render(): string {
  const canvas = new Canvas();
  canvas.clear();
  return canvas.draw({ kind: 'square', size: 2 });
}
