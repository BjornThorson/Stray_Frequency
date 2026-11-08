import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSocialInteractionState, proposeSocialInteraction,
  respondToSocialInteraction, completeSocialInteraction,
  suggestSocialResponse, expireSocialInteractions
} from '../SRC/systems/social-interaction.ts';
import {
  createSocialCognitionState, witnessSocialEvent, getSocialKnowledge
} from '../SRC/systems/social-cognition.ts';
import { getSocialRelationship, relationshipKey } from '../SRC/systems/social.ts';

const moment = '2026-11-07T13:00:00Z'; // Saturday
const later = '2026-11-07T13:02:00Z';
const workTime = '2026-11-07T10:00:00Z';
const profiles = Object.fromEntries(['receptionist','regular','mara','theresa'].map(id =>
  [id, { id, traits: { empathy: 0.5, scepticism: 0.5 } }]));
const slot = (place='glassmarket', start=0, end=1440, activity='free') => ({
  dayOfWeek: 6, startMinute: start, endMinute: end, locationId: place, activity
});
function person(id, overrides={}) {
  return {
    id,
    drives: { connection: 0.8, curiosity: 0.8, caution: 0.8, ...overrides.drives },
    boundaries: {
      noContactIds: [], allowInvitations: true,
      allowInformationSharing: true, allowInformationSharingAtWork: false,
      ...overrides.boundaries
    },
    schedule: overrides.schedule ?? [slot()]
  };
}
function world({
  nowUtc=moment, agents={}, shareableEventIds=[], authorised=()=>true
}={}) {
  return {
    nowUtc,
    agents: {
      receptionist: person('receptionist'),
      regular: person('regular'),
      mara: person('mara'),
      theresa: person('theresa'),
      ...agents
    },
    cognitionProfiles: profiles,
    shareableEventIds,
    canActAs: authorised
  };
}
const request = (id, kind='start_conversation', actorId='receptionist', targetId='regular',
  eventId=undefined) => ({
  id, kind, actorId, targetId,
  ...(eventId === undefined ? {} : { eventId })
});
function progressedRelationship() {
  let cognition = createSocialCognitionState();
  for(let i=0; i<6; i++) {
    const event = {
      id: 'intro-'+i, kind: 'conversation', actorId:'receptionist',
      targetId: 'regular', occurredAt: moment, locationId: 'glassmarket'
    };
    cognition = witnessSocialEvent(cognition, event, 'receptionist', moment, profiles);
  }
  const kindness = {
    id: 'kindness', kind:'helped', actorId:'regular',
    targetId:'receptionist', occurredAt:moment, locationId:'glassmarket'
  };
  cognition = witnessSocialEvent(cognition, kindness, 'receptionist', moment, profiles);
  return cognition;
}

test('full conversation: proposal, target acceptance, completion, two observers', () => {
  const env=world();
  let state=createSocialInteractionState();
  const initial=structuredClone(state);
  state=proposeSocialInteraction(state,env,request('c1'));
  assert.equal(state.interactions.c1.status,'pending');
  assert.deepEqual(state.cognition,initial.cognition);
  assert.equal(suggestSocialResponse(state,env,'c1'),'accept');
  state=respondToSocialInteraction(state,{...env,nowUtc:later},'c1','regular','accept');
  assert.equal(state.interactions.c1.status,'accepted');
  assert.deepEqual(state.cognition,initial.cognition);

  const completed=completeSocialInteraction(state,{...env,nowUtc:later},'c1','receptionist');
  assert.equal(completed.interactions.c1.status,'completed');
  assert.equal(completed.interactions.c1.completedSocialEventId,'interaction:c1');
  assert.ok(getSocialRelationship(completed.cognition.social,'receptionist','regular').familiarity > 0);
  assert.ok(getSocialRelationship(completed.cognition.social,'regular','receptionist').familiarity > 0);
  assert.equal(getSocialKnowledge(completed.cognition,'theresa','interaction:c1'),undefined);
  assert.equal(getSocialKnowledge(completed.cognition,'regular','interaction:c1').chosen.source,'direct');
  assert.equal(completed.lastInitiatedAt[relationshipKey('receptionist','regular')],later);
  assert.deepEqual(initial,createSocialInteractionState());
});

test('refusal does not modify trust, warmth, or routine history and invokes cooldown', () => {
  let state=proposeSocialInteraction(createSocialInteractionState(),world(),request('c1'));
  state=respondToSocialInteraction(state,world({nowUtc:later}),'c1','regular','decline');
  assert.equal(state.interactions.c1.status,'declined');
  assert.deepEqual(state.cognition,createSocialCognitionState());
  assert.throws(()=>proposeSocialInteraction(state,world({nowUtc:later}),request('c2')),
    /no longer eligible/);
  assert.throws(()=>respondToSocialInteraction(state,world({nowUtc:later}),'c1','regular','accept'),
    /No pending/);
});

test('only the target can respond; only the actor can complete', () => {
  let state=proposeSocialInteraction(createSocialInteractionState(),world(),request('c1'));
  assert.throws(()=>respondToSocialInteraction(state,world(),'c1','mara','accept'),
    /Only the target/);
  assert.throws(()=>respondToSocialInteraction(state,world({
    authorised: id=>id!=='regular'
  }),'c1','regular','accept'), /Not authorised/);
  state=respondToSocialInteraction(state,world(),'c1','regular','accept');
  assert.throws(()=>completeSocialInteraction(state,world(),'c1','regular'),
    /Only the initiator/);
  assert.throws(()=>completeSocialInteraction(state,world({
    authorised: id=>id!=='receptionist'
  }),'c1','receptionist'), /Not authorised/);
});

test('an unauthorised initiating actor cannot impersonate NPCs', () => {
  const state=createSocialInteractionState();
  assert.throws(()=>proposeSocialInteraction(state,world({
    authorised: id=>id!=='receptionist'
  }),request('c1')), /Not authorised/);
  assert.deepEqual(state,createSocialInteractionState());
});

test('proposal is recomputed, never trusting fabricated intent details', () => {
  const state=createSocialInteractionState();
  const env=world();
  assert.throws(()=>proposeSocialInteraction(state,env,request('c1','invite_to_spend_time')),
    /no longer eligible/);
  assert.throws(()=>proposeSocialInteraction(state,env,request('c2','share_information',
    'receptionist','regular','secret')), /no longer eligible/);
  assert.throws(()=>proposeSocialInteraction(state,env,request('c3','start_conversation',
    'receptionist','receptionist')), /Invalid social interaction/);
  assert.throws(()=>proposeSocialInteraction(state,env,request('c4','start_conversation',
    'receptionist','unknown')), /Unknown social character/);
  assert.deepEqual(state,createSocialInteractionState());
});

test('same interaction ID replays idempotently but conflicts are rejected',()=>{
  const env=world();
  const original=proposeSocialInteraction(createSocialInteractionState(),env,request('c1'));
  assert.strictEqual(proposeSocialInteraction(original,env,request('c1')),original);
  assert.throws(()=>proposeSocialInteraction(original,env,request('c1','share_information')),
    /Conflicting interaction ID/);
  assert.deepEqual(Object.keys(original.interactions),['c1']);
});

test('cannot send overlapping requests, including reverse-direction invitations',()=>{
  const state=proposeSocialInteraction(createSocialInteractionState(),world(),request('c1'));
  assert.throws(()=>proposeSocialInteraction(state,world(),request('c2')),
    /active interaction/);
  assert.throws(()=>proposeSocialInteraction(state,world(),
    request('c3','start_conversation','regular','receptionist')),
    /active interaction/);
});

test('NPC responds autonomously according to its OWN knowledge, not the initiator opinion',()=>{
  let state=createSocialInteractionState();
  state={...state,cognition:progressedRelationship()};
  state=proposeSocialInteraction(state,world(),request('inv1','invite_to_spend_time'));
  const initiator=getSocialRelationship(state.cognition.social,'receptionist','regular');
  const recipient=getSocialRelationship(state.cognition.social,'regular','receptionist');
  assert.ok(initiator.warmth>=15);
  assert.equal(recipient,undefined);
  assert.equal(suggestSocialResponse(state,world(),'inv1'),'decline');
  // A trusted human/agent acting as the target may still choose their own response.
  state=respondToSocialInteraction(state,world(),'inv1','regular','decline');
  assert.deepEqual(state.cognition, { ...state.cognition });
  assert.equal(state.interactions.inv1.status,'declined');
});

test('accepted invitations produce no relationship progress until shared time is completed',()=>{
  let state={...createSocialInteractionState(),cognition:progressedRelationship()};
  const previous=structuredClone(state.cognition);
  state=proposeSocialInteraction(state,world(),request('inv1','invite_to_spend_time'));
  state=respondToSocialInteraction(state,world(),'inv1','regular','accept');
  assert.deepEqual(state.cognition,previous);
  state=completeSocialInteraction(state,world({nowUtc:later}),'inv1','receptionist');
  assert.equal(state.interactions.inv1.status,'completed');
  assert.ok(getSocialRelationship(state.cognition.social,'receptionist','regular').familiarity >
    getSocialRelationship(previous.social,'receptionist','regular').familiarity);
  assert.ok(getSocialRelationship(state.cognition.social,'regular','receptionist').familiarity > 0);
});

test('professional shift disallows a personal invitation even with mutual affection',()=>{
  const onDuty=person('receptionist',{schedule:[
    slot('glassmarket',0,720,'working'),slot('glassmarket',720,1440,'free')
  ]});
  const env=world({nowUtc:workTime,agents:{receptionist:onDuty}});
  let state={...createSocialInteractionState(),cognition:progressedRelationship()};
  assert.throws(()=>proposeSocialInteraction(state,env,request('inv1','invite_to_spend_time')),
    /no longer eligible/);
});

test('a no-contact boundary introduced after acceptance blocks completion',()=>{
  let state=proposeSocialInteraction(createSocialInteractionState(),world(),request('c1'));
  state=respondToSocialInteraction(state,world(),'c1','regular','accept');
  const altered=world({agents:{regular:person('regular',{
    boundaries:{noContactIds:['receptionist']}
  })}});
  assert.throws(()=>completeSocialInteraction(state,altered,'c1','receptionist'),
    /no longer available/);
  assert.equal(state.interactions.c1.status,'accepted');
  assert.deepEqual(state.cognition,createSocialCognitionState());
});

test('a location change after acceptance blocks completion and preserves state',()=>{
  let state=proposeSocialInteraction(createSocialInteractionState(),world(),request('c1'));
  state=respondToSocialInteraction(state,world(),'c1','regular','accept');
  const otherLocation=world({agents:{regular:person('regular',{
    schedule:[slot('south-dock-pier')]
  })}});
  assert.throws(()=>completeSocialInteraction(state,otherLocation,'c1','receptionist'),
    /no longer available/);
  assert.deepEqual(state.cognition,createSocialCognitionState());
});

test('completion requires response and cannot be replayed to farm familiarity',()=>{
  const env=world();
  let state=proposeSocialInteraction(createSocialInteractionState(),env,request('c1'));
  assert.throws(()=>completeSocialInteraction(state,env,'c1','receptionist'),
    /No accepted/);
  state=respondToSocialInteraction(state,env,'c1','regular','accept');
  state=completeSocialInteraction(state,env,'c1','receptionist');
  const before=structuredClone(state);
  assert.throws(()=>completeSocialInteraction(state,env,'c1','receptionist'),
    /No accepted/);
  assert.deepEqual(state,before);
});

test('sharing public information only changes recipient knowledge at completion',()=>{
  let cognition=createSocialCognitionState();
  const story={id:'mara-help',kind:'helped',actorId:'mara',targetId:'regular',
    locationId:'glassmarket',occurredAt:moment};
  cognition=witnessSocialEvent(cognition,story,'receptionist',moment,profiles);
  let state={...createSocialInteractionState(),cognition};
  const env=world({shareableEventIds:['mara-help']});
  state=proposeSocialInteraction(state,env,request('g1','share_information',
    'receptionist','regular','mara-help'));
  assert.equal(getSocialKnowledge(state.cognition,'regular','mara-help'),undefined);
  state=respondToSocialInteraction(state,env,'g1','regular','accept');
  assert.equal(getSocialKnowledge(state.cognition,'regular','mara-help'),undefined);
  state=completeSocialInteraction(state,env,'g1','receptionist');
  assert.equal(getSocialKnowledge(state.cognition,'regular','mara-help')?.chosen.source,'reported');
  assert.ok(getSocialRelationship(state.cognition.social,'regular','mara').respect > 0);
  assert.equal(state.interactions.g1.completedSocialEventId,undefined);
});

test('an event made private between proposal and completion cannot be leaked',()=>{
  let cognition=createSocialCognitionState();
  cognition=witnessSocialEvent(cognition,{id:'story',kind:'helped',actorId:'mara',
    targetId:'regular',locationId:'glassmarket',occurredAt:moment},
    'receptionist',moment,profiles);
  let state={...createSocialInteractionState(),cognition};
  state=proposeSocialInteraction(state,world({shareableEventIds:['story']}),
    request('g1','share_information','receptionist','regular','story'));
  state=respondToSocialInteraction(state,world({shareableEventIds:['story']}),
    'g1','regular','accept');
  const before=structuredClone(state);
  assert.throws(()=>completeSocialInteraction(state,world(),
    'g1','receptionist'), /no longer available/);
  assert.deepEqual(state,before);
  assert.equal(getSocialKnowledge(state.cognition,'regular','story'),undefined);
});

test('NPC keeping its distance completes immediately without consent or relationship changes',()=>{
  let cognition=createSocialCognitionState();
  for (let i=0;i<2;i++) {
    cognition=witnessSocialEvent(cognition,{id:'threat-'+i,kind:'threatened',
      actorId:'regular',targetId:'receptionist',locationId:'glassmarket',
      occurredAt:moment}, 'receptionist',moment,profiles);
  }
  let state={...createSocialInteractionState(),cognition};
  const before=structuredClone(cognition);
  state=proposeSocialInteraction(state,world(),request('avoid1','keep_distance'));
  assert.equal(state.interactions.avoid1.status,'completed');
  assert.deepEqual(state.cognition,before);
  assert.throws(()=>respondToSocialInteraction(state,world(),'avoid1','regular','accept'),
    /No pending/);
});

test('expired proposals and expired accepted interactions are explicitly reclaimed',()=>{
  const env=world();
  let state=proposeSocialInteraction(createSocialInteractionState(),env,request('c1'));
  assert.throws(()=>respondToSocialInteraction(state,
    world({nowUtc:'2026-11-07T13:11:00Z'}),'c1','regular','accept'), /expired/);
  state=expireSocialInteractions(state,'2026-11-07T13:11:00Z');
  assert.equal(state.interactions.c1.status,'expired');
  state=proposeSocialInteraction(state,world({nowUtc:'2026-11-07T13:12:00Z'}),request('c2'));
  state=respondToSocialInteraction(state,world({nowUtc:'2026-11-07T13:13:00Z'}),'c2','regular','accept');
  assert.throws(()=>completeSocialInteraction(state,
    world({nowUtc:'2026-11-07T14:14:00Z'}),'c2','receptionist'), /expired/);
  state=expireSocialInteractions(state,'2026-11-07T14:14:00Z');
  assert.equal(state.interactions.c2.status,'expired');
  assert.deepEqual(state.cognition,createSocialCognitionState());
});

test('outcome state is serialisable and no operation mutates its input',()=>{
  const start=createSocialInteractionState();
  const afterProposal=proposeSocialInteraction(start,world(),request('c1'));
  const snapshot=structuredClone(afterProposal);
  const afterReply=respondToSocialInteraction(afterProposal,world(),'c1','regular','accept');
  assert.deepEqual(afterProposal,snapshot);
  const completed=completeSocialInteraction(afterReply,world(),'c1','receptionist');
  assert.deepEqual(start,createSocialInteractionState());
  assert.deepEqual(JSON.parse(JSON.stringify(completed)),completed);
});

test('replay and malformed identifiers cannot masquerade as existing object properties',()=>{
  const original=createSocialInteractionState();
  for(const id of ['__proto__','', ' space', 'evil/../path']) {
    assert.throws(()=>proposeSocialInteraction(original,world(),request(id)),
      /Invalid social interaction identity/);
  }
  const allowed=proposeSocialInteraction(original,world(),request('constructor'));
  assert.equal(allowed.interactions.constructor.id,'constructor');
  assert.equal(original.interactions.constructor,Object.prototype.constructor);
});

test('a stale world clock cannot backdate an invitation response or completion',()=>{
  const starting=world({nowUtc:moment});
  let state=proposeSocialInteraction(createSocialInteractionState(),starting,request('clock1'));
  const before=structuredClone(state);
  assert.throws(()=>respondToSocialInteraction(state,
    world({nowUtc:'2026-11-07T12:59:00Z'}),'clock1','regular','decline'),/cannot move backwards/);
  assert.deepEqual(state,before);
  state=respondToSocialInteraction(state,world({nowUtc:later}),'clock1','regular','accept');
  assert.throws(()=>completeSocialInteraction(state,
    world({nowUtc:moment}),'clock1','receptionist'),/cannot move backwards/);
  assert.equal(state.interactions.clock1.status,'accepted');
});
