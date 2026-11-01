# AR1: counting Symbiote's own record

The scripts behind `docs/plan/ar1-activity-review.md`. They only read: a repository's `symbiote/`
folder, Claude Code's transcripts (`~/.claude/projects/`) and Symbiote's logs
(`~/.cache/symbiote/logs`). Their outputs hold the person's records: write them to the ignored
`coverage/activity-review/`, never to tracked files.

From the worktree's root:

```sh
O=coverage/activity-review; C=2026-11-01T08:09:44.594Z   # the export's time
node spikes/activity-review/transcripts.mjs $O/transcripts.json        # tokens, $ per request
node spikes/activity-review/load.mjs /home/anton/projects/Symbiote $O/transcripts.json $O/symbiote.json $C
node spikes/activity-review/analyze.mjs $O/symbiote.json spike/activity-review     # the counts by kind
node spikes/activity-review/phases.mjs $O/symbiote.json $O/transcripts.json spike/activity-review $C
node spikes/activity-review/briefs.mjs $O/symbiote.json /home/anton/projects/Symbiote spike/activity-review
node spikes/activity-review/prices.mjs   # Claude Code's own cost lines (a fit; ill-conditioned)
```

- `price-table.mjs`: API list prices; cache writes 1.25× input for 5 minutes, 2× for an hour.
- `trials/run.mjs`: one real `claude -p` run in a fresh clone, confined in Claude Code's sandbox
  (`acceptEdits`, Bash only in the sandbox). Keep the trial repository outside `~/.claude/`
  (edits there are refused as sensitive) and outside any folder whose `CLAUDE.md` would load.

The trials' repository is `trials/inventory.bundle` (`git clone trials/inventory.bundle <dir>`,
outside this repository): `main`, `feature/discount` (trial 1: a bug its check finds) and
`feature/discount-report` (trial 2: one real defect and a format change the person asked for
later). The prompts are in `trials/prompts/`: `t1-A` today's Hive words, `t1-B` the proposed ones;
`t2-*` the reviewer's prompt and system prompt, without and with the person's later words.

```sh
node spikes/activity-review/trials/run.mjs <clone> feature/discount spikes/activity-review/trials/prompts/t1-B.txt <out>
node spikes/activity-review/trials/run.mjs <clone> feature/discount-report spikes/activity-review/trials/prompts/t2-B.txt <out> --system spikes/activity-review/trials/prompts/t2-sys-B.txt --schema
```
