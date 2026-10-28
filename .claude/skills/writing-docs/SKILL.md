---
name: writing-docs
description: "Writes and rewrites documentation that people understand on the first read: the README, user guides, reference pages, docs/graph-schema.md, and the prose of plans and journal entries the person reviews. Gives a standard built from plain-language guidance, Diátaxis and Google's developer documentation style guide (one reader and one task per page, the point first, short active sentences, every term defined once), the order of a README, a script that counts long and crowded sentences, a reader test by a fresh agent that has only the page, and the checks of every command, flag and key against the code. Use when writing, rewriting or reviewing the README or any Markdown page for people, when a change adds user-visible behavior to document, when docs are called hard to read, dense, too long or stale, or when asked for clearer or human-readable text. Not for code comments, commit messages, UI strings, or agent instructions (CLAUDE.md, AGENTS.md, SKILL.md)."
---

# Writing docs people understand

A page works when a reader who was not in the conversation can do the task, or answer the
question, from the page alone, on the first read. Agents fail this test in a known way. They
write for themselves: compressed, in the words of the code and of the conversation, with every
fact they found and no order. This skill is the standard for every Markdown page a person reads,
and the two tests that show whether a page meets it.

**Do not copy the prose around you.** Text written here before this skill does not meet it. This
is truest of the README, which the person wants rewritten in full ([readme.md](readme.md)). Keep
what CLAUDE.md asks of docs: measured numbers, no hype, and a note of what was not verified.

## Who reads what

| Page | Its reader | Kind (below) |
|---|---|---|
| `README.md` | Someone deciding whether to use Symbiote, then installing it and trying it | A short explanation, a tutorial (the quick start), links to the rest |
| User guides | A user with one task: review a branch, start a workspace, set up CI | How-to guide, one task a page |
| Commands, options, configuration, environment variables, keys, findings | A user looking one thing up | Reference |
| `docs/graph-schema.md` | A developer reading or writing the graph JSON | Reference (its version rules: `packages/core/CLAUDE.md`) |
| `docs/plan/<id>-<slug>.md` | The person, reviewing a plan they did not write | Explanation; sections from the `milestone` skill's `plan-template.md` |
| `docs/journal/` entries | A developer or agent who needs what was learned | Explanation; sections from `journal-template.md` |

Plans and journals keep their templates. The sentence and word rules below apply to them in full.

## One kind of page at a time (Diátaxis)

| Kind | The reader asks | It holds | It leaves out |
|---|---|---|---|
| Tutorial | "Can I get it working?" | One path, from nothing to a visible result; every step tested | Options, alternatives, reasons |
| How-to guide | "How do I do X?" | Numbered steps to one goal, conditions first, what the reader sees after each step | Teaching, internals |
| Reference | "What exactly does X do?" | Every command, flag or key, each with the same fields: what it does, its default, its limits | Steps, opinions |
| Explanation | "Why does it work this way?" | The model, the trade-offs, the design | Steps, full option lists |

Mixing kinds is the usual cause of a long, hard page: a how-to that stops to explain a cache, a
reference row that tells a story. Split the page and link the parts.

## Before writing

```
- [ ] 1. Name the reader and their task in one sentence ("A developer who has never run
         Symbiote wants to review their branch as a graph")
- [ ] 2. Pick the kind of page
- [ ] 3. Write down 5 to 10 questions the reader has, in their words. They become the
         headings and the reader test
- [ ] 4. Find each fact in the code or in a real run, not in a plan or an older doc
- [ ] 5. Write the outline, headings only. Read it on its own. Does it answer the questions in
         the order the reader has them?
```

Step 4 comes from a mistake made here. An earlier README printed a sample output copied from a
plan. Nothing regenerated it, and it was wrong (`docs/journal/chore-update-readme.md`).

## Pages and sections

- **The point first.** The page, each section and each paragraph open with what the reader most
  needs: what it is, or what to do. Details, exceptions and history come after.
- **Headings say what the reader finds there**, in the reader's words. A how-to's heading is a
  task with a verb ("Review a pull request"); a reference's is a noun ("Configuration keys").
  Sentence case, three levels at most. "Its terminal" says nothing on its own; "Answer the
  agent in its terminal" does.
- **Paragraphs hold one topic**, in 80 words or fewer. Wrap the source at 100 columns, like the
  rest of the repository's Markdown. Prettier does not format `*.md` here, so wrap by hand.
- **Numbered lists for steps in order**: one action a step, then what the reader sees. **Bullets
  for items in no order.** Introduce each list with a full sentence. Start every item the same
  way (all verbs, or all nouns). Reasons and trade-offs stay prose.
- **Tables for many items with the same fields** (options, keys, findings). A cell holds a
  phrase or one short sentence; anything longer gets a section and a link.
- **Conditions before instructions**: "To open the viewer in a browser, add `--browser`", not
  "Add `--browser` to open it in a browser".
- **The common case first.** Edge cases, platform notes and internals go in their own section
  or page, linked from where the reader would look for them.
- **Examples are real**: a command and the output it printed, run for the page. A screenshot
  shows the state the text describes.
- **Edit in place.** A new behavior goes where the reader needs it, and the section is reread as
  a whole. An appended paragraph keeps every fact and loses the order. That is how the README
  grew past a thousand lines.

## Sentences

Aim for 15 to 20 words a sentence on average. Split any sentence over 25 words, unless it is a
list or a definition that cannot be split.

- **One idea a sentence.** A colon introduces a list, an example or a definition. A semicolon is
  rare. Neither stands in for "and", "so", "because" or "then".
- **Name the actor, in the active voice**: "Symbiote writes the review to …", not "the review is
  written to …".
- **Talk to the reader as "you"**, in the present tense, and use the imperative for steps.
- **Repeat the noun.** Use "it", "its", "they" or "one" only when the noun it stands for is in the
  same sentence. Undo chains of possessives: "the workspace's agent's first prompt" becomes "the
  first prompt Symbiote gives the workspace's agent".
- **Keep the small words.** Do not drop articles, verbs or "that" to save space. Telegraphic
  prose is the agents' habit and the reader's main obstacle.
- **One aside a sentence, in brackets or between dashes**, a few words long. Never brackets inside
  brackets. A longer aside is a sentence of its own.
- **Say a condition with "if"**, and the other case with "otherwise" or "if not". "Else" is code.
- **Be exact with numbers**: digits and units ("about 5 s", "100 MB"), measured, not adjectives.
- **No filler or hype**: "simply", "just", "easily", "seamless", "powerful", "robust". None of
  the habits that mark machine-written text: "it's not X, it's Y", triplets for rhythm, a closing
  line that repeats the section, emoji in headings.

| Before | After | Rule |
|---|---|---|
| Its model is the project's when the conversation's agent lists it, else the agent's own. | Scout starts on the model set in **Settings**. If the agent does not offer that model, Scout uses the agent's default. | Name the actor; "if" and "otherwise"; no possessive chain |
| A failed check does not take Approve away: the page says which commands passed; the log has their output. | You can approve a merge even when its check fails. The page lists the commands that passed and failed, and the log shows their output. | One idea a sentence; no colon or semicolon for "and" |
| The records (`symbiote/features/` before V25) | The records are in `symbiote/workspaces/`. (Older versions: one line in an "Upgrading" section.) | No milestone IDs in user docs |
| The list comes from the SDK's `initialize` answer, cached for a day. (In a how-to.) | Pick a model from the list. It shows the models your agent offers. | A how-to says what the reader does and sees; internals go elsewhere |
| The merger resolves it. (First mention.) | Symbiote gives the conflict to the *merger*, an agent that proposes a resolution for each conflicting region. You review the resolution before it lands. | Define a term where the reader first meets it |
| Add `--browser` to use a browser tab instead of Symbiote's window, when the app is set up. | If you set up the desktop app, `symbiote view` opens in Symbiote's window. To use a browser tab instead, add `--browser`. | Condition first; the common case first |

## Words

- **Plain words**: "use", not "utilize"; "to", not "in order to"; "before", not "prior to";
  "for example", not "e.g."; "that is", not "i.e."; "through" or "with", not "via".
- **Define each term where the reader first meets it**, or link to its definition. Symbiote's
  own terms need it: symbol, change, finding, context (the unchanged callers and callees), map,
  workspace, worktree, brief, thread, review, verdict, merger, Scout, Scribe, plugin, forge.
- **One word for one thing**, everywhere. A workspace was called a "feature" until V25
  (`docs/journal/chore-workspaces-term.md`), and both words are still in places. Pick the
  current one and keep it; do not switch to a synonym for variety.
- **No internal IDs in user docs.** Milestone IDs (V25, MC1) and decision numbers mean nothing to
  a user: say what changed, or leave it out. Plans and journals may use IDs, with a few words of
  what each is the first time.
- **Formatting has one meaning each.** `Code` for commands, flags, paths, keys, variables and
  output; **bold** for an on-screen label, as the screen writes it (**Merge into**); keys as
  written on the keyboard (Ctrl+Enter, Esc). Link text names its target
  (`the [graph schema](docs/graph-schema.md)`), never "here".

## Check every fact against the code

The earlier README rewrite checked these with a script it did not keep
(`docs/journal/chore-update-readme.md`). Check the same for any page:

- **Commands and flags**: `pnpm build`, then `node packages/cli/dist/bin.js <command> --help`.
- **Configuration keys and environment variables**: find each where the code reads it
  (`grep -rn 'SYMBIOTE_TERMINAL' packages/*/src`), with its default.
- **The GitHub Action's inputs**: `action.yml`. **The GitLab template**: `ci/gitlab/symbiote.yml`.
- **Sample output**: a real run, for example `symbiote diff` on a fixture, pasted as printed.
- **Links and anchors**: each relative link points to a file that exists, and each `#anchor` to
  a heading. GitHub makes an anchor from a heading in lowercase, spaces as hyphens, punctuation
  dropped: "Symbiote's window" is `#symbiotes-window`.
- **Text that points into the docs**: messages in the code name the README's sections ("see
  Symbiote's window in the README", in `packages/cli/src/main.ts`, `app.ts` and
  `packages/cli/test/app.test.ts`). Moving or renaming a section changes them:
  `grep -rn README packages/*/src`.
- **Screenshots**: `docs/images/`, at 1440 × 900 from a fresh build, with nothing personal in
  them. For workspaces, use the e2e suite's fake agent (`serveWorkspaces` in
  `packages/viewer/e2e/symbiote.ts`); `shots.mjs` in the `symbiote-style` skill takes the pages.

## Measure the prose

[readability.mjs](readability.mjs) counts what the rules above are about. It leaves out code,
inline code, tables, link targets and front matter.

```sh
node .claude/skills/writing-docs/readability.mjs README.md docs/graph-schema.md
node .claude/skills/writing-docs/readability.mjs README.md --outline      # the headings, indented
git show main:README.md | node .claude/skills/writing-docs/readability.mjs -   # main's, to compare
```

For each file: words a sentence (average, median, 90th percentile), the sentences over `--max`
words (default 25), sentences with two or more asides in brackets, three or more possessives,
or two or more colons and semicolons inside, and paragraphs over 80 words. Then the longest
sentences with their line numbers (`--top`, default 15).

Targets: an average of 20 words or fewer; no sentence over 40 words. Every sentence the script
lists is one to reread, not an automatic fix. The script measures length, not sense. The reader
test decides.

## Reader test

This is Anthropic's "reader testing", from the `doc-coauthoring` skill in its public skills
repository. A fresh agent reads the page with no other context, the way a person meets it.

1. **Take the reader's questions** from "Before writing", step 3. Write down the right answer to
   each, from the code.
2. **Ask a fresh agent**: a subagent, or a new session that has not seen the work. Paste the
   page into its prompt and tell it to use no tools, so that it answers from the page and not
   from the code:

   ```
   You are reading a page of Symbiote's documentation for the first time. Use no tools, and
   nothing you know about Symbiote beyond this page. For each question, answer from the page and
   quote the sentence you used; if the page does not say, answer "guessed" with what you assumed,
   or "not on the page". Then list every term the page uses before it explains it, every sentence
   you had to read twice (quote it), and what you would do first after reading.

   Questions:
   1. …

   The page:
   <the page's text>
   ```

3. **Score it.** A wrong answer or a guess means the sentence it quoted misleads: rewrite that
   sentence. "Not on the page", for a question the reader has, means the page is missing it. Each
   term used before it is explained gets a definition. Each sentence read twice gets rewritten.
4. **Test again with a new agent** after the fixes: the first one has learned the page. The page
   passes when every answer is right and quoted.
5. **Skim test**: read only the headings and the first sentence of each paragraph
   (`--outline` for the headings). They should tell the page's story on their own.

Then give the page to the person, with the questions, the test's results and the numbers.

## Checklist (writing or rewriting a page)

```
- [ ] 1. Before writing: the reader, the kind of page, the questions, the facts, the outline
- [ ] 2. Measure the current page (readability.mjs), if there is one
- [ ] 3. Write it: pages and sections, sentences, words (above)
- [ ] 4. Check every fact against the code; links, anchors, and messages that name a section
- [ ] 5. Measure again; reread every sentence it lists
- [ ] 6. Reader test until every answer is right; skim test
- [ ] 7. Record it as CLAUDE.md's docs workflow says (journal entry: the numbers before and
         after, the reader test's questions and results, what was not verified)
```

## Sources

The rules above are condensed from these, which say more:

- Diátaxis, the four kinds of documentation: diataxis.fr
- Google developer documentation style guide: developers.google.com/style
- Microsoft Writing Style Guide: learn.microsoft.com/style-guide
- Plain-language guidance: the US Federal Plain Language Guidelines (plainlanguage.gov), and
  GOV.UK's content design guidance (gov.uk/guidance/content-design), which keeps sentences
  to 25 words
- Anthropic's skills repository, `doc-coauthoring` (reader testing): github.com/anthropics/skills
- standard-readme, the sections of a README: github.com/RichardLitt/standard-readme
- Wikipedia's "Signs of AI writing", for the habits of machine-written text
