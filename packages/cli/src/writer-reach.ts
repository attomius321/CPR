// What the writer of a workspace from an issue may reach (HV10b; decisions 1015, 1050–1054, 1063,
// 1064). Measured in HV10a: `claude --bg` hands the session to Claude Code's daemon, so the
// variables Symbiote spawns it with never reach the writer; its `--settings` do. Its settings file
// sets them in `env`, turns Claude Code's sandbox on as the running reviewer's (677) with the
// forge's credentials hidden, allows the hosts of the repository's own ecosystems and
// `hive.sandbox.allowedDomains`, gives the installs one cache folder, and denies the web tools.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { appendFile, chmod, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { HiveSandboxSetting } from '@symbiote/core';
import { writeConfig } from './config-write.js';
import { writeFileWhole } from './file-write.js';
import { FORGE_TOKENS, secretName } from './nucleus-record.js';
import { CONFIG_FILES } from './plugins.js';
import { PromptRefused } from './prompts.js';

/** An ecosystem a repository's root files name, and the hosts its installs need (HV10a's table). */
export interface Ecosystem {
  name: string;
  /** The root files that named it. */
  files: string[];
  hosts: string[];
}

/**
 * Each ecosystem: the files at a worktree's root that name it, and its hosts (decision 1052).
 * Measured in HV10a for npm, Yarn 1, pip, Cargo and Go; the rest from their documentation.
 * Composer's archives from GitHub's API and a git dependency's host are not here: no forge host
 * unless the repository lists it in `hive.sandbox.allowedDomains`.
 */
const ECOSYSTEMS: { name: string; match: (file: string) => boolean; hosts: string[] }[] = [
  {
    name: 'npm',
    match: (f) =>
      [
        'package-lock.json',
        'npm-shrinkwrap.json',
        'pnpm-lock.yaml',
        'bun.lock',
        'bun.lockb',
      ].includes(f),
    hosts: ['registry.npmjs.org'],
  },
  {
    name: 'Yarn',
    match: (f) => f === 'yarn.lock',
    hosts: ['registry.yarnpkg.com', 'repo.yarnpkg.com'],
  },
  {
    name: 'Python',
    match: (f) => /^requirements.*\.txt$/.test(f) || f === 'pyproject.toml' || f === 'uv.lock',
    hosts: ['pypi.org', 'files.pythonhosted.org'],
  },
  {
    name: 'Cargo',
    match: (f) => f === 'Cargo.lock',
    hosts: ['index.crates.io', 'static.crates.io'],
  },
  {
    name: 'Go',
    match: (f) => f === 'go.sum',
    hosts: ['proxy.golang.org', 'sum.golang.org', 'storage.googleapis.com'],
  },
  { name: 'Maven', match: (f) => f === 'pom.xml', hosts: ['repo.maven.apache.org'] },
  {
    name: 'Gradle',
    match: (f) => f === 'build.gradle' || f === 'build.gradle.kts',
    hosts: [
      'services.gradle.org',
      'downloads.gradle.org',
      'plugins.gradle.org',
      'repo.maven.apache.org',
    ],
  },
  {
    name: 'Bundler',
    match: (f) => f === 'Gemfile.lock',
    hosts: ['rubygems.org', 'index.rubygems.org'],
  },
  { name: 'NuGet', match: (f) => f.endsWith('.csproj'), hosts: ['api.nuget.org'] },
  { name: 'Composer', match: (f) => f === 'composer.lock', hosts: ['repo.packagist.org'] },
  {
    name: 'Deno',
    match: (f) => f === 'deno.json' || f === 'deno.jsonc',
    hosts: ['jsr.io', 'deno.land', 'registry.npmjs.org'],
  },
];

/** The ecosystems `files` (a worktree's root names) name, in the table's order. */
export function ecosystemsAt(files: readonly string[]): Ecosystem[] {
  return ECOSYSTEMS.flatMap(({ name, match, hosts }) => {
    const named = files.filter(match).sort();
    return named.length > 0 ? [{ name, files: named, hosts }] : [];
  });
}

/** The ecosystems at the root of `folder`; none when it cannot be read. */
export function ecosystemsIn(folder: string): Ecosystem[] {
  try {
    return ecosystemsAt(readdirSync(folder));
  } catch {
    return [];
  }
}

/** The hosts a writer may reach: its ecosystems', then the setting's, once each. */
export function writerHosts(
  ecosystems: readonly Ecosystem[],
  allowed: readonly string[],
): string[] {
  return [...new Set([...ecosystems.flatMap((e) => e.hosts), ...allowed])];
}

/** A host Claude Code's `allowedDomains` takes: a name, `*.` before one, an optional port. */
const HOST =
  /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?::\d{1,5})?$/;

/** `hive.sandbox.allowedDomains` (decision 1052): its hosts, lowercase, once each. */
export function readSandboxDomains(root: string): string[] {
  const file = CONFIG_FILES.find((name) => existsSync(join(root, name)));
  if (!file) return [];
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(join(root, file), 'utf8'));
  } catch {
    return [];
  }
  const object = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
  const list = object(object(object(value).hive).sandbox).allowedDomains;
  if (!Array.isArray(list)) return [];
  const hosts = list
    .filter((h): h is string => typeof h === 'string')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => HOST.test(h));
  return [...new Set(hosts)];
}

/** Sets `hive.sandbox.allowedDomains` (Settings → Hive); an empty list removes it. */
export async function setSandboxDomains(root: string, hosts: readonly string[]): Promise<void> {
  const kept: string[] = [];
  for (const host of hosts) {
    const word = host.trim().toLowerCase();
    if (!HOST.test(word)) throw new PromptRefused(`Not a host: ${host}`, 400);
    if (!kept.includes(word)) kept.push(word);
  }
  await writeConfig(
    root,
    ['hive', 'sandbox', 'allowedDomains'],
    kept.length > 0 ? kept : undefined,
  );
}

/** Settings → Hive's writer network (HV10b): read from `root`'s files and config, and set. */
export function hiveSandboxService(root: string) {
  const read = (): HiveSandboxSetting => {
    const ecosystems = ecosystemsIn(root);
    const allowedDomains = readSandboxDomains(root);
    return { ecosystems, allowedDomains, hosts: writerHosts(ecosystems, allowedDomains) };
  };
  return {
    read: () => Promise.resolve(read()),
    async set(hosts: readonly string[]): Promise<HiveSandboxSetting> {
      await setSandboxDomains(root, hosts);
      return read();
    },
  };
}

export type HiveSandboxService = ReturnType<typeof hiveSandboxService>;

/** A workspace's writer folder in Symbiote's cache: one per worktree (decision 1063). */
export function writerFolder(cacheDir: string, worktree: string): string {
  const id = createHash('sha256').update(worktree).digest('hex').slice(0, 16);
  return join(cacheDir, 'writers', id);
}

/**
 * The variables the writer's `env` sets: an empty gh folder, the installs' caches (1053). Never
 * `TMPDIR`: the sandbox makes its sockets there, and a path that long stopped every command
 * (Claude Code 2.1.325, "Failed to create bridge sockets"); its own temp folder is writable.
 */
function writerEnv(folder: string): Record<string, string> {
  const cache = join(folder, 'cache');
  return {
    GH_CONFIG_DIR: join(folder, 'gh'),
    npm_config_cache: join(cache, 'npm'),
    npm_config_store_dir: join(cache, 'pnpm'),
    YARN_CACHE_FOLDER: join(cache, 'yarn'),
    BUN_INSTALL_CACHE_DIR: join(cache, 'bun'),
    PIP_CACHE_DIR: join(cache, 'pip'),
    CARGO_HOME: join(cache, 'cargo'),
    GOPATH: join(cache, 'go'),
    GOMODCACHE: join(cache, 'go', 'pkg', 'mod'),
    GOCACHE: join(cache, 'go-build'),
  };
}

/** The person's credential files the sandbox hides (decision 1051). */
const CREDENTIAL_FILES = [
  '~/.config/gh',
  '~/.config/glab-cli',
  '~/.ssh',
  '~/.git-credentials',
  '~/.netrc',
];

/**
 * Claude Code's tools that reach claude.ai or the web: no sandbox stands between them and the
 * network (HV10a). `WebFetch` lives in the built-in `web-fetch` agent since 2.1.323; the deny
 * removes it.
 */
const DENIED_TOOLS = [
  'WebFetch',
  'WebSearch',
  'RemoteTrigger',
  'SendToProject',
  'ArtifactComments',
  'PushNotification',
];

/**
 * The variables the sandbox hides (decision 1051): the forge's tokens, then every secret-named
 * variable Symbiote sees, by name; Claude Code's own (`CLAUDE_CODE_*`) left to it.
 */
export function writerSecretNames(env: Readonly<Record<string, string | undefined>>): string[] {
  const named = Object.keys(env)
    .filter((name) => !name.startsWith('CLAUDE_CODE_') && secretName(name))
    .filter((name) => !FORGE_TOKENS.includes(name))
    .sort();
  return [...FORGE_TOKENS, ...named];
}

/** A path as an absolute Edit rule: `//abs/path`. */
const absolute = (path: string) => `/${path.startsWith('/') ? path : `/${path}`}`;

/**
 * An issue writer's settings file (decisions 1050–1054, 1063): Symbiote's hooks; the variables in
 * `env`; the sandbox on and required, every command in it, the worktree and the cache its only
 * writes, the hosts given its only network, the credentials hidden; the web and claude.ai tools
 * denied, and edits of Symbiote's own files (its settings, its hook, `protect`).
 */
export function issueWriterSettings({
  hooks,
  folder,
  cacheDir,
  hosts,
  secrets,
  protect,
}: {
  hooks: { hooks?: unknown };
  folder: string;
  cacheDir: string;
  hosts: readonly string[];
  secrets: readonly string[];
  protect: readonly string[];
}): string {
  const settings = {
    ...(hooks.hooks ? { hooks: hooks.hooks } : {}),
    env: writerEnv(folder),
    permissions: {
      deny: [
        ...DENIED_TOOLS,
        `Edit(${absolute(join(cacheDir, 'writers'))}/**)`,
        `Edit(${absolute(join(cacheDir, 'hooks'))}/**)`,
        ...protect.map((path) => `Edit(${absolute(path)})`),
      ],
    },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      network: { allowLocalBinding: true, allowedDomains: [...hosts] },
      filesystem: { allowWrite: [join(folder, 'cache')] },
      credentials: {
        files: CREDENTIAL_FILES.map((path) => ({ path, mode: 'deny' })),
        envVars: secrets.map((name) => ({ name, mode: 'deny' })),
      },
    },
  };
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/**
 * The paths Claude Code's sandbox mounts `/dev/null` at in a worktree that lacks them, to deny
 * writing them (measured on 2.1.323 in HV10a and again on 2.1.325: 11 at the root, 12 under
 * `.claude/`). Git lists them as untracked and `git add -A` fails on them.
 */
export const SANDBOX_PLACEHOLDERS = [
  '.bash_profile',
  '.bashrc',
  '.gitconfig',
  '.gitmodules',
  '.idea',
  '.mcp.json',
  '.profile',
  '.ripgreprc',
  '.vscode',
  '.zprofile',
  '.zshrc',
  '.claude/agents',
  '.claude/commands',
  '.claude/hooks',
  '.claude/launch.json',
  '.claude/loop.md',
  '.claude/output-styles',
  '.claude/routines',
  '.claude/scheduled_tasks.json',
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.claude/skills',
  '.claude/workflows',
] as const;

const EXCLUDE_HEAD =
  "# Symbiote (HV10): Claude Code's sandbox mounts these in an issue writer's worktree; untracked only";

/**
 * The placeholders in the repository's `info/exclude` (decision 1054), once: a linked worktree
 * reads the main checkout's. Anchored at the root; a tracked file is never affected.
 */
export async function excludePlaceholders(commonDir: string): Promise<void> {
  const file = join(commonDir, 'info', 'exclude');
  const text = await readFile(file, 'utf8').catch(() => '');
  if (text.includes(EXCLUDE_HEAD)) return;
  await mkdir(join(commonDir, 'info'), { recursive: true });
  const lines = [EXCLUDE_HEAD, ...SANDBOX_PLACEHOLDERS.map((path) => `/${path}`)];
  await appendFile(file, `${text === '' || text.endsWith('\n') ? '' : '\n'}${lines.join('\n')}\n`);
}

/**
 * The writer's folder made for `worktree` (decision 1063): its cache's folders (a sandbox path
 * that does not exist yet has no effect on Linux), the empty gh folder and its settings file,
 * written when they differ; the placeholders excluded. The settings file's path.
 */
export async function prepareWriter({
  cacheDir,
  worktree,
  commonDir,
  root,
  hooks,
  env,
  protect,
}: {
  cacheDir: string;
  worktree: string;
  commonDir: string;
  /** Where the project's config is: `hive.sandbox.allowedDomains`. */
  root: string;
  hooks: { hooks?: unknown };
  env: Readonly<Record<string, string | undefined>>;
  protect: readonly string[];
}): Promise<string> {
  const folder = writerFolder(cacheDir, worktree);
  const variables = writerEnv(folder);
  for (const [name, path] of Object.entries(variables)) {
    if (name !== 'GH_CONFIG_DIR') await mkdir(path, { recursive: true });
  }
  await mkdir(variables.GH_CONFIG_DIR ?? join(folder, 'gh'), { recursive: true });
  const text = issueWriterSettings({
    hooks,
    folder,
    cacheDir,
    hosts: writerHosts(ecosystemsIn(worktree), readSandboxDomains(root)),
    secrets: writerSecretNames(env),
    protect,
  });
  const path = join(folder, 'settings.json');
  if ((await readFile(path, 'utf8').catch(() => null)) !== text) await writeFileWhole(path, text);
  await excludePlaceholders(commonDir);
  return path;
}

/** Makes every folder under `path` writable: Go keeps its module cache read-only (HV10a). */
async function writable(path: string): Promise<void> {
  await chmod(path, 0o700).catch(() => undefined);
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory()) await writable(join(path, entry.name));
  }
}

/** Removes `worktree`'s writer folder with its workspace (decision 1053); none is no error. */
export async function removeWriter(cacheDir: string, worktree: string): Promise<void> {
  const folder = writerFolder(cacheDir, worktree);
  if (!existsSync(folder)) return;
  await writable(folder);
  await rm(folder, { recursive: true, force: true });
}

/** Each host Claude Code's sandbox refused, as its commands' output names it (decision 1064). */
export function refusedHosts(text: string): string[] {
  const hosts = [...text.matchAll(/\bdeny network-outbound (\S+)/g)].map((m) => m[1] ?? '');
  return [...new Set(hosts.filter((h) => h !== ''))];
}
