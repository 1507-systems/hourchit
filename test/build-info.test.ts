import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/**
 * Run the stamper against a throwaway copy of itself.
 *
 * It writes src/build-info.generated.ts next to its own location, so testing it
 * in place would rewrite the stamp the rest of the suite already imported , 
 * order-dependent and, worse, it would leave a wrong stamp behind for whatever
 * ran next. A temp tree isolates it completely and lets the no-git case be real
 * rather than mocked.
 */
function stamp({
  git,
  env = {},
  ciShaIsHead = false,
}: {
  git: boolean;
  env?: Record<string, string>;
  /** Set WORKERS_CI_COMMIT_SHA to the fixture's own HEAD, the core-repo CI case. */
  ciShaIsHead?: boolean;
}) {
  const dir = mkdtempSync(join(tmpdir(), 'hourchit-buildinfo-'));
  try {
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    mkdirSync(join(dir, 'src'), { recursive: true });
    cpSync(join(ROOT, 'scripts', 'generate-build-info.mjs'), join(dir, 'scripts', 'generate-build-info.mjs'));

    let head = '';
    if (git) {
      const g = (...args: string[]) =>
        execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      g('init', '-q');
      g('config', 'user.email', 'test@example.test');
      g('config', 'user.name', 'test');
      g('commit', '-q', '--allow-empty', '-m', 'stamp fixture');
      head = g('rev-parse', 'HEAD').trim();
    }

    execFileSync('node', [join(dir, 'scripts', 'generate-build-info.mjs')], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      // Wipe the inherited CI variables, this suite itself runs in CI, where
      // GITHUB_SHA is set and would leak into every case.
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        // Stop git from discovering a repository above the temp directory in
        // the no-git case; otherwise it would report an unrelated sha.
        GIT_CEILING_DIRECTORIES: tmpdir(),
        ...(ciShaIsHead ? { WORKERS_CI_COMMIT_SHA: head } : {}),
        ...env,
      },
    });

    const out = readFileSync(join(dir, 'src', 'build-info.generated.ts'), 'utf8');
    const read = (name: string) => out.match(new RegExp(`${name} = "([^"]*)"`))?.[1];
    return { head, gitSha: read('GIT_SHA'), configSha: read('CONFIG_SHA') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const FAKE_CI_SHA = 'a'.repeat(40);

describe('build stamp', () => {
  it('reports this tree via git when there are no CI variables', () => {
    const { head, gitSha, configSha } = stamp({ git: true });
    expect(gitSha).toBe(head.slice(0, 12));
    expect(configSha).toBe('');
  });

  /**
   * The case that matters. A managed tenant build clones this core at a pinned
   * ref inside a checkout of the *config* repo, so WORKERS_CI_COMMIT_SHA is the
   * config repo's commit. If that won, /health would advertise a sha from a
   * different history and the drift check would compare unrelated repositories
   *, silently, since the value looks like a perfectly good sha.
   */
  it('keeps the core sha when CI is building a different repository', () => {
    const { head, gitSha, configSha } = stamp({
      git: true,
      env: { WORKERS_CI_COMMIT_SHA: FAKE_CI_SHA },
    });
    expect(gitSha).toBe(head.slice(0, 12));
    expect(configSha).toBe(FAKE_CI_SHA.slice(0, 12));
  });

  // The core repo's own CI: the commit CI is building IS this tree, so there is
  // no second repository to report.
  it('leaves the config sha empty when CI is building this repository', () => {
    const { head, gitSha, configSha } = stamp({ git: true, ciShaIsHead: true });
    expect(gitSha).toBe(head.slice(0, 12));
    expect(configSha).toBe('');
  });

  it('falls back to the CI sha when there is no git checkout', () => {
    const { gitSha, configSha } = stamp({ git: false, env: { GITHUB_SHA: FAKE_CI_SHA } });
    expect(gitSha).toBe(FAKE_CI_SHA.slice(0, 12));
    // The fallback made them the same commit, so there is no separate config.
    expect(configSha).toBe('');
  });

  it('says unknown rather than inventing a sha', () => {
    const { gitSha, configSha } = stamp({ git: false });
    expect(gitSha).toBe('unknown');
    expect(configSha).toBe('');
  });
});
