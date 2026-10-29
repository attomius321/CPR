# The README

The README has two jobs. First, a visitor decides in a minute whether Symbiote is for them.
Second, they get to a first result within five minutes. Everything else is a link to a guide
or a reference page. The order below follows standard-readme and GitHub's guidance on READMEs,
with Diátaxis' kinds of page (SKILL.md) deciding what moves out.

## Its order

1. **The name and one sentence**: what Symbiote is, and who it is for.
2. **Why**: the problem it solves, in two or three sentences, and one screenshot of the result.
3. **Requirements**: the operating systems, Node and pnpm versions, and the agents it can start.
4. **Install**: commands to copy and paste, tested from a clean clone.
5. **Quick start**: the shortest path to the first success, and what the reader sees then.
6. **What you can do**: four to seven tasks, each in one or two sentences with a link to its
   guide (review a branch, start a workspace, merge, review a pull request, run in CI, use a
   framework plugin).
7. **Documentation**: links to the guides and the reference pages.
8. **Limits**: the languages it reads, the platforms it is tested on, what it does not do.
9. **Development**, for contributors (commands, the packages, where the plan and the journal
   are), and the **license**.

Name, sentence, screenshot and install fit the first screen. Reference tables (commands,
options, configuration keys, environment variables, keys, findings) and how-tos longer than a
few steps belong on their own pages.

## Pages beside it

Propose this layout to the person and **ask before creating it**. Where user docs live is their
decision, and links from the code and from other docs depend on it.

- `docs/guide/`: one how-to guide a task, named by the task (`review-a-branch.md`).
- `docs/reference/`: commands and options, configuration, environment variables, keys, findings.
- An explanation page for how the analysis works (symbols, references, findings), and one for
  how Symbiote confines its agents (what Nucleus and Scribe may run, what asks first).
- `docs/graph-schema.md` stays where it is: CLAUDE.md and the packages link it.

## The reader's questions (for the reader test)

1. What does Symbiote do, and does it work on my project (languages, platforms)?
2. What do I need installed, and how do I install it?
3. How do I see my branch's changes as a graph?
4. What does each finding mean, and what should I do about it?
5. How do I review a branch and send my verdict to the agent that wrote it?
6. How do I start a workspace with Claude Code or Codex?
7. What files does Symbiote write in my repository, and are they committed?
8. What does Symbiote send over the network?
9. How do I run it on pull requests in CI?
10. How do I turn off the intro, the usage bars or the agent's terminal?

## Rewriting it

```
- [ ] 1. Measure the current README (readability.mjs, --outline); keep the numbers
- [ ] 2. Inventory every fact it states (commands, flags, keys, variables, paths, behaviors):
         for each, kept in the README, moved to a page (which), or dropped (why). Nothing is
         lost without a reason
- [ ] 3. Check each fact kept or moved against the code (SKILL.md, "Check every fact")
- [ ] 4. Agree the layout of the pages with the person (above)
- [ ] 5. Write the README in its order, then the pages, each to SKILL.md's rules
- [ ] 6. Links: every relative link and anchor; the messages in the code that name a README
         section (grep -rn README packages/*/src, and their tests); links from other docs
- [ ] 7. Screenshots retaken if the views they show changed
- [ ] 8. Measure again; reader test with the questions above, on the README and each page
- [ ] 9. Record it (journal entry: the numbers before and after, the inventory's drops, the
         reader test's results, what was not verified)
```
