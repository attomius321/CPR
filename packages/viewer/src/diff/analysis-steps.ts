// An analysis's steps on its page (V71, decision 504): the pipeline's phases in their order
// (`AnalysisPhase`, core's pipeline.ts), each done, running or to come.

export type StepMark = 'done' | 'running' | 'next';

export interface AnalysisStep {
  key: string;
  name: string;
  mark: StepMark;
}

const PHASES: [phase: string, name: string][] = [
  ['checkout', 'Check out both sides'],
  ['loadBase', 'Load the base'],
  ['loadHead', 'Load the head'],
  ['extract', 'Extract symbols'],
  ['references', 'Find references'],
  ['findings', 'Look for findings'],
];

/**
 * The steps for `phase` (null before the first is reported) with `queued` analyses before it.
 * Steps before the phase are done: the page asks every 500 ms, so a short one is never seen. A
 * phase it does not know claims no progress: as before the first.
 */
export function analysisSteps(phase: string | null, queued: number): AnalysisStep[] {
  if (queued > 0) {
    const waiting = `Waiting for ${queued} other analys${queued === 1 ? 'is' : 'es'}`;
    return [
      { key: 'queue', name: waiting, mark: 'running' },
      ...PHASES.map(([key, name]) => ({ key, name, mark: 'next' as const })),
    ];
  }
  const at = Math.max(
    0,
    PHASES.findIndex(([key]) => key === phase),
  );
  return PHASES.map(([key, name], i) => ({
    key,
    name,
    mark: i < at ? 'done' : i === at ? 'running' : 'next',
  }));
}
