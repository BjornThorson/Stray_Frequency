import type { SocialCognitionState } from '../core/social-cognition-types.ts';
import type {
  SocialBehaviourProfile, SocialIntent, SocialPresence
} from '../core/social-behaviour-types.ts';
import { getSocialRelationship, relationshipKey } from './social.ts';
import { getSocialKnowledge } from './social-cognition.ts';

export interface SocialDecisionContext {
  /** Authoritative game-world UTC timestamp. Never use the browser clock as truth. */
  nowUtc: string;
  agents: Readonly<Record<string, SocialBehaviourProfile>>;
  knowledge: SocialCognitionState;
  /** Public/story-safe event IDs that the game has explicitly authorised for sharing. */
  shareableEventIds: readonly string[];
  /**
   * Last completed social initiation per directional character pair.
   * A later authoritative executor must record successful actions, not this evaluator.
   */
  lastInitiatedAt?: Readonly<Record<string, string>>;
}

const MINUTE_MS = 60_000;
const CONTACT_COOLDOWN_MINUTES = 30;

function validTimestamp(when: string): number {
  const value = Date.parse(when);
  if (!when || !Number.isFinite(value)) throw new Error('Invalid game-world timestamp');
  return value;
}

function validateProfile(profile: SocialBehaviourProfile): void {
  if (!profile.id) throw new Error('Social behaviour profile needs an ID');
  for (const key of ['connection', 'curiosity', 'caution'] as const) {
    const value = profile.drives[key];
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`Invalid social drive ${key} for ${profile.id}`);
    }
  }
  if (!Array.isArray(profile.boundaries.noContactIds) ||
      typeof profile.boundaries.allowInvitations !== 'boolean' ||
      typeof profile.boundaries.allowInformationSharing !== 'boolean' ||
      typeof profile.boundaries.allowInformationSharingAtWork !== 'boolean') {
    throw new Error(`Invalid social boundaries for ${profile.id}`);
  }
  for (const slot of profile.schedule) {
    if (!Number.isInteger(slot.dayOfWeek) || slot.dayOfWeek < 0 || slot.dayOfWeek > 6 ||
        !Number.isInteger(slot.startMinute) || !Number.isInteger(slot.endMinute) ||
        slot.startMinute < 0 || slot.endMinute > 1440 ||
        slot.startMinute >= slot.endMinute || !slot.locationId ||
        (slot.activity !== 'working' && slot.activity !== 'free')) {
      throw new Error(`Invalid social schedule for ${profile.id}`);
    }
  }
  // Overlapping windows with contradictory locations or activities are ambiguous.
  for (let i = 0; i < profile.schedule.length; i++) {
    const a = profile.schedule[i];
    for (let j = i + 1; j < profile.schedule.length; j++) {
      const b = profile.schedule[j];
      if (a.dayOfWeek === b.dayOfWeek &&
          a.startMinute < b.endMinute && b.startMinute < a.endMinute) {
        throw new Error(`Overlapping social schedule for ${profile.id}`);
      }
    }
  }
}

function presenceAt(
  profile: SocialBehaviourProfile, now: Date
): SocialPresence | undefined {
  const dayOfWeek = now.getUTCDay();
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
  const slot = profile.schedule.find(window => window.dayOfWeek === dayOfWeek &&
    minute >= window.startMinute && minute < window.endMinute);
  return slot ? {
    characterId: profile.id,
    locationId: slot.locationId,
    activity: slot.activity
  } : undefined;
}

/** Resolve one character's authored whereabouts without simulating the whole city. */
export function resolveSocialPresence(
  profile: SocialBehaviourProfile, nowUtc: string
): SocialPresence | undefined {
  validateProfile(profile);
  return presenceAt(profile, new Date(validTimestamp(nowUtc)));
}

function isOnCooldown(
  actorId: string, targetId: string, nowMs: number,
  recent: Readonly<Record<string, string>> = {}
): boolean {
  const stamp = recent[relationshipKey(actorId, targetId)];
  if (stamp === undefined) return false;
  const last = validTimestamp(stamp);
  // Treat a future record as unavailable too; never bypass a cooldown via clock skew.
  return nowMs - last < CONTACT_COOLDOWN_MINUTES * MINUTE_MS;
}

function clampPriority(value: number): number {
  return Math.max(1, Math.min(100, Math.round(value)));
}

function compareIntents(a: SocialIntent, b: SocialIntent): number {
  return b.priority - a.priority ||
    a.targetId.localeCompare(b.targetId) ||
    a.kind.localeCompare(b.kind) ||
    (a.eventId ?? '').localeCompare(b.eventId ?? '');
}

/**
 * Generate possible social intentions for one agent in one world moment.
 * Relationships, character boundaries and co-location all matter. The
 * result is read-only advice to a future authoritative action executor.
 */
export function evaluateSocialIntents(
  context: SocialDecisionContext, actorId: string
): SocialIntent[] {
  const nowMs = validTimestamp(context.nowUtc);
  const actor = context.agents[actorId];
  if (!actor || actor.id !== actorId) throw new Error(`Unknown social actor: ${actorId}`);

  for (const [id, profile] of Object.entries(context.agents)) {
    if (profile.id !== id) throw new Error(`Mismatched social actor profile: ${id}`);
    validateProfile(profile);
  }

  const now = new Date(nowMs);
  const actorHere = presenceAt(actor, now);
  if (!actorHere) return [];

  const intents: SocialIntent[] = [];
  const shareable = new Set(context.shareableEventIds);
  const possibleStories = Object.values(context.knowledge.beliefs)
    .filter(belief => belief.observerId === actorId && shareable.has(belief.eventId))
    .map(belief => belief.eventId).sort();

  for (const target of Object.values(context.agents)) {
    if (target.id === actorId) continue;
    const targetHere = presenceAt(target, now);
    if (!targetHere || targetHere.locationId !== actorHere.locationId) continue;
    // Absolute boundaries work in either direction. They do not depend on trust.
    if (actor.boundaries.noContactIds.includes(target.id) ||
        target.boundaries.noContactIds.includes(actorId)) continue;

    if (isOnCooldown(actorId, target.id, nowMs, context.lastInitiatedAt)) continue;

    const opinion = getSocialRelationship(context.knowledge.social, actorId, target.id);
    const familiarity = opinion?.familiarity ?? 0;
    const warmth = opinion?.warmth ?? 0;
    const trust = opinion?.trust ?? 0;
    const fear = opinion?.fear ?? 0;
    const contextKind = actorHere.activity === 'working' ? 'professional' : 'personal';
    const add = (
      kind: SocialIntent['kind'], priority: number, reason: SocialIntent['reason'],
      eventId?: string
    ) => intents.push({
      actorId, targetId: target.id, kind, priority: clampPriority(priority),
      reason, locationId: actorHere.locationId, context: contextKind,
      ...(eventId === undefined ? {} : { eventId })
    });

    if (fear >= 35 || warmth <= -45) {
      add('keep_distance', 60 + fear * actor.drives.caution * 0.35 - warmth * 0.15,
        'feels_unsafe');
      continue;
    }

    if (actor.drives.connection >= 0.15) {
      add('start_conversation',
        16 + 35 * actor.drives.connection + warmth * 0.18 + familiarity * 0.08,
        'open_to_talking');
    }

    // This is only an invitation proposal. The other character may refuse.
    // It requires intentional personal affection, not a numeric friendship rank.
    if (actor.boundaries.allowInvitations &&
        actorHere.activity === 'free' && targetHere.activity === 'free' &&
        actor.drives.connection >= 0.4 && familiarity >= 12 && warmth >= 15) {
      add('invite_to_spend_time',
        38 + 30 * actor.drives.connection + warmth * 0.2,
        'personal_connection');
    }

    if (actor.boundaries.allowInformationSharing &&
        (actorHere.activity !== 'working' ||
          actor.boundaries.allowInformationSharingAtWork) &&
        actor.drives.curiosity >= 0.35 && trust >= -10) {
      for (const eventId of possibleStories) {
        const known = getSocialKnowledge(context.knowledge, actorId, eventId);
        if (!known) continue;
        const targetBelief = getSocialKnowledge(context.knowledge, target.id, eventId);
        // Can tell an unknown story or offer a different account of one already heard.
        if (targetBelief && targetBelief.chosen.event.kind === known.chosen.event.kind) continue;
        add('share_information',
          12 + 30 * actor.drives.curiosity + trust * 0.08,
          'news_to_share', eventId);
      }
    }
  }
  return intents.sort(compareIntents);
}

/** Selects a single proposed intention, never executes it or assumes consent. */
export function chooseSocialIntent(
  context: SocialDecisionContext, actorId: string
): SocialIntent | null {
  return evaluateSocialIntents(context, actorId)[0] ?? null;
}
