import { useState } from 'react';
import type { Notice } from './shell-context.js';

/**
 * The shell's status bar (V29a): on the left the last thing said (a start, a checkout, an
 * error), until the next; the right is for each subscription's usage (V29c).
 */
export function StatusBar({ notice }: { notice: Notice | null }) {
  return (
    <footer className="statusbar" aria-label="Status bar">
      {notice && <NoticeLine key={`${notice.text}\n${notice.copy ?? ''}`} notice={notice} />}
    </footer>
  );
}

function NoticeLine({ notice }: { notice: Notice }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const said = [notice.text, notice.warning].filter(Boolean).join(' · ');
  return (
    <p
      className={`statusbar-notice${notice.error ? ' error' : ''}`}
      role={notice.error ? 'alert' : 'status'}
      title={said}
    >
      {notice.text}
      {notice.warning && <span className="warning"> · {notice.warning}</span>}
      {notice.copy !== undefined && (
        <>
          {' '}
          <button
            type="button"
            className="link"
            onClick={() => {
              navigator.clipboard
                .writeText(notice.copy ?? '')
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            {copied === null ? 'Copy the prompt' : copied ? 'Copied' : 'Could not copy'}
          </button>
        </>
      )}
    </p>
  );
}
