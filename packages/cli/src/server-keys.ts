// A run's secrets (SC1, decisions 930–932). The page key: what the page sends with each write and
// the Confirm's reads (`x-symbiote-key`), handed out only by trading a one-time token that the
// address Symbiote opens carries in its fragment. The bridge key: `/api/mcp`'s, in the view
// record. Nucleus's key: in its bridge's environment alone (`x-symbiote-nucleus`). None of them is
// ever written to a log or served to a request that does not hold one already.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** How many open tokens wait at once: the oldest goes first. */
const OPEN_TOKENS = 20;

/** The header a page and a bridge send their key in; Nucleus's bridge sends its own too. */
export const KEY_HEADER = 'x-symbiote-key';
export const NUCLEUS_HEADER = 'x-symbiote-nucleus';

export interface ServerKeys {
  /** The page key (decision 930). */
  readonly page: string;
  /** The bridge key: `/api/mcp` only, and a page's open token for the nexus. */
  readonly bridge: string;
  /** Nucleus's key (decision 931). */
  readonly nucleus: string;
  /** A new one-time token, for an address to open. */
  open(): string;
  /** The page key for `token`, once; undefined for a token used, dropped or never made. */
  trade(token: string): string | undefined;
  isPage(req: IncomingMessage): boolean;
  isBridge(req: IncomingMessage): boolean;
  isNucleus(req: IncomingMessage): boolean;
}

const secret = () => randomBytes(32).toString('base64url');

/** Whether `given` is `key`, in a time that does not tell how much of it matched. */
function same(given: string | string[] | undefined, key: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * A run's secrets: made here; the page's and Nucleus's when they are given (the e2e harness's
 * `SYMBIOTE_PAGE_KEY`, `SYMBIOTE_NUCLEUS_KEY`).
 */
export function serverKeys({
  page,
  nucleus,
}: { page?: string; nucleus?: string } = {}): ServerKeys {
  const keys = { page: page || secret(), bridge: secret(), nucleus: nucleus || secret() };
  const tokens: string[] = [];
  return {
    ...keys,
    open() {
      const token = secret();
      tokens.push(token);
      if (tokens.length > OPEN_TOKENS) tokens.shift();
      return token;
    },
    trade(token) {
      const at = tokens.findIndex((kept) => same(token, kept));
      if (at < 0) return undefined;
      tokens.splice(at, 1);
      return keys.page;
    },
    isPage: (req) => same(req.headers[KEY_HEADER], keys.page),
    isBridge: (req) => same(req.headers[KEY_HEADER], keys.bridge),
    isNucleus: (req) => same(req.headers[NUCLEUS_HEADER], keys.nucleus),
  };
}

type Env = Readonly<Record<string, string | undefined>>;

/**
 * A run's secrets, the keys its environment gives taken out of it and of this process's: no
 * process it starts (an agent, a terminal) inherits them. Its environment without them.
 */
export function runKeys(env: Env): { keys: ServerKeys; env: Env } {
  const { SYMBIOTE_PAGE_KEY: page, SYMBIOTE_NUCLEUS_KEY: nucleus, ...rest } = env;
  delete process.env.SYMBIOTE_PAGE_KEY;
  delete process.env.SYMBIOTE_NUCLEUS_KEY;
  return {
    keys: serverKeys({ ...(page ? { page } : {}), ...(nucleus ? { nucleus } : {}) }),
    env: rest,
  };
}

/** `url` with an open token in its fragment: the address Symbiote opens or prints. */
export function addressWith(url: string, token: string): string {
  return `${url}#k=${token}`;
}

/** `url` without its fragment: what a log or another process's output may show. */
export function withoutFragment(url: string): string {
  const at = url.indexOf('#');
  return at < 0 ? url : url.slice(0, at);
}
