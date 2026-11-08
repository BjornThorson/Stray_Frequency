import type { SocialSnapshot } from '../services/social';
import { escapeHtml } from './html.ts';

export const FIRST_SOCIAL_NPC = 'marrow_kest';

type VisitStatus = 'loading' | 'ready' | 'sending' | 'unavailable';
export interface SocialEncounterView {
  status: VisitStatus;
  snapshot: SocialSnapshot | null;
  message: string | null;
}

export function socialFamiliarityText(snapshot: SocialSnapshot, characterId: string): string {
  const routine = snapshot.routines.find(row =>
    row.observer_key === `npc:${FIRST_SOCIAL_NPC}` &&
    row.subject_key === `player:${characterId}`
  );
  const encounters = routine?.encounters ?? 0;
  if (encounters === 0) return 'A new face at the counter.';
  if (encounters < 4) return 'Marrow has seen you around.';
  if (encounters < 12) return 'You are becoming a familiar customer.';
  return 'Marrow recognises you as a regular.';
}

export function socialEncounterMarkup(
  view: SocialEncounterView, characterId: string
): string {
  const loading = view.status === 'loading';
  const sending = view.status === 'sending';
  const ready = view.status === 'ready';
  const statusText = view.status === 'unavailable'
    ? 'Social records are unavailable on this server.'
    : loading ? 'Checking your past visits…'
    : sending ? 'Marrow turns away from the ledger…'
    : socialFamiliarityText(view.snapshot ?? { version: 1, relationships: [], routines: [] }, characterId);
  const buttonDisabled = ready ? '' : 'disabled';
  return `<section class="social-encounter" aria-label="Conversation with Marrow Kest">
    <div class="social-encounter__heading">
      <div><span class="panel-kicker">OFF THE CLOCK? NOT QUITE</span>
      <h3>A word with Marrow</h3></div>
      <span class="social-encounter__type">LOCAL CONTACT</span>
    </div>
    <p class="social-encounter__status" data-social-status>${escapeHtml(statusText)}</p>
    <div class="social-encounter__footer">
      <button type="button" data-social-visit ${buttonDisabled}>Say hello</button>
      ${view.status === 'unavailable'
        ? '<button type="button" class="social-encounter__retry" data-social-refresh>Retry connection</button>'
        : ''}
    </div>
    ${view.message ? `<p class="social-encounter__message" role="status">${escapeHtml(view.message)}</p>` : ''}
    <small class="social-encounter__footnote">A greeting builds familiarity, not friendship.</small>
  </section>`;
}
