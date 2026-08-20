import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { webSearch } from './browser';

/**
 * Background topic monitoring - strictly opt-in. Atlas must never start
 * monitoring a topic on its own; a topic only exists here because the
 * operator explicitly named it once via addMonitoredTopic(). This module
 * only checks topics and reports what changed - it never alerts anyone
 * itself. The caller (the daily-interval scheduler someone else wires up)
 * is responsible for actually notifying, probably via showNotification()
 * in ./notifications.ts.
 */

export interface MonitoredTopic {
  id: string;
  query: string;
  addedAt: number;
  lastHeadline?: string;
  lastCheckedAt?: number;
}

// Hard block, not a suggestion - financial/crypto/trading topics are
// rejected before a topic is ever added, regardless of how the request is
// phrased. Case-insensitive substring match against the query.
const BLOCKED_KEYWORDS = [
  'crypto',
  'cryptocurrency',
  'bitcoin',
  'btc',
  'ethereum',
  'eth',
  'altcoin',
  'nft',
  'defi',
  'web3',
  'blockchain',
  'stock',
  'stocks',
  'stock market',
  'shares',
  'equities',
  'equity market',
  'nasdaq',
  'dow jones',
  's&p 500',
  's&p500',
  'trading',
  'day trading',
  'day trader',
  'forex',
  'fx trading',
  'options trading',
  'futures trading',
  'margin trading',
  'leverage trading',
  'investment advice',
  'investing advice',
  'financial advice',
  'financial advisor',
  'portfolio management',
  'hedge fund',
  'mutual fund',
  'index fund',
  'ipo',
  'dividend',
  'interest rate',
  'commodities trading',
  'gold trading',
  'currency trading',
  'wall street',
];

function filePath(): string {
  return path.join(app.getPath('userData'), 'monitored-topics.json');
}

function readTopics(): MonitoredTopic[] {
  try {
    const p = filePath();
    if (!fs.existsSync(p)) return [];
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeTopics(topics: MonitoredTopic[]): void {
  const p = filePath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    // Write to a temp file and rename over the target - same atomic-write
    // pattern as store.ts, so a process death mid-write never leaves a
    // truncated/corrupted topic list.
    const tmp = `${p}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(topics, null, 2), 'utf8');
    fs.renameSync(tmp, p);
  } catch {
    // A failed persist should degrade to "in-memory value only" for this
    // call, not throw through read paths.
  }
}

export function isTopicBlocked(query: string): boolean {
  const q = query.toLowerCase();
  return BLOCKED_KEYWORDS.some((kw) => q.includes(kw));
}

export function addMonitoredTopic(query: string): { ok: boolean; topic?: MonitoredTopic; error?: string } {
  const trimmed = query.trim();
  if (!trimmed) {
    return { ok: false, error: 'Topic query cannot be empty.' };
  }
  if (isTopicBlocked(trimmed)) {
    return { ok: false, error: 'Financial/crypto topics are blocked.' };
  }
  const topics = readTopics();
  const topic: MonitoredTopic = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    query: trimmed,
    addedAt: Date.now(),
  };
  topics.push(topic);
  writeTopics(topics);
  return { ok: true, topic };
}

export function removeMonitoredTopic(id: string): void {
  const topics = readTopics().filter((t) => t.id !== id);
  writeTopics(topics);
}

export function listMonitoredTopics(): MonitoredTopic[] {
  return readTopics();
}

export async function checkTopicForUpdate(
  id: string,
): Promise<{ ok: boolean; changed?: boolean; headline?: string; error?: string }> {
  const topics = readTopics();
  const topic = topics.find((t) => t.id === id);
  if (!topic) {
    return { ok: false, error: 'Topic not found.' };
  }

  const result = await webSearch(topic.query, 1);
  if (!result.ok) {
    return { ok: false, error: result.error || 'Search failed.' };
  }

  const headline = result.results[0]?.title;
  if (!headline) {
    return { ok: false, error: 'No results found for topic.' };
  }

  const changed = topic.lastHeadline !== undefined && topic.lastHeadline !== headline;

  topic.lastHeadline = headline;
  topic.lastCheckedAt = Date.now();
  writeTopics(topics);

  return { ok: true, changed, headline };
}

export async function checkAllTopics(): Promise<{ id: string; changed: boolean; headline?: string }[]> {
  const topics = readTopics();
  const changes: { id: string; changed: boolean; headline?: string }[] = [];

  for (const topic of topics) {
    const result = await checkTopicForUpdate(topic.id);
    if (result.ok && result.changed) {
      changes.push({ id: topic.id, changed: true, headline: result.headline });
    }
  }

  return changes;
}
