import type { ReactNode } from 'react';
import {
  AlertIcon,
  DoneIcon,
  FailedIcon,
  HexagonIcon,
  IdleIcon,
  RunningIcon,
  StoppedIcon,
  WaitingIcon,
} from './icons.js';

/**
 * A state's tone (V88, decision 813), the same in both modes: in progress or the agent's turn
 * (`run`, amber), passed (`ok`), failed or stopped (`error`), paused (`info`), not run (`idle`), the
 * person's turn (`you`, violet), a real warning, and Hive's own (`hive`, its identity).
 */
export type StatusTone = 'run' | 'ok' | 'error' | 'info' | 'idle' | 'you' | 'warning' | 'hive';

const ICONS: Record<StatusTone, () => ReactNode> = {
  run: RunningIcon,
  ok: DoneIcon,
  error: FailedIcon,
  info: StoppedIcon,
  idle: IdleIcon,
  you: WaitingIcon,
  warning: AlertIcon,
  hive: HexagonIcon,
};

/**
 * A status (V88, decision 817; the kits' `.pill`): its icon and its word, tinted in its tone's
 * colour, never the colour alone (`ui/status.css`). `className` is the place's own, for its rules
 * and its tests.
 */
export function StatusLabel({
  tone,
  icon,
  className,
  children,
}: {
  tone: StatusTone;
  /** In place of the tone's own icon. */
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const Icon = ICONS[tone];
  return (
    <span className={className ? `status-label ${className}` : 'status-label'} data-tone={tone}>
      {icon ?? <Icon />}
      <span className="status-word">{children}</span>
    </span>
  );
}
