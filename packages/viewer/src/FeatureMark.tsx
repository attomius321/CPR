import type { AgentChip } from './features.js';
/** A feature's mark (V18b): what its agent is doing, a link to the feature. */
export function FeatureMark({ chip }: { chip: AgentChip & { href: string } }) {
  return (
    <a
      className={`feature-mark feature-mark-${chip.tone}`}
      href={chip.href}
      title={chip.title}
      aria-label={chip.title}
      onClick={(event) => event.stopPropagation()}
    >
      {chip.mark}
    </a>
  );
}
