/**
 * AI inbox scoring for peep.
 *
 * Ranks mentions and DMs for actionability using OpenAI or heuristic fallbacks.
 * Inspired by birdclaw's inbox system.
 */

import type Database from 'better-sqlite3';
import { getAiScore, setAiScore } from './local-cache.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InboxItem {
  id: string;
  entityId: string;
  entityKind: 'mention' | 'dm' | 'like' | 'bookmark';
  title: string;
  text: string;
  createdAt?: string;
  needsReply: boolean;
  influenceScore: number;
  participant: {
    username: string;
    name: string;
    followersCount?: number;
  };
  score: number;
  summary: string;
  reasoning: string;
  source: 'openai' | 'heuristic';
}

export interface InboxScoreInput {
  entityKind: 'mention' | 'dm' | 'like' | 'bookmark';
  title: string;
  text: string;
  influenceScore: number;
  participant: {
    handle: string;
    displayName: string;
    bio?: string;
    followersCount?: number;
  };
}

export interface OpenAIScoreResult {
  score: number;
  summary: string;
  reasoning: string;
  model: string;
}

// ---------------------------------------------------------------------------
// Heuristic scoring
// ---------------------------------------------------------------------------

function getHeuristicScoreForMention(text: string, followersCount: number): number {
  const influence = Math.min(32, Math.round(Math.log10(followersCount + 10) * 18));
  const specificityBoost = text.includes('?') ? 8 : 0;
  const lengthBoost = text.length > 100 ? 4 : 0;
  return Math.max(0, Math.min(100, 44 + influence + specificityBoost + lengthBoost));
}

function getHeuristicScoreForDm(followersCount: number, unreadCount = 0, needsReply = false): number {
  const unreadBoost = Math.min(15, unreadCount * 5);
  const replyBoost = needsReply ? 12 : 0;
  return Math.max(0, Math.min(100, 34 + Math.round(followersCount * 0.32) + unreadBoost + replyBoost));
}

// ---------------------------------------------------------------------------
// OpenAI scoring
// ---------------------------------------------------------------------------

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export async function scoreWithOpenAI(input: InboxScoreInput): Promise<OpenAIScoreResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const model = process.env.PEEP_OPENAI_MODEL || 'gpt-4o-mini';

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'You rank inbound X mentions and DMs for the authenticated user.',
            'Return JSON only with keys: score, summary, reasoning.',
            'Score 0-100. High score = worth replying soon.',
            'Prefer specific, actionable, novel, high-signal items.',
            'Penalize generic praise, low-context asks, and low-signal chatter.',
            'summary: max 18 words. reasoning: max 28 words.',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify(input),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.status}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned no content');

  const parsed = JSON.parse(content) as { score?: number; summary?: string; reasoning?: string };

  return {
    model,
    score: clampScore(parsed.score ?? 0),
    summary: String(parsed.summary ?? 'No summary'),
    reasoning: String(parsed.reasoning ?? 'No reasoning'),
  };
}

// ---------------------------------------------------------------------------
// Build inbox from cached mentions
// ---------------------------------------------------------------------------

export interface InboxQueryOptions {
  kind?: 'mentions' | 'dm' | 'mixed';
  minScore?: number;
  hideLowSignal?: boolean;
  limit?: number;
}

export interface InboxResponse {
  items: InboxItem[];
  stats: { total: number; openai: number; heuristic: number };
}

/**
 * Build an inbox from locally cached tweets that are mentions (i.e., they
 * reply to the authenticated user or contain a user mention).
 */
export function buildInboxFromCache(db: Database.Database, options: InboxQueryOptions = {}): InboxResponse {
  const { kind = 'mixed', minScore = 0, hideLowSignal = false, limit = 20 } = options;
  const items: InboxItem[] = [];

  if (kind === 'mixed' || kind === 'mentions') {
    // Get recent mentions-like tweets (replies to self or containing self-mentions)
    // We use tweets that have in_reply_to_id set as a simple heuristic
    const rows = db
      .prepare(`
        SELECT t.id, t.text, t.created_at, t.author_id, t.in_reply_to_id,
               p.username, p.name, p.followers_count
        FROM tweets t
        JOIN profiles p ON t.author_id = p.id
        WHERE t.in_reply_to_id IS NOT NULL
        ORDER BY t.created_at DESC
        LIMIT 50
      `)
      .all() as Array<{
      id: string;
      text: string;
      created_at: string | null;
      author_id: string;
      in_reply_to_id: string | null;
      username: string;
      name: string;
      followers_count: number;
    }>;

    for (const row of rows) {
      const scoreKey = `mention:${row.id}`;
      const stored = getAiScore(db, 'mention', row.id);
      const followersCount = row.followers_count ?? 0;

      items.push({
        id: scoreKey,
        entityId: row.id,
        entityKind: 'mention',
        title: `Mention from ${row.name}`,
        text: row.text,
        createdAt: row.created_at ?? undefined,
        needsReply: true,
        influenceScore: Math.round(Math.log10(followersCount + 10) * 24),
        participant: { username: row.username, name: row.name, followersCount },
        score: stored?.score ?? getHeuristicScoreForMention(row.text, followersCount),
        summary: stored?.summary ?? 'Ranked from mention urgency and influence.',
        reasoning: stored?.reasoning ?? `@${row.username} · ${followersCount} followers`,
        source: stored ? 'openai' : 'heuristic',
      });
    }
  }

  const lowSignalFloor = hideLowSignal ? Math.max(40, minScore) : minScore;
  const filtered = items
    .filter((item) => item.score >= lowSignalFloor)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
    })
    .slice(0, limit);

  return {
    items: filtered,
    stats: {
      total: filtered.length,
      openai: filtered.filter((i) => i.source === 'openai').length,
      heuristic: filtered.filter((i) => i.source === 'heuristic').length,
    },
  };
}

/**
 * Score inbox items with OpenAI and persist the scores.
 */
export async function scoreInbox(db: Database.Database, options: { kind?: string; limit?: number } = {}): Promise<{ ok: boolean; scored: number }> {
  const inbox = buildInboxFromCache(db, { kind: options.kind as InboxQueryOptions['kind'], limit: options.limit ?? 8 });
  let scored = 0;

  for (const item of inbox.items) {
    if (item.source === 'openai') continue; // already scored

    try {
      const result = await scoreWithOpenAI({
        entityKind: item.entityKind,
        title: item.title,
        text: item.text,
        influenceScore: item.influenceScore,
        participant: {
          handle: item.participant.username,
          displayName: item.participant.name,
          followersCount: item.participant.followersCount,
        },
      });

      setAiScore(db, item.entityKind, item.entityId, result.score, result.summary, result.reasoning, result.model);
      scored++;
    } catch {
      // skip items that fail scoring
    }
  }

  return { ok: true, scored };
}
