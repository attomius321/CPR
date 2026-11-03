// The kits' figures and gauge (V91, decision 858; `ui/figures.css`): a number with its label, a
// note and, for a count by day, the week's bars; how much of a limit is used.
import type { ReactNode } from 'react';

/** A figure: its icon and label, its number (and a smaller unit), a note under it. */
export function Figure({
  icon,
  label,
  value,
  unit,
  note,
  bars,
  className,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  unit?: ReactNode;
  note?: ReactNode;
  /** A count on each of the week's days, today the last. */
  bars?: readonly number[];
  className?: string;
}) {
  return (
    <div className={className ? `figure ${className}` : 'figure'} role="group" aria-label={label}>
      <div className="figure-label">
        {icon}
        {label}
      </div>
      <div className="figure-value">
        <span className="figure-number">{value}</span>
        {unit !== undefined && <small>{unit}</small>}
        {bars && <DayBars counts={bars} />}
      </div>
      {note !== undefined && <div className="figure-note">{note}</div>}
    </div>
  );
}

/** The week's counts as bars, the highest full height, today's last and in green. */
export function DayBars({ counts }: { counts: readonly number[] }) {
  const most = Math.max(1, ...counts);
  return (
    <span
      className="figure-bars"
      role="img"
      aria-label={`By day, the last ${counts.length}: ${counts.join(', ')}`}
    >
      {counts.map((count, i) => (
        <i
          key={i}
          className={i === counts.length - 1 ? 'today' : undefined}
          style={{ height: `${Math.round((count / most) * 100)}%` }}
        />
      ))}
    </span>
  );
}

/** How much is used, in percent; `mark`, where a limit is (Hive's pause, decision 797). */
export function Gauge({
  percent,
  mark,
  tone,
  label,
}: {
  percent: number;
  mark?: number;
  /** As the status bar's usage (V29c): amber from 80 % or when warned, red at a limit. */
  tone?: 'ok' | 'high' | 'full';
  label: string;
}) {
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  return (
    <div
      className={`gauge${tone ? ` tone-${tone}` : ''}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamp(percent))}
    >
      <i style={{ width: `${clamp(percent)}%` }} />
      {mark !== undefined && <b style={{ left: `${clamp(mark)}%` }} />}
    </div>
  );
}
