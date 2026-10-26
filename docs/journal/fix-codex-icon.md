# Journal: Fix — Codex's mark is OpenAI's blossom, in OpenAI's white or black

[Index](../JOURNAL.md)

## Fix — Codex's mark is OpenAI's blossom, in OpenAI's white or black (2026-10-27, branch `fix/codex-icon`)

The person: "Right now, we use the real codex icon, might be nicer if we use the openai icon for
the agent icon"; on the plan, "Use the icon as it is", then: OpenAI's own colours, black on the
light theme and white on the dark.

**Before**: `CodexMark` (`ui/icons.tsx`, V53) drew the Codex CLI's mark from Lobe Icons in its
violet-to-blue gradient (`#b1a7ff` → `#3941ff`), each copy with a gradient of its own (`useId`).
It is drawn on a working Codex workspace's row and its heading (`WorkspaceFacts.tsx`).

**The fix**: `CodexMark` draws OpenAI's blossom from Simple Icons (CC0, the source of Claude's
spark), unchanged, filled with a new token `--openai`: `#ffffff` in the dark theme, `#000000` in
the light and the system's light. Its name and tooltip stay "Codex": the agent is still Codex.
No gradient, so no `useId`; Hermes keeps its own.

**Learned**: OpenAI's mark has no colour of its own, only black or white; a fixed fill would
vanish on one of the themes, so it is a token per theme like the rest of the look.

**Verification**: `test/icons.test.ts`, 2 tests, both red on `main` (the Lobe path, the gradient,
no `--openai`), green after. `e2e/codex.spec.ts`'s mark test now asks for both marks filled
`rgb(255, 255, 255)` on the dark theme; `codex.spec.ts` and `workspaces.spec.ts` 52 of 52.
`pnpm check` 1,883 of 1,883; `pnpm build`. Screenshots of a working Codex workspace at
1280 × 720, dark and light: the blossom white on dark, black on light, at 14 px beside "Thinking".

Not verified: the full `pnpm test:e2e` (only the two specs that draw the mark).
