import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The stylesheet is in parts beside what they draw; src/styles.css lists them, and its order is
// the cascade (at equal specificity a later rule wins). A part imported by its own component
// would be placed by Vite in module-graph order instead, and rules could swap unseen.
const SRC = new URL('../src/', import.meta.url);
const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
  .map((file) => file.replaceAll('\\', '/'))
  .sort();
const read = (file: string) => readFileSync(new URL(file, SRC), 'utf8');

describe('the stylesheet’s parts', () => {
  const imported = [...read('styles.css').matchAll(/^@import '\.\/([^']+)';$/gm)].map((m) => m[1]);

  it('are all imported by styles.css, each once', () => {
    const parts = files.filter((file) => file.endsWith('.css') && file !== 'styles.css');
    expect([...imported].sort()).toEqual(parts);
  });

  it('are imported nowhere else: main.tsx imports styles.css, no module a part', () => {
    const local = files
      .filter((file) => /\.tsx?$/.test(file))
      .flatMap((file) =>
        [...read(file).matchAll(/import\s*\(?\s*['"](\.{1,2}\/[^'"]+\.css)['"]/g)].map(
          (m) => `${file}: ${m[1]}`,
        ),
      );
    expect(local).toEqual(['main.tsx: ./styles.css']);
  });
});
