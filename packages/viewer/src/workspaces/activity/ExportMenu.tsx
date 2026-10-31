// Export on an Activity tab's bar (V84, decision 672): the activity as Symbiote's server makes it
// (`/api/…/activity/export`), saved as Markdown or JSON Lines, or its Markdown copied to paste
// into an agent's chat. The same on a workspace's tab, History's and Nucleus's.
import { useEffect, useRef, useState } from 'react';
import { CheckIcon, DownloadIcon } from '../../ui/icons.js';
import { tip } from '../../ui/tip.js';

/** How long "Copied" stays on the button. */
const SAID_MS = 2500;

/** `from` with the format asked: Markdown, or JSON Lines. */
export const exportAddress = (from: string, format: 'markdown' | 'jsonl') =>
  `${from}${from.includes('?') ? '&' : '?'}format=${format}`;

/**
 * The Markdown to the clipboard. Written as a promised item while it is read, so the click's
 * permission holds; a browser that takes no promised item is given the text once read.
 */
async function copyFrom(address: string): Promise<void> {
  const read = fetch(address).then(async (response) => {
    if (!response.ok) throw new Error((await response.text()) || response.statusText);
    return response.text();
  });
  if (typeof ClipboardItem !== 'undefined') {
    try {
      const blob = read.then((text) => new Blob([text], { type: 'text/plain' }));
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      return;
    } catch {
      // A failed read throws again below.
    }
  }
  await navigator.clipboard.writeText(await read);
}

/** Export's button and menu; `from`, the export's address without its format. */
export function ExportMenu({ from }: { from: string }) {
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  useEffect(() => {
    if (!said) return;
    const timer = setTimeout(() => setSaid(null), SAID_MS);
    return () => clearTimeout(timer);
  }, [said]);

  const copy = () => {
    setOpen(false);
    copyFrom(exportAddress(from, 'markdown')).then(
      () => setSaid('Copied'),
      () => setSaid('Could not copy'),
    );
  };
  return (
    <div className="more-actions activity-export" ref={box}>
      <button
        type="button"
        className="button ghost activity-export-button"
        aria-haspopup="menu"
        aria-expanded={open}
        {...tip('Export this activity: Markdown for you or an agent, JSON Lines for a script')}
        onClick={() => setOpen((o) => !o)}
      >
        {said === 'Copied' ? <CheckIcon /> : <DownloadIcon />}
        <span className="activity-export-label" aria-live="polite">
          {said ?? 'Export'}
        </span>
      </button>
      {open && (
        <div className="more-menu" role="menu" aria-label="Export">
          <a
            role="menuitem"
            href={exportAddress(from, 'markdown')}
            download
            onClick={() => setOpen(false)}
          >
            Download Markdown
          </a>
          <a
            role="menuitem"
            href={exportAddress(from, 'jsonl')}
            download
            onClick={() => setOpen(false)}
          >
            Download JSON Lines
          </a>
          <button type="button" role="menuitem" onClick={copy}>
            Copy Markdown
          </button>
        </div>
      )}
    </div>
  );
}
