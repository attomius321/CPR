import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type {
  Issue,
  IssueAnswer,
  IssueDecision,
  IssueDecisions,
  IssueFilter,
  IssueListAnswer,
  IssueRecord,
  IssueSource,
  IssueSummary,
} from '@symbiote/core';
import { Help } from '../ui/Help.js';
import { PageHead } from '../ui/PageHead.js';
import { getJson, postJson } from '../ui/http.js';
import { DoneIcon, ExternalIcon, IssuesIcon, SearchIcon } from '../ui/icons.js';
import { Loading } from '../ui/Loading.js';
import { markdownNodes, useMarkdown } from '../ui/markdown.js';
import { Resizer } from '../ui/Resizer.js';
import { tip } from '../ui/tip.js';
import { loadWidths, saveWidth } from '../ui/widths.js';
import { longDate } from '../history/commits.js';
import { useShell } from '../shell/shell-context.js';
import { useHive } from '../shell/hive.js';
import { DecisionChip, HiveCard } from './HiveCard.js';
import { DECISIONS_ADDRESS, classificationAddress, classifyAddress } from './classification.js';
import { issueTokens } from './issue-text.js';
import {
  authorName,
  commentsWords,
  emptyWords,
  FORGE_NAMES,
  forgeIssuesUrl,
  issueAddress,
  issueLine,
  labelColour,
  listAddress,
  problemTitle,
  relativeTime,
  roleWord,
  rowLabels,
  STATES,
  tokenNote,
} from './issues.js';

/** How long the search waits after a key before it asks the forge (decision 947). */
const SEARCH_WAIT_MS = 400;

interface List {
  source: IssueSource | null;
  issues: IssueSummary[];
  next?: string;
  /** Reading the first page (`first`) or the next (`more`). */
  reading: 'first' | 'more' | null;
  /** The server's own refusal or no answer; the forge's are `source.problem`. */
  error?: string;
}

/**
 * The Issues page (IS1): origin's GitHub or GitLab issues, read only. The list (a state, a search
 * on titles, 30 a page and Load more) beside the issue picked (its text and comments, a link to
 * it); the issue in the address (`?number=`). Nothing is polled: a read on opening, on Refresh,
 * on a state or a search (decision 950).
 */
export function IssuesPage({ number }: { number?: number | undefined }) {
  const shell = useShell();
  const [state, setState] = useState<IssueFilter>('open');
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [round, setRound] = useState(0);
  const [list, setList] = useState<List>({ source: null, issues: [], reading: 'first' });
  const [width, setWidth] = useState(() => loadWidths().issues);
  const [resizing, setResizing] = useState(false);
  const asked = useRef(0);
  const classifier = useClassifier(round);

  // The search asks once typing rests.
  useEffect(() => {
    const wait = setTimeout(() => setSearch(typed.trim()), SEARCH_WAIT_MS);
    return () => clearTimeout(wait);
  }, [typed]);

  // The first page, again on a state, a search or Refresh; an answer to an older ask is dropped.
  useEffect(() => {
    const ask = ++asked.current;
    setList((was) => ({ ...was, reading: 'first' }));
    getJson<IssueListAnswer>(listAddress(state, search))
      .then((answer) => {
        if (ask !== asked.current) return;
        const { issues = [], next, ...source } = answer;
        setList({ source, issues, ...(next ? { next } : {}), reading: null });
      })
      .catch((failed: unknown) => {
        if (ask !== asked.current) return;
        setList({ source: null, issues: [], reading: null, error: (failed as Error).message });
      });
  }, [state, search, round]);

  const more = () => {
    if (!list.next || list.reading) return;
    const ask = ++asked.current;
    setList((was) => ({ ...was, reading: 'more' }));
    getJson<IssueListAnswer>(listAddress(state, search, list.next))
      .then((answer) => {
        if (ask !== asked.current) return;
        setList((was) =>
          answer.problem
            ? { ...was, reading: null, error: answer.problem.message }
            : {
                ...was,
                issues: [...was.issues, ...(answer.issues ?? [])],
                reading: null,
                ...(answer.next ? { next: answer.next } : { next: undefined }),
              },
        );
      })
      .catch((failed: unknown) => {
        if (ask !== asked.current) return;
        setList((was) => ({ ...was, reading: null, error: (failed as Error).message }));
      });
  };

  const pick = useCallback(
    (picked: number) => shell?.navigate({ page: 'issues', number: picked }),
    [shell],
  );
  const resize = useCallback((next: number | null) => {
    setWidth(next ?? undefined);
    saveWidth('issues', next);
  }, []);

  const source = list.source;
  const forge = source?.forge;
  const problem = source?.problem;
  const now = Date.now();
  const note = source ? tokenNote(source) : undefined;

  return (
    <div
      className={`issues${resizing ? ' resizing' : ''}`}
      style={width ? ({ '--issues-width': `${width}px` } as CSSProperties) : undefined}
    >
      <PageHead
        className="issues-head"
        icon={<IssuesIcon />}
        title="Issues"
        beside={
          <Help label="About Issues">
            <p>
              The issues of the repository origin names, on GitHub or GitLab, read only: nothing is
              written to the forge.
            </p>
            <p>
              Anyone can open an issue on a public repository: its text is shown without its HTML,
              and its images as links, never loaded.
            </p>
            <p>
              Without a token, public issues are still read: GitHub allows 60 requests an hour then,
              and GitLab shows comments only with one.
            </p>
          </Help>
        }
        line={forge ? `${forge.project} on ${FORGE_NAMES[forge.kind]}` : undefined}
        actions={
          <>
            {forge && (
              <a
                className="button secondary issues-open"
                href={forgeIssuesUrl(forge)}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalIcon />
                Issues on {FORGE_NAMES[forge.kind]}
              </a>
            )}
            <button
              type="button"
              className="button secondary"
              onClick={() => setRound((n) => n + 1)}
              disabled={list.reading === 'first'}
            >
              Refresh
            </button>
          </>
        }
      />
      {problem && problem.kind !== 'forge' ? (
        <div className="issues-body empty">
          <section className="issues-card issues-problem" aria-label="Issues">
            <h2>{problemTitle(problem)}</h2>
            <p>{problem.message}</p>
            <p className="issues-muted">
              The Issues page reads the issues of the GitHub or GitLab repository the remote named
              origin points to.
            </p>
          </section>
        </div>
      ) : (
        <div className="issues-body">
          <section className="issues-card issues-list" aria-label="Issues">
            <div className="card-head tabs" role="tablist" aria-label="Which issues">
              {STATES.map(({ state: each, label }) => (
                <button
                  key={each}
                  type="button"
                  role="tab"
                  aria-selected={state === each}
                  onClick={() => setState(each)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="issues-filters">
              <label className="issues-search">
                <SearchIcon />
                <input
                  type="search"
                  aria-label="Search issue titles"
                  placeholder="Search titles…"
                  value={typed}
                  maxLength={200}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setTyped(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') setSearch(typed.trim());
                    if (event.key !== 'Escape' || typed === '') return;
                    event.preventDefault();
                    setTyped('');
                    setSearch('');
                  }}
                />
              </label>
            </div>
            {note && (
              <p className="issues-note" role="note">
                {note}
              </p>
            )}
            <IssueRows
              list={list}
              state={state}
              search={search}
              picked={number}
              now={now}
              decided={classifier.decided}
              running={classifier.running}
              onPick={pick}
              onMore={more}
              onRetry={() => setRound((n) => n + 1)}
            />
          </section>
          <Resizer
            gutter
            label="Resize the list of issues"
            side="before"
            variable="--issues-width"
            min={280}
            room={320}
            onResize={resize}
            onDrag={setResizing}
          />
          <IssueCard number={number} round={round} classifier={classifier} />
        </div>
      )}
    </div>
  );
}

/** The list's rows, its state (reading, empty, a problem) and its end. */
function IssueRows({
  list,
  state,
  search,
  picked,
  now,
  decided,
  running,
  onPick,
  onMore,
  onRetry,
}: {
  list: List;
  state: IssueFilter;
  search: string;
  picked: number | undefined;
  now: number;
  /** Each classified issue's decision (decision 1055). */
  decided: ReadonlyMap<number, IssueDecision>;
  running: ReadonlySet<number>;
  onPick: (number: number) => void;
  onMore: () => void;
  onRetry: () => void;
}) {
  const problem = list.source?.problem;
  if (list.reading === 'first' && list.issues.length === 0) {
    return <Loading className="issues-state">Reading the issues…</Loading>;
  }
  if (problem || (list.error && list.issues.length === 0)) {
    const forge = list.source?.forge;
    return (
      <div className="issues-state" role="alert">
        <p className="issues-problem-title">
          {problem ? problemTitle(problem, forge?.kind) : 'The issues could not be read'}
        </p>
        <p className="error">{problem?.message ?? list.error}</p>
        <button type="button" className="button secondary" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }
  if (list.issues.length === 0) {
    return <p className="issues-state issues-muted">{emptyWords(state, search)}</p>;
  }
  return (
    <div className="issues-scroll" aria-busy={list.reading === 'first'}>
      <ul className="issues-rows">
        {list.issues.map((issue) => (
          <li key={issue.number}>
            <button
              type="button"
              className="issues-row"
              aria-current={issue.number === picked ? 'true' : undefined}
              onClick={() => onPick(issue.number)}
            >
              <StateIcon state={issue.state} />
              <span className="issues-row-text">
                <span className="issues-row-line">
                  <span className="issues-row-number">#{issue.number}</span>
                  <span className="issues-row-title">{issue.title}</span>
                  <DecisionChip
                    decision={decided.get(issue.number)}
                    running={running.has(issue.number)}
                  />
                </span>
                {issue.labels.length > 0 && <Labels labels={issue.labels} max={4} />}
                <span className="issues-row-meta">{issueLine(issue, now)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="issues-end">
        <span className="issues-muted">
          {list.issues.length} shown{list.next ? '' : ', all of them'}
        </span>
        {list.next &&
          (list.reading === 'more' ? (
            <Loading inline>Reading more…</Loading>
          ) : (
            <button type="button" className="button secondary" onClick={onMore}>
              Load more
            </button>
          ))}
        {list.error && <span className="error">{list.error}</span>}
      </div>
    </div>
  );
}

/** Open or closed: an icon of its own shape, its word for assistive technology and the tip. */
function StateIcon({ state }: { state: IssueSummary['state'] }) {
  const word = state === 'open' ? 'Open' : 'Closed';
  return (
    <span
      className="issues-state-icon"
      data-state={state}
      role="img"
      aria-label={word}
      {...tip(word)}
    >
      {state === 'open' ? <IssuesIcon /> : <DoneIcon />}
    </span>
  );
}

/** Labels as quiet chips; with `max`, a row's: the first few and how many more. */
function Labels({ labels, max }: { labels: IssueSummary['labels']; max?: number }) {
  const { shown, more } = max ? rowLabels(labels, max) : { shown: labels, more: 0 };
  return (
    <span className="issues-labels">
      {shown.map((label) => {
        const colour = labelColour(label.color);
        return (
          <span key={label.name} className="chip issues-label">
            {colour && (
              <span
                className="issues-label-dot"
                aria-hidden="true"
                style={{ background: colour }}
              />
            )}
            {label.name}
          </span>
        );
      })}
      {more > 0 && (
        <span className="chip issues-label" aria-label={`${more} more labels`}>
          +{more}
        </span>
      )}
    </span>
  );
}

/** The classifier's part of the page (HV9c): the rows' decisions, Classify and its answers. */
export interface ClassifierState {
  /** What `/api/issues/classifications` said: null until read, or when it could not be. */
  read: IssueDecisions | null;
  decided: ReadonlyMap<number, IssueDecision>;
  running: ReadonlySet<number>;
  /** Records this page's Classify got, newer than any read. */
  fresh: Readonly<Record<number, IssueRecord>>;
  /** A Classify the server refused: its words. */
  refused: Readonly<Record<number, string>>;
  classify: (number: number) => void;
}

/**
 * The rows' decisions, read on opening and on Refresh (nothing is polled, decision 950), and
 * Classify: one POST an issue, its record then the row's chip and the card's.
 */
function useClassifier(round: number): ClassifierState {
  const [read, setRead] = useState<IssueDecisions | null>(null);
  const [running, setRunning] = useState<ReadonlySet<number>>(new Set());
  const [fresh, setFresh] = useState<Record<number, IssueRecord>>({});
  const [refused, setRefused] = useState<Record<number, string>>({});

  useEffect(() => {
    let live = true;
    getJson<IssueDecisions>(DECISIONS_ADDRESS)
      .then((answer) => live && setRead(answer))
      .catch(() => live && setRead(null));
    return () => {
      live = false;
    };
  }, [round]);

  const classify = useCallback((number: number) => {
    const without = (all: Record<number, string>) => {
      const rest = { ...all };
      delete rest[number];
      return rest;
    };
    setRunning((was) => new Set([...was, number]));
    setRefused(without);
    postJson<IssueRecord>(classifyAddress(number), {})
      .then((record) => setFresh((was) => ({ ...was, [number]: record })))
      .catch((failed: unknown) =>
        setRefused((was) => ({ ...was, [number]: (failed as Error).message })),
      )
      .finally(() => setRunning((was) => new Set([...was].filter((n) => n !== number))));
  }, []);

  const decided = new Map((read?.decisions ?? []).map((d) => [d.number, d]));
  for (const record of Object.values(fresh)) {
    decided.set(record.number, {
      number: record.number,
      decision: record.decision,
      ...(record.held?.length ? { held: record.held } : {}),
      ...(record.refusal ? { refusal: record.refusal } : {}),
      at: record.run.at,
    });
  }
  return { read, decided, running, fresh, refused, classify };
}

/** The issue's record (HV9b), or null when it was never classified (404). */
async function readClassification(number: number): Promise<IssueRecord | null> {
  const response = await fetch(classificationAddress(number));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as IssueRecord;
}

/** The issue picked, read whole: its text, its comments, a link to it on the forge. */
function IssueCard({
  number,
  round,
  classifier,
}: {
  number: number | undefined;
  round: number;
  classifier: ClassifierState;
}) {
  const [answer, setAnswer] = useState<{ number: number; read?: IssueAnswer; error?: string }>();
  const [kept, setKept] = useState<{ number: number; record: IssueRecord | null }>();
  const hive = useHive();
  const lexer = useMarkdown();
  const fresh = number ? classifier.fresh[number] : undefined;

  // Read again after a Classify: the issue as the classifier read it, its hash the record's.
  useEffect(() => {
    if (!number) return;
    let live = true;
    setAnswer({ number });
    getJson<IssueAnswer>(issueAddress(number))
      .then((read) => live && setAnswer({ number, read }))
      .catch((failed: unknown) => live && setAnswer({ number, error: (failed as Error).message }));
    return () => {
      live = false;
    };
  }, [number, round, fresh]);

  useEffect(() => {
    if (!number) return;
    let live = true;
    readClassification(number)
      .then((record) => live && setKept({ number, record }))
      .catch(() => live && setKept({ number, record: null }));
    return () => {
      live = false;
    };
  }, [number, round]);

  const text = (body: string) =>
    lexer ? (
      <div className="markdown issues-text">{markdownNodes(issueTokens(lexer(body)))}</div>
    ) : (
      <div className="issues-text issues-plain">{body}</div>
    );

  if (!number) {
    return (
      <section className="issues-card issues-issue" aria-label="Issue">
        <p className="issues-state issues-muted">Pick an issue to read it.</p>
      </section>
    );
  }
  const issue: Issue | undefined = answer?.number === number ? answer.read?.issue : undefined;
  const problem =
    answer?.number === number ? (answer.read?.problem?.message ?? answer.error) : undefined;
  const forge = issue ? FORGE_NAMES[issue.forge] : undefined;
  const now = Date.now();
  const ending = issue ? commentsWords(issue) : undefined;
  // The record: this page's Classify's, else the one read; undefined until read.
  const record = fresh ?? (kept?.number === number ? kept.record : undefined);

  return (
    <section className="issues-card issues-issue" aria-label={`Issue #${number}`}>
      <div className="card-head issues-issue-head">
        <h2>#{number}</h2>
        {issue && (
          <div className="end">
            <a
              className="button secondary issues-open"
              href={issue.url}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalIcon />
              Open on {forge}
            </a>
          </div>
        )}
      </div>
      <div className="issues-issue-body">
        {problem ? (
          <div className="issues-state" role="alert">
            <p className="issues-problem-title">#{number} could not be read</p>
            <p className="error">{problem}</p>
          </div>
        ) : !issue ? (
          <Loading className="issues-state">Reading #{number}…</Loading>
        ) : (
          <article className="issues-article">
            {record !== undefined && classifier.read && (
              <HiveCard
                number={number}
                record={record}
                hive={hive}
                about={classifier.read.about}
                identity={classifier.read.identity}
                snapshot={answer?.read?.snapshot}
                running={classifier.running.has(number)}
                refused={classifier.refused[number]}
                text={text}
                now={now}
                onClassify={() => classifier.classify(number)}
              />
            )}
            <h3 className="issues-title">{issue.title}</h3>
            <p className="issues-byline">
              <span className="issues-state-word" data-state={issue.state}>
                {issue.state === 'open' ? <IssuesIcon /> : <DoneIcon />}
                {issue.state === 'open' ? 'Open' : 'Closed'}
              </span>
              <span>
                {authorName(issue.author)}
                {roleWord(issue.author.role) && (
                  <span className="chip issues-role">{roleWord(issue.author.role)}</span>
                )}{' '}
                opened it{' '}
                <span {...tip(longDate(issue.created))}>{relativeTime(issue.created, now)}</span>
              </span>
            </p>
            {issue.labels.length > 0 && <Labels labels={issue.labels} />}
            {issue.body.trim() ? text(issue.body) : <p className="issues-muted">No description.</p>}
            <h3 className="issues-comments-head">
              Comments <span className="count">{issue.comments}</span>
            </h3>
            {issue.thread.length > 0 && (
              <ol className="issues-comments">
                {issue.thread.map((comment, i) => (
                  <li key={comment.url ?? i} className="issues-comment">
                    <p className="issues-comment-head">
                      <span className="issues-comment-author">{authorName(comment.author)}</span>
                      {roleWord(comment.author.role) && (
                        <span className="chip issues-role">{roleWord(comment.author.role)}</span>
                      )}
                      <span className="issues-muted" {...tip(longDate(comment.created))}>
                        {relativeTime(comment.created, now)}
                      </span>
                    </p>
                    {comment.body.trim() ? (
                      text(comment.body)
                    ) : (
                      <p className="issues-muted">No text.</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
            {ending && <p className="issues-muted issues-comments-end">{ending}</p>}
          </article>
        )}
      </div>
    </section>
  );
}
