// A merge's conflicting files (V46c): the list, the picked file's regions with what its resolution
// kept, dropped or wrote, and the regions the merger agent asked about.
import { useState, type CSSProperties } from 'react';
import type { MergeConflict, MergeEntry, MergeRegion } from '@symbiote/core';
import { splitPath } from './changes.js';
import {
  askedRegions,
  firstFile,
  gutterChars,
  regionFlags,
  reviewRegion,
  type LineFrom,
  type ResolutionFile,
  type SideKept,
} from './merges.js';
import { tip } from '../ui/tip.js';
import { Loading } from '../ui/Loading.js';

/** Each file's tone, as a step's dot draws it. */
const FILE_TONES: Record<ResolutionFile['tone'], string> = {
  bad: 'merge-tone-bad',
  new: 'merge-tone-new',
  ok: 'merge-tone-done',
  asked: 'merge-tone-you',
  none: '',
};

/**
 * A merge's conflicting files (V46c, decision 317): each with its regions' count and what its
 * resolution did in a few words — or why nobody resolved it — and the picked file's regions
 * beside the list, numbered as the merger agent's prompt numbered them. The first shown is the
 * one holding the region the agent asks about, else the first that loses, doubles or repeats
 * lines, else the first the agent wrote in (fix/merge-viewer-on-conflict).
 */
export function MergeFiles({
  entry,
  files,
  hidden,
}: {
  entry: MergeEntry;
  files: ResolutionFile[];
  hidden: boolean;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const file = files.find((f) => f.path === picked) ?? firstFile(files, entry);
  const resolution = entry.resolution;
  const numbered: readonly MergeConflict[] = resolution?.regions.length
    ? resolution.regions
    : (resolution?.asked ?? []);
  const named = resolution?.needsYou ? askedRegions(resolution.needsYou) : [];
  // The gutter fits the sides' names (and the lines around's), so a branch's is not cut.
  const gutter = {
    '--merge-gutter': gutterChars([entry.into, entry.branch, 'before', 'above', 'below']),
  } as CSSProperties;
  return (
    <div className="merge-fileview" hidden={hidden}>
      <ul className="merge-filelist" aria-label="Its files">
        {files.map((f) => {
          const { name, folder } = splitPath(f.path);
          const what = f.resolving ? (
            <Loading inline>{f.why}</Loading>
          ) : (
            (f.why ?? f.flags.map((flag) => flag.text).join(' · '))
          );
          return (
            <li key={f.path}>
              <button
                type="button"
                className={`merge-filerow ${FILE_TONES[f.tone]}${f.tone === 'none' ? ' unresolved' : ''}`}
                aria-current={f === file ? 'true' : undefined}
                {...tip(f.path, { code: true })}
                onClick={() => setPicked(f.path)}
              >
                <span className="merge-step-dot" aria-hidden="true" />
                <span className="merge-filerow-name">
                  {name}
                  {folder && <span className="merge-filerow-folder"> {folder}</span>}
                </span>
                {f.regions.length + f.asked.length > 0 && (
                  <span className="merge-filerow-count">
                    {f.regions.length + f.asked.length} region
                    {f.regions.length + f.asked.length === 1 ? '' : 's'}
                  </span>
                )}
                <span className="merge-filerow-what">{what}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {file && file.regions.length > 0 ? (
        <ol className="merge-regions" aria-label="Its resolution" style={gutter}>
          {file.regions.map((region, i) => (
            <MergeRegionView
              key={`${file.path} ${i}`}
              region={region}
              number={numbered.indexOf(region) + 1}
              into={entry.into}
              branch={entry.branch}
            />
          ))}
        </ol>
      ) : file && file.asked.length > 0 ? (
        <ol className="merge-regions" aria-label="What it asks about" style={gutter}>
          {file.asked.map((region, i) => {
            const number = numbered.indexOf(region) + 1;
            return (
              <MergeAskedView
                key={`${file.path} ${i}`}
                region={region}
                number={number}
                named={named.includes(number)}
                into={entry.into}
                branch={entry.branch}
              />
            );
          })}
        </ol>
      ) : (
        file &&
        (file.resolving ? (
          <Loading className="merge-fileview-why hint">{file.why}</Loading>
        ) : (
          <p className="merge-fileview-why hint">{file.why}</p>
        ))
      )}
    </div>
  );
}

/** At most this many dropped lines a side shows; the rest are counted. */
const DROPPED_SHOWN = 8;

/**
 * One region of a resolution to review, numbered as the agent's prompt numbered it: what it says in
 * words (lines dropped, kept twice, repeated from just around it, written by the agent, or every
 * line kept), the resolution with each line marked by its side between the lines around it (dim:
 * they stay in the file), each side's dropped lines and those rewritten with their changes kept, and
 * the raw conflict folded under "Show the conflict".
 */
function MergeRegionView({
  region,
  number,
  into,
  branch,
}: {
  region: MergeRegion;
  number: number;
  into: string;
  branch: string;
}) {
  const [conflict, setConflict] = useState(false);
  const review = reviewRegion(region);
  const names: Record<LineFrom, string> = {
    ours: into,
    theirs: branch,
    both: 'both',
    base: 'before',
    new: 'new',
    blank: '',
  };
  const sides = (lines: { ours: string[]; theirs: string[] }) =>
    [
      { side: 'ours' as const, name: into, lines: lines.ours },
      { side: 'theirs' as const, name: branch, lines: lines.theirs },
    ].filter((d) => d.lines.length > 0);
  return (
    <li className="merge-region">
      <MergeRegionWhere region={region} number={number} />
      <div className="merge-verdict">
        {regionFlags(review, into, branch).map((flag) => (
          <span key={flag.text} className={`merge-flag merge-flag-${flag.tone}`}>
            {flag.text}
          </span>
        ))}
        <span className="merge-counts small">
          <MergeCount from="ours" name={into} count={review.kept.ours} />
          <MergeCount from="theirs" name={branch} count={review.kept.theirs} />
          <span className="merge-count from-new">
            new <b>{review.written}</b>
          </span>
        </span>
      </div>
      <div className="merge-code merge-resolved" aria-label="Written in its place">
        <MergeAround lines={region.around?.before} where="above" />
        {review.lines.map((line, i) => (
          <MergeLine
            key={i}
            from={line.from}
            name={names[line.from]}
            text={line.text}
            twice={line.twice}
            repeats={line.repeats}
          />
        ))}
        <MergeAround lines={region.around?.after} where="below" />
      </div>
      {sides(review.dropped).map((d) => (
        <div key={d.side}>
          <p className="merge-sub">Dropped from {d.name}</p>
          <div className="merge-code merge-dropped">
            {d.lines.slice(0, DROPPED_SHOWN).map((text, i) => (
              <MergeLine key={i} from={d.side} name={d.name} text={text} />
            ))}
            {d.lines.length > DROPPED_SHOWN && (
              <p className="merge-more small">+ {d.lines.length - DROPPED_SHOWN} more lines</p>
            )}
          </div>
        </div>
      ))}
      {sides(review.rewritten).map((d) => (
        <div key={d.side}>
          <p className="merge-sub merge-sub-rewritten">Rewritten from {d.name}, its changes kept</p>
          <div className="merge-code merge-rewritten">
            {d.lines.slice(0, DROPPED_SHOWN).map((text, i) => (
              <MergeLine key={i} from={d.side} name={d.name} text={text} />
            ))}
            {d.lines.length > DROPPED_SHOWN && (
              <p className="merge-more small">+ {d.lines.length - DROPPED_SHOWN} more lines</p>
            )}
          </div>
        </div>
      ))}
      <p className="merge-conflict small">
        <button
          type="button"
          className="link small"
          aria-expanded={conflict}
          onClick={() => setConflict((open) => !open)}
        >
          {conflict ? 'Hide the conflict' : 'Show the conflict'}
        </button>
        {region.base?.length === 0 && (
          <span className="muted"> · both sides added here, nothing before</span>
        )}
      </p>
      {conflict && <MergeSides region={region} into={into} branch={branch} />}
    </li>
  );
}

/** A region's number, as the agent's prompt gave it, and where it is; the agent's note on it. */
function MergeRegionWhere({
  region,
  number,
  named = false,
}: {
  region: MergeConflict & { note?: string };
  number: number;
  named?: boolean;
}) {
  return (
    <p className="merge-region-where">
      <span className="merge-region-number">Region {number}</span>
      <span className="merge-file">
        {region.path}:{region.line}
      </span>
      {named && <span className="merge-flag merge-flag-you">Asked about</span>}
      {region.note && <span className="merge-note"> “{region.note}”</span>}
    </p>
  );
}

/**
 * A region the merger agent asked the person about (fix/merge-viewer-on-conflict): its number, as
 * the question names it, marked when it does; the lines around it and its three sides, open.
 */
function MergeAskedView({
  region,
  number,
  named,
  into,
  branch,
}: {
  region: MergeConflict;
  number: number;
  named: boolean;
  into: string;
  branch: string;
}) {
  const around = (lines: string[] | undefined, where: 'above' | 'below') =>
    lines && lines.some((line) => line.trim() !== '') ? (
      <div className="merge-code">
        <MergeAround lines={lines} where={where} />
      </div>
    ) : null;
  return (
    <li className="merge-region">
      <MergeRegionWhere region={region} number={number} named={named} />
      {around(region.around?.before, 'above')}
      <MergeSides region={region} into={into} branch={branch} />
      {around(region.around?.after, 'below')}
      {region.base?.length === 0 && (
        <p className="merge-conflict small muted">Both sides added here, nothing before</p>
      )}
    </li>
  );
}

/** A region's three sides, as git wrote them. */
function MergeSides({
  region,
  into,
  branch,
}: {
  region: MergeConflict;
  into: string;
  branch: string;
}) {
  return (
    <div className="merge-region-sides">
      <MergeSide label={into} from="ours" lines={region.ours} />
      {region.base && region.base.length > 0 && (
        <MergeSide label="before both" from="base" lines={region.base} />
      )}
      <MergeSide label={branch} from="theirs" lines={region.theirs} />
    </div>
  );
}

/** The lines just above or below a region, which stay in the file: dim, named in the gutter. */
function MergeAround({ lines, where }: { lines: string[] | undefined; where: 'above' | 'below' }) {
  return (lines ?? []).map((text, i) => (
    <MergeLine
      key={`${where} ${i}`}
      from="around"
      name={text.trim() === '' ? '' : where}
      text={text}
    />
  ));
}

/** "main 1/1": a side's own lines the resolution kept, of all it added. */
function MergeCount({
  from,
  name,
  count,
}: {
  from: 'ours' | 'theirs';
  name: string;
  count: SideKept;
}) {
  return (
    <span className={`merge-count from-${from}`}>
      {name}{' '}
      <b>
        {count.kept}/{count.of}
      </b>
    </span>
  );
}

/**
 * A line of a resolution, or a dropped one, or one just around it: its side in the gutter,
 * coloured by it; a copy past a side's own, or of a line around, outlined and said.
 */
function MergeLine({
  from,
  name,
  text,
  twice,
  repeats,
}: {
  from: LineFrom | 'around';
  name: string;
  text: string;
  twice?: true | undefined;
  repeats?: 'above' | 'below' | undefined;
}) {
  return (
    <div className={`merge-line from-${from}${twice || repeats ? ' merge-twice' : ''}`}>
      <span className="merge-line-from" {...tip(name)}>
        {name}
      </span>
      <code className="merge-line-text">{text}</code>
      {twice && <span className="merge-line-tag">kept twice</span>}
      {repeats && <span className="merge-line-tag">also just {repeats}</span>}
    </div>
  );
}

/** One side of a conflict region, as git wrote it. */
function MergeSide({ label, from, lines }: { label: string; from: LineFrom; lines: string[] }) {
  return (
    <figure className={`merge-side from-${from}`}>
      <figcaption className="small">{label}</figcaption>
      <pre>
        {lines.length === 0 || (lines.length === 1 && lines[0] === '') ? ' ' : lines.join('\n')}
      </pre>
    </figure>
  );
}
