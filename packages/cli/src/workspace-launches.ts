// The workspaces whose Claude Code agent this process is launching (fix/e2e-flakes). Its record is
// written before `claude --bg` runs, for the session's first hooks, and Claude Code lists the
// session only once `--bg` has started it: a read meanwhile, or one that began before the launch
// ended (its sessions read before the session was listed), would say "No agent" or "Not running"
// of an agent being started, and its card jumped to Not running and back.

export interface WorkspaceLaunches {
  /** A launch begins; the way to say it ended, whatever its outcome. */
  begin(branch: string): () => void;
  /** Where a read begins: `since` tells it which launches it may have seen half done. */
  mark(): number;
  /** Whether `branch`'s agent is being launched, or its launch ended after `from` was marked. */
  since(branch: string, from?: number): boolean;
}

export function workspaceLaunches(): WorkspaceLaunches {
  /** The launches under way, by branch: how many (a restart while one starts is refused later). */
  const under = new Map<string, number>();
  /** Each branch's last launch's end, on a count of ends: no clock to go back. */
  const ended = new Map<string, number>();
  let ends = 0;
  return {
    begin(branch) {
      under.set(branch, (under.get(branch) ?? 0) + 1);
      let done = false;
      return () => {
        if (done) return;
        done = true;
        const left = (under.get(branch) ?? 1) - 1;
        if (left > 0) under.set(branch, left);
        else under.delete(branch);
        ends += 1;
        ended.set(branch, ends);
      };
    },
    mark: () => ends,
    since(branch, from) {
      if (under.has(branch)) return true;
      return from !== undefined && (ended.get(branch) ?? -1) > from;
    },
  };
}
