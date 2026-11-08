import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSocialSnapshot, parseSocialVisitResult
} from '../SRC/services/social.ts';

test('the RPC presentation contract accepts server-authored social state', () => {
  const snapshot = parseSocialSnapshot({
    version: 1,
    relationships: [{
      observer_key: 'npc:example',
      subject_key: 'player:character-1',
      familiarity: 1, warmth: 0, trust: 0, reliability: 0,
      respect: 0, discretion: 0, fear: 0, indebtedness: 0,
      last_perceived_at: '2026-11-07T21:00:00Z'
    }],
    routines: [{
      observer_key: 'npc:example',
      subject_key: 'player:character-1',
      encounters: 1,
      last_encounter_at: '2026-11-07T21:00:00Z'
    }]
  });
  assert.equal(snapshot.version,1);
  assert.equal(snapshot.relationships[0].warmth,0);
  assert.equal(snapshot.routines[0].encounters,1);
});

test('malformed data and unsupported snapshot versions are rejected', () => {
  assert.throws(()=>parseSocialSnapshot(null),/Unsupported/);
  assert.throws(()=>parseSocialSnapshot({version:2,relationships:[],routines:[]}),/Unsupported/);
  assert.throws(()=>parseSocialSnapshot({version:1,relationships:[{
    observer_key:'npc:test',subject_key:'player:a',familiarity:999
  }],routines:[]}),/Malformed persisted social relationship/);
  assert.throws(()=>parseSocialSnapshot({version:1,relationships:[],routines:[{
    observer_key:'npc:test', subject_key:'player:a',
    encounters:-1, last_encounter_at:'2026-11-07T21:00:00Z'
  }]}),/Malformed persisted social routine/);
});

test('server visit confirmations are validated before consumption', () => {
  assert.deepEqual(parseSocialVisitResult({recorded:true,replayed:false}),
    {recorded:true,replayed:false});
  assert.deepEqual(parseSocialVisitResult({recorded:true,replayed:true}),
    {recorded:true,replayed:true});
  assert.throws(()=>parseSocialVisitResult({recorded:false,replayed:false}),/Malformed/);
  assert.throws(()=>parseSocialVisitResult({recorded:true,replayed:'yes'}),/Malformed/);
});
