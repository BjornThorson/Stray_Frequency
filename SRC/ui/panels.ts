import {
  EQUIPMENT_SLOTS, FISHING_XP_PER_TICK, INVENTORY_SLOT_COUNT, MAX_SKILL_LEVEL,
} from '../core/constants';
import { gameState } from '../core/state';
import type { EquipmentSlot, FishingMethod, InventoryEntry, RoomAction, SkillKey } from '../core/types';
import { ITEM_DEFINITIONS } from '../data/items';
import { getRoom } from '../data/rooms';
import { SKILL_DEFINITIONS, SKILL_UNLOCK_LEVELS } from '../data/skills';
import { derivedDefense } from '../systems/equipment';
import { getFishingActionPresentation } from '../systems/fishing';
import { getSalvageActionPresentation } from '../systems/salvage';
import { xpForNextSkillLevel } from '../systems/skills';
import { escapeHtml } from './html';

function inventorySlotMarkup(entry: InventoryEntry, index: number): string {
  if (!entry) return `<button class="inventory-tile empty" type="button" data-inventory-index="${index}" aria-label="Empty inventory slot"></button>`;
  const item = ITEM_DEFINITIONS[entry.item];
  return `<button class="inventory-tile" type="button" data-inventory-index="${index}" data-use-item="${item.usable ? 'true' : 'false'}" data-double-use-item="${entry.item === 'portable_induction_pad' ? 'true' : 'false'}" data-tooltip="${escapeHtml(`${item.name} — ${item.description}`)}" aria-label="${escapeHtml(item.name)}"><img src="${escapeHtml(item.asset)}" alt="" />${entry.quantity > 1 ? `<span class="item-quantity">${entry.quantity}</span>` : ''}</button>`;
}

function equipmentSlotMarkup(slot: EquipmentSlot, label: string): string {
  const key = gameState.equipment[slot];
  if (!key) return `<button class="equipment-slot empty" type="button" data-equipment-slot="${escapeHtml(slot)}"><span>${escapeHtml(label)}</span><small>EMPTY</small></button>`;
  const item = ITEM_DEFINITIONS[key];
  return `<button class="equipment-slot" type="button" data-equipment-slot="${escapeHtml(slot)}" data-tooltip="${escapeHtml(`${item.name} — ${item.description}`)}"><span>${escapeHtml(label)}</span><img src="${escapeHtml(item.asset)}" alt="${escapeHtml(item.name)}" /><small>${escapeHtml(item.name)}</small></button>`;
}

function actionPresentation(action: RoomAction): { disabled: boolean; detail: string } {
  if (action.type === 'start-salvaging') return getSalvageActionPresentation(gameState, action.detail);
  if (action.type === 'start-fishing-net' || action.type === 'start-fishing-rod') {
    const method: FishingMethod = action.type === 'start-fishing-net' ? 'net' : 'rod';
    return getFishingActionPresentation(gameState, method, action.detail);
  }
  return { disabled: false, detail: action.detail };
}

function actionIcon(action: RoomAction): string {
  if (action.type === 'start-salvaging') return '⛭';
  if (action.type === 'start-fishing-net' || action.type === 'start-fishing-rod') return '≈';
  if (action.type === 'goto-breaker-yard' || action.type === 'goto-south-dock-pier') return '↗';
  if (action.type === 'goto-glassmarket') return '↙';
  if (action.type === 'open-vendor') return '◎';
  return '⌕';
}

function worldActionsMarkup(actions: RoomAction[]): string {
  return `<div class="action-list">${actions.map((action) => {
    const p = actionPresentation(action);
    return `<button type="button" data-action="${escapeHtml(action.type)}" ${p.disabled ? 'disabled' : ''}><span>${escapeHtml(actionIcon(action))}</span>${escapeHtml(action.label)}<b>›</b></button>`;
  }).join('')}</div>`;
}

function worldPanelMarkup(): string {
  const room = getRoom(gameState.roomId);
  const name = escapeHtml(room.name), description = escapeHtml(room.description);
  if (room.id === 'glassmarket') return `<div class="panel-kicker">CURRENT LOCATION</div><h3>${name}</h3><p>${description}</p><p class="world-note">The service underpass gives you a direct route to the local gathering area.</p>${worldActionsMarkup(room.actions)}`;
  if (room.id === 'south-dock-pier') return `
    <div class="panel-kicker">CURRENT LOCATION</div><h3>${name}</h3><p>${description}</p>
    ${worldActionsMarkup(room.actions)}
    <div class="gather-summary">
      <div class="summary-card"><span>Water</span><strong>Saltwater harbour</strong></div>
      <div class="summary-card"><span>Net</span><strong>Shrimp</strong></div>
      <div class="summary-card"><span>Rod</span><strong>Sardines</strong></div>
      <div class="summary-card"><span>Catch XP</span><strong>+${FISHING_XP_PER_TICK} Fishing XP</strong></div>
    </div>`;
  return `<div class="panel-kicker">CURRENT LOCATION</div><h3>${name}</h3><p>${description}</p>${worldActionsMarkup(room.actions)}<button class="node-reset" type="button" data-action="reset-node">Reset demo node</button>`;
}

function inventoryPanelMarkup(): string {
  return `<div class="panel-kicker">INVENTORY</div><div class="inventory-heading"><h3>${INVENTORY_SLOT_COUNT} Slots</h3><span>${gameState.inventorySlots.filter(Boolean).length}/${INVENTORY_SLOT_COUNT} USED</span></div><div class="inventory-tiles">${gameState.inventorySlots.slice(0, INVENTORY_SLOT_COUNT).map((entry, index) => inventorySlotMarkup(entry, index)).join('')}</div><div class="touch-item-detail" id="touch-item-detail">Tap = use/equip · Hold = inspect · Drag = move</div><p class="inventory-hint">Desktop: hover for details, double-click to equip or deploy.</p>`;
}

function equipmentPanelMarkup(): string {
  return `<div class="panel-kicker">EQUIPMENT</div><h3>Equipped Gear</h3><div class="equipment-grid">${EQUIPMENT_SLOTS.map(([slot, label]) => equipmentSlotMarkup(slot, label)).join('')}</div><div class="derived-stats"><span>Equipment Defense</span><strong>${derivedDefense(gameState)}</strong></div><div class="touch-item-detail" id="touch-item-detail">Tap equipped gear for details · Double-tap to unequip</div><p class="inventory-hint">Desktop: hover for details, double-click to unequip.</p>`;
}

function skillsPanelMarkup(): string {
  return `<div class="panel-kicker">SKILLS</div><h3>Capability</h3><div class="skill-tiles">${SKILL_DEFINITIONS.map(({ key, name, icon }) => {
    const skill = gameState.skills.find((entry) => entry.skill_key === key);
    const level = skill?.level ?? 1; const xp = skill?.xp ?? 0; const next = xpForNextSkillLevel(level);
    const tip = level >= MAX_SKILL_LEVEL ? `${name} — Level ${level}/${MAX_SKILL_LEVEL} — MAX LEVEL` : `${name} — Level ${level}/${MAX_SKILL_LEVEL} — XP ${xp} / ${next} to next level`;
    return `<button type="button" class="skill-tile" data-skill="${escapeHtml(key)}" data-tooltip="${escapeHtml(tip)}" aria-haspopup="dialog" aria-label="${escapeHtml(`${name}, level ${level} of ${MAX_SKILL_LEVEL}`)}" aria-controls="skill-details-dialog"><span class="skill-icon">${escapeHtml(icon)}</span><span class="skill-name">${escapeHtml(name)}</span><strong>${level}<small>/${MAX_SKILL_LEVEL}</small></strong></button>`;
  }).join('')}</div>`;
}

const journalMarkup = `<div class="panel-kicker">JOURNAL</div><h3>Stories & Jobs</h3><button class="journal-entry"><strong>Breaker Yard 12</strong><span>A direct gathering room linked from Glassmarket. Good for testing salvage nodes and asset placement.</span></button><button class="journal-entry"><strong>South Dock Routine</strong><span>Travel between hubs and work local nodes without breaking the UI shell.</span></button><button class="journal-entry muted-entry"><strong>Prototype Goal</strong><span>Collect scrap, prove the core loop, then layer in production.</span></button>`;
const commsMarkup = `<div class="panel-kicker">COMMS</div><h3>Messages</h3><button class="message"><span class="avatar">RV</span><span><strong>Rhea Venn</strong><small>If you work the yard, keep anything useful and ignore the obvious tetanus.</small></span><time>21:41</time></button><button class="message"><span class="avatar">BY</span><span><strong>Breaker Yard 12</strong><small>Low-tier scrap available. Personal salvage bays open.</small></span><time>21:36</time></button><button class="message"><span class="avatar">TA</span><span><strong>Transit Authority</strong><small>Service underpass remains open to foot traffic.</small></span><time>20:08</time></button>`;

function mapPanelMarkup(): string {
  return `<div class="panel-kicker">CITY MAP</div><h3>South Dock</h3><div class="district-map"><div class="map-node ${gameState.roomId === 'glassmarket' ? 'current' : ''}" style="left:32%;top:42%">Glassmarket</div><div class="map-node ${gameState.roomId === 'breaker-yard' ? 'current' : ''}" style="left:68%;top:64%">Breaker Yard 12</div><div class="map-node" style="left:16%;top:68%">Dock 9</div><div class="map-node locked" style="left:70%;top:16%">???</div><svg viewBox="0 0 100 70" aria-hidden="true"><path d="M28 33 52 44 68 50" /><path d="M14 54 28 33" /></svg></div><p class="footnote">Glassmarket now links directly to the salvage room used by the gathering prototype.</p>`;
}

const nearbyMarkup = `<div class="panel-kicker">CURRENT ROOM</div><h3>Nearby Players</h3><p class="nearby-summary">Loading nearby players…</p><div class="nearby-player-list"></div>`;

let lastPanelContent: string | null = null;
let lastPanelTarget: HTMLElement | null = null;

export function renderPanel(): HTMLElement | null {
  const target = document.querySelector<HTMLElement>('#active-panel');
  if (!target) return null;

  const content = {
    world: worldPanelMarkup(),
    inventory: inventoryPanelMarkup(),
    equipment: equipmentPanelMarkup(),
    skills: skillsPanelMarkup(),
    journal: journalMarkup,
    comms: commsMarkup,
    map: mapPanelMarkup(),
    nearby: nearbyMarkup
  }[gameState.panel];

  if (target === lastPanelTarget && content === lastPanelContent) return null;

  target.innerHTML = content;
  lastPanelTarget = target;
  lastPanelContent = content;
  return target;
}

export function openSkillDetails(skillKey: SkillKey): void {
  const definition = SKILL_DEFINITIONS.find(({ key }) => key === skillKey);
  const dialog = document.querySelector<HTMLDialogElement>('#skill-details-dialog');
  if (!definition || !dialog) return;
  const skill = gameState.skills.find((entry) => entry.skill_key === skillKey);
  const level = Math.min(MAX_SKILL_LEVEL, skill?.level ?? 1); const xp = skill?.xp ?? 0;
  const nextLevelXp = xpForNextSkillLevel(level); const progress = nextLevelXp ? Math.max(0, Math.min(100, xp / nextLevelXp * 100)) : 100;
  const unlocks = SKILL_UNLOCK_LEVELS.map((unlockLevel) => `<li class="skill-unlock ${level >= unlockLevel ? 'reached' : ''}"><span class="skill-unlock-level">LV ${unlockLevel}</span><span class="skill-unlock-dot" aria-hidden="true"></span><div><strong>${level >= unlockLevel ? 'REACHED' : 'LOCKED'}</strong><p>Placeholder reward details to be defined.</p></div></li>`).join('');
  dialog.innerHTML = `<header class="skill-details-header"><div><div class="panel-kicker">SKILL DETAILS · PLACEHOLDER</div><h2 id="skill-details-title">${escapeHtml(definition.name)}</h2></div><button class="skill-details-close" type="button" data-close-skill-details aria-label="Close skill details">×</button></header><p class="skill-details-description">${escapeHtml(definition.description)}</p><section class="skill-details-progress" aria-label="Skill progress"><div class="skill-details-progress-label"><strong>LEVEL ${level}</strong><span>${level >= MAX_SKILL_LEVEL ? 'MAX LEVEL' : `${xp} / ${nextLevelXp} XP TO NEXT LEVEL`}</span></div><div class="skill-details-xp-track" role="progressbar" aria-label="Experience progress to next level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"><span style="width:${progress}%"></span></div></section><h3 class="skill-unlocks-heading">LEVEL UNLOCKS</h3><p class="skill-placeholder-note">Unlock levels and rewards are placeholders for now.</p><ol class="skill-unlocks">${unlocks}</ol>`;
  dialog.showModal();
  dialog.querySelector<HTMLButtonElement>('.skill-details-close')?.focus();
}
