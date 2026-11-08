// IS1: the Issues page's words and addresses.
import type { Issue, IssueSummary } from '@symbiote/core';
import { describe, expect, it } from 'vitest';
import {
  commentsWords,
  emptyWords,
  forgeIssuesUrl,
  issueAddress,
  issueLine,
  labelColour,
  listAddress,
  problemTitle,
  roleWord,
  rowLabels,
  tokenNote,
} from '../src/issues/issues.js';

const NOW = Date.parse('2026-11-08T12:00:00Z');
const issue: IssueSummary = {
  forge: 'github',
  number: 12,
  title: 'It breaks',
  url: 'https://github.com/acme/app/issues/12',
  state: 'open',
  labels: [],
  author: { login: 'ada', role: 'none' },
  comments: 3,
  created: '2026-11-01T10:00:00Z',
  updated: '2026-11-08T09:00:00Z',
};

describe('the Issues page (IS1)', () => {
  it('asks for a list and an issue', () => {
    expect(listAddress('open', '')).toBe('/api/issues?state=open');
    expect(listAddress('all', ' watch & run ', '2~a+b/=~7')).toBe(
      '/api/issues?state=all&q=watch+%26+run&cursor=2%7Ea%2Bb%2F%3D%7E7',
    );
    expect(issueAddress(12)).toBe('/api/issues/12');
  });

  it('says who, when and how many comments', () => {
    expect(issueLine(issue, NOW)).toBe('ada · updated 3 hours ago · 3 comments');
    expect(issueLine({ ...issue, comments: 1, author: { login: 'bot', bot: true } }, NOW)).toBe(
      'bot (bot) · updated 3 hours ago · 1 comment',
    );
    expect(issueLine({ ...issue, comments: 0, updated: '2026-11-08T11:59:30Z' }, NOW)).toBe(
      'ada · updated just now',
    );
  });

  it('names a role, and none for no standing', () => {
    expect(roleWord('owner')).toBe('Owner');
    expect(roleWord('first-time contributor')).toBe('First-time contributor');
    expect(roleWord('none')).toBeUndefined();
    expect(roleWord(undefined)).toBeUndefined();
  });

  it('says what is empty', () => {
    expect(emptyWords('open', '')).toBe('No open issues.');
    expect(emptyWords('all', '')).toBe('No issues.');
    expect(emptyWords('closed', ' crash ')).toBe('No closed issues with “crash” in their title.');
  });

  it('heads each problem', () => {
    expect(problemTitle({ kind: 'no-origin', message: '' })).toBe('No origin');
    expect(problemTitle({ kind: 'no-forge', message: '' })).toBe(
      'origin is not on GitHub or GitLab',
    );
    expect(problemTitle({ kind: 'forge', message: '' }, 'gitlab')).toBe('GitLab did not answer');
  });

  it('says what of the comments is not shown', () => {
    const whole: Issue = { ...issue, body: '', thread: [], moreComments: 0 };
    expect(commentsWords(whole)).toBe('No comments.');
    expect(commentsWords({ ...whole, moreComments: 30 })).toBe(
      '30 more comments on GitHub, past the first 100.',
    );
    expect(
      commentsWords({ ...whole, forge: 'gitlab', moreComments: 3, commentsNeedToken: true }),
    ).toBe('3 comments: GitLab shows them only with a token (GITLAB_TOKEN).');
  });

  it('links the project’s issues on its forge', () => {
    expect(forgeIssuesUrl({ kind: 'github', host: 'github.com', project: 'acme/app' })).toBe(
      'https://github.com/acme/app/issues',
    );
    expect(forgeIssuesUrl({ kind: 'gitlab', host: 'gitlab.example', project: 'a/b/c' })).toBe(
      'https://gitlab.example/a/b/c/-/issues',
    );
  });

  it('colours a label’s dot only with a colour', () => {
    expect(labelColour('#b3c4dd')).toBe('#b3c4dd');
    expect(labelColour('red;background:url(x)')).toBeUndefined();
    expect(labelColour(undefined)).toBeUndefined();
  });

  it('says what is read without a token, and what to set', () => {
    const forge = { kind: 'github', host: 'github.com', project: 'acme/app' } as const;
    expect(tokenNote({ forge, token: true })).toBeUndefined();
    expect(
      tokenNote({
        forge,
        token: false,
        tokenHint:
          'no GitHub token for github.com: set GITHUB_TOKEN or GH_TOKEN, or log in with gh auth login',
      }),
    ).toBe(
      'Read without a token: public issues only, 60 requests an hour. No GitHub token for github.com: set GITHUB_TOKEN or GH_TOKEN, or log in with gh auth login.',
    );
    expect(tokenNote({ forge: { ...forge, kind: 'gitlab' }, token: false })).toBe(
      'Read without a token: public issues only, without their comments.',
    );
  });

  it('shows 4 labels in a row and how many more; 5 whole', () => {
    expect(rowLabels([1, 2, 3, 4, 5])).toEqual({ shown: [1, 2, 3, 4, 5], more: 0 });
    expect(rowLabels([1, 2, 3, 4, 5, 6, 7])).toEqual({ shown: [1, 2, 3, 4], more: 3 });
  });
});
