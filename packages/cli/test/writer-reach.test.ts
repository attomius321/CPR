// HV10b: what an issue's writer may reach (decisions 1015, 1050–1054, 1063, 1064). Its settings:
// the variables in `env`, Claude Code's sandbox as the reviewer's with the credentials denied, the
// hosts of the repository's ecosystems and `hive.sandbox.allowedDomains`, one install cache, the
// web tools and the claude.ai tools denied; the sandbox's placeholders excluded from git.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRepo, tempDir, type TestRepo } from '../../core/test/helpers/git-repo.js';
import {
  SANDBOX_PLACEHOLDERS,
  ecosystemsAt,
  excludePlaceholders,
  issueWriterSettings,
  prepareWriter,
  readSandboxDomains,
  refusedHosts,
  removeWriter,
  setSandboxDomains,
  writerFolder,
  writerHosts,
  writerSecretNames,
} from '../src/writer-reach.js';

const repos: TestRepo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
});

const HOOKS = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node hook.js' }] }] } };

describe("the hosts a writer's installs need (decision 1052)", () => {
  it("finds each ecosystem by the files at the worktree's root", () => {
    const found = ecosystemsAt([
      'package-lock.json',
      'go.sum',
      'requirements-dev.txt',
      'App.csproj',
      'README.md',
    ]);
    expect(found.map((e) => [e.name, e.files])).toEqual([
      ['npm', ['package-lock.json']],
      ['Python', ['requirements-dev.txt']],
      ['Go', ['go.sum']],
      ['NuGet', ['App.csproj']],
    ]);
    expect(found.find((e) => e.name === 'Go')?.hosts).toEqual([
      'proxy.golang.org',
      'sum.golang.org',
      'storage.googleapis.com',
    ]);
    expect(ecosystemsAt(['pnpm-lock.yaml', 'yarn.lock', 'Cargo.lock'])).toMatchObject([
      { name: 'npm', hosts: ['registry.npmjs.org'] },
      { name: 'Yarn', hosts: ['registry.yarnpkg.com', 'repo.yarnpkg.com'] },
      { name: 'Cargo', hosts: ['index.crates.io', 'static.crates.io'] },
    ]);
    expect(ecosystemsAt([])).toEqual([]);
  });

  it('allows those hosts and the setting, once each; never a forge host the repository did not list', () => {
    const hosts = writerHosts(ecosystemsAt(['package-lock.json', 'deno.json', 'composer.lock']), [
      'npm.internal.example',
    ]);
    expect(hosts).toEqual([
      'registry.npmjs.org',
      'repo.packagist.org',
      'jsr.io',
      'deno.land',
      'npm.internal.example',
    ]);
    expect(hosts).not.toContain('github.com');
    expect(hosts).not.toContain('api.github.com');
  });

  it('reads and writes hive.sandbox.allowedDomains: hosts only, lowercase, once each', async () => {
    const root = tempDir();
    expect(readSandboxDomains(root)).toEqual([]);
    mkdirSync(join(root, 'symbiote'), { recursive: true });
    writeFileSync(
      join(root, 'symbiote', 'config.json'),
      JSON.stringify({
        hive: {
          sandbox: {
            allowedDomains: ['GitHub.com', '*.corp.example', 'github.com', 'bad host', 3, 'x:443'],
          },
        },
      }),
    );
    expect(readSandboxDomains(root)).toEqual(['github.com', '*.corp.example', 'x:443']);
    await setSandboxDomains(root, ['npm.corp.example', 'npm.corp.example']);
    expect(readSandboxDomains(root)).toEqual(['npm.corp.example']);
    await expect(setSandboxDomains(root, ['https://x.example/'])).rejects.toThrow(
      'Not a host: https://x.example/',
    );
    await setSandboxDomains(root, []);
    expect(JSON.parse(readFileSync(join(root, 'symbiote', 'config.json'), 'utf8'))).toEqual({});
  });
});

describe("an issue writer's settings (decisions 1050–1054, 1063)", () => {
  const cacheDir = '/c/symbiote';
  const folder = writerFolder(cacheDir, '/w/fix-12');
  const settings = () =>
    JSON.parse(
      issueWriterSettings({
        hooks: HOOKS,
        folder,
        cacheDir,
        hosts: ['registry.npmjs.org'],
        secrets: ['GITHUB_TOKEN', 'NPM_TOKEN'],
        protect: ['/r/symbiote/claude-settings.json'],
      }),
    ) as Record<string, Record<string, unknown>>;

  it("is kept in Symbiote's cache, a folder per worktree", () => {
    expect(folder.startsWith('/c/symbiote/writers/')).toBe(true);
    expect(writerFolder(cacheDir, '/w/fix-12')).toBe(folder);
    expect(writerFolder(cacheDir, '/w/fix-13')).not.toBe(folder);
  });

  it("keeps Symbiote's hooks", () => {
    expect(settings().hooks).toEqual(HOOKS.hooks);
  });

  it('sets the variables in env: an empty gh folder, every install cache in one folder; never TMPDIR', () => {
    const cache = join(folder, 'cache');
    expect(settings().env).toEqual({
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
    });
    // The sandbox makes its sockets in TMPDIR: a cache's path too long for one stopped every
    // command (2.1.325, "Failed to create bridge sockets"); its own temp folder is writable.
    expect(settings().env).not.toHaveProperty('TMPDIR');
  });

  it("runs every command in Claude Code's sandbox, none outside, writing only the worktree and the cache", () => {
    const sandbox = settings().sandbox as Record<string, unknown>;
    expect(sandbox).toMatchObject({
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      // strictAllowlist: no command widens it with its own allowed_domains (2.1.325 lets one,
      // reviewed by auto mode's classifier).
      network: {
        allowLocalBinding: true,
        allowedDomains: ['registry.npmjs.org'],
        strictAllowlist: true,
      },
      filesystem: { allowWrite: [join(folder, 'cache')] },
    });
  });

  it("hides the forge's credentials: the files and the variables (decision 1051)", () => {
    const { credentials } = settings().sandbox as {
      credentials: { files: unknown[]; envVars: unknown[] };
    };
    expect(credentials.files).toEqual(
      ['~/.config/gh', '~/.config/glab-cli', '~/.ssh', '~/.git-credentials', '~/.netrc'].map(
        (path) => ({ path, mode: 'deny' }),
      ),
    );
    expect(credentials.envVars).toEqual([
      { name: 'GITHUB_TOKEN', mode: 'deny' },
      { name: 'NPM_TOKEN', mode: 'deny' },
    ]);
  });

  it("denies the web, claude.ai's and other sessions' tools, and edits of Symbiote's own files", () => {
    expect(settings().permissions).toEqual({
      deny: [
        'WebFetch',
        'WebSearch',
        // claude.ai's, as Claude Code 2.1.325 lists them to a writer (HV10b's real run).
        'Artifact',
        'ArtifactData',
        'ArtifactComments',
        'DesignSync',
        'SendToProject',
        'SendToProjectContext',
        'PushNotification',
        // The person's other sessions, Nucleus among them, and their routines (every agent's,
        // 1078); a message to one.
        'ListAgents',
        'RemoteTrigger',
        'SendMessage',
        // Its own settings file only: an Edit deny is a write deny in the sandbox too, and one on
        // the writers' folder made the install cache read-only (the real run's npm).
        `Edit(/${folder}/settings.json)`,
        'Edit(//c/symbiote/hooks/**)',
        'Edit(//r/symbiote/claude-settings.json)',
      ],
    });
  });

  it('hides every forge token and every secret-named variable Symbiote sees, not Claude Code’s own', () => {
    expect(
      writerSecretNames({
        PATH: '/usr/bin',
        HOME: '/h',
        NPM_TOKEN: 'x',
        AWS_SECRET_ACCESS_KEY: 'x',
        OPENAI_API_KEY: 'x',
        CLAUDE_CODE_MESSAGING_TOKEN: 'x',
        SSH_AUTH_SOCK: '/s',
      }),
    ).toEqual([
      'GITHUB_TOKEN',
      'GH_TOKEN',
      'GH_ENTERPRISE_TOKEN',
      'GITHUB_ENTERPRISE_TOKEN',
      'GITLAB_TOKEN',
      'CI_JOB_TOKEN',
      'AWS_SECRET_ACCESS_KEY',
      'NPM_TOKEN',
      'OPENAI_API_KEY',
    ]);
  });
});

describe("the writer's folder on disk (decisions 1053, 1054)", () => {
  it('makes the cache and the empty gh folder, writes the settings, and excludes the placeholders once', async () => {
    const repo = createRepo();
    repos.push(repo);
    repo.write({ 'package-lock.json': '{}\n' });
    repo.commit('A');
    const cacheDir = tempDir();
    const path = await prepareWriter({
      cacheDir,
      worktree: repo.root,
      commonDir: join(repo.root, '.git'),
      root: repo.root,
      hooks: HOOKS,
      env: { GITHUB_TOKEN: 'x' },
      protect: [],
    });
    const folder = writerFolder(cacheDir, repo.root);
    expect(path).toBe(join(folder, 'settings.json'));
    const written = JSON.parse(readFileSync(path, 'utf8')) as {
      sandbox: { network: { allowedDomains: string[] } };
    };
    expect(written.sandbox.network.allowedDomains).toEqual(['registry.npmjs.org']);
    for (const sub of ['cache/npm', 'cache/pnpm', 'cache/go/pkg/mod', 'gh']) {
      expect(existsSync(join(folder, sub))).toBe(true);
    }
    // The sandbox's placeholders: ignored, so `git add -A` passes (HV10a; 23 on 2.1.325).
    for (const name of SANDBOX_PLACEHOLDERS) {
      const path = join(repo.root, name);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, '');
    }
    expect(repo.git('status', '--porcelain', '--untracked-files=all')).toBe('');
    const exclude = readFileSync(join(repo.root, '.git', 'info', 'exclude'), 'utf8');
    await excludePlaceholders(join(repo.root, '.git'));
    expect(readFileSync(join(repo.root, '.git', 'info', 'exclude'), 'utf8')).toBe(exclude);
    expect(SANDBOX_PLACEHOLDERS).toHaveLength(23);
  });

  it("removes the folder with the workspace, Go's read-only module cache too", async () => {
    const cacheDir = tempDir();
    const folder = writerFolder(cacheDir, '/w/x');
    const mod = join(folder, 'cache', 'go', 'pkg', 'mod', 'example.com', 'm@v1');
    mkdirSync(mod, { recursive: true });
    writeFileSync(join(mod, 'go.mod'), 'module m\n');
    chmodSync(join(mod, 'go.mod'), 0o444);
    chmodSync(mod, 0o555);
    await removeWriter(cacheDir, '/w/x');
    expect(existsSync(folder)).toBe(false);
    await removeWriter(cacheDir, '/w/none');
  });
});

describe('a host the sandbox refused (decision 1064)', () => {
  it("reads each host from Claude Code's words, once", () => {
    expect(
      refusedHosts(
        'npm error network request failed\ndeny network-outbound api.github.com:443\n' +
          'deny network-outbound evil.example\ndeny network-outbound api.github.com:443\n' +
          // The writer's own words around it, as the real run's probes.txt had them.
          '6. 2026/11/14 1 (sandbox: deny network-outbound github.com:22)',
      ),
    ).toEqual(['api.github.com:443', 'evil.example', 'github.com:22']);
    expect(refusedHosts('all good')).toEqual([]);
  });
});
