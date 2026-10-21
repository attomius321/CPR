// Subscription usage (V29c): each window of use a vendor reports for the agents Symbiote starts, as
// `symbiote view` reads them (`GET /api/usage`) and the status bar shows them.

/** One window of use, as its vendor reports it. */
export interface UsageWindow {
  /** Its length: 300 for 5 hours, 10,080 for a week, 43,200 for 30 days. */
  minutes: number;
  /** Used, in percent of the window's limit. */
  usedPercent: number;
  /** When it starts again (ISO); absent when the vendor does not say. */
  resetsAt?: string;
  /** What it is limited to when not the whole plan (a model's weekly limit): shown on hover. */
  scope?: string;
  /** The vendor marks it near its limit (Claude's `severity: "warning"`, at 79 % in real use). */
  warning?: true;
}

/** An agent's subscription and its windows. */
export interface UsageSubscription {
  agent: 'claude' | 'codex';
  /** The plan's name: Pro, Max, Go… */
  plan?: string;
  windows: UsageWindow[];
  /** When the numbers were read (ISO). */
  at: string;
  /** Read from the vendor now, or a copy the agent kept, as old as `at`. */
  source: 'live' | 'cached';
  /** The vendor says a limit is reached. */
  limited?: true;
  /**
   * Why the numbers are a copy, or live ones were not read again: the token expired, the request
   * failed.
   */
  note?: string;
}

/** `GET /api/usage`. */
export interface UsageReport {
  subscriptions: UsageSubscription[];
  /** `SYMBIOTE_USAGE=off`: nothing is read. */
  off?: true;
}
