import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CodexMark } from '../src/ui/icons.js';

const css = readFileSync(new URL('../src/ui/base.css', import.meta.url), 'utf8');

/** The value `token` takes in the first block whose selector is `selector`. */
function token(selector: string, name: string): string | undefined {
  const at = css.indexOf(`${selector} {`);
  const body = css.slice(at, css.indexOf('}', at));
  return new RegExp(`${name}:\\s*([^;]+);`).exec(body)?.[1]?.trim();
}

describe("Codex's mark", () => {
  const svg = renderToStaticMarkup(createElement(CodexMark));

  it("is OpenAI's blossom (Simple Icons'), still named Codex", () => {
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Codex"');
    expect(svg).toContain('d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108');
    expect(svg).not.toContain('linearGradient');
  });

  it("is in OpenAI's own colours: white in the dark theme, black in the light", () => {
    expect(svg).toContain('fill="var(--openai)"');
    expect(
      token(":root,\n:root[data-theme='dark'],\n:root[data-hive] .sidenav,\n.hive-ink", '--openai'),
    ).toBe('#ffffff');
    expect(token(":root[data-theme='light']", '--openai')).toBe('#000000');
    expect(token("  :root[data-theme='system']", '--openai')).toBe('#000000');
  });
});
