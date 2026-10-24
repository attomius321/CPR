import { closing, splitTopLevel, stringEnd } from './tokens.js';

/** A class a selector names, and whether it is on the element the rule styles. */
export interface SelectorClass {
  name: string;
  /** In the selector's last compound (`.row` in `.list .row:hover`), not an ancestor's. */
  subject: boolean;
}

const COMBINATOR = /[\s>+~]/;
const NAME_START = /[-_a-zA-Z\u00a0-\uffff\\]/;

/** What one selector of a list needs: every class it names, and those on its subject. */
export interface SelectorPart {
  classes: string[];
  subject: string[];
}

/**
 * The classes of a canonical selector list, each once (on the subject if any selector puts it
 * there). A class inside `:not()` is not named (the element must lack it); inside `:has()` it is
 * a descendant's, not the subject's. Escapes are read (`.md\:flex` → `md:flex`); a selector with
 * SCSS interpolation names none.
 */
export function selectorClasses(selectors: string): SelectorClass[] {
  const found = new Map<string, boolean>();
  for (const part of selectorParts(selectors)) {
    for (const name of part.classes) {
      found.set(name, (found.get(name) ?? false) || part.subject.includes(name));
    }
  }
  return [...found].map(([name, subject]) => ({ name, subject }));
}

/**
 * Every class a selector list names, also inside `:not()` and `:has()`: a class its rules still
 * style by its absence (`.button:not(.primary)`) still matters to the look.
 */
export function selectorNames(selectors: string): string[] {
  const names = new Set<string>();
  for (const part of selectorParts(selectors, true))
    for (const name of part.classes) names.add(name);
  return [...names];
}

/** Each selector of a list with the classes it needs (see `selectorClasses`). */
export function selectorParts(selectors: string, negated = false): SelectorPart[] {
  const parts: SelectorPart[] = [];
  for (const selector of splitTopLevel(selectors, ',')) {
    if (selector.includes('#{')) continue;
    const classes = new Set<string>();
    const subjects = new Set<string>();
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
        if (negated || !pseudo.includes('not')) {
          classes.add(name);
          if (i >= subjectStart && !pseudo.includes('has')) subjects.add(name);
        }
        i = j - 1;
      }
    }
    if (classes.size > 0) parts.push({ classes: [...classes], subject: [...subjects] });
  }
  return parts;
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
