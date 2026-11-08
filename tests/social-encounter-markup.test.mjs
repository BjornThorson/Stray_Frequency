import test from 'node:test';
import assert from 'node:assert/strict';
import {
  socialFamiliarityText,
  socialEncounterMarkup
} from '../SRC/ui/social-encounter-markup.ts';

const characterId = 'char-7';
const sample = count => ({
  version: 1,
  relationships: [],
  routines: count ? [{
    observer_key:'npc:marrow_kest',subject_key:'player:char-7',
    encounters:count,last_encounter_at:'2026-11-07T21:00:00Z'
  }] : []
});
test('visitor recognition uses qualitative language, never a friendship number', () => {
  assert.match(socialFamiliarityText(sample(0),characterId),/new face/i);
  assert.match(socialFamiliarityText(sample(1),characterId),/seen you/i);
  assert.match(socialFamiliarityText(sample(5),characterId),/familiar customer/i);
  assert.match(socialFamiliarityText(sample(12),characterId),/regular/i);
  const output=socialEncounterMarkup({ status:'ready',snapshot:sample(12),message:null },characterId);
  assert.ok(output.includes('Say hello'));
  assert.ok(!output.includes('12 visits'));
  assert.ok(!output.includes('friendship level'));
});

test('character-specific history cannot leak into another character presentation', () => {
  const data=sample(15);
  assert.match(socialFamiliarityText(data,'different-character'),/new face/i);
  assert.match(socialFamiliarityText(data,characterId),/regular/i);
});

test('loading, submitting and unavailable views do not offer a live action', () => {
  for(const status of ['loading','sending','unavailable']) {
    const markup=socialEncounterMarkup({status,snapshot:null,message:null},characterId);
    assert.match(markup,/<button type="button" data-social-visit disabled>/);
  }
  const retry=socialEncounterMarkup({status:'unavailable',snapshot:null,message:null},characterId);
  assert.match(retry,/data-social-refresh/);
  assert.match(retry,/unavailable on this server/i);
});

test('feedback is HTML-escaped and ready button is clickable', () => {
  const ready=socialEncounterMarkup({status:'ready',snapshot:sample(1),message:'<script>alert(1)</script>'},characterId);
  assert.match(ready,/<button type="button" data-social-visit >/);
  assert.ok(!ready.includes('<script>'));
  assert.match(ready,/&lt;script&gt;/);
});

test('a recorded routine stays per-character after a fresh snapshot read', () => {
  const original=structuredClone(sample(3));
  const reloaded=JSON.parse(JSON.stringify(original));
  assert.equal(socialFamiliarityText(reloaded,characterId),socialFamiliarityText(original,characterId));
});
