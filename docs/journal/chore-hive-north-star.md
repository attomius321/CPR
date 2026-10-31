# Journal: Hive's North Star — two modes

[Index](../JOURNAL.md) · [Plan](../plan/hv1-hive-graph.md#chore-hives-north-star-chorehive-north-star)

## Hive's North Star: human-centric and fully autonomous (2026-10-31, branch `chore/hive-north-star`)

Symbiote had one North Star, "review decisions, not lines", written for a person who decides. Hive
already runs the other way: HV2 and HV3 drive a workspace through the writer, the check and the
running reviewer, and only Land waits for the person (decision 681). The person: normal mode keeps
the human in the loop; Hive mode "should be a fully autonomous machine, with agent graphs, loops",
and "the mode splitting should be clear for the agents".

What changed, docs only:

- `docs/PLAN.md` states two North Stars. Normal mode's text is word for word as before. Hive mode:
  goals in, verified work landed, with its own tie-breakers (proven beats claimed, stopping beats
  guessing, recorded beats silent, within limits beats faster).
- `CLAUDE.md` names both modes and says which rules are which mode's. "Ask before merging into
  `main`" and "push as you go" are normal mode's. In a Hive workspace, Hive decides landing and,
  from HV4, pushes only the workspace's branch.
- Decisions 688–692 in HV1's plan: the two modes; no step waits for the person in Hive mode (651's
  gates replaced for Hive only); Hive's hard limits; 649 stands until a rigorous measurement;
  Alpha Ceph orchestrates the graph.
- The Hive milestones, as planned rows in the order they are built: HV4 autonomous landing, HV5
  usage pacing, HV6 the measurement (a spike), HV7 the graph.

The person's answers to the plan:

- IDs in the order the milestones are built. HV1 had named the graph HV4; it is HV7 now. HV2's,
  HV3's and V82's plans say HV7 where they meant the graph. HV5 keeps its number.
- Hive pushes only the workspace's branch, never `main`, for now.
- Never force-push and never delete unmerged work stay hard limits in Hive mode.
- The decisions live in a section of HV1's plan; a chore has no plan of its own.

Left as they are: code, prompts and the viewer's text. The text that says landing is the person's
is listed in HV4's row: Settings' Hive page (`HivePage.tsx:61–65`, `:150–153`), README's Hive
part, `configuration.md`'s Hive mode and the agents' prompts (`prompts.ts`). Also left as they
are: decision 119 in `design.md` ("the North Star is unchanged"), which is dated history, and the
`milestone` skill's "ask before merging", which is normal mode's.

**Verification**: decision numbers rechecked on `main`, every local and remote branch and every
worktree: the highest in use was 687, and each of 688–692 is used once. Normal mode's North Star
text is identical to `main`'s. `pnpm check` passes. No code changed: no build, e2e or regression
sets run for this change; Hive's check runs them on the branch.
