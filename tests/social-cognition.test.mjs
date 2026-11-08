import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSocialCognitionState, getSocialKnowledge, shareSocialRumour,
  socialBeliefKey, witnessSocialEvent
} from '../SRC/systems/social-cognition.ts';
import { getSocialRelationship } from '../SRC/systems/social.ts';

const profiles = Object.fromEntries(
  ['mara', 'receptionist', 'regular', 'theresa', 'outsider', 'bystander'].map(id => [
    id, { id, traits: { empathy: 0.5, scepticism: 0.5 } }
  ])
);

const event = (id, kind = 'helped', actorId = 'mara', targetId = 'regular') => ({
  id, kind, actorId, targetId, locationId: 'glassmarket',
  occurredAt: '2026-11-07T12:00:00Z'
});
const time = '2026-11-07T13:00:00Z';
const direct = (state, ev, who) =>
  witnessSocialEvent(state, ev, who, time, profiles);
const tell = (state, who, whom, id, opts) =>
  shareSocialRumour(state, who, whom, id, time, profiles, opts);

test('direct experience creates local belief, social opinion and landmark memory', () => {
  const world = direct(createSocialCognitionState(), event('help'), 'receptionist');
  const knowledge = getSocialKnowledge(world, 'receptionist', 'help');
  assert.equal(knowledge.chosen.source, 'direct');
  assert.equal(knowledge.chosen.event.kind, 'helped');
  assert.equal(knowledge.contested, false);
  assert.ok(getSocialRelationship(world.social, 'receptionist', 'mara').respect > 0);
  assert.equal(world.landmarks.receptionist.length, 1);
  assert.equal(getSocialKnowledge(world, 'outsider', 'help'), undefined);
  assert.equal(getSocialRelationship(world.social, 'outsider', 'mara'), undefined);
});

test('gossip travels only to an explicitly selected recipient', () => {
  let world = direct(createSocialCognitionState(), event('help'), 'mara');
  world = tell(world, 'mara', 'theresa', 'help');
  assert.equal(getSocialKnowledge(world, 'theresa', 'help').chosen.source, 'reported');
  assert.ok(getSocialRelationship(world.social, 'theresa', 'mara').respect > 0);
  assert.equal(getSocialKnowledge(world, 'outsider', 'help'), undefined);
  assert.equal(getSocialKnowledge(world, 'bystander', 'help'), undefined);
});

test('NPC gossip may be misunderstood and passed onward as an inaccurate story', () => {
  let world = direct(createSocialCognitionState(), event('event1'), 'mara');
  world = tell(world, 'mara', 'theresa', 'event1', { retoldAs: 'threatened' });
  world = tell(world, 'theresa', 'outsider', 'event1');
  assert.equal(getSocialKnowledge(world, 'outsider', 'event1').chosen.event.kind, 'threatened');
  assert.ok(getSocialRelationship(world.social, 'outsider', 'mara').fear > 0);
  assert.equal(getSocialKnowledge(world, 'bystander', 'event1'), undefined);
});

test('a stronger contradictory report revises belief and removes prior reputation damage', () => {
  let world = direct(createSocialCognitionState(), event('event1'), 'mara');
  world = tell(world, 'mara', 'theresa', 'event1', { retoldAs: 'threatened' });
  world = tell(world, 'theresa', 'outsider', 'event1');
  const initial = getSocialRelationship(world.social, 'outsider', 'mara');
  assert.ok(initial.fear > 0);

  // A direct witness tells Outsider what they actually saw.
  world = tell(world, 'mara', 'outsider', 'event1');
  const belief = getSocialKnowledge(world, 'outsider', 'event1');
  assert.equal(belief.chosen.event.kind, 'helped');
  assert.equal(belief.contested, true);
  const opinion = getSocialRelationship(world.social, 'outsider', 'mara');
  assert.equal(opinion.fear, 0);
  assert.ok(opinion.respect > 0);
  assert.equal(world.landmarks.outsider[0].rememberedKind, 'helped');
  assert.equal(world.landmarks.outsider[0].contested, true);
});

test('direct witnessing overrides a rumour and corrects the opinion completely', () => {
  let world = direct(createSocialCognitionState(), event('event1'), 'mara');
  world = tell(world, 'mara', 'theresa', 'event1', { retoldAs: 'threatened' });
  assert.ok(getSocialRelationship(world.social, 'theresa', 'mara').fear > 0);
  world = direct(world, event('event1'), 'theresa');
  assert.equal(getSocialKnowledge(world, 'theresa', 'event1').chosen.source, 'direct');
  assert.equal(getSocialKnowledge(world, 'theresa', 'event1').contested, true);
  assert.equal(getSocialRelationship(world.social, 'theresa', 'mara').fear, 0);
  assert.ok(getSocialRelationship(world.social, 'theresa', 'mara').respect > 0);
});

test('duplicate reports cannot farm trust, respect or memories', () => {
  let world = direct(createSocialCognitionState(), event('event1'), 'mara');
  world = tell(world, 'mara', 'theresa', 'event1');
  const original = structuredClone(world);
  world = tell(world, 'mara', 'theresa', 'event1');
  assert.deepEqual(world, original);
  assert.equal(world.beliefs[socialBeliefKey('theresa', 'event1')].accounts.length, 1);
  assert.equal(world.landmarks.theresa.length, 1);
});

test('conversations contribute compact routine familiarity rather than landmark memories', () => {
  let world = createSocialCognitionState();
  world = direct(world, event('greet1', 'conversation', 'receptionist', 'regular'), 'receptionist');
  world = direct(world, event('greet2', 'conversation', 'receptionist', 'regular'), 'receptionist');
  world = direct(world, event('greet1', 'conversation', 'receptionist', 'regular'), 'receptionist');
  assert.equal(world.routines[JSON.stringify(['receptionist', 'regular'])].conversations, 2);
  assert.equal(world.landmarks.receptionist, undefined);
  assert.ok(getSocialRelationship(world.social, 'receptionist', 'regular').familiarity > 0);
  world = tell(world, 'receptionist', 'theresa', 'greet1');
  assert.equal(world.routines[JSON.stringify(['theresa', 'receptionist'])], undefined);
});

test('ordinary landmark memories remain bounded while a major personal event endures', () => {
  let world = direct(
    createSocialCognitionState(), event('threat1', 'threatened', 'mara', 'regular'), 'regular'
  );
  for (let i = 0; i < 40; i++) {
    world = direct(world, event('help'+i, 'helped', 'mara', 'regular'), 'regular');
  }
  assert.equal(world.landmarks.regular.length, 25);
  assert.ok(world.landmarks.regular.some(m => m.eventId === 'threat1' && m.protected));
  assert.equal(world.landmarks.regular.filter(m => !m.protected).length, 24);
});

test('the same system supports NPC-to-NPC encounters with no player involvement', () => {
  let world = direct(createSocialCognitionState(),
    event('npc-meeting', 'kept_promise', 'receptionist', 'theresa'), 'theresa');
  world = tell(world, 'theresa', 'mara', 'npc-meeting');
  assert.ok(getSocialRelationship(world.social, 'mara', 'receptionist').reliability > 0);
  assert.equal(getSocialKnowledge(world, 'regular', 'npc-meeting'), undefined);
});

test('invalid gossip and unknown characters are rejected without changing state', () => {
  const world = createSocialCognitionState();
  const before = structuredClone(world);
  assert.throws(() => tell(world, 'mara', 'theresa', 'never'), /unknown event/);
  assert.throws(() => direct(world, event('help'), 'missing'), /Unknown character/);
  assert.throws(() => tell(world, 'mara', 'mara', 'never'), /yourself/);
  assert.deepEqual(world, before);
});

test('social history is JSON-serialisable and update functions are immutable', () => {
  const first = createSocialCognitionState();
  const second = direct(first, event('help'), 'regular');
  assert.deepEqual(first, createSocialCognitionState());
  assert.deepEqual(JSON.parse(JSON.stringify(second)), second);
  const before = structuredClone(second);
  const third = tell(second, 'regular', 'theresa', 'help');
  assert.deepEqual(second, before);
  assert.notDeepEqual(third, second);
});

test('a messenger can retract their own false version of a story later', () => {
  let world = direct(createSocialCognitionState(), event('incident1'), 'mara');
  world = tell(world, 'mara', 'theresa', 'incident1', { retoldAs: 'threatened' });
  assert.ok(getSocialRelationship(world.social, 'theresa', 'mara').fear > 0);
  world = shareSocialRumour(world, 'mara', 'theresa', 'incident1',
    '2026-11-07T15:00:00Z', profiles);
  assert.equal(getSocialKnowledge(world, 'theresa', 'incident1').chosen.event.kind, 'helped');
  assert.equal(getSocialKnowledge(world, 'theresa', 'incident1').contested, true);
  assert.equal(getSocialRelationship(world.social, 'theresa', 'mara').fear, 0);
});

test('untrusted gossip multiplier is validated before combining with confidence', () => {
  let world = direct(createSocialCognitionState(), event('incident2'), 'mara');
  const before = structuredClone(world);
  assert.throws(() => tell(world, 'mara', 'theresa', 'incident2',
    { confidence: 100 }), /Invalid confidence/);
  assert.deepEqual(world, before);
});
