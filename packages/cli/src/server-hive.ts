// The view server's Hive mode (V82, HV4): `/api/hive`, what turning it on or off concerns, and
// Nucleus's conversation following it.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  NUCLEUS_NAMES,
  type HiveState,
  type HiveStep,
  type WorkspaceSummary,
} from '@symbiote/core';
import { parseHiveChange } from './server-requests.js';
import { WorkspaceRefused } from './workspace-record.js';
import type { HiveRecord } from './hive.js';
import type { ServerContext } from './server-context.js';
import { answer, json, type ServerHttp } from './server-http.js';

/** When Hive was turned on, while on (V92); a record that cannot say is none. */
export async function sinceOf(hive: HiveRecord): Promise<string | undefined> {
  return hive.since?.().catch(() => undefined);
}

/** Hive's steps that turning it off stops or leaves running (HV4, decision 771). */
const IN_FLIGHT: ReadonlySet<HiveStep> = new Set<HiveStep>([
  'writing',
  'checking',
  'reviewing',
  'landing',
]);

/** Hive mode read and set, and what it concerns. */
export function serverHive(
  {
    options,
    repository,
    log,
    mcp,
    busy,
  }: Pick<ServerContext, 'options' | 'repository' | 'log' | 'mcp' | 'busy'>,
  { written }: Pick<ServerHttp, 'written'>,
) {
  /** Whether Hive mode is on; a record that cannot be read is off. */
  async function hiveOn(): Promise<boolean> {
    return (await options.hive?.on().catch(() => false)) ?? false;
  }

  /** `GET /api/hive`: `{ on }`; `POST { on }`: Hive mode turned on or off (V82). */
  async function hiveApi(
    req: IncomingMessage,
    res: ServerResponse,
    hive: HiveRecord,
  ): Promise<void> {
    if (req.method === 'GET') {
      const [on, since] = await Promise.all([hive.on(), sinceOf(hive)]);
      return json(res, 200, { on, ...(since ? { since } : {}) });
    }
    return written(req, res, parseHiveChange, ({ on }) =>
      answer(res, async () => {
        // Not while a workspace is in normal mode (HV4, decision 772): every open one is Hive's.
        const { normal } = on ? await hiveState() : { normal: [] };
        if (normal.length > 0) {
          const one = normal.length === 1;
          throw new WorkspaceRefused(
            `Hive cannot turn on while ${one ? 'a workspace is' : 'workspaces are'} in normal mode: ${normal.map((w) => w.branch).join(', ')}. Land ${one ? 'it' : 'them'} or clean ${one ? 'it' : 'them'} up first`,
            409,
          );
        }
        await hive.set(on);
        // After the answer: the arrival does not wait on an agent's start.
        void nucleusFollows(on).catch((error: unknown) =>
          log.log.warn({ err: error }, "Nucleus's conversation did not follow Hive"),
        );
        return { on };
      }),
    );
  }

  /**
   * What turning Hive on or off concerns (HV4, decisions 771, 772): the open workspaces started in
   * normal mode and not merged, and Hive's writing, checking, reviewing or landing.
   */
  async function hiveState(): Promise<Pick<HiveState, 'normal' | 'flight'>> {
    const list = await repository?.workspaces?.list();
    const open = list?.workspaces ?? [];
    const named = (w: WorkspaceSummary) => (w.title ? { title: w.title } : {});
    return {
      normal: open
        .filter((w) => !w.hive && !w.merged)
        .map((w) => ({ branch: w.branch, ...named(w) })),
      flight: open.flatMap((w) =>
        w.hive && IN_FLIGHT.has(w.hive.step)
          ? [
              {
                branch: w.branch,
                step: w.hive.step,
                ...named(w),
                // HV8: waiting for the person's merge on the forge, which Hive off leaves open.
                ...(w.hive.request?.state === 'open'
                  ? { request: { forge: w.hive.request.forge, number: w.hive.request.number } }
                  : {}),
              },
            ]
          : [],
      ),
    };
  }

  /**
   * Nucleus's conversation follows Hive mode (V86, decision 750): one started under the other name
   * ends and the next opens under the new one (Alpha Ceph told what Hive does), unless it is
   * answering, waits on a dialog or on the person's Confirm: then it keeps its name, and its page
   * says how to start the next (decision 686). One at a time with the page's own starts.
   */
  async function nucleusFollows(on: boolean): Promise<void> {
    const nucleus = repository?.nucleus;
    if (!nucleus) return;
    const { conversation } = await nucleus.state();
    const name = on ? NUCLEUS_NAMES.hive : NUCLEUS_NAMES.off;
    if (!conversation || (conversation.name ?? NUCLEUS_NAMES.off) === name) return;
    if (conversation.state === 'working' || conversation.state === 'needs-you') return;
    if (mcp?.asks().asks.some((ask) => ask.by.via === 'nucleus')) return;
    const words = 'Nucleus is being asked';
    if (busy.has(words)) return;
    busy.add(words);
    try {
      await nucleus.renew();
      await nucleus.open({});
    } finally {
      busy.delete(words);
    }
  }

  return { hiveApi, hiveState, hiveOn };
}

export type ServerHive = ReturnType<typeof serverHive>;
