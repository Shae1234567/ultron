import { env } from './env';

/**
 * The GitHub connector's real implementation. Free tier: a personal access
 * token, no OAuth flow needed, 5,000 REST requests/hour. Every function
 * reads GITHUB_TOKEN from .env and returns an honest {ok:false} on any
 * failure - never a fabricated repo list.
 */

const UA = 'Atlas-Personal-Assistant/0.1 (local desktop app; no distribution)';
const TIMEOUT_MS = 10000;

export interface GitHubUser {
  login: string;
  name: string | null;
  avatarUrl: string;
  profileUrl: string;
}

export interface GitHubRepo {
  name: string;
  fullName: string;
  url: string;
  private: boolean;
  stars: number;
  updatedAt: string;
  description: string | null;
}

export interface GitHubIssue {
  title: string;
  repo: string;
  url: string;
  isPullRequest: boolean;
  updatedAt: string;
  state: string;
}

function token(): string {
  return env('GITHUB_TOKEN');
}

export function hasToken(): boolean {
  return Boolean(token());
}

async function ghFetch(path: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  const t = token();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.github.com${path}`, {
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${t}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': UA,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/** Verifies the token actually works and returns who it belongs to. */
export async function verify(): Promise<{ ok: boolean; user?: GitHubUser; error?: string }> {
  if (!token()) return { ok: false, error: 'No GITHUB_TOKEN set.' };
  try {
    const { ok, status, data } = await ghFetch('/user');
    if (!ok) {
      const d = data as { message?: string } | null;
      if (status === 401) return { ok: false, error: 'Token was rejected (401) - it may be invalid, expired, or revoked.' };
      return { ok: false, error: d?.message ? `GitHub ${status}: ${d.message}` : `GitHub responded ${status}.` };
    }
    const u = data as { login: string; name: string | null; avatar_url: string; html_url: string };
    return { ok: true, user: { login: u.login, name: u.name, avatarUrl: u.avatar_url, profileUrl: u.html_url } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Recently updated repos the token can see - own + collaborator repos. */
export async function getRepos(limit = 10): Promise<GitHubRepo[]> {
  if (!token()) return [];
  try {
    const { ok, data } = await ghFetch(`/user/repos?sort=updated&per_page=${limit}&affiliation=owner,collaborator`);
    if (!ok || !Array.isArray(data)) return [];
    return (data as Array<{
      name: string; full_name: string; html_url: string; private: boolean;
      stargazers_count: number; updated_at: string; description: string | null;
    }>).map((r) => ({
      name: r.name,
      fullName: r.full_name,
      url: r.html_url,
      private: r.private,
      stars: r.stargazers_count,
      updatedAt: r.updated_at,
      description: r.description,
    }));
  } catch {
    return [];
  }
}

/** Open issues and PRs assigned to (or authored by) the token's owner, across every repo. */
export async function getOpenWork(limit = 15): Promise<GitHubIssue[]> {
  if (!token()) return [];
  try {
    const { ok, data } = await ghFetch(`/issues?filter=all&state=open&per_page=${limit}&sort=updated`);
    if (!ok || !Array.isArray(data)) return [];
    return (data as Array<{
      title: string; html_url: string; repository_url: string; updated_at: string;
      state: string; pull_request?: unknown;
    }>).map((i) => ({
      title: i.title,
      repo: i.repository_url.split('/').slice(-2).join('/'),
      url: i.html_url,
      isPullRequest: Boolean(i.pull_request),
      updatedAt: i.updated_at,
      state: i.state,
    }));
  } catch {
    return [];
  }
}
