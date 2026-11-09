// A run of calls as a group (V73, decision 518): its title, its words (the files edited, the pages
// read, the tests run), its status and times.
import {
  COMMAND_TOOLS,
  EDIT_TOOLS,
  editPaths,
  gitVerbs,
  IMAGE,
  outside,
  type WorkKind,
} from './classify.js';
import { symbioteTool, type ToolCall } from './events.js';
import { countsText, testCounts, type TestCounts } from './test-summary.js';
import {
  type ActivityGroup,
  type CommitEvent,
  type Context,
  type GroupKind,
  type GroupStatus,
  type Run,
  type WorkEvent,
  callsIn,
  commandOf,
  isEdit,
  isTest,
  kindOf,
  outcome,
  plural,
  running,
  testName,
  times,
} from './group-parts.js';

/** What the files an edit phase touched came to: "2 files · +14 −1". */
function editsText(calls: readonly ToolCall[]): string {
  const files = new Set<string>();
  let added = 0;
  let removed = 0;
  let counted = false;
  let commands = 0;
  for (const call of calls) {
    if (EDIT_TOOLS.has(call.tool)) {
      for (const path of editPaths(call.tool, call.subject)) if (!outside(path)) files.add(path);
    } else if (COMMAND_TOOLS.has(call.tool) && isEdit(call)) commands += 1;
    if (call.added !== undefined || call.removed !== undefined) {
      counted = true;
      added += call.added ?? 0;
      removed += call.removed ?? 0;
    }
  }
  const parts = [
    files.size > 0 ? plural(files.size, 'file', 'files') : '',
    files.size === 0 && commands > 0 ? plural(commands, 'command', 'commands') : '',
    counted ? `+${added.toLocaleString('en-US')} −${removed.toLocaleString('en-US')}` : '',
  ];
  return parts.filter((p) => p !== '').join(' · ');
}

/** What an exploration came to: "12 files read · 8 searches · 15 commands". */
function readsText(calls: readonly ToolCall[]): string {
  const read = new Set<string>();
  let searches = 0;
  let pages = 0;
  let subagents = 0;
  let commands = 0;
  for (const call of calls) {
    if (call.tool === 'Read') read.add(call.subject ?? call.id);
    else if (['Grep', 'Glob', 'WebSearch', 'webSearch', 'LS'].includes(call.tool)) searches += 1;
    else if (call.tool === 'WebFetch') pages += 1;
    else if (call.tool === 'Task' || call.tool === 'Agent') subagents += 1;
    else if (COMMAND_TOOLS.has(call.tool)) commands += 1;
  }
  return [
    read.size > 0 ? `${plural(read.size, 'file', 'files')} read` : '',
    searches > 0 ? plural(searches, 'search', 'searches') : '',
    pages > 0 ? `${plural(pages, 'page', 'pages')} fetched` : '',
    subagents > 0 ? plural(subagents, 'subagent', 'subagents') : '',
    commands > 0 ? plural(commands, 'command', 'commands') : '',
  ]
    .filter((p) => p !== '')
    .join(' · ');
}

/** A test call in a line: "pnpm check · 42 passed", "npx vitest run · 1 failed (exit 1)". */
function testText(call: ToolCall, context: Context): { text: string; counts?: TestCounts } {
  const name = testName(call, context);
  const counts = call.output ? testCounts(call.output) : null;
  const state = outcome(call, context);
  const exit = call.exit !== undefined && call.exit !== 0 ? ` (exit ${call.exit})` : '';
  const result = counts
    ? `${countsText(counts)}${state === 'failed' ? exit : ''}`
    : state === 'failed'
      ? `failed${exit}`
      : state === 'done'
        ? 'passed'
        : state === 'cancelled'
          ? 'stopped'
          : state === 'running'
            ? 'running'
            : 'no end recorded';
  return { text: `${name} · ${result}`, ...(counts ? { counts } : {}) };
}

const TITLES: Record<WorkKind | 'debug' | 'other', string> = {
  explore: 'Exploration',
  implement: 'Implementation',
  docs: 'Documentation',
  test: 'Testing',
  visual: 'Visual inspection',
  debug: 'Debugging',
  git: 'Git',
  web: 'Web research',
  symbiote: 'Symbiote',
  other: 'Other tools',
};

/** What Nucleus did on the web (NU2): "2 searches · 5 pages". */
function webText(calls: readonly ToolCall[]): string {
  let searches = 0;
  let pages = 0;
  for (const call of calls) {
    if (call.refused) continue;
    if (call.tool === 'WebFetch') pages += 1;
    else if (call.tool === 'WebSearch') searches += 1;
    else if (call.tool === 'webSearch') {
      // Codex's item is a search, or a page it opened or searched in.
      if (call.pages && call.pages.length > 0) pages += call.pages.length;
      else searches += 1;
    }
  }
  return [
    searches > 0 ? plural(searches, 'search', 'searches') : '',
    pages > 0 ? plural(pages, 'page', 'pages') : '',
  ]
    .filter((p) => p !== '')
    .join(' · ');
}

/** Which of Symbiote's tools Nucleus used, once each in order (NU2): "workspaces · review". */
function symbioteText(calls: readonly ToolCall[]): string {
  return [...new Set(calls.flatMap((c) => symbioteTool(c) ?? (c.source ? [c.tool] : [])))].join(
    ' · ',
  );
}

/** A phase of calls as a group: its title, its facts, its status. */
export function workGroup(run: Run, context: Context): ActivityGroup {
  const calls = callsIn(run.events);
  const commit = run.events.find((e): e is CommitEvent => e.kind === 'commit');
  const kind: GroupKind = commit ? 'commit' : (run.kind ?? 'other');
  // A call Nucleus's gate or agent refused is said as refused (NU2), one the person declined by
  // its Confirm: neither is a failure.
  const failures = calls.filter(
    (c) => c.failed && !c.interrupted && !c.refused && !c.declined,
  ).length;
  const last = calls.at(-1);
  let status: GroupStatus = 'done';
  if (calls.some((c) => running(c, context))) status = 'running';
  else if (last?.interrupted) status = 'cancelled';
  else if (last && !last.end) status = 'open';
  let summary = '';
  let tests: TestCounts | undefined;
  switch (kind) {
    case 'explore':
      summary = readsText(calls);
      break;
    case 'implement':
    case 'docs':
      summary = editsText(calls);
      break;
    case 'visual': {
      const images = calls.filter((c) => c.tool === 'Read' && IMAGE.test(c.subject ?? '')).length;
      const edits = calls.filter(isEdit).length;
      const commands = calls.filter((c) => COMMAND_TOOLS.has(c.tool) && !isEdit(c)).length;
      summary = [
        images > 0 ? plural(images, 'image', 'images') : '',
        edits > 0 ? plural(edits, 'edit', 'edits') : '',
        commands > 0 ? plural(commands, 'command', 'commands') : '',
      ]
        .filter((p) => p !== '')
        .join(' · ');
      break;
    }
    case 'test': {
      const runs = calls.filter(isTest);
      const decisive = runs.at(-1);
      if (decisive) {
        const said = testText(decisive, context);
        summary = runs.length > 1 ? `${said.text} · ${runs.length} runs` : said.text;
        tests = said.counts;
        const state = outcome(decisive, context);
        if (state !== 'done') status = state;
        else if (runs.some((c) => c.failed && !c.interrupted)) status = 'recovered';
      }
      break;
    }
    case 'debug': {
      const runs = calls.filter(isTest);
      const edits = calls.filter(isEdit).length;
      const decisive = runs.at(-1);
      const name = run.after ?? (decisive ? testName(decisive, context) : 'the test');
      const editWords = plural(edits, 'edit', 'edits');
      if (!decisive) summary = `${name} not run again · ${editWords}`;
      else {
        const state = outcome(decisive, context);
        const runWords = plural(runs.length, 'run', 'runs');
        const again = testName(decisive, context);
        if (state === 'running') {
          status = 'running';
          summary = `${name} · ${again === name ? 'running again' : `running ${again}`} · ${editWords}`;
        } else if (state === 'done') {
          status = status === 'running' ? status : 'recovered';
          summary = `${name} passed after ${runWords} · ${editWords}`;
        } else {
          if (status !== 'running') status = state;
          summary = `${name} still failing after ${runWords} · ${editWords}`;
        }
        tests = testText(decisive, context).counts;
      }
      break;
    }
    case 'git':
    case 'commit': {
      summary = [...new Set(calls.flatMap((c) => gitVerbs(commandOf(c))))].join(' · ');
      const lastGit = calls.filter((c) => kindOf(c) === 'git').at(-1);
      if (status === 'done' && lastGit?.failed && !lastGit.interrupted) status = 'failed';
      break;
    }
    case 'web':
      summary = webText(calls);
      break;
    case 'symbiote':
      summary = symbioteText(calls);
      break;
    default: {
      const tools = [...new Set(calls.map((c) => c.tool))];
      summary = `${plural(calls.length, 'call', 'calls')}: ${tools.slice(0, 3).join(', ')}${tools.length > 3 ? '…' : ''}`;
    }
  }
  // Nucleus's calls its gate or its agent refused (NU2): said, never folded away.
  const refused = calls.filter((c) => c.refused !== undefined).length;
  if (refused > 0)
    summary = [summary, `${refused.toLocaleString('en-US')} refused`]
      .filter((p) => p !== '')
      .join(' · ');
  const first = run.events[0] as WorkEvent;
  return {
    key: first.key,
    kind,
    milestone: kind === 'commit',
    title: commit ? commit.commit.subject : TITLES[kind as keyof typeof TITLES],
    ...(summary ? { summary } : {}),
    ...times(run.events),
    status,
    failures,
    events: run.events,
    ...(run.task ? { task: run.task } : {}),
    ...(commit ? { sha: commit.commit.sha } : {}),
    ...(tests ? { tests } : {}),
  };
}
