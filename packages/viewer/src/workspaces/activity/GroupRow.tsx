// One phase or milestone of the Activity tab (V73): its time and how long, its tile on the rail
// in its kind of work's colour (V74), its line (title, status, count) and its summary; open, every
// event in it, each opening to what was recorded of it — the whole command, its output or error,
// exit code, times.
import { memo, useState, type MouseEvent, type ReactNode } from 'react';
import {
  AgentIcon,
  AlertIcon,
  BellIcon,
  BranchIcon,
  BugIcon,
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  CodeIcon,
  CollapseIcon,
  CommentIcon,
  CommitIcon,
  CopyIcon,
  DocumentsIcon,
  FileIcon,
  FlaskIcon,
  GlobeIcon,
  ImageIcon,
  PlayIcon,
  PlugIcon,
  QuestionIcon,
  ReviewIcon,
  SearchIcon,
  ShieldIcon,
  StopIcon,
  StoppedIcon,
  TerminalIcon,
  WaitingIcon,
  WorkingIcon,
  WrenchIcon,
} from '../../ui/icons.js';
import { markdownNodes, type Lexer } from '../../ui/markdown.js';
import { tip } from '../../ui/tip.js';
import { longDate } from '../../history/commits.js';
import { askedFor } from '../workspaces.js';
import { callKind, COMMAND_TOOLS, IMAGE } from './classify.js';
import type { ActivityEvent, ToolCall } from './events.js';
import type { ActivityGroup, GroupKind } from './groups.js';
import {
  durationText,
  eventWords,
  groupPhase,
  phaseOf,
  statusWords,
  summaryParts,
  tokensText,
  type Phase,
} from './words.js';

/** How many events an open group draws before "Show all". */
const SHOWN = 50;

export const timeOf = (at: string, seconds = false) =>
  new Date(at).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
  });

const ICONS: Record<GroupKind, () => ReactNode> = {
  explore: SearchIcon,
  implement: CodeIcon,
  docs: DocumentsIcon,
  test: FlaskIcon,
  visual: ImageIcon,
  debug: BugIcon,
  git: BranchIcon,
  commit: CommitIcon,
  other: WrenchIcon,
  made: BranchIcon,
  session: PlayIcon,
  prompt: CommentIcon,
  message: CommentIcon,
  asks: QuestionIcon,
  report: AgentIcon,
  end: StopIcon,
  verdict: ReviewIcon,
  notice: BellIcon,
  unknown: WrenchIcon,
  web: GlobeIcon,
  symbiote: PlugIcon,
  confirm: ShieldIcon,
  compact: CollapseIcon,
  error: AlertIcon,
  interrupted: StoppedIcon,
};

/** A status's mark in its badge (V74): passed a check, failed a cross, running, waiting, stopped. */
const STATUS_ICONS: Partial<Record<ActivityGroup['status'], () => ReactNode>> = {
  running: WorkingIcon,
  failed: CloseIcon,
  recovered: CheckIcon,
  done: CheckIcon,
  waiting: WaitingIcon,
  cancelled: StoppedIcon,
};

/** The class that colours an element in a kind of work's colour (`--phase`), when it has one. */
export const phaseClass = (phase: Phase | null) => (phase ? ` phase-${phase}` : '');

/** A group's kind on a tile, in its kind of work's colour (V74): on the rail and in the live strip. */
export function PhaseTile({ kind }: { kind: GroupKind }) {
  const Icon = ICONS[kind];
  return (
    <span className={`activity-tile${phaseClass(groupPhase(kind))}`}>
      <Icon />
    </span>
  );
}

/** An event's icon: by what its call is. */
function EventIcon({ event }: { event: ActivityEvent }) {
  if (event.kind === 'commit') return <CommitIcon />;
  if (event.kind !== 'call') return <WrenchIcon />;
  const { call } = event;
  if (call.tool === 'Read') return IMAGE.test(call.subject ?? '') ? <ImageIcon /> : <FileIcon />;
  const kind = call.kind !== undefined ? call.kind : callKind(call);
  if (kind === 'web') return <GlobeIcon />;
  if (kind === 'symbiote') return <PlugIcon />;
  if (kind === 'test') return <FlaskIcon />;
  if (kind === 'git') return <BranchIcon />;
  if (kind === 'visual') return <ImageIcon />;
  if (COMMAND_TOOLS.has(call.tool)) return <TerminalIcon />;
  if (kind === 'implement') return <CodeIcon />;
  if (kind === 'docs') return <DocumentsIcon />;
  if (kind === 'explore') return <SearchIcon />;
  if (call.tool === 'TaskCreate' || call.tool === 'TaskUpdate') return <CheckIcon />;
  return <WrenchIcon />;
}

/** A group's duration, when both its ends are recorded. */
const groupMs = (group: ActivityGroup) =>
  group.start && group.end ? Date.parse(group.end) - Date.parse(group.start) : undefined;

/** A copy button for a command's whole text: a check for a moment once copied. */
function CopyButton({ text, what }: { text: string; what: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="icon-button activity-copy"
      aria-label={`Copy ${what}`}
      {...tip(copied ? 'Copied' : `Copy ${what}`)}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

/** One thing recorded of an event, labelled. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

/** Everything recorded of a call: its whole command, its output or error, its exit code, times. */
function CallFacts({ call, running }: { call: ToolCall; running: boolean }) {
  const commands = COMMAND_TOOLS.has(call.tool);
  const command = call.input ?? (commands ? call.subject : undefined);
  const when = (at: string) => (
    <time dateTime={at} {...tip(longDate(at))}>
      {timeOf(at, true)}
    </time>
  );
  return (
    <dl className="activity-facts">
      {command !== undefined && (
        <Fact label={commands ? 'Command' : 'Arguments'}>
          <div className="activity-code">
            <pre>{command}</pre>
            <CopyButton text={command} what={commands ? 'the command' : 'the arguments'} />
          </div>
          {!call.input && (
            <p className="activity-note">Only its first 160 characters were recorded.</p>
          )}
        </Fact>
      )}
      {command === undefined && call.subject && <Fact label="On">{call.subject}</Fact>}
      {call.about && <Fact label="The agent's words">{call.about}</Fact>}
      {call.gate && <GateFact gate={call.gate} />}
      {call.refused && call.gate?.decision !== 'deny' && (
        <Fact label="Refused">By its agent: {call.refused}</Fact>
      )}
      {call.pages && call.pages.length > 0 && (
        <Fact label={call.pages.length > 1 ? 'Pages' : 'Page'}>
          <ul className="activity-pages">
            {call.pages.map((page, i) => (
              <li key={i}>
                <code>{page.url}</code>
                {page.code !== undefined && (
                  <span className={page.code >= 400 ? 'tone-error' : 'tone-muted'}>
                    {' '}
                    {page.code}
                  </span>
                )}
                {page.bytes !== undefined && (
                  <span className="tone-muted"> · {page.bytes.toLocaleString('en-US')} bytes</span>
                )}
              </li>
            ))}
          </ul>
        </Fact>
      )}
      {call.links && call.links.length > 0 && (
        <Fact label="Results">
          <ul className="activity-pages">
            {call.links.map((link, i) => (
              <li key={i}>
                {link.title && <span>{link.title} </span>}
                <code>{link.url}</code>
              </li>
            ))}
          </ul>
        </Fact>
      )}
      {call.output !== undefined && (
        <Fact label={call.failed ? 'Error' : commands ? 'Output' : 'Answer'}>
          <pre className={call.failed ? 'activity-output failed' : 'activity-output'}>
            {call.output}
          </pre>
          {call.clipped && (
            <p className="activity-note">
              {commands
                ? 'Its earlier lines were not kept: the last 2 KB.'
                : 'Only its first 2 KB were kept.'}
            </p>
          )}
        </Fact>
      )}
      {call.symbiote && (
        <Fact label="Symbiote's answer">
          {call.symbiote.output !== undefined ? (
            <pre className={call.symbiote.failed ? 'activity-output failed' : 'activity-output'}>
              {call.symbiote.output}
            </pre>
          ) : (
            'None recorded'
          )}
          {call.symbiote.ms !== undefined && (
            <p className="activity-note">In {durationText(call.symbiote.ms)}.</p>
          )}
        </Fact>
      )}
      {call.exit !== undefined && <Fact label="Exit code">{call.exit}</Fact>}
      {call.interrupted && <Fact label="Stopped">By you, before it ended</Fact>}
      {call.background && <Fact label="Ran">In the background: its end is not the command's</Fact>}
      {(call.added !== undefined || call.removed !== undefined) && (
        <Fact label="Lines">
          <span className="chip-added">+{call.added ?? 0}</span>{' '}
          <span className="chip-removed">−{call.removed ?? 0}</span>
        </Fact>
      )}
      {call.ms !== undefined && <Fact label="Took">{durationText(call.ms)}</Fact>}
      {call.startedAt && <Fact label="Started">{when(call.startedAt)}</Fact>}
      {call.gate?.decision === 'deny' ? (
        <Fact label="Ended">Never ran: its gate refused it</Fact>
      ) : call.endedAt ? (
        <Fact label="Ended">{when(call.endedAt)}</Fact>
      ) : (
        <Fact label="Ended">{running ? 'Running now' : 'No end recorded'}</Fact>
      )}
      <Fact label="Tool">
        <code>{call.tool}</code>
      </Fact>
      <Fact label="Call">
        <code>{call.id}</code>
      </Fact>
    </dl>
  );
}

/** What Nucleus's gate said of a call (NU2). */
function GateFact({ gate }: { gate: NonNullable<ToolCall['gate']> }) {
  const said =
    gate.decision === 'allow'
      ? `Allowed${gate.reason ? `: ${gate.reason}` : ": one of git's read commands"}`
      : gate.decision === 'deny'
        ? `Refused: ${gate.reason ?? 'no reason given'}`
        : "Left to Claude Code's own rules";
  return (
    <Fact label="Nucleus's gate">
      <span className={gate.decision === 'deny' ? 'tone-error' : ''}>{said}</span>
    </Fact>
  );
}

/** What an event that is not a call recorded. */
function OtherFacts({ event }: { event: ActivityEvent }) {
  if (event.kind === 'commit') {
    const { commit } = event;
    return (
      <dl className="activity-facts">
        <Fact label="Commit">
          <code>{commit.sha}</code>
        </Fact>
        <Fact label="By">{commit.author}</Fact>
        <Fact label="At">
          <time dateTime={commit.date}>{longDate(commit.date)}</time>
        </Fact>
      </dl>
    );
  }
  return <pre className="activity-output">{JSON.stringify(event, null, 2)}</pre>;
}

/** One event of an open group: its line, opening to what was recorded of it. */
function EventRow({
  event,
  worktree,
  running,
}: {
  event: ActivityEvent;
  worktree: string;
  running: boolean;
}) {
  const [open, setOpen] = useState(false);
  const words = eventWords(event, worktree);
  const call = event.kind === 'call' ? event.call : null;
  const state = !call
    ? ''
    : running
      ? ' running'
      : call.interrupted
        ? ' cancelled'
        : call.failed
          ? ' failed'
          : call.end
            ? ''
            : ' open';
  const at = call ? call.startedAt : event.at;
  return (
    <li className={`activity-event${state}${phaseClass(phaseOf(event))}`}>
      <details open={open}>
        <summary
          onClick={(e: MouseEvent) => {
            e.preventDefault();
            setOpen(!open);
          }}
        >
          <span className="activity-event-icon">
            <EventIcon event={event} />
          </span>
          <span className="activity-event-words">
            {words.text && <span className="activity-event-text">{words.text}</span>}
            {words.path && <span className="activity-path">{words.path}</span>}
            {words.code && <code>{words.code}</code>}
          </span>
          {call && (call.added !== undefined || call.removed !== undefined) && (
            <span className="activity-lines">
              <span className="chip-added">+{call.added ?? 0}</span>
              <span className="chip-removed">−{call.removed ?? 0}</span>
            </span>
          )}
          {call?.refused !== undefined && (
            <span className="badge badge-error activity-exit">refused</span>
          )}
          {call?.exit !== undefined && call.exit !== 0 && (
            <span className="badge badge-error activity-exit">exit {call.exit}</span>
          )}
          {running && <span className="badge badge-info activity-exit">running</span>}
          {call?.ms !== undefined && (
            <span className="activity-event-took">{durationText(call.ms)}</span>
          )}
          {at && (
            <time className="activity-event-time" dateTime={at}>
              {timeOf(at, true)}
            </time>
          )}
        </summary>
        {open && (
          <div className="activity-event-details">
            {call ? <CallFacts call={call} running={running} /> : <OtherFacts event={event} />}
          </div>
        )}
      </details>
    </li>
  );
}

/** What a milestone opens to: a report as Markdown, a prompt or a verdict as written, a question. */
function MilestoneDetail({ group, lexer }: { group: ActivityGroup; lexer: Lexer | null }) {
  const asks = group.events[0]?.kind === 'asks' ? group.events[0].entry : null;
  if (asks) {
    return (
      <div className="activity-detail">
        {asks.questions ? (
          <ul className="activity-questions">
            {asks.questions.map((q, i) => (
              <li key={i}>
                <span>{q.question}</span>
                {q.options.length > 0 && (
                  <span className="activity-options">
                    {q.options.map((o, j) => (
                      <span key={j} className="chip">
                        {o}
                      </span>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <>
            <p>{askedFor(asks)}</p>
            {asks.input && <pre className="activity-output">{asks.input}</pre>}
          </>
        )}
      </div>
    );
  }
  if (group.detail === undefined) return null;
  if (group.kind === 'report' && lexer) {
    return <div className="activity-detail markdown">{markdownNodes(lexer(group.detail))}</div>;
  }
  return <div className="activity-detail plain">{group.detail}</div>;
}

/** Whether a group opens: its events, or a milestone's words. */
const opens = (group: ActivityGroup) =>
  group.events.some((e) => e.kind === 'call' || e.kind === 'commit') ||
  group.detail !== undefined ||
  group.kind === 'asks';

function GroupRowView({
  group,
  open,
  onToggle,
  worktree,
  lexer,
  fresh,
}: {
  group: ActivityGroup;
  open: boolean;
  onToggle: (key: string) => void;
  worktree: string;
  lexer: Lexer | null;
  fresh: boolean;
}) {
  // Drawn once opened, kept while closed: closing slides as opening does.
  const [drawn, setDrawn] = useState(open);
  const [all, setAll] = useState(false);
  if (open && !drawn) setDrawn(true);
  const ms = groupMs(group);
  const status = statusWords(group);
  const parts = summaryParts(group);
  const events = group.events.filter((e) => e.kind === 'call' || e.kind === 'commit');
  const shown = all ? events : events.slice(0, SHOWN);
  const StatusIcon = status ? STATUS_ICONS[group.status] : undefined;
  const phase = groupPhase(group.kind);
  const expandable = opens(group);
  const classes = [
    'activity-group',
    `kind-${group.kind}`,
    `status-${group.status}`,
    group.milestone ? 'milestone' : 'phase',
    phase ? `phase-${phase}` : '',
    group.failures > 0 ? 'has-failures' : '',
    fresh ? 'fresh' : '',
  ]
    .filter((c) => c !== '')
    .join(' ');
  const line = (
    <>
      <span className="activity-head">
        <span className="activity-title">{group.title}</span>
        {group.sha && <code className="chip activity-sha">{group.sha.slice(0, 7)}</code>}
        {group.tokens && (
          <span className="activity-tokens">
            {tokensText(group.tokens)}
            {group.took !== undefined && ` · ${durationText(group.took)}`}
          </span>
        )}
        <span className="activity-fill" />
        {status && (
          <span className={`badge activity-status tone-${status.tone}`}>
            {StatusIcon && <StatusIcon />}
            {status.text}
          </span>
        )}
        {events.length > 1 && (
          <span className="activity-count" {...tip(`${events.length} events`)}>
            {events.length}
          </span>
        )}
        {expandable && <ChevronIcon open={open} />}
      </span>
      {(parts.length > 0 || group.task || group.failures > 0) && (
        <span className="activity-summary">
          {group.task && <span className="activity-task">{group.task}</span>}
          {parts.map((part, i) => (
            <span key={i} className={`activity-part${part.tone ? ` tone-${part.tone}` : ''}`}>
              {i > 0 && <span className="activity-sep"> · </span>}
              {part.lines ? (
                <>
                  <span className="chip-added">{part.lines.added}</span>{' '}
                  <span className="chip-removed">{part.lines.removed}</span>
                </>
              ) : part.code ? (
                <code>{part.text}</code>
              ) : (
                part.text
              )}
            </span>
          ))}
          {group.failures > 0 && group.status !== 'failed' && group.kind !== 'test' && (
            <span className="activity-part tone-warning">
              {parts.length > 0 && <span className="activity-sep"> · </span>}
              {group.failures} failed
            </span>
          )}
        </span>
      )}
    </>
  );
  return (
    <li className={classes} data-key={group.key}>
      <span className="activity-when">
        {group.start ? (
          <time
            dateTime={group.start}
            {...tip(
              group.end && group.end !== group.start
                ? `${longDate(group.start)}, to ${timeOf(group.end, true)}`
                : longDate(group.start),
            )}
          >
            {timeOf(group.start)}
          </time>
        ) : (
          <span {...tip('Codex gives no time for this')} />
        )}
        {ms !== undefined && ms > 0 && !group.milestone && (
          <span className="activity-took">{durationText(ms)}</span>
        )}
      </span>
      <span className="activity-rail" aria-hidden="true">
        <PhaseTile kind={group.kind} />
      </span>
      {expandable ? (
        <details className="activity-body" open={open}>
          <summary
            onClick={(e: MouseEvent) => {
              e.preventDefault();
              onToggle(group.key);
            }}
          >
            {line}
          </summary>
          {drawn && (
            <div className="activity-open">
              <MilestoneDetail group={group} lexer={lexer} />
              {shown.length > 0 && (
                <ol className="activity-events" aria-label={`Events of ${group.title}`}>
                  {shown.map((event) => (
                    <EventRow
                      key={event.key}
                      event={event}
                      worktree={worktree}
                      running={
                        group.status === 'running' && event.kind === 'call' && !event.call.end
                      }
                    />
                  ))}
                </ol>
              )}
              {events.length > shown.length && (
                <button type="button" className="link activity-all" onClick={() => setAll(true)}>
                  Show all {events.length}
                </button>
              )}
            </div>
          )}
        </details>
      ) : (
        <div className="activity-body">{line}</div>
      )}
    </li>
  );
}

/** A group drawn again only when what it shows changed: reads give new group objects each time. */
export const GroupRow = memo(
  GroupRowView,
  (a, b) =>
    a.open === b.open &&
    a.fresh === b.fresh &&
    a.lexer === b.lexer &&
    a.worktree === b.worktree &&
    a.onToggle === b.onToggle &&
    a.group.key === b.group.key &&
    a.group.kind === b.group.kind &&
    a.group.status === b.group.status &&
    a.group.title === b.group.title &&
    a.group.summary === b.group.summary &&
    a.group.detail === b.group.detail &&
    a.group.start === b.group.start &&
    a.group.end === b.group.end &&
    a.group.failures === b.group.failures &&
    a.group.task === b.group.task &&
    a.group.events.length === b.group.events.length &&
    a.group.events.at(-1)?.key === b.group.events.at(-1)?.key,
);
