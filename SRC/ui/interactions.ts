import { ACTIVITY_TICK_MS, SALVAGE_MAX_TICKS, SALVAGE_RESET_MS } from '../core/constants';
import { appendLog, characterName, gameState } from '../core/state';
import type { ActionType, EquipmentSlot, FishingMethod, Panel, SkillKey } from '../core/types';
import { ITEM_DEFINITIONS } from '../data/items';
import { applyGameSnapshot, loadCharacterProgress } from '../services/persistence';
import { developerSpawnItem, hasDeveloperAccess, logoutAccount, performGameAction, type GameAction } from '../services/supabase';
import { inspectDeparturesBoard, isNavigationAction } from '../systems/navigation';
import { vendorTradeSummary } from '../systems/vendor';
import { refreshCharacterHealth, refreshCharacterStats } from './character-card';
import { renderLog } from './log';
import { bindItemInteraction } from './mobile-input';
import { openSkillDetails, renderPanel } from './panels';
import { renderScene } from './scene';
import { renderShell, updateShell } from './shell';

function addLog(message: string): void { appendLog(gameState, message); renderLog(); }

function spawnXpPopup(text: string): void {
  const host = document.querySelector<HTMLElement>('#xp-layer');
  if (!host) return;
  host.querySelector('.xp-popup')?.remove();
  const popup = document.createElement('div');
  popup.className = 'xp-popup';
  popup.textContent = text;
  host.appendChild(popup);
  window.setTimeout(() => popup.remove(), 950);
}

async function authoritative(action: GameAction, payload: Record<string, unknown> = {}): Promise<boolean> {
  const { data, error } = await performGameAction(action, payload);
  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes('inventory full')) addLog('Inventory full.');
    else if (message.includes('action too fast')) return false;
    else addLog(`Action rejected: ${error.message}`);
    return false;
  }
  applyGameSnapshot(data, gameState);
  renderAll();
  refreshCharacterStats();
  refreshCharacterHealth();
  return true;
}

function renderPanelAndBind(): void {
  const target = renderPanel();
  if (!target) return;
  target.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.action as ActionType | undefined;
      if (action) void handleAction(action);
    });
  });
  const moveItem = (from: number, to: number) => { void authoritative('move_item', { from, to }); };
  target.querySelectorAll<HTMLButtonElement>('[data-inventory-index]').forEach((button) => {
    const index = Number(button.dataset.inventoryIndex);
    if (Number.isInteger(index) && gameState.inventorySlots[index]) {
      bindItemInteraction(target, button, () => { void activateInventoryItem(index); }, moveItem);
    }
  });
  target.querySelectorAll<HTMLButtonElement>('[data-equipment-slot]').forEach((button) => {
    const slot = button.dataset.equipmentSlot as EquipmentSlot | undefined;
    if (slot && gameState.equipment[slot]) bindItemInteraction(target, button, () => { void unequipItem(slot); }, moveItem);
  });
}

function renderDeveloperItemMenu(): void {
  if (!hasDeveloperAccess()) return;
  const menu = document.querySelector<HTMLElement>('#developer-item-menu');
  if (!menu) return;

  const fragment = document.createDocumentFragment();
  Object.values(ITEM_DEFINITIONS).forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'developer-item';
    button.dataset.devItem = item.key;
    button.title = item.description;
    button.setAttribute('aria-label', item.name);
    button.textContent = item.name;
    fragment.appendChild(button);
  });
  menu.replaceChildren(fragment);
}

export function renderAll(): void { updateShell(); renderScene(); renderPanelAndBind(); renderLog(); renderDeveloperItemMenu(); }

async function equipItem(index: number): Promise<void> { stopFishing(); await authoritative('equip', { index }); }
async function unequipItem(slot: EquipmentSlot): Promise<void> { stopFishing(); await authoritative('unequip', { slot }); }

async function activateInventoryItem(index: number): Promise<void> {
  const entry = gameState.inventorySlots[index];
  if (!entry) return;
  if (ITEM_DEFINITIONS[entry.item].equipmentSlot) { await equipItem(index); return; }
  if (entry.item === 'portable_induction_pad') { startCooking(); return; }
  if (entry.item === 'cooked_shrimp') {
    if (await authoritative('eat_shrimp')) addLog('Cooked Shrimp restored HP.');
  }
}

function stopSalvaging(): void {
  if (gameState.salvage.intervalId !== null) globalThis.clearInterval(gameState.salvage.intervalId);
  gameState.salvage.intervalId = null; gameState.salvage.active = false;
}
function startSalvaging(): void {
  if (gameState.salvage.active || gameState.fishing.active || gameState.cooking.active) return;
  if (gameState.roomId !== 'breaker-yard' || gameState.equipment.main_hand !== 'salvage_bar') { addLog('A Tier 1 salvage tool must be equipped in Main Hand to work this node.'); return; }
  gameState.salvage.active = true; gameState.salvage.remainingTicks = SALVAGE_MAX_TICKS;
  addLog(`${characterName(gameState)} steps into the bay and starts salvaging the node.`); renderAll();
  gameState.salvage.intervalId = globalThis.setInterval(async () => {
    if (!gameState.salvage.active) return;
    const ok = await authoritative('salvage'); if (!ok) return;
    gameState.salvage.remainingTicks -= 1; spawnXpPopup('+3 XP'); addLog('+3 Salvaging XP · salvage recovered.');
    if (gameState.salvage.remainingTicks <= 0) {
      stopSalvaging(); addLog(`The scrap node is depleted. It will replenish in ${SALVAGE_RESET_MS / 1000} seconds.`); renderAll();
      gameState.salvage.resetTimeoutId = globalThis.setTimeout(() => {
        gameState.salvage.remainingTicks = SALVAGE_MAX_TICKS; gameState.salvage.resetTimeoutId = null;
        addLog('The scrap node has replenished.'); renderAll();
      }, SALVAGE_RESET_MS);
    }
  }, ACTIVITY_TICK_MS);
}
function resetSalvageNode(): void {
  stopSalvaging();
  if (gameState.salvage.resetTimeoutId !== null) globalThis.clearTimeout(gameState.salvage.resetTimeoutId);
  gameState.salvage.resetTimeoutId = null; gameState.salvage.remainingTicks = SALVAGE_MAX_TICKS;
  addLog('A fresh Tier 1 Scrap pile is set aside for the demo.'); renderAll();
}
function stopFishing(): void {
  if (gameState.fishing.intervalId !== null) globalThis.clearInterval(gameState.fishing.intervalId);
  gameState.fishing.intervalId = null; gameState.fishing.active = false; gameState.fishing.method = null; renderScene();
}
function startFishing(method: FishingMethod): void {
  if (gameState.fishing.active || gameState.salvage.active || gameState.cooking.active) return;
  const required = method === 'net' ? 'fishing_net' : 'fishing_rod';
  if (gameState.roomId !== 'south-dock-pier' || gameState.equipment.main_hand !== required) { addLog(`Equip the ${method === 'net' ? 'Fishing Net' : 'Fishing Rod'} in Main Hand before fishing here.`); return; }
  gameState.fishing.active = true; gameState.fishing.method = method;
  addLog(`${characterName(gameState)} starts fishing the South Dock water with a ${method}.`); renderAll();
  gameState.fishing.intervalId = globalThis.setInterval(async () => {
    if (!gameState.fishing.active) return;
    const ok = await authoritative('fish', { method });
    if (ok) { spawnXpPopup('+3 XP'); addLog('+3 Fishing XP · catch collected.'); }
  }, ACTIVITY_TICK_MS);
}
function equippedFishingMethod(): FishingMethod | null {
  if (gameState.equipment.main_hand === 'fishing_net') return 'net';
  if (gameState.equipment.main_hand === 'fishing_rod') return 'rod';
  return null;
}
function startFishingWithEquippedTool(): void {
  const method = equippedFishingMethod();
  if (!method) { addLog('Equip a Fishing Net or Fishing Rod in Main Hand before fishing here.'); return; }
  startFishing(method);
}
function stopCooking(): void {
  if (gameState.cooking.intervalId !== null) globalThis.clearInterval(gameState.cooking.intervalId);
  gameState.cooking.intervalId = null; gameState.cooking.active = false; gameState.cooking.inventoryIndex = null; gameState.cooking.ticksRemaining = 3; renderAll();
}
function startCooking(): void {
  if (gameState.cooking.active || gameState.salvage.active || gameState.fishing.active) return;
  if (!gameState.inventorySlots.some((entry) => entry?.item === 'uncooked_shrimp')) { addLog('No Uncooked Shrimp to cook.'); return; }
  gameState.cooking.active = true; gameState.cooking.ticksRemaining = 3;
  addLog('Portable Induction Pad deployed. Cooking takes 3 ticks per shrimp.'); renderAll();
  let ticks = 0;
  gameState.cooking.intervalId = globalThis.setInterval(async () => {
    ticks += 1; gameState.cooking.ticksRemaining = Math.max(1, 3 - (ticks % 3)); renderScene();
    if (ticks % 3 !== 0) return;
    const ok = await authoritative('cook_shrimp'); if (!ok) { stopCooking(); return; }
    spawnXpPopup('+3 XP'); addLog('Portable Induction Pad cooked 1 Uncooked Shrimp. +3 Cooking XP.');
    if (!gameState.inventorySlots.some((entry) => entry?.item === 'uncooked_shrimp')) { addLog('No Uncooked Shrimp remains. Cooking stopped.'); stopCooking(); }
  }, ACTIVITY_TICK_MS);
}

function openVendorDialog(): void {
  const dialog = document.querySelector<HTMLDialogElement>('#vendor-dialog'); if (!dialog) return;
  const summary = vendorTradeSummary(gameState);
  dialog.innerHTML = `
    <header class="vendor-header"><div><div class="panel-kicker">GLASSMARKET MERCHANT</div><h2 id="vendor-dialog-title">Marrow Kest</h2></div>
    <button class="skill-details-close" type="button" data-close-vendor aria-label="Close vendor dialog">×</button></header>
    <p class="vendor-summary">Paid salvage work, cut-rate tools, and a few side jobs for travellers.</p>
    <div class="vendor-grid">
      <div class="vendor-card"><strong>Powered Salvage Bar</strong><span>100 credits</span><button type="button" data-vendor-action="buy-powered-salvage-bar" ${summary.canBuy ? '' : 'disabled'}>Buy</button></div>
      <div class="vendor-card"><strong>Tier 1 Metal Scrap</strong><span>5 credits each</span><button type="button" data-vendor-action="sell-metal-scrap" ${summary.scrap > 0 ? '' : 'disabled'}>Sell 1</button></div>
    </div>
    <div class="vendor-footer"><small>Available credits: ${summary.credits}</small><small>Scrap on hand: ${summary.scrap}</small></div>`;
  if (!dialog.open) dialog.showModal();
}

async function handleAction(action: ActionType): Promise<void> {
  if (isNavigationAction(action)) {
    stopSalvaging(); stopFishing(); stopCooking();
    const room = action === 'goto-breaker-yard' ? 'breaker-yard' : action === 'goto-south-dock-pier' ? 'south-dock-pier' : 'glassmarket';
    if (await authoritative('navigate', { room })) addLog(`You travel to ${room}.`); return;
  }
  switch (action) {
    case 'open-vendor': openVendorDialog(); return;
    case 'start-salvaging': startSalvaging(); return;
    case 'start-fishing-net': startFishing('net'); return;
    case 'start-fishing-rod': startFishing('rod'); return;
    case 'reset-node': resetSalvageNode(); return;
    case 'inspect-board': inspectDeparturesBoard(gameState, addLog); return;
    case 'buy-powered-salvage-bar': if (await authoritative('buy_salvage_bar')) addLog('You bought a Powered Salvage Bar for 100 credits.'); openVendorDialog(); return;
    case 'sell-metal-scrap': if (await authoritative('sell_metal_scrap')) addLog('Sold 1 Tier 1 Metal Scrap for 5 credits.'); openVendorDialog(); return;
  }
}

function bindStaticInteractions(): void {
  const developerButton = document.querySelector<HTMLButtonElement>('#developer-item-button');
  const developerMenu = document.querySelector<HTMLElement>('#developer-item-menu');
  if (developerButton && developerMenu) {
    developerButton.addEventListener('click', () => {
      if (!hasDeveloperAccess()) return;
      const nowOpen = !developerMenu.classList.contains('hidden');
      developerMenu.classList.toggle('hidden', nowOpen); developerButton.setAttribute('aria-expanded', String(!nowOpen)); renderDeveloperItemMenu();
    });
    developerMenu.addEventListener('dblclick', async (event) => {
      if (!hasDeveloperAccess()) return;
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-dev-item]');
      if (!target?.dataset.devItem) return;
      const itemKey = target.dataset.devItem as keyof typeof ITEM_DEFINITIONS;
      if (!(itemKey in ITEM_DEFINITIONS)) { addLog('Developer item request was rejected.'); return; }
      const { error } = await developerSpawnItem(itemKey);
      if (error) { addLog('Developer item request was rejected by the server.'); return; }
      await loadCharacterProgress(gameState); addLog(`Added ${ITEM_DEFINITIONS[itemKey].name} to inventory.`); renderAll();
    });
  }
  document.querySelectorAll<HTMLButtonElement>('.rune-menu button').forEach((button) => {
    button.addEventListener('click', () => {
      gameState.panel = button.dataset.panel as Panel;
      document.querySelectorAll('.rune-menu button').forEach((item) => item.classList.toggle('active', item === button)); renderPanelAndBind();
    });
  });
  document.querySelector<HTMLFormElement>('#chat-form')?.addEventListener('submit', (event) => {
    event.preventDefault(); const input = document.querySelector<HTMLInputElement>('#chat-message'); if (!input) return;
    const value = input.value.trim(); if (!value) return; addLog(`${characterName(gameState)}: ${value}`); input.value = '';
  });
  document.querySelector<HTMLElement>('#active-panel')?.addEventListener('click', (event) => {
    const tile = (event.target as HTMLElement).closest<HTMLButtonElement>('.skill-tile[data-skill]');
    if (tile?.dataset.skill) openSkillDetails(tile.dataset.skill as SkillKey);
  });
  document.querySelector<HTMLDialogElement>('#skill-details-dialog')?.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('[data-close-skill-details]')) (event.currentTarget as HTMLDialogElement).close();
  });
  document.querySelector<HTMLDialogElement>('#vendor-dialog')?.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('[data-close-vendor]')) (event.currentTarget as HTMLDialogElement).close();
    const vendorAction = (event.target as HTMLElement).closest<HTMLElement>('[data-vendor-action]');
    if (vendorAction?.dataset.vendorAction) void handleAction(vendorAction.dataset.vendorAction as ActionType);
  });
  const sceneWrap = document.querySelector<HTMLElement>('#scene-wrap');
  sceneWrap?.addEventListener('click', (event) => { if ((event.target as HTMLElement).closest('[data-cancel-cooking]')) stopCooking(); });
  const nodeAction = (event: Event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-node-action]'); if (!target?.dataset.nodeAction) return;
    if (target.dataset.nodeAction === 'start-fishing-equipped') startFishingWithEquippedTool(); else void handleAction(target.dataset.nodeAction as ActionType);
  };
  sceneWrap?.addEventListener('dblclick', nodeAction);
  sceneWrap?.addEventListener('keydown', (event) => { if (event.key !== 'Enter' && event.key !== ' ') return; event.preventDefault(); nodeAction(event); });
  document.querySelector<HTMLButtonElement>('#logout-button')?.addEventListener('click', async () => { stopSalvaging(); stopFishing(); stopCooking(); await logoutAccount(); });
}
export function startGame(app: HTMLDivElement): void { renderShell(app); bindStaticInteractions(); renderAll(); }
