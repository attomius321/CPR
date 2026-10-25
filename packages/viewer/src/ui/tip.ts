/** Where a tooltip goes (V54): beside the sidenav, under the title bar, above anything else. */
export type TipSide = 'top' | 'bottom' | 'right';

/** A state's colour, as a dot before a tooltip's words. */
export type TipTone = 'ok' | 'bad' | 'warn' | 'info';

export interface TipOptions {
  /** The keys that do the same, drawn as caps: `h`, `Ctrl+S`, `Alt+←`. */
  keys?: string | undefined;
  side?: TipSide | undefined;
  tone?: TipTone | undefined;
  /** Code that is not on screen (an id, a path, a SHA, a command): in Geist Mono. */
  code?: boolean | undefined;
}

export interface TipAttributes {
  'data-tip'?: string;
  'data-tip-keys'?: string;
  'data-tip-side'?: TipSide;
  'data-tip-tone'?: TipTone;
  'data-tip-code'?: '';
}

/**
 * What gives an element a tooltip (V54, decision 397), drawn by `Tooltips`: its text, a line per
 * `\n` (the first its head, the rest muted), and the keys, side, tone or code font asked. No text,
 * no tooltip. A text that is the element's own shows only when the element cuts it.
 */
export function tip(text: string | undefined, options: TipOptions = {}): TipAttributes {
  if (!text) return {};
  return {
    'data-tip': text,
    ...(options.keys ? { 'data-tip-keys': options.keys } : {}),
    ...(options.side ? { 'data-tip-side': options.side } : {}),
    ...(options.tone ? { 'data-tip-tone': options.tone } : {}),
    ...(options.code ? { 'data-tip-code': '' as const } : {}),
  };
}
