# Chore — commands.md: Enter on a nexus folder

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding N5)

**Status:** planned (2026-11-06), to be built on branch `chore/nexus-keys-doc` in its own
workspace; written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** chore · **Branch** `chore/nexus-keys-doc` · **Size** S · **Depends on** none · **Plan**
P42 of 51 (the audit's order)

## The brief

**What to change**: `docs/reference/commands.md:184` says Enter "opens the picked repository (or
shows its tab, or goes into a folder)". Since NX6, Enter on a folder opens it: a repository's
Symbiote starts, and a plain folder is offered `git init` after a question. Going into a folder is
→. Rewrite the sentence to say what the page does.

**Where to look**:
- `docs/reference/commands.md:181-186`, the nexus's keys.
- The code it describes: `packages/nexus/src/page/main.ts:806-819` (`act`: a tab shown, a
  repository opened, a folder opened or asked about; home, `/` and a drive: nothing),
  `:956-977` (the field's keys: Enter calls `act`).
- The README already says it right: `README.md:429-430`.
- Decisions 913 and 927 (`docs/plan/nx6-nexus-explorer.md`).

**Out of scope**: the nexus's behaviour; the README; the other keys of the paragraph (they match
the code: ↑ ↓, Page Up/Down by ten, Esc, Tab, →, Backspace after `/`).

**Done when**: the sentence reads, in the page's words, "Enter opens the picked row: a running
Symbiote's tab, a repository's Symbiote, or a folder (one that is no repository is made one with
`git init` after you say yes)". Every key in the paragraph is checked against `main.ts:956-1010`.

## Evidence

**Code**: `act()` (`main.ts:807-819`) opens a folder with `openSymbiote(row)` when
`refusedFor(row.path) === null`; nothing in it goes into a folder. → is handled in the field's
keys. The audit's ops review found the line; read again for this plan.

## Approach

Edit the one sentence; read the rest of the paragraph against the key handler in the same commit.
Follow the `writing-docs` skill (short sentences, the page's words).

## Tests first

None: a docs change. The behaviour is covered by `packages/nexus/e2e/explorer.spec.ts` and
`list.spec.ts`.

## Verification

- Grep the page's key handler for each key the paragraph names.
- `pnpm check` (Markdown is not formatted by Prettier here; it must still pass).
