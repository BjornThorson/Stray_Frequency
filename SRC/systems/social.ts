import type {
  SocialAxis, SocialDelta, SocialEvent, SocialObservation, SocialProfile,
  SocialRelationship, SocialState, SocialTraits, SocialValues
} from '../core/social-types.ts';
import { DEFAULT_SOCIAL_TRAITS, SOCIAL_AXES, SOCIAL_BOUNDS, SOCIAL_RULES } from '../data/social-rules.ts';

export function createSocialState(): SocialState {
  return { relationships: {}, processedObservations: [] };
}

/** JSON-encoding the pair avoids collisions between arbitrary character IDs. */
export function relationshipKey(observerId: string, subjectId: string): string {
  return JSON.stringify([observerId, subjectId]);
}

export function getSocialRelationship(
  state: SocialState, observerId: string, subjectId: string
): SocialRelationship | undefined {
  return state.relationships[relationshipKey(observerId, subjectId)];
}

function initialValues(): SocialValues {
  return {
    familiarity: 0, warmth: 0, trust: 0, reliability: 0,
    respect: 0, discretion: 0, fear: 0, indebtedness: 0
  };
}

function validateProfile(profile: SocialProfile | undefined, id: string): SocialTraits {
  if (!profile || profile.id !== id) throw new Error(`Missing social profile: ${id}`);
  const traits = profile.traits ?? DEFAULT_SOCIAL_TRAITS;
  for (const trait of ['empathy', 'scepticism'] as const) {
    const n = traits[trait];
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      throw new Error(`Invalid ${trait} for ${id}: expected 0..1`);
    }
  }
  return traits;
}

function validateEvent(event: SocialEvent): void {
  if (!event.id || !event.actorId || !event.targetId || !event.locationId ||
      !event.occurredAt || event.actorId === event.targetId) {
    throw new Error('Invalid social event identity or participants');
  }
  if (!Object.prototype.hasOwnProperty.call(SOCIAL_RULES, event.kind)) {
    throw new Error(`Unknown social event: ${event.kind}`);
  }
}

function validateObservation(observation: SocialObservation): void {
  if (!observation.observerId ||
      (observation.source !== 'direct' && observation.source !== 'reported') ||
      !Number.isFinite(observation.confidence) ||
      observation.confidence < 0 || observation.confidence > 1) {
    throw new Error('Invalid social observation');
  }
}

/** Effect weights reflect the observer's traits and confidence in the report. */
function interpret(
  delta: SocialDelta, axis: SocialAxis, traits: SocialTraits, observation: SocialObservation
): number {
  const raw = delta[axis] ?? 0;
  let multiplier = observation.confidence * (observation.source === 'reported' ? 0.6 : 1);
  if (axis === 'warmth' && raw > 0) multiplier *= 0.75 + 0.5 * traits.empathy;
  if (axis === 'trust') multiplier *= raw > 0
    ? 1 - 0.5 * traits.scepticism
    : 1 + 0.5 * traits.scepticism;
  return Math.round(raw * multiplier);
}

function applyDelta(
  relationship: SocialRelationship, delta: SocialDelta,
  traits: SocialTraits, observation: SocialObservation, occurredAt: string
): SocialRelationship {
  const next = { ...relationship, lastPerceivedEventAt: occurredAt };
  for (const axis of SOCIAL_AXES) {
    const change = interpret(delta, axis, traits, observation);
    const [min, max] = SOCIAL_BOUNDS[axis];
    next[axis] = Math.max(min, Math.min(max, next[axis] + change));
  }
  return next;
}

/**
 * Apply only the observations delivered to each character.
 *
 * The caller supplies authoritative events and perception. This function
 * does not determine who could see an event, and does not accept player-
 * supplied relationship deltas. It is deterministic and does not mutate
 * its inputs. An event may reach another character later through gossip.
 */
export function processSocialEvent(
  state: SocialState,
  event: SocialEvent,
  observations: readonly SocialObservation[],
  profiles: Readonly<Record<string, SocialProfile>>
): SocialState {
  validateEvent(event);
  validateProfile(profiles[event.actorId], event.actorId);
  validateProfile(profiles[event.targetId], event.targetId);

  // Validate the entire batch first so malformed input never partly applies.
  for (const observation of observations) {
    validateObservation(observation);
    validateProfile(profiles[observation.observerId], observation.observerId);
  }

  const rule = SOCIAL_RULES[event.kind];
  const next: SocialState = {
    relationships: { ...state.relationships },
    processedObservations: [...state.processedObservations]
  };
  const processed = new Set(next.processedObservations);

  for (const observation of observations) {
    const receiptId = relationshipKey(event.id, observation.observerId);
    if (processed.has(receiptId)) continue;

    const observerId = observation.observerId;
    const subjectId = observerId === event.actorId ? event.targetId : event.actorId;
    const delta = observerId === event.actorId
      ? rule.actorToTarget
      : observerId === event.targetId ? rule.targetToActor : rule.witnessToActor;

    if (Object.keys(delta).length > 0 && observation.confidence > 0) {
      const key = relationshipKey(observerId, subjectId);
      const existing = next.relationships[key] ?? {
        observerId, subjectId, ...initialValues(), lastPerceivedEventAt: null
      };
      next.relationships[key] = applyDelta(
        existing, delta, profiles[observerId].traits, observation, event.occurredAt
      );
    }
    processed.add(receiptId);
    next.processedObservations.push(receiptId);
  }
  return next;
}
