import type {
  SocialInteractionRecord, SocialInteractionSelection,
  SocialInteractionState, SocialInteractionWorld, SocialResponse
} from '../core/social-interaction-types.ts';
import type { SocialIntentKind } from '../core/social-behaviour-types.ts';
import { createSocialCognitionState, shareSocialRumour, witnessSocialEvent } from './social-cognition.ts';
import { evaluateSocialIntents, resolveSocialPresence } from './social-behaviour.ts';
import { getSocialRelationship, relationshipKey } from './social.ts';

const PROPOSAL_MS = 10 * 60 * 1000;
const ACCEPTED_MS = 60 * 60 * 1000;

function timeMs(value: string): number {
  const ms = Date.parse(value);
  if (!value || !Number.isFinite(ms)) throw new Error('Invalid authoritative social time');
  return ms;
}

function ensureChronological(record: SocialInteractionRecord, nowMs: number): void {
  if (nowMs < timeMs(record.updatedAt)) {
    throw new Error('Social interaction time cannot move backwards');
  }
}

function ensureAuthorised(world: SocialInteractionWorld, actorId: string): void {
  if (!world.canActAs(actorId)) throw new Error(`Not authorised to act as ${actorId}`);
}

function profileExists(world: SocialInteractionWorld, id: string): void {
  if (!world.agents[id] || world.agents[id].id !== id ||
      !world.cognitionProfiles[id] || world.cognitionProfiles[id].id !== id) {
    throw new Error(`Unknown social character: ${id}`);
  }
}

function intentAvailable(
  state: SocialInteractionState,
  world: SocialInteractionWorld,
  request: Pick<SocialInteractionSelection, 'actorId' | 'targetId' | 'kind' | 'eventId'>
): boolean {
  return evaluateSocialIntents({
    nowUtc: world.nowUtc,
    agents: world.agents,
    knowledge: state.cognition,
    shareableEventIds: world.shareableEventIds,
    lastInitiatedAt: state.lastInitiatedAt
  }, request.actorId).some(intent =>
    intent.targetId === request.targetId &&
    intent.kind === request.kind &&
    intent.eventId === request.eventId
  );
}

function isAvailableNow(
  world: SocialInteractionWorld, record: SocialInteractionRecord
): boolean {
  const actor = world.agents[record.actorId];
  const target = world.agents[record.targetId];
  if (!actor || !target) return false;
  if (actor.boundaries.noContactIds.includes(record.targetId) ||
      target.boundaries.noContactIds.includes(record.actorId)) return false;
  const actorHere = resolveSocialPresence(actor, world.nowUtc);
  const targetHere = resolveSocialPresence(target, world.nowUtc);
  if (!actorHere || !targetHere ||
      actorHere.locationId !== record.locationId ||
      targetHere.locationId !== record.locationId) return false;
  if (record.kind === 'invite_to_spend_time' &&
      (actorHere.activity !== 'free' || targetHere.activity !== 'free' ||
       !actor.boundaries.allowInvitations)) return false;
  if (record.kind === 'share_information' &&
      (!actor.boundaries.allowInformationSharing ||
       (actorHere.activity === 'working' && !actor.boundaries.allowInformationSharingAtWork) ||
       !record.eventId || !world.shareableEventIds.includes(record.eventId))) return false;
  return true;
}

function lockPair(
  state: SocialInteractionState, a: string, b: string
): boolean {
  return Object.values(state.interactions).some(record =>
    (record.status === 'pending' || record.status === 'accepted') &&
    ((record.actorId === a && record.targetId === b) ||
     (record.actorId === b && record.targetId === a))
  );
}

function replaceRecord(
  state: SocialInteractionState, record: SocialInteractionRecord,
  completedAttempt: boolean
): SocialInteractionState {
  const key = relationshipKey(record.actorId, record.targetId);
  return {
    ...state,
    interactions: { ...state.interactions, [record.id]: record },
    lastInitiatedAt: completedAttempt
      ? { ...state.lastInitiatedAt, [key]: record.updatedAt }
      : state.lastInitiatedAt
  };
}

/** Transient standalone world state; persistence will later own this in the game server. */
export function createSocialInteractionState(): SocialInteractionState {
  return { cognition: createSocialCognitionState(), interactions: {}, lastInitiatedAt: {} };
}

/**
 * Validate a proposed action against a newly computed eligible list.
 * Caller-provided priority, location and outcome are NEVER trusted.
 * The trusted host must mint IDs and supply canActAs and world facts.
 */
export function proposeSocialInteraction(
  state: SocialInteractionState,
  world: SocialInteractionWorld,
  selection: SocialInteractionSelection
): SocialInteractionState {
  const nowMs = timeMs(world.nowUtc);
  ensureAuthorised(world, selection.actorId);
  profileExists(world, selection.actorId);
  profileExists(world, selection.targetId);
  if (!/^[A-Za-z][A-Za-z0-9:._-]{0,127}$/.test(selection.id) ||
      selection.actorId === selection.targetId) {
    throw new Error('Invalid social interaction identity');
  }
  const existing = Object.prototype.hasOwnProperty.call(state.interactions, selection.id)
    ? state.interactions[selection.id] : undefined;
  if (existing) {
    if (existing.actorId !== selection.actorId ||
        existing.targetId !== selection.targetId ||
        existing.kind !== selection.kind ||
        existing.eventId !== selection.eventId) {
      throw new Error('Conflicting interaction ID');
    }
    return state; // replay of the exact proposal never creates another attempt
  }
  if (lockPair(state, selection.actorId, selection.targetId)) {
    throw new Error('Social pair already has an active interaction');
  }
  if (!intentAvailable(state, world, selection)) {
    throw new Error('Social intention is no longer eligible');
  }
  const presence = resolveSocialPresence(world.agents[selection.actorId], world.nowUtc);
  if (!presence) throw new Error('Social actor is unavailable');

  const immediate = selection.kind === 'keep_distance';
  const record: SocialInteractionRecord = {
    ...selection,
    locationId: presence.locationId,
    createdAt: world.nowUtc,
    updatedAt: world.nowUtc,
    expiresAt: new Date(nowMs + PROPOSAL_MS).toISOString(),
    status: immediate ? 'completed' : 'pending'
  };
  // Avoidance requires no consent, causes no relationship change, and is not a
  // request to the person being avoided.
  return replaceRecord(state, record, immediate);
}

/**
 * NPC response recommendation. The NPC still retains the ability to refuse:
 * this function does not accept/decline automatically.
 */
export function suggestSocialResponse(
  state: SocialInteractionState,
  world: SocialInteractionWorld,
  interactionId: string
): SocialResponse {
  const nowMs = timeMs(world.nowUtc);
  const record = state.interactions[interactionId];
  if (!record || record.status !== 'pending') {
    throw new Error('No pending interaction');
  }
  ensureChronological(record, nowMs);
  profileExists(world, record.actorId);
  profileExists(world, record.targetId);
  if (nowMs >= timeMs(record.expiresAt) || !isAvailableNow(world, record)) {
    return 'decline';
  }
  const recipient = world.agents[record.targetId];
  const attitude = getSocialRelationship(state.cognition.social, record.targetId, record.actorId);
  const warmth = attitude?.warmth ?? 0;
  const familiarity = attitude?.familiarity ?? 0;
  if ((attitude?.fear ?? 0) >= 35 || warmth <= -45) return 'decline';

  if (record.kind === 'invite_to_spend_time') {
    return recipient.boundaries.allowInvitations &&
      recipient.drives.connection >= 0.4 &&
      familiarity >= 8 && warmth >= 8 ? 'accept' : 'decline';
  }
  if (record.kind === 'share_information') {
    return recipient.drives.curiosity >= 0.35 ? 'accept' : 'decline';
  }
  return recipient.drives.connection >= 0.15 ? 'accept' : 'decline';
}

/**
 * A response is an authoritative action from the **target**, never the
 * initiator. Acceptance does not generate relationship progress by itself.
 */
export function respondToSocialInteraction(
  state: SocialInteractionState,
  world: SocialInteractionWorld,
  interactionId: string,
  responderId: string,
  response: SocialResponse
): SocialInteractionState {
  const nowMs = timeMs(world.nowUtc);
  const record = state.interactions[interactionId];
  if (!record || record.status !== 'pending') throw new Error('No pending interaction');
  ensureChronological(record, nowMs);
  if (responderId !== record.targetId) throw new Error('Only the target may respond');
  ensureAuthorised(world, responderId);
  if (nowMs >= timeMs(record.expiresAt)) throw new Error('Social invitation has expired');
  if (response !== 'accept' && response !== 'decline') throw new Error('Invalid social response');
  if (response === 'accept' && !isAvailableNow(world, record)) {
    throw new Error('Social encounter is no longer available');
  }
  const updated: SocialInteractionRecord = {
    ...record,
    status: response === 'accept' ? 'accepted' : 'declined',
    updatedAt: world.nowUtc,
    expiresAt: response === 'accept'
      ? new Date(nowMs + ACCEPTED_MS).toISOString() : record.expiresAt
  };
  // A refused request still counts as an initiation for the cooldown.
  return replaceRecord(state, updated, response === 'decline');
}

/**
 * Can only be invoked by the authorised actor after the activity occurred.
 * The real game server MUST independently verify that gameplay activity;
 * this pure function checks the remaining social constraints.
 */
export function completeSocialInteraction(
  state: SocialInteractionState,
  world: SocialInteractionWorld,
  interactionId: string,
  actorId: string
): SocialInteractionState {
  const nowMs = timeMs(world.nowUtc);
  const record = state.interactions[interactionId];
  if (!record || record.status !== 'accepted') {
    throw new Error('No accepted interaction to complete');
  }
  ensureChronological(record, nowMs);
  if (record.actorId !== actorId) throw new Error('Only the initiator may complete');
  ensureAuthorised(world, actorId);
  profileExists(world, record.actorId);
  profileExists(world, record.targetId);
  if (nowMs >= timeMs(record.expiresAt)) {
    throw new Error('Accepted social interaction has expired');
  }
  if (!isAvailableNow(world, record)) {
    throw new Error('Social encounter is no longer available');
  }

  let cognition = state.cognition;
  let completedSocialEventId: string | undefined;
  if (record.kind === 'share_information') {
    if (!record.eventId) throw new Error('Missing social story');
    cognition = shareSocialRumour(
      cognition, record.actorId, record.targetId, record.eventId,
      world.nowUtc, world.cognitionProfiles
    );
  } else {
    // A completed conversation or shared-time encounter is an actual event.
    // Accepting an invitation alone never reaches this code.
    const event = {
      id: `interaction:${record.id}`,
      kind: 'conversation' as const,
      actorId: record.actorId,
      targetId: record.targetId,
      occurredAt: world.nowUtc,
      locationId: record.locationId
    };
    cognition = witnessSocialEvent(cognition, event, record.actorId, world.nowUtc,
      world.cognitionProfiles);
    cognition = witnessSocialEvent(cognition, event, record.targetId, world.nowUtc,
      world.cognitionProfiles);
    completedSocialEventId = event.id;
  }

  const updated: SocialInteractionRecord = {
    ...record,
    status: 'completed',
    updatedAt: world.nowUtc,
    ...(completedSocialEventId ? { completedSocialEventId } : {})
  };
  return {
    ...replaceRecord(state, updated, true),
    cognition
  };
}

/**
 * Reclaim stale proposals in a coarse, explicit maintenance pass.
 * Pure code does not schedule background ticks or mutate world state.
 */
export function expireSocialInteractions(
  state: SocialInteractionState,
  nowUtc: string
): SocialInteractionState {
  const nowMs = timeMs(nowUtc);
  let changed = false;
  const interactions = { ...state.interactions };
  for (const record of Object.values(interactions)) {
    if ((record.status === 'pending' || record.status === 'accepted') &&
        nowMs >= timeMs(record.expiresAt)) {
      interactions[record.id] = {
        ...record, status: 'expired', updatedAt: nowUtc
      };
      changed = true;
    }
  }
  return changed ? { ...state, interactions } : state;
}
