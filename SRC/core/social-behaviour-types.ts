/**
 * Author-authored dispositions, opportunities and boundaries.
 * Intentions are suggestions; they never perform actions or grant access.
 */
export type SocialActivity = 'working' | 'free';
export type SocialIntentKind =
  | 'start_conversation'
  | 'share_information'
  | 'invite_to_spend_time'
  | 'keep_distance';

export interface SocialDrives {
  /** Desire to initiate contact, 0..1. */
  connection: number;
  /** Willingness to exchange news, 0..1. */
  curiosity: number;
  /** Tendency to withdraw when threatened, 0..1. */
  caution: number;
}

export interface SocialBoundaries {
  /** Absolute authored boundaries or explicit refusals, regardless of affection. */
  noContactIds: readonly string[];
  allowInvitations: boolean;
  allowInformationSharing: boolean;
  allowInformationSharingAtWork: boolean;
}

/** Time windows use the authoritative simulation's UTC clock. */
export interface SocialScheduleWindow {
  /** JS UTC day of week: 0=Sunday, 6=Saturday. */
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  locationId: string;
  activity: SocialActivity;
}

export interface SocialBehaviourProfile {
  id: string;
  drives: SocialDrives;
  boundaries: SocialBoundaries;
  schedule: readonly SocialScheduleWindow[];
}

export interface SocialPresence {
  characterId: string;
  locationId: string;
  activity: SocialActivity;
}

export type SocialIntentReason =
  | 'open_to_talking'
  | 'personal_connection'
  | 'news_to_share'
  | 'feels_unsafe';

export interface SocialIntent {
  actorId: string;
  targetId: string;
  kind: SocialIntentKind;
  /** Relative priority for the current evaluated moment, not a relationship score. */
  priority: number;
  reason: SocialIntentReason;
  locationId: string;
  context: 'professional' | 'personal';
  /** Present only when a news-sharing proposal refers to known information. */
  eventId?: string;
}
