import type { SocialEvent, SocialEventKind, SocialState } from './social-types.ts';

/**
 * Each account describes an event as one character understands it.
 * Accounts are not authoritative statements about the underlying world.
 */
export interface EventAccount {
  event: SocialEvent;
  source: 'direct' | 'reported';
  /** Null for direct experience; otherwise the person who told the story. */
  fromId: string | null;
  /** Subjective confidence, 0..1. */
  confidence: number;
  learnedAt: string;
}

export interface SocialBelief {
  observerId: string;
  eventId: string;
  /** Competing stories of one event, including potentially false versions. */
  accounts: EventAccount[];
}

export interface LandmarkMemory {
  observerId: string;
  eventId: string;
  /** The remembered account may be mistaken or contested. */
  rememberedKind: SocialEventKind;
  subjectId: string;
  learnedAt: string;
  salience: number;
  contested: boolean;
  protected: boolean;
}

export interface RoutineHistory {
  observerId: string;
  otherId: string;
  conversations: number;
  lastEncounterAt: string;
}

export interface SocialCognitionState {
  social: SocialState;
  beliefs: Record<string, SocialBelief>;
  /** Bounded ordinary landmark memories, plus protected high-impact memories. */
  landmarks: Record<string, LandmarkMemory[]>;
  /** Ordinary conversations become compact summaries, not individual memories. */
  routines: Record<string, RoutineHistory>;
}

export interface GossipOptions {
  confidence?: number;
  /** Deliberate narrative misinterpretation; controlled by game rules, never player trust. */
  retoldAs?: SocialEventKind;
}

export interface SocialKnowledgeSnapshot {
  eventId: string;
  observerId: string;
  chosen: EventAccount;
  contested: boolean;
}
