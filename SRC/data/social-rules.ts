import type { SocialEventKind, SocialRule, SocialTraits, SocialValues } from '../core/social-types.ts';

/**
 * These initial weights are prototype tuning values, not established game
 * balance. Events specify consequences by role; interpretation happens later.
 */
export const SOCIAL_RULES: Readonly<Record<SocialEventKind, SocialRule>> = {
  conversation: {
    actorToTarget: { familiarity: 3, warmth: 1 },
    targetToActor: { familiarity: 3, warmth: 1 },
    witnessToActor: {}
  },
  helped: {
    actorToTarget: { familiarity: 2, warmth: 2 },
    targetToActor: { familiarity: 5, warmth: 9, trust: 6, reliability: 4, respect: 6, indebtedness: 8 },
    witnessToActor: { familiarity: 1, warmth: 4, trust: 2, respect: 6 }
  },
  kept_promise: {
    actorToTarget: { familiarity: 2, warmth: 1 },
    targetToActor: { familiarity: 2, trust: 5, reliability: 10, respect: 3 },
    witnessToActor: { trust: 2, reliability: 4, respect: 2 }
  },
  broke_promise: {
    actorToTarget: { familiarity: 2 },
    targetToActor: { familiarity: 3, warmth: -5, trust: -12, reliability: -15, respect: -4 },
    witnessToActor: { trust: -5, reliability: -7, respect: -2 }
  },
  threatened: {
    actorToTarget: { familiarity: 2 },
    targetToActor: { familiarity: 4, warmth: -12, trust: -15, fear: 20 },
    witnessToActor: { warmth: -7, trust: -6, respect: -4, fear: 5 }
  }
};

export const DEFAULT_SOCIAL_TRAITS: Readonly<SocialTraits> = {
  empathy: 0.5,
  scepticism: 0.5
};

export const SOCIAL_AXES: readonly (keyof SocialValues)[] = [
  'familiarity', 'warmth', 'trust', 'reliability',
  'respect', 'discretion', 'fear', 'indebtedness'
];

export const SOCIAL_BOUNDS: Readonly<Record<keyof SocialValues, readonly [number, number]>> = {
  familiarity: [0, 100],
  warmth: [-100, 100],
  trust: [-100, 100],
  reliability: [-100, 100],
  respect: [-100, 100],
  discretion: [-100, 100],
  fear: [0, 100],
  indebtedness: [-100, 100]
};
