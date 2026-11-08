import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseSocialIntent, evaluateSocialIntents, resolveSocialPresence
} from '../SRC/systems/social-behaviour.ts';
import {
  createSocialCognitionState, shareSocialRumour, witnessSocialEvent
} from '../SRC/systems/social-cognition.ts';
import { relationshipKey, getSocialRelationship } from '../SRC/systems/social.ts';

const now = '2026-11-07T13:00:00Z'; // Saturday
const workTime = '2026-11-07T10:00:00Z';
const saturday = 6;
const slot = (locationId = 'glassmarket', startMinute = 0, endMinute = 1440, activity = 'free') => ({
  dayOfWeek: saturday, startMinute, endMinute, locationId, activity
});
const agent = (id, overrides = {}) => ({
  id,
  drives: { connection: 0.8, curiosity: 0.8, caution: 0.7, ...overrides.drives },
  boundaries: {
    noContactIds: [],
    allowInvitations: true,
    allowInformationSharing: true,
    allowInformationSharingAtWork: false,
    ...overrides.boundaries
  },
  schedule: overrides.schedule ?? [slot()]
});
const profiles = Object.fromEntries(
  ['receptionist','regular','mara','theresa','neighbour'].map(id => [
    id, { id, traits: { empathy: 0.5, scepticism: 0.5 } }
  ])
);
const event = (id, kind='conversation', actorId='receptionist', targetId='regular') => ({
  id, kind, actorId, targetId, occurredAt: now, locationId: 'glassmarket'
});
const witnessed = (state, ev, observer) => witnessSocialEvent(state, ev, observer, now, profiles);
const atWork = agent('receptionist', { schedule: [
  slot('glassmarket', 0, 720, 'working'),
  slot('glassmarket', 720, 1440, 'free')
]});
const defaults = ({
  time = now,
  social = createSocialCognitionState(),
  regular = agent('regular'),
  receptionist = agent('receptionist'),
  others = {},
  publicStories = [],
  lastInitiatedAt = {}
} = {}) => ({
  nowUtc: time,
  knowledge: social,
  shareableEventIds: publicStories,
  lastInitiatedAt,
  agents: { receptionist, regular, ...others }
});

function acquainted() {
  let state = createSocialCognitionState();
  for (let i=0; i<6; i++) {
    state = witnessed(state, event('chat-'+i), 'receptionist');
  }
  return witnessed(state, event('help', 'helped', 'regular', 'receptionist'), 'receptionist');
}

test('co-located characters can initiate a conversation even when unfamiliar', () => {
  const decisions = evaluateSocialIntents(defaults(), 'receptionist');
  assert.ok(decisions.some(x => x.kind === 'start_conversation' && x.targetId === 'regular'));
  assert.equal(chooseSocialIntent(defaults(), 'receptionist')?.kind, 'start_conversation');
});

test('schedule differentiates working and personal context', () => {
  assert.equal(resolveSocialPresence(atWork, workTime)?.activity, 'working');
  assert.equal(resolveSocialPresence(atWork, now)?.activity, 'free');
  assert.equal(evaluateSocialIntents(defaults({ receptionist: atWork, time: workTime }), 'receptionist')[0].context, 'professional');
  assert.equal(evaluateSocialIntents(defaults({ receptionist: atWork }), 'receptionist')[0].context, 'personal');
});

test('no remote meetings or interaction outside schedule', () => {
  const remote = defaults({ regular: agent('regular', { schedule: [slot('south-dock-pier')] }) });
  const absent = defaults({ regular: agent('regular', { schedule: [slot('glassmarket', 0, 720)] }) });
  assert.deepEqual(evaluateSocialIntents(remote, 'receptionist'), []);
  assert.deepEqual(evaluateSocialIntents(absent, 'receptionist'), []);
  assert.equal(resolveSocialPresence(agent('regular'), '2026-11-08T13:00:00Z'), undefined);
});

test('NPC initiates invitation because of history, not a friendship flag', () => {
  const social = acquainted();
  const opinion = getSocialRelationship(social.social, 'receptionist', 'regular');
  assert.ok(opinion.warmth >= 15);
  assert.ok(opinion.familiarity >= 12);
  assert.equal(getSocialRelationship(social.social, 'regular', 'receptionist'), undefined);

  const intention = chooseSocialIntent(defaults({ social }), 'receptionist');
  assert.equal(intention.kind, 'invite_to_spend_time');
  assert.equal(intention.reason, 'personal_connection');
  assert.equal(intention.context, 'personal');
  assert.equal(intention.actorId, 'receptionist');
});

test('invitation is blocked by an authored boundary even with affection', () => {
  const social = acquainted();
  const receptionist = agent('receptionist', { boundaries: { allowInvitations: false } });
  const list = evaluateSocialIntents(defaults({ social, receptionist }), 'receptionist');
  assert.equal(list.some(x => x.kind === 'invite_to_spend_time'), false);
  assert.ok(list.some(x => x.kind === 'start_conversation'));
});

test('working hours prevent an off-duty social invitation', () => {
  const social = acquainted();
  const duty = evaluateSocialIntents(defaults({
    social, receptionist: atWork, time: workTime
  }), 'receptionist');
  assert.equal(duty.some(x => x.kind === 'invite_to_spend_time'), false);
  assert.equal(duty[0].context, 'professional');
  assert.equal(evaluateSocialIntents(defaults({
    social, receptionist: atWork
  }), 'receptionist').some(x => x.kind === 'invite_to_spend_time'), true);
});

test('explicit no-contact boundary prevents approaches in either direction', () => {
  const fromActor = defaults({ receptionist: agent('receptionist',
    { boundaries: { noContactIds: ['regular'] } }) });
  const fromTarget = defaults({ regular: agent('regular',
    { boundaries: { noContactIds: ['receptionist'] } }) });
  assert.deepEqual(evaluateSocialIntents(fromActor, 'receptionist'), []);
  assert.deepEqual(evaluateSocialIntents(fromTarget, 'receptionist'), []);
});

test('threatening experiences can motivate avoidance despite sociability', () => {
  let social = createSocialCognitionState();
  social = witnessed(social, event('threat1', 'threatened', 'regular', 'receptionist'), 'receptionist');
  social = witnessed(social, event('threat2', 'threatened', 'regular', 'receptionist'), 'receptionist');
  const decisions = evaluateSocialIntents(defaults({ social }), 'receptionist');
  assert.deepEqual(decisions.map(x => x.kind), ['keep_distance']);
  assert.equal(decisions[0].reason, 'feels_unsafe');
});

test('only explicit shareable information can be proposed for gossip', () => {
  let social = createSocialCognitionState();
  social = witnessed(social, event('story', 'helped', 'mara', 'regular'), 'receptionist');
  assert.ok(!evaluateSocialIntents(defaults({ social }), 'receptionist').some(x => x.kind === 'share_information'));
  const allowed = evaluateSocialIntents(defaults({ social, publicStories: ['story'] }), 'receptionist');
  assert.deepEqual(allowed.filter(x => x.kind === 'share_information').map(x => x.eventId), ['story']);
  const blocked = defaults({ social, publicStories: ['story'], receptionist: agent('receptionist',
    { boundaries: { allowInformationSharing: false } }) });
  assert.ok(!evaluateSocialIntents(blocked, 'receptionist').some(x => x.kind === 'share_information'));
});

test('workplace information sharing requires its own explicit permission', () => {
  let social = createSocialCognitionState();
  social = witnessed(social, event('story', 'helped', 'mara', 'regular'), 'receptionist');
  const base = defaults({ social, publicStories: ['story'], receptionist: atWork, time: workTime });
  assert.ok(!evaluateSocialIntents(base, 'receptionist').some(x => x.kind === 'share_information'));
  const allowed = defaults({ social, publicStories: ['story'], time: workTime,
    receptionist: agent('receptionist', {
      schedule: atWork.schedule,
      boundaries: { allowInformationSharingAtWork: true }
    })
  });
  assert.ok(evaluateSocialIntents(allowed, 'receptionist').some(x => x.kind === 'share_information'));
});

test('a conflicting rumour permits an NPC to offer a correction', () => {
  let social = createSocialCognitionState();
  const story = event('story', 'helped', 'mara', 'regular');
  social = witnessed(social, story, 'receptionist');
  social = witnessed(social, story, 'theresa');
  social = shareSocialRumour(social, 'theresa', 'regular', 'story', now, profiles,
    { retoldAs: 'threatened' });
  assert.ok(evaluateSocialIntents(defaults({ social, publicStories: ['story'] }), 'receptionist')
    .some(x => x.kind === 'share_information' && x.eventId === 'story'));
  social = shareSocialRumour(social, 'receptionist', 'regular', 'story',
    '2026-11-07T15:00:00Z', profiles);
  // Two equally credible, different messengers are not automatically proof.
  // The listener remains unconvinced, so offering the correction is still valid.
  assert.ok(evaluateSocialIntents(defaults({ social, publicStories: ['story'] }), 'receptionist')
    .some(x => x.kind === 'share_information' && x.eventId === 'story'));

  // Direct knowledge is authoritative to this individual's opinion.
  social = witnessed(social, story, 'regular');
  assert.ok(!evaluateSocialIntents(defaults({ social, publicStories: ['story'] }), 'receptionist')
    .some(x => x.kind === 'share_information' && x.eventId === 'story'));
});

test('a directional cooldown blocks repeated initiation until it expires', () => {
  const recent = { [relationshipKey('receptionist', 'regular')]: '2026-11-07T12:50:00Z' };
  assert.deepEqual(evaluateSocialIntents(defaults({ lastInitiatedAt: recent }), 'receptionist'), []);
  assert.ok(evaluateSocialIntents(defaults({
    time: '2026-11-07T13:31:00Z', lastInitiatedAt: recent
  }), 'receptionist').length > 0);
  assert.ok(evaluateSocialIntents(defaults(), 'receptionist').length > 0);
});

test('decisions are deterministic proposals and never mutate world state', () => {
  const context = defaults({ others: { neighbour: agent('neighbour') } });
  const before = structuredClone(context);
  const actions = evaluateSocialIntents(context, 'receptionist');
  assert.equal(actions.length, 2);
  assert.deepEqual(evaluateSocialIntents(context, 'receptionist'), actions);
  assert.deepEqual(chooseSocialIntent(context, 'receptionist'), actions[0]);
  assert.deepEqual(context, before);
});

test('invalid schedules, traits and timestamps are rejected', () => {
  const overlap = agent('receptionist', {
    schedule: [slot('glassmarket', 0, 720), slot('south-dock-pier', 300, 900)]
  });
  assert.throws(() => evaluateSocialIntents(defaults({ receptionist: overlap }), 'receptionist'),
    /Overlapping social schedule/);
  assert.throws(() => evaluateSocialIntents(defaults({
    receptionist: agent('receptionist', { drives: { connection: 2 } })
  }), 'receptionist'), /Invalid social drive/);
  assert.throws(() => chooseSocialIntent(defaults(), 'unknown'), /Unknown social actor/);
  assert.throws(() => chooseSocialIntent(defaults({ time: 'not-a-time' }), 'receptionist'),
    /Invalid game-world timestamp/);
});

test('no off-duty invitation unless the recipient is also available socially', () => {
  const social = acquainted();
  const regular = agent('regular', { schedule: [slot('glassmarket', 0, 1440, 'working')] });
  const ideas = evaluateSocialIntents(defaults({ social, regular }), 'receptionist');
  assert.equal(ideas.some(x => x.kind === 'invite_to_spend_time'), false);
  assert.ok(ideas.some(x => x.kind === 'start_conversation'));
});

test('two NPCs can initiate friendship actions independently of a player', () => {
  let social = createSocialCognitionState();
  for (let i = 0; i < 7; i++) {
    social = witnessed(social,
      event('npc-chat-'+i, 'conversation', 'mara', 'theresa'), 'mara');
  }
  social = witnessed(social,
    event('npc-help', 'helped', 'theresa', 'mara'), 'mara');
  const context = defaults({
    social,
    others: {
      mara: agent('mara'),
      theresa: agent('theresa')
    }
  });
  assert.equal(chooseSocialIntent(context, 'mara')?.kind, 'invite_to_spend_time');
  assert.equal(chooseSocialIntent(context, 'mara')?.targetId, 'theresa');
});

test('lower social drive prevents an invitation even after positive history', () => {
  const social = acquainted();
  const actor = agent('receptionist', {
    drives: { connection: 0.2 }
  });
  assert.ok(!evaluateSocialIntents(defaults({
    social, receptionist: actor
  }), 'receptionist').some(x => x.kind === 'invite_to_spend_time'));
});
