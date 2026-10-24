import { closing, splitTopLevel, stringEnd } from './tokens.js';

/** A class a selector names, and whether it is on the element the rule styles. */
export interface SelectorClass {
  name: string;
  /** In the selector's last compound (`.row` in `.list .row:hover`), not an ancestor's. */
  subject: boolean;
}

const COMBINATOR = /[\s>+~]/;
const NAME_START = /[-_a-zA-Z\u00a0-\uffff\\]/;

/**
 * The classes of a canonical selector list, each once (on the subject if any selector puts it
 * there). A class inside `:not()` is not named (the element must lack it); inside `:has()` it is
 * a descendant's, not the subject's. Escapes are read (`.md\:flex` → `md:flex`); a selector with
 * SCSS interpolation names none.
 */
export function selectorClasses(selectors: string): SelectorClass[] {
  const found = new Map<string, boolean>();
  for (const selector of splitTopLevel(selectors, ',')) {
    if (selector.includes('#{')) continue;
    const subjectStart = lastCompound(selector);
    const pseudo: string[] = [];
    for (let i = 0; i < selector.length; i++) {
      const c = selector[i] as string;
      if (c === '\\') i++;
      else if (c === '"' || c === "'") i = stringEnd(selector, i);
      else if (c === '[') i = closing(selector, i, '[', ']');
      else if (c === '(') pseudo.push(/:([\w-]+)$/.exec(selector.slice(0, i))?.[1] ?? '');
      else if (c === ')') pseudo.pop();
      else if (c === '.' && NAME_START.test(selector[i + 1] ?? '')) {
        let name = '';
        let j = i + 1;
        for (; j < selector.length; j++) {
          const d = selector[j] as string;
          if (d === '\\') name += selector[++j] ?? '';
          else if (/[\w\-\u00a0-\uffff]/.test(d)) name += d;
          else break;
        }
        if (!pseudo.includes('not')) {
          const subject = i >= subjectStart && !pseudo.includes('has');
          found.set(name, (found.get(name) ?? false) || subject);
        }
        i = j - 1;
      }
    }
  }
  return [...found].map(([name, subject]) => ({ name, subject }));
}

/** Where a selector's last compound starts: after its last combinator outside brackets. */
function lastCompound(selector: string): number {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i] as string;
    if (c === '\\') i++;
    else if (c === '"' || c === "'") i = stringEnd(selector, i);
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && COMBINATOR.test(c)) start = i + 1;
  }
  return start;
}
