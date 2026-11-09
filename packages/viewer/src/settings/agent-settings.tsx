// What a prebuilt agent's page sets (V47, V51) and Suggest settings' (V75c): the config keys of
// its model and level, and the page's words for them; Nucleus's in the name Hive mode gives it.
import type { ReactNode } from 'react';
import type { PrebuiltAgent } from './settings.js';
import { nucleusName } from '../shell/names.js';
import { AGENT_NAMES } from '../workspaces/workspaces.js';

/** The agents the advisor runs on (V75c), each its model and level on Suggest settings' page. */
export const ADVISING = ['claude', 'codex'] as const;

type Advising = (typeof ADVISING)[number];

/**
 * A prebuilt agent's model in the project's config (V47), from its agent's own list; the advisor's
 * on an agent (V75c).
 */
interface ModelSetting {
  key:
    | 'nucleus.model'
    | 'scribe.model'
    | 'merge.model'
    | 'hive.reviewer.model'
    | `advisor.${Advising}.model`;
  /** What the model is for, before "from <agent>'s list". */
  about: string;
  /** What Default does, when not "passes none of Settings'". */
  byDefault?: string;
  /** What the next run does on `model` once saved. */
  saved: (model: string) => string;
  /** What happens with a configured model its agent does not list (decision 343). */
  unlisted: string;
}

/**
 * A prebuilt agent's effort in the project's config: Nucleus's (fix/scout-effort-level), the
 * merger's (V46d) and Scribe's (fix/scribe-effort-level).
 */
interface EffortSetting {
  key:
    | 'nucleus.effort'
    | 'scribe.effort'
    | 'merge.effort'
    | 'hive.reviewer.effort'
    | `advisor.${Advising}.effort`;
  /** What the level is for, before "from <agent>'s levels". */
  about: string;
  /** What Default does, when not "passes none: the agent's own setting decides". */
  byDefault?: string;
  /** Where else it changes, when it does. */
  also?: ReactNode;
  /** What happens without a level it can use. */
  atDefault: string;
  /** What the next run does at `level` once saved. */
  saved: (level: string) => string;
}

/** A prebuilt agent's settings beside its prompts, on its page (fix/scout-merger-scribe-settings). */
export interface AgentSettings {
  /** Where its models and levels are read (`<api>/efforts`), and set (`<api>/model`, `/effort`). */
  api: string;
  /** Its name in a sentence, and whose settings they are. */
  who: string;
  whose: string;
  /** What the page says without its agent, when not that it needs Claude Code or Codex. */
  missing?: string;
  model: ModelSetting;
  effort: EffortSetting;
}

const AGENTS: Record<Exclude<PrebuiltAgent, 'Nucleus'>, AgentSettings> = {
  Merger: {
    api: '/api/merges',
    who: 'The merger',
    whose: "the merger's",
    model: {
      key: 'merge.model',
      about: "The model each of the merger agent's runs is asked on",
      saved: (model) => `Saved. The merger agent's next run is asked on ${model}.`,
      unlisted: 'the merger asks on it as written',
    },
    effort: {
      key: 'merge.effort',
      about: "The level each of the merger agent's runs is asked at",
      also: (
        <>Its log says the level each run was asked at, or why it was not (the merge&apos;s Log).</>
      ),
      atDefault: 'the merger runs it at its default',
      saved: (level) => `Saved. The merger agent's next run is asked at ${level}.`,
    },
  },
  Reviewer: {
    api: '/api/hive/reviewer',
    who: 'The running reviewer',
    whose: "the running reviewer's",
    missing: 'The running reviewer needs Claude Code: it is not installed here.',
    model: {
      key: 'hive.reviewer.model',
      about: 'The model each running review of a Hive workspace is asked on',
      byDefault: "Default is Symbiote's pick, Opus.",
      saved: (model) => `Saved. The next running review is asked on ${model}.`,
      unlisted: 'the reviewer asks on it as written',
    },
    effort: {
      key: 'hive.reviewer.effort',
      about: 'The level each running review is asked at',
      byDefault: "Default is Symbiote's high.",
      atDefault: 'the reviewer is asked at high',
      saved: (level) => `Saved. The next running review is asked at ${level}.`,
    },
  },
  Scribe: {
    api: '/api/scribe',
    who: 'Scribe',
    whose: "Scribe's",
    model: {
      key: 'scribe.model',
      about: "The model each of Scribe's conversations starts on",
      saved: (model) => `Saved. Scribe's next conversation starts on ${model}.`,
      unlisted: 'Scribe starts on the default',
    },
    effort: {
      key: 'scribe.effort',
      about: "The level each of Scribe's conversations starts at",
      also: (
        <>
          A running conversation keeps its own: New conversation in Scribe&apos;s pane starts the
          next on this level, and <code>/effort</code> in its terminal changes a running one.
        </>
      ),
      atDefault: 'Scribe starts it at its default',
      saved: (level) => `Saved. Scribe's next conversation starts at ${level}.`,
    },
  },
};

/** Nucleus's settings in its name: Alpha Ceph's while Hive mode is on (decision 682). */
const nucleusSettings = (name: string): AgentSettings => ({
  api: '/api/nucleus',
  who: name,
  whose: `${name}'s`,
  model: {
    key: 'nucleus.model',
    about: `The model each of ${name}'s conversations starts on`,
    saved: (model) => `Saved. ${name}'s next conversation starts on ${model}.`,
    unlisted: `${name} starts on the default`,
  },
  effort: {
    key: 'nucleus.effort',
    about: `The level each of ${name}'s conversations starts at`,
    also: (
      <>
        A running conversation keeps its own: New conversation on {name}&apos;s page starts the next
        on this level, and <code>/effort</code> in its terminal changes a running one.
      </>
    ),
    atDefault: `${name} starts it at its default`,
    saved: (level) => `Saved. ${name}'s next conversation starts at ${level}.`,
  },
});

/** A prebuilt agent's settings, Nucleus's in the name Hive mode gives it. */
export const agentSettings = (agent: PrebuiltAgent, hive: boolean): AgentSettings =>
  agent === 'Nucleus' ? nucleusSettings(nucleusName(hive)) : AGENTS[agent];

/**
 * The advisor's model and level on `kind` (V75c, decision 556): read and set where Nucleus's are,
 * per agent, since the advisor runs on the agent picked on the Start page.
 */
function advisorSettings(kind: Advising): AgentSettings {
  const name = AGENT_NAMES[kind];
  return {
    api: `/api/workspaces/advisor/${kind}`,
    who: name,
    whose: `${name}'s`,
    missing: `${name} is not installed here.`,
    model: {
      key: `advisor.${kind}.model`,
      about: `The model that reads the brief when you press Suggest settings with ${name} picked`,
      byDefault:
        "Default is Symbiote's pick, the agent's small model, when the agent lists it: the first entry says which it is.",
      saved: (model) => `Saved. With ${name} picked, Suggest settings asks ${model}.`,
      unlisted: 'Suggest settings asks on the default',
    },
    effort: {
      key: `advisor.${kind}.effort`,
      about: 'The level that model reads it at',
      byDefault: "Default is Symbiote's low when the model takes it, else the agent's own.",
      atDefault: 'Suggest settings asks at the default',
      saved: (level) => `Saved. With ${name} picked, Suggest settings asks at ${level}.`,
    },
  };
}

export const ADVISOR: Record<Advising, AgentSettings> = {
  claude: advisorSettings('claude'),
  codex: advisorSettings('codex'),
};
