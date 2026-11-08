import type {
  EventAccount, GossipOptions, LandmarkMemory, RoutineHistory,
  SocialBelief, SocialCognitionState, SocialKnowledgeSnapshot
} from '../core/social-cognition-types.ts';
import type { SocialEvent, SocialEventKind, SocialProfile, SocialState } from '../core/social-types.ts';
import { createSocialState, processSocialEvent, relationshipKey } from './social.ts';

const MAX_REPORTED_ACCOUNTS = 6;
const MAX_ORDINARY_LANDMARKS = 24;
const BASE_SALIENCE: Readonly<Partial<Record<SocialEventKind, number>>> = {
  helped: 55,
  kept_promise: 45,
  broke_promise: 65,
  threatened: 90
};

export function createSocialCognitionState(): SocialCognitionState {
  return { social: createSocialState(), beliefs: {}, landmarks: {}, routines: {} };
}

/** Unique by (observer, real-world event ID), regardless of conflicting reports. */
export function socialBeliefKey(observerId: string, eventId: string): string {
  return relationshipKey(observerId, eventId);
}

function validateTime(value: string): void {
  if (!value || !Number.isFinite(Date.parse(value))) {
    throw new Error('Invalid social knowledge timestamp');
  }
}

function validateConfidence(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('Invalid confidence: expected 0..1');
  }
}

function validateProfile(id: string, profiles: Readonly<Record<string, SocialProfile>>): void {
  if (!id || !profiles[id] || profiles[id].id !== id) {
    throw new Error(`Unknown character: ${id}`);
  }
}

function validateEvent(event: SocialEvent): void {
  if (!event.id || !event.actorId || !event.targetId || event.actorId === event.targetId ||
      !event.locationId) {
    throw new Error('Invalid known event');
  }
  validateTime(event.occurredAt);
  if (!Object.prototype.hasOwnProperty.call(BASE_SALIENCE, event.kind) &&
      event.kind !== 'conversation') {
    throw new Error('Unknown social event kind');
  }
}

function accountPriority(account: EventAccount): number {
  // Direct observation outranks any report; independent reports are not proofs.
  return (account.source === 'direct' ? 2 : 1) + account.confidence;
}

function preferredAccount(belief: SocialBelief): EventAccount {
  // More credible accounts win. If the same source retracts an earlier
  // account with equal confidence, its newer statement can revise the story.
  // Exact ties keep the first received account.
  return belief.accounts.reduce((best, candidate) => {
    const difference = accountPriority(candidate) - accountPriority(best);
    if (difference > 0) return candidate;
    if (difference === 0 &&
        candidate.source === best.source && candidate.fromId === best.fromId &&
        Date.parse(candidate.learnedAt) > Date.parse(best.learnedAt)) {
      return candidate;
    }
    return best;
  });
}

function isContested(belief: SocialBelief): boolean {
  return new Set(belief.accounts.map(account => account.event.kind)).size > 1;
}

/** Returns what this individual currently believes, not an objective world fact. */
export function getSocialKnowledge(
  state: SocialCognitionState, observerId: string, eventId: string
): SocialKnowledgeSnapshot | undefined {
  const belief = state.beliefs[socialBeliefKey(observerId, eventId)];
  if (!belief) return undefined;
  return {
    observerId,
    eventId,
    chosen: { ...preferredAccount(belief), event: { ...preferredAccount(belief).event } },
    contested: isContested(belief)
  };
}

function sameAccount(a: EventAccount, b: EventAccount): boolean {
  return a.fromId === b.fromId &&
    a.source === b.source &&
    a.event.kind === b.event.kind &&
    a.event.actorId === b.event.actorId &&
    a.event.targetId === b.event.targetId &&
    a.event.locationId === b.event.locationId;
}

/**
 * The Stage A engine is additive. Replaying a compact prototype knowledge set
 * lets a corrected rumour replace its previous influence instead of leaving
 * an irreversible trust/fear penalty. Stage C can materialise these projections.
 */
function rebuildSocial(
  beliefs: Readonly<Record<string, SocialBelief>>,
  profiles: Readonly<Record<string, SocialProfile>>
): SocialState {
  let social = createSocialState();
  const accounts = Object.values(beliefs)
    .map(belief => ({ observerId: belief.observerId, account: preferredAccount(belief) }))
    .sort((a, b) =>
      a.account.event.occurredAt.localeCompare(b.account.event.occurredAt) ||
      a.account.event.id.localeCompare(b.account.event.id) ||
      a.observerId.localeCompare(b.observerId)
    );

  for (const { observerId, account } of accounts) {
    social = processSocialEvent(social, account.event, [{
      observerId,
      source: account.source,
      confidence: account.confidence
    }], profiles);
  }
  return social;
}

function routineKey(observerId: string, otherId: string): string {
  return relationshipKey(observerId, otherId);
}

function updateRoutine(
  routines: SocialCognitionState['routines'], observerId: string, account: EventAccount
): SocialCognitionState['routines'] {
  if (account.source !== 'direct' || account.event.kind !== 'conversation') return routines;
  const { actorId, targetId } = account.event;
  if (observerId !== actorId && observerId !== targetId) return routines;

  const otherId = observerId === actorId ? targetId : actorId;
  const key = routineKey(observerId, otherId);
  const existing = routines[key];
  const updated: RoutineHistory = {
    observerId, otherId,
    conversations: (existing?.conversations ?? 0) + 1,
    lastEncounterAt: existing && Date.parse(existing.lastEncounterAt) > Date.parse(account.learnedAt)
      ? existing.lastEncounterAt : account.learnedAt
  };
  return { ...routines, [key]: updated };
}

function updateLandmarks(
  state: SocialCognitionState['landmarks'], observerId: string,
  belief: SocialBelief, chosen: EventAccount
): SocialCognitionState['landmarks'] {
  const salience = BASE_SALIENCE[chosen.event.kind] ?? 0;
  const existing = state[observerId] ?? [];
  if (!salience) {
    const remainder = existing.filter(memory => memory.eventId !== belief.eventId);
    return remainder.length === existing.length ? state : { ...state, [observerId]: remainder };
  }

  const subjectId = chosen.event.actorId === observerId
    ? chosen.event.targetId : chosen.event.actorId;
  const memory: LandmarkMemory = {
    observerId,
    eventId: belief.eventId,
    rememberedKind: chosen.event.kind,
    subjectId,
    learnedAt: chosen.learnedAt,
    salience,
    contested: isContested(belief),
    // Severe directly experienced harm may remain an enduring landmark.
    protected: chosen.event.kind === 'threatened' &&
      chosen.source === 'direct' && chosen.event.targetId === observerId
  };

  const all = [...existing.filter(item => item.eventId !== belief.eventId), memory];
  const protectedMemories = all.filter(item => item.protected);
  const ordinary = all.filter(item => !item.protected)
    .sort((a, b) =>
      b.salience - a.salience ||
      b.learnedAt.localeCompare(a.learnedAt) ||
      a.eventId.localeCompare(b.eventId)
    )
    .slice(0, MAX_ORDINARY_LANDMARKS);
  return { ...state, [observerId]: [...protectedMemories, ...ordinary] };
}

function recordAccount(
  state: SocialCognitionState, observerId: string,
  account: EventAccount, profiles: Readonly<Record<string, SocialProfile>>
): SocialCognitionState {
  validateEvent(account.event);
  validateProfile(observerId, profiles);
  validateProfile(account.event.actorId, profiles);
  validateProfile(account.event.targetId, profiles);
  validateConfidence(account.confidence);
  validateTime(account.learnedAt);
  if (account.source === 'direct' && account.fromId !== null) {
    throw new Error('Direct knowledge must not claim a messenger');
  }
  if (account.source === 'reported' && (!account.fromId || account.fromId === observerId)) {
    throw new Error('A report requires a different messenger');
  }

  const key = socialBeliefKey(observerId, account.event.id);
  const previous = state.beliefs[key];
  if (previous?.accounts.some(item => sameAccount(item, account))) return state;

  const accounts = [...(previous?.accounts ?? []), account];
  // Keep all direct accounts; bound the number of competing reports.
  const direct = accounts.filter(item => item.source === 'direct');
  const reported = accounts.filter(item => item.source === 'reported')
    .sort((a, b) => accountPriority(b) - accountPriority(a))
    .slice(0, MAX_REPORTED_ACCOUNTS);
  const belief: SocialBelief = { observerId, eventId: account.event.id, accounts: [...direct, ...reported] };
  const chosen = preferredAccount(belief);
  const priorChosen = previous ? preferredAccount(previous) : null;
  const changedOpinion = !priorChosen ||
    priorChosen.event.kind !== chosen.event.kind ||
    priorChosen.event.actorId !== chosen.event.actorId ||
    priorChosen.event.targetId !== chosen.event.targetId ||
    priorChosen.confidence !== chosen.confidence ||
    priorChosen.source !== chosen.source;
  const beliefs = { ...state.beliefs, [key]: belief };
  return {
    social: changedOpinion ? rebuildSocial(beliefs, profiles) : state.social,
    beliefs,
    landmarks: updateLandmarks(state.landmarks, observerId, belief, chosen),
    routines: !previous ? updateRoutine(state.routines, observerId, account) : state.routines
  };
}

/** Called only after the authoritative game decides who directly witnessed an event. */
export function witnessSocialEvent(
  state: SocialCognitionState, event: SocialEvent, observerId: string,
  observedAt: string, profiles: Readonly<Record<string, SocialProfile>>
): SocialCognitionState {
  return recordAccount(state, observerId, {
    event: { ...event }, source: 'direct', fromId: null,
    confidence: 1, learnedAt: observedAt
  }, profiles);
}

/**
 * Shares only a story the sender knows. The caller decides whether the
 * characters meet and what, if anything, gets distorted in retelling.
 * Nothing is automatically broadcast through the social graph.
 */
export function shareSocialRumour(
  state: SocialCognitionState,
  senderId: string, recipientId: string, eventId: string, toldAt: string,
  profiles: Readonly<Record<string, SocialProfile>>, options: GossipOptions = {}
): SocialCognitionState {
  validateProfile(senderId, profiles);
  validateProfile(recipientId, profiles);
  validateTime(toldAt);
  if (senderId === recipientId) throw new Error('Cannot relay a rumour to yourself');

  const senderKnowledge = getSocialKnowledge(state, senderId, eventId);
  if (!senderKnowledge) throw new Error('Cannot gossip about an unknown event');
  const { chosen } = senderKnowledge;
  validateConfidence(options.confidence ?? 1);
  const confidence = Math.min(1, chosen.confidence * 0.8) * (options.confidence ?? 1);
  validateConfidence(confidence);
  const kind = options.retoldAs ?? chosen.event.kind;
  const event: SocialEvent = { ...chosen.event, kind };
  return recordAccount(state, recipientId, {
    event,
    source: 'reported',
    fromId: senderId,
    confidence,
    learnedAt: toldAt
  }, profiles);
}
