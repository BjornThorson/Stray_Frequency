import { fetchSocialSnapshotRpc, recordSocialVisitRpc } from './supabase.ts';

/** Current prototype's persisted, per-player snapshot format (version 1). */
export interface PersistedSocialRelationship {
  observer_key: string;
  subject_key: string;
  familiarity: number;
  warmth: number;
  trust: number;
  reliability: number;
  respect: number;
  discretion: number;
  fear: number;
  indebtedness: number;
  last_perceived_at: string | null;
}

export interface PersistedSocialRoutine {
  observer_key: string;
  subject_key: string;
  encounters: number;
  last_encounter_at: string;
}

export interface SocialSnapshot {
  version: 1;
  relationships: PersistedSocialRelationship[];
  routines: PersistedSocialRoutine[];
}

export interface SocialVisitResult {
  recorded: true;
  /** The same retry ID was already processed; no extra relationship effects. */
  replayed: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const SOCIAL_FIELDS = [
  'familiarity', 'warmth', 'trust', 'reliability',
  'respect', 'discretion', 'fear', 'indebtedness'
] as const;

export function parseSocialSnapshot(value: unknown): SocialSnapshot {
  if (!isObject(value) || value.version !== 1 ||
      !Array.isArray(value.relationships) || !Array.isArray(value.routines)) {
    throw new Error('Unsupported social snapshot');
  }

  for (const item of value.relationships) {
    if (!isObject(item) ||
        typeof item.observer_key !== 'string' ||
        typeof item.subject_key !== 'string' ||
        !(item.last_perceived_at === null || typeof item.last_perceived_at === 'string') ||
        SOCIAL_FIELDS.some(field => !Number.isInteger(item[field]) ||
          (field === 'familiarity' || field === 'fear'
            ? Number(item[field]) < 0 || Number(item[field]) > 100
            : Number(item[field]) < -100 || Number(item[field]) > 100))) {
      throw new Error('Malformed persisted social relationship');
    }
  }

  for (const item of value.routines) {
    if (!isObject(item) ||
        typeof item.observer_key !== 'string' ||
        typeof item.subject_key !== 'string' ||
        !Number.isSafeInteger(item.encounters) ||
        Number(item.encounters) < 0 ||
        typeof item.last_encounter_at !== 'string') {
      throw new Error('Malformed persisted social routine');
    }
  }

  // A new JSON object ensures callers do not accidentally mutate the RPC
  // response. These types are presentation contracts, not write permissions.
  return {
    version: 1,
    relationships: value.relationships.map(item => ({ ...item })) as PersistedSocialRelationship[],
    routines: value.routines.map(item => ({ ...item })) as PersistedSocialRoutine[]
  };
}

export function parseSocialVisitResult(value: unknown): SocialVisitResult {
  if (!isObject(value) || value.recorded !== true || typeof value.replayed !== 'boolean') {
    throw new Error('Malformed social visit result');
  }
  return { recorded: true, replayed: value.replayed };
}

/**
 * Read the authenticated character's server-scoped social state. This does not
 * include other players' or the world's private NPC-to-NPC memories.
 */
export async function loadSocialSnapshot(): Promise<SocialSnapshot> {
  const { data, error } = await fetchSocialSnapshotRpc();
  if (error) throw error;
  return parseSocialSnapshot(data);
}

/**
 * A factual, co-located NPC visit. The server decides if the NPC is enabled,
 * the character is present, and the visit can be recorded.
 *
 * Keep requestId stable if retrying a failed network request. Do not mint a
 * new ID on retry or use this to simulate a completed dialogue/meeting.
 */
export async function recordSocialVisit(
  npcId: string, requestId: string
): Promise<SocialVisitResult> {
  if (!/^[a-z][a-z0-9_-]{1,63}$/.test(npcId)) {
    throw new Error('Invalid NPC identifier');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new Error('Invalid request identifier');
  }
  const { data, error } = await recordSocialVisitRpc(npcId, requestId);
  if (error) throw error;
  return parseSocialVisitResult(data);
}
