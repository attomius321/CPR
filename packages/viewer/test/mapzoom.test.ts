import { describe, expect, it } from 'vitest';
import { MAP_ZOOM, nextMapZoom } from '../src/mapzoom.js';

describe('nextMapZoom', () => {
  it('writes the zoom on the map, once per value', () => {
    expect(nextMapZoom(0.2, undefined)).toBe(0.2);
    expect(nextMapZoom(0.1, 0.2)).toBe(0.1);
    expect(nextMapZoom(0.1, 0.1)).toBeUndefined();
  });

  it('writes nothing off the map, where no label reads it', () => {
    expect(nextMapZoom(MAP_ZOOM, undefined)).toBeUndefined();
    expect(nextMapZoom(1.1, 0.3)).toBeUndefined();
    // Back on the map at another zoom: written again.
    expect(nextMapZoom(0.3, 0.2)).toBe(0.3);
  });
});
