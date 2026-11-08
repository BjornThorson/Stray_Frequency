import { gameState } from '../core/state';
import {
  loadSocialSnapshot, recordSocialVisit
} from '../services/social';

/** Only enable after the matching server migration and NPC are deployed. */
export const SOCIAL_ENCOUNTERS_ENABLED =
  import.meta.env.VITE_SOCIAL_ENCOUNTERS_ENABLED === 'true';

import {
  socialEncounterMarkup, FIRST_SOCIAL_NPC, type SocialEncounterView
} from './social-encounter-markup';

function emptyView(): SocialEncounterView {
  return { status: 'loading', snapshot: null, message: null };
}

let view = emptyView();
let activeCharacterId: string | null = null;
let pendingRequestId: string | null = null;
let busy = false;
let generation = 0;

function updateView(): void {
  if (!SOCIAL_ENCOUNTERS_ENABLED) return;
  const section = document.querySelector<HTMLElement>('#vendor-social-section');
  if (section && activeCharacterId) {
    section.innerHTML = socialEncounterMarkup(view, activeCharacterId);
  }
}

function currentCharacterId(): string | null {
  return gameState.character?.id ?? null;
}

function sameCharacter(id: string, epoch: number): boolean {
  return epoch === generation && currentCharacterId() === id && activeCharacterId === id;
}

/** Open state is per character so a new login never inherits stale social UI. */
export function beginVendorSocialEncounter(): void {
  if (!SOCIAL_ENCOUNTERS_ENABLED) return;
  const id = currentCharacterId();
  if (!id) return;
  if (id !== activeCharacterId) {
    activeCharacterId = id;
    pendingRequestId = null;
    view = emptyView();
  }
  const epoch = ++generation;
  view = { ...view, status: 'loading' };
  updateView();
  void refreshVendorSocialEncounter(id, epoch);
}

async function refreshVendorSocialEncounter(id: string, epoch: number): Promise<void> {
  try {
    const snapshot = await loadSocialSnapshot();
    if (!sameCharacter(id, epoch)) return;
    view = { status: 'ready', snapshot, message: view.message };
  } catch (error) {
    console.warn('Could not load NPC social state.', error);
    if (!sameCharacter(id, epoch)) return;
    view = { ...view, status: 'unavailable', message: null };
  }
  updateView();
}

export function retryVendorSocialEncounter(): void {
  if (!SOCIAL_ENCOUNTERS_ENABLED) return;
  beginVendorSocialEncounter();
}

export async function greetVendorSocialEncounter(): Promise<void> {
  if (!SOCIAL_ENCOUNTERS_ENABLED || busy || view.status !== 'ready') return;
  const characterId = currentCharacterId();
  if (!characterId || characterId !== activeCharacterId) return;
  const epoch = generation;
  busy = true;
  const requestId = pendingRequestId ?? crypto.randomUUID();
  pendingRequestId = requestId;
  view = { ...view, status: 'sending', message: null };
  updateView();
  try {
    await recordSocialVisit(FIRST_SOCIAL_NPC, requestId);
    if (!sameCharacter(characterId, epoch)) return;
    // The visit has already been recorded: never retry it with a new ID.
    pendingRequestId = null;
    const snapshot = await loadSocialSnapshot();
    if (!sameCharacter(characterId, epoch)) return;
    view = {
      status: 'ready', snapshot,
      message: 'Marrow glances up from the ledger and gives you a brief nod.'
    };
  } catch (error) {
    console.warn('Could not confirm NPC visit.', error);
    if (!sameCharacter(characterId, epoch)) return;
    // Preserve the request ID after uncertain delivery. A retry of that ID
    // is safe even if the server applied the original call.
    view = {
      ...view, status: 'ready',
      message: 'Could not confirm the greeting. You can retry safely.'
    };
  } finally {
    busy = false;
    if (sameCharacter(characterId, epoch)) updateView();
  }
}
