import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSocialState, getSocialRelationship, processSocialEvent,
  relationshipKey
} from '../SRC/systems/social.ts';

const profiles = {
  player: { id: 'player', traits: { empathy: 0.5, scepticism: 0.5 } },
  mara: { id: 'mara', traits: { empathy: 1, scepticism: 0 } },
  recipient: { id: 'recipient', traits: { empathy: 0.5, scepticism: 0.5 } },
  cautious: { id: 'cautious', traits: { empathy: 0, scepticism: 1 } },
  neighbour: { id: 'neighbour', traits: { empathy: 0.5, scepticism: 0.5 } },
  uninformed: { id: 'uninformed', traits: { empathy: 0.5, scepticism: 0.5 } }
};

const event = (id, kind = 'helped') => ({
  id, kind, actorId: 'player', targetId: 'recipient',
  occurredAt: '2026-11-07T12:00:00Z', locationId: 'glassmarket'
});
const direct = observerId => ({ observerId, source: 'direct', confidence: 1 });
const reported = (observerId, confidence = 1) => ({
  observerId, source: 'reported', confidence
});

test('no witnesses means no omniscient relationship changes', () => {
  const result = processSocialEvent(createSocialState(), event('e1'), [], profiles);
  assert.deepEqual(result, createSocialState());
});

test('direct participants form independent directional opinions', () => {
  const result = processSocialEvent(createSocialState(), event('e1'), [
    direct('player'), direct('recipient')
  ], profiles);
  const giver = getSocialRelationship(result, 'player', 'recipient');
  const receiver = getSocialRelationship(result, 'recipient', 'player');
  assert.equal(giver.warmth, 2);
  assert.equal(receiver.warmth, 9);
  assert.equal(receiver.indebtedness, 8);
  assert.equal(giver.indebtedness, 0);
  assert.equal(getSocialRelationship(result, 'player', 'player'), undefined);
});

test('only informed witnesses update their opinions', () => {
  const result = processSocialEvent(createSocialState(), event('e1'), [
    direct('mara')
  ], profiles);
  assert.ok(getSocialRelationship(result, 'mara', 'player'));
  assert.equal(getSocialRelationship(result, 'recipient', 'player'), undefined);
  assert.equal(getSocialRelationship(result, 'uninformed', 'player'), undefined);
  assert.equal(getSocialRelationship(result, 'mara', 'recipient'), undefined);
});

test('personalities influence interpretation of the same witnessed kindness', () => {
  const result = processSocialEvent(createSocialState(), event('e1'), [
    direct('mara'), direct('cautious')
  ], profiles);
  const empathetic = getSocialRelationship(result, 'mara', 'player');
  const sceptical = getSocialRelationship(result, 'cautious', 'player');
  assert.ok(empathetic.warmth > sceptical.warmth);
  assert.ok(empathetic.trust > sceptical.trust);
  assert.equal(empathetic.respect, sceptical.respect);
});

test('second-hand reports have less impact than direct observation', () => {
  const result = processSocialEvent(createSocialState(), event('e1'), [
    direct('mara'), reported('cautious', 0.5)
  ], profiles);
  const firsthand = getSocialRelationship(result, 'mara', 'player');
  const hearsay = getSocialRelationship(result, 'cautious', 'player');
  // Both are witnesses, so differences here are not caused by event roles.
  assert.ok(firsthand.respect > hearsay.respect);
});

test('duplicate delivery is idempotent, while new observers may learn later', () => {
  let state = processSocialEvent(createSocialState(), event('e1'), [
    direct('mara'), direct('mara')
  ], profiles);
  const initialRespect = getSocialRelationship(state, 'mara', 'player').respect;
  assert.equal(state.processedObservations.length, 1);
  const before = structuredClone(state);
  state = processSocialEvent(state, event('e1'), [direct('mara')], profiles);
  assert.deepEqual(state, before);

  state = processSocialEvent(state, event('e1'), [reported('neighbour')], profiles);
  assert.equal(getSocialRelationship(state, 'mara', 'player').respect, initialRespect);
  assert.ok(getSocialRelationship(state, 'neighbour', 'player'));
  assert.equal(state.processedObservations.length, 2);
});

test('relationship values are bounded even after many repeated negative events', () => {
  let state = createSocialState();
  for (let i = 0; i < 40; i++) {
    state = processSocialEvent(state, event('threat-'+i, 'threatened'), [
      direct('recipient')
    ], profiles);
  }
  const opinion = getSocialRelationship(state, 'recipient', 'player');
  assert.equal(opinion.fear, 100);
  assert.equal(opinion.trust, -100);
  assert.equal(opinion.warmth, -100);
  assert.ok(opinion.familiarity <= 100);
});

test('warmth and trust evolve separately; negative conduct is not reset by familiarity', () => {
  let state = processSocialEvent(createSocialState(), event('help1'), [
    direct('recipient')
  ], profiles);
  state = processSocialEvent(state, event('betray1', 'broke_promise'), [
    direct('recipient')
  ], profiles);
  const opinion = getSocialRelationship(state, 'recipient', 'player');
  assert.equal(opinion.familiarity, 8);
  assert.equal(opinion.warmth, 4);
  assert.ok(opinion.trust < 0);
  assert.ok(opinion.reliability < 0);
});

test('bad input rejects atomically and the input state is never mutated', () => {
  const original = createSocialState();
  const before = structuredClone(original);
  assert.throws(() => processSocialEvent(original, event('e1'), [
    direct('mara'), { ...direct('recipient'), confidence: 1.1 }
  ], profiles), /Invalid social observation/);
  assert.deepEqual(original, before);
  assert.throws(() => processSocialEvent(original, event('e1'), [
    direct('missing')
  ], profiles), /Missing social profile/);
  assert.deepEqual(original, before);
});

test('stable pair keys do not collide for unusual IDs', () => {
  assert.notEqual(relationshipKey('a:b', 'c'), relationshipKey('a', 'b:c'));
});

test('the same engine evolves relationships entirely between NPCs', () => {
  const npcEvent = {
    ...event('npc-1', 'kept_promise'),
    actorId: 'mara', targetId: 'neighbour'
  };
  const result = processSocialEvent(createSocialState(), npcEvent, [
    direct('mara'), direct('neighbour'), direct('cautious')
  ], profiles);
  assert.ok(getSocialRelationship(result, 'neighbour', 'mara').reliability > 0);
  assert.ok(getSocialRelationship(result, 'mara', 'neighbour').familiarity > 0);
  assert.ok(getSocialRelationship(result, 'cautious', 'mara').respect > 0);
  assert.equal(getSocialRelationship(result, 'player', 'mara'), undefined);
});

test('one person may become feared and still remain familiar', () => {
  let state = createSocialState();
  for (let i = 0; i < 4; i++) {
    state = processSocialEvent(state, event('talk-'+i, 'conversation'), [
      direct('recipient')
    ], profiles);
  }
  state = processSocialEvent(state, event('threat-1', 'threatened'), [
    direct('recipient')
  ], profiles);
  const opinion = getSocialRelationship(state, 'recipient', 'player');
  assert.ok(opinion.familiarity > 10);
  assert.ok(opinion.fear > 0);
  assert.ok(opinion.warmth < 0);
});
