import type { SocialCognitionState } from './social-cognition-types.ts';
import type { SocialBehaviourProfile, SocialIntentKind } from './social-behaviour-types.ts';
import type { SocialProfile } from './social-types.ts';

export type SocialInteractionStatus =
  | 'pending' | 'accepted' | 'declined'
  | 'completed' | 'expired' | 'cancelled';

export interface SocialInteractionRecord {
  id: string;
  actorId: string;
  targetId: string;
  kind: SocialIntentKind;
  eventId?: string;
  locationId: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  status: SocialInteractionStatus;
  /** Only actual conversations or completed shared time create a social event. */
  completedSocialEventId?: string;
}

export interface SocialInteractionState {
  cognition: SocialCognitionState;
  interactions: Record<string, SocialInteractionRecord>;
  /** Directional cooldowns for attempts that received a response or completed. */
  lastInitiatedAt: Record<string, string>;
}

export interface SocialInteractionWorld {
  /** Provided by the authoritative game host, never read from the client clock. */
  nowUtc: string;
  agents: Readonly<Record<string, SocialBehaviourProfile>>;
  cognitionProfiles: Readonly<Record<string, SocialProfile>>;
  shareableEventIds: readonly string[];
  /** Provided by trusted auth/NPC orchestration, never inferred from a supplied ID. */
  canActAs: (actorId: string) => boolean;
}

export interface SocialInteractionSelection {
  /** Minted by the authoritative host, not by a browser. */
  id: string;
  actorId: string;
  targetId: string;
  kind: SocialIntentKind;
  eventId?: string;
}

export type SocialResponse = 'accept' | 'decline';
