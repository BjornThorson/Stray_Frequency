import type { EquipmentSlot, InventoryItem } from './types';

export const INVENTORY_SLOT_COUNT = 28;

export const MAX_SKILL_LEVEL = 100;
export const LOG_LIMIT = 36;
export const LOG_TIMESTAMP = '21:48';

export const ACTIVITY_TICK_MS = 1_200;
export const SALVAGE_RESET_MS = 5_000;
export const SALVAGE_MAX_TICKS = 4;
export const SALVAGE_REQUIREMENT = 1;
export const SALVAGE_XP_PER_TICK = 3;
export const SALVAGE_METAL_CUTOFF = 0.3;
export const SALVAGE_COMPOSITE_CUTOFF = 0.6;
export const FISHING_XP_PER_TICK = 3;
export const COOKING_XP_PER_ITEM = 3;
export const COOKING_TICKS_PER_ITEM = 3;
export const COOKED_SHRIMP_HEAL = 3;

export const EQUIPMENT_SLOTS: ReadonlyArray<readonly [EquipmentSlot, string]> = [
  ['main_hand', 'Main Hand'],
  ['off_hand', 'Off Hand'],
  ['head', 'Head'],
  ['torso', 'Torso'],
  ['legs', 'Legs'],
  ['boots', 'Boots']
];

export const STARTER_INVENTORY: ReadonlyArray<readonly [number, InventoryItem]> = [
  [0, { item: 'salvage_bar', quantity: 1 }],
  [1, { item: 'portable_induction_pad', quantity: 1 }],
  [2, { item: 'fishing_rod', quantity: 1 }],
  [3, { item: 'fishing_net', quantity: 1 }],
  [4, { item: 't1_light_armor', quantity: 1 }]
];

export const INITIAL_LOGS = [
  '[21:47]  You arrive at Glassmarket Transit Concourse.',
  '[21:47]  A route marker points toward Breaker Yard 12.',
  '[21:46]  New location discovered: Glassmarket Transit Concourse.'
] as const;
