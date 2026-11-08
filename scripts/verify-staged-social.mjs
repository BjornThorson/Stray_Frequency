/**
 * Manual hosted integration test. NEVER run against production.
 *
 * An isolated Supabase branch must already have the social migration, a
 * marrow_kest catalogue row enabled for Glassmarket, and two distinct test
 * accounts with playable characters standing at glassmarket.
 *
 * Supply credentials through the sandbox's environment, never in source,
 * command arguments, chat or a committed .env file.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const PROD_REF = 'aikcmzqdzsbnknvcapvm';
const REQUIRED = [
  'SF_STAGING_SUPABASE_URL',
  'SF_STAGING_EXPECTED_REF',
  'SF_STAGING_SUPABASE_PUBLISHABLE_KEY',
  'SF_STAGING_ACCOUNT_A_EMAIL',
  'SF_STAGING_ACCOUNT_A_PASSWORD',
  'SF_STAGING_ACCOUNT_B_EMAIL',
  'SF_STAGING_ACCOUNT_B_PASSWORD'
];

function stagingConfig(env) {
  const urlString = env.SF_STAGING_SUPABASE_URL;
  const ref = env.SF_STAGING_EXPECTED_REF;
  if (!urlString || !ref) throw new Error('Staging URL and expected project ref are required.');
  let url;
  try { url = new URL(urlString); }
  catch { throw new Error('Invalid staging Supabase URL.'); }

  if (url.protocol !== 'https:' ||
      !/^[a-z0-9]{12,32}$/.test(ref) ||
      url.hostname !== ref + '.supabase.co' ||
      ref === PROD_REF ||
      url.hostname === PROD_REF + '.supabase.co') {
    throw new Error('SAFETY STOP: refusing a non-staging or production Supabase URL.');
  }
  if (env.SF_STAGING_CONFIRM_WRITE !== 'I_AUTHORISE_STAGING_ONLY') {
    throw new Error('SAFETY STOP: staging writes require SF_STAGING_CONFIRM_WRITE=I_AUTHORISE_STAGING_ONLY.');
  }
  const missing = REQUIRED.filter(key => !env[key]);
  if (missing.length) {
    throw new Error('Missing staging environment variables: ' + missing.join(', '));
  }
  if (env.SF_STAGING_ACCOUNT_A_EMAIL === env.SF_STAGING_ACCOUNT_B_EMAIL) {
    throw new Error('Two distinct staging test accounts are required.');
  }
  return { url: url.origin, ref, key: env.SF_STAGING_SUPABASE_PUBLISHABLE_KEY };
}

function client(config) {
  return createClient(config.url, config.key, {
    auth: { persistSession:false, autoRefreshToken:false, detectSessionInUrl:false }
  });
}

async function unwrap(promise, label) {
  const { data, error } = await promise;
  if (error) throw new Error(label + ': ' + error.message);
  return data;
}

async function authenticatedClient(config, email, password) {
  const c = client(config);
  const result = await unwrap(c.auth.signInWithPassword({ email, password }), 'Sign-in failed');
  if (!result.user?.id) throw new Error('Authenticated user unavailable.');
  return { client:c, userId:result.user.id };
}

async function playerRoom(identity) {
  const character = await unwrap(identity.client
    .from('characters')
    .select('id,location_id')
    .eq('account_id', identity.userId)
    .maybeSingle(), 'Read character');
  if (!character) throw new Error('Staging test account has no playable character.');
  if (character.location_id !== 'glassmarket') {
    throw new Error('Both staging characters must be in Glassmarket before this test.');
  }
  return character;
}

async function socialSnapshot(identity, label) {
  const response = await unwrap(identity.client.rpc('social_snapshot'),label);
  assert.equal(response.version,1,'Unexpected snapshot version');
  assert.ok(Array.isArray(response.relationships),'Missing directional relationships');
  assert.ok(Array.isArray(response.routines),'Missing routine history');
  return response;
}

function encounters(snapshot, characterId) {
  return snapshot.routines.find(row =>
    row.observer_key === 'npc:marrow_kest' &&
    row.subject_key === 'player:' + characterId
  )?.encounters ?? 0;
}

async function greet(identity, requestId) {
  return unwrap(identity.client.rpc('social_record_visit', {
    p_npc_id:'marrow_kest',
    p_request_id:requestId
  }), 'Marrow encounter');
}

async function verify() {
  const config = stagingConfig(process.env);
  // Only validated, deliberately isolated staging targets reach the network.
  const a = await authenticatedClient(config,
    process.env.SF_STAGING_ACCOUNT_A_EMAIL,
    process.env.SF_STAGING_ACCOUNT_A_PASSWORD);
  const b = await authenticatedClient(config,
    process.env.SF_STAGING_ACCOUNT_B_EMAIL,
    process.env.SF_STAGING_ACCOUNT_B_PASSWORD);
  assert.notEqual(a.userId,b.userId,'Accounts must belong to different users');

  // Two independent clients for account A exercise concurrent retries.
  const aAgain = await authenticatedClient(config,
    process.env.SF_STAGING_ACCOUNT_A_EMAIL,
    process.env.SF_STAGING_ACCOUNT_A_PASSWORD);

  const charA = await playerRoom(a);
  const charB = await playerRoom(b);
  assert.notEqual(charA.id,charB.id,'The test must use two different characters');

  const beforeA = await socialSnapshot(a,'Snapshot A before');
  const beforeB = await socialSnapshot(b,'Snapshot B before');

  const idA = randomUUID();
  const concurrent = await Promise.all([greet(a,idA),greet(aAgain,idA)]);
  assert.equal(concurrent.filter(x => x.recorded === true && x.replayed === false).length,1,
    'Exactly one of the concurrent attempts should create the encounter');
  assert.equal(concurrent.filter(x => x.recorded === true && x.replayed === true).length,1,
    'Exactly one of the concurrent attempts should be an idempotent replay');

  const afterA = await socialSnapshot(a,'Snapshot A after');
  const afterB = await socialSnapshot(b,'Snapshot B after A visit');
  assert.equal(encounters(afterA,charA.id),encounters(beforeA,charA.id)+1,
    'A should gain exactly one visit');
  assert.deepEqual(afterB,beforeB,'A visit must not modify B records');

  // A second fresh request is subject to the server cooldown.
  const tooSoon = await a.client.rpc('social_record_visit',{
    p_npc_id:'marrow_kest',p_request_id:randomUUID()
  });
  assert.ok(tooSoon.error,'A new immediate greeting should be rejected by cooldown');

  const bVisit = await greet(b,randomUUID());
  assert.equal(bVisit.recorded,true);
  assert.equal(bVisit.replayed,false);
  const finalB = await socialSnapshot(b,'Snapshot B after B visit');
  const finalA = await socialSnapshot(a,'Snapshot A after B visit');
  assert.equal(encounters(finalB,charB.id),encounters(beforeB,charB.id)+1,
    'B should gain exactly one separate visit');
  assert.deepEqual(finalA,afterA,'B visit must not modify A records');

  // The exposed Data API must not leak private social state.
  const anonymous = client(config);
  const noAnonymous = await anonymous.rpc('social_snapshot');
  assert.ok(noAnonymous.error,'Anonymous callers must not execute social_snapshot');
  const denied = await a.client.from('social_relationships').select('*').limit(1);
  assert.ok(denied.error,'Direct social table reads must remain blocked');

  console.log('PASS: two authenticated staging accounts, separate social histories');
  console.log('PASS: concurrent same-ID retries are applied exactly once');
  console.log('PASS: server cooldown, anon RPC denial, direct-table denial');
  console.log('No production project or credentials were accessed.');
}

verify().catch(e => {
  // Never log environment values, emails, password contents or session tokens.
  console.error('STAGED SOCIAL VALIDATION:', e.message);
  process.exitCode=1;
});
