import type { AgentChip } from './workspaces.js';
/** A workspace's mark (V18b): what its agent is doing, a link to the workspace. */
export function WorkspaceMark({ chip }: { chip: AgentChip & { href: string } }) {
  return (
    <a
      className={`workspace-mark workspace-mark-${chip.tone}`}
      href={chip.href}
      title={chip.title}
      aria-label={chip.title}
      onClick={(event) => event.stopPropagation()}
    >
      {chip.mark}
    </a>
  );
}
