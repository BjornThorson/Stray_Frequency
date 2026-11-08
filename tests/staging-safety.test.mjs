import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const target = new URL('../scripts/verify-staged-social.mjs',import.meta.url);

function run(env) {
  return spawnSync(process.execPath,[target.pathname],{
    encoding:'utf8',
    env:{
      PATH:process.env.PATH,
      ...env
    }
  });
}

test('staged integration runner refuses the production project before network calls',()=>{
  const result=run({
    SF_STAGING_SUPABASE_URL:'https://aikcmzqdzsbnknvcapvm.supabase.co',
    SF_STAGING_EXPECTED_REF:'aikcmzqdzsbnknvcapvm',
    SF_STAGING_CONFIRM_WRITE:'I_AUTHORISE_STAGING_ONLY'
  });
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/SAFETY STOP: refusing/);
});

test('staging run refuses a valid-looking branch without explicit write consent',()=>{
  const result=run({
    SF_STAGING_SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',
    SF_STAGING_EXPECTED_REF:'abcdefghijklmnopqrst'
  });
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/SAFETY STOP: staging writes require/);
});

test('test runner refuses missing credentials before any hosted API request',()=>{
  const result=run({
    SF_STAGING_SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',
    SF_STAGING_EXPECTED_REF:'abcdefghijklmnopqrst',
    SF_STAGING_CONFIRM_WRITE:'I_AUTHORISE_STAGING_ONLY'
  });
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Missing staging environment variables/);
  assert.doesNotMatch(result.stdout,/PASS/);
});
