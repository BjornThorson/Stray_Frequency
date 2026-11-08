import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ID_ONE = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const ID_TWO = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const SQL = new URL('../supabase/migrations/20261107210338_social_conversation_foundation.sql', import.meta.url);

test('social SQL migration: authenticated scope, replay, location, RLS and cooldown', async t => {
  const db = new PGlite();
  try {
    // Isolated simulated auth environment, never the hosted Supabase database.
    await db.exec(`
      create role authenticated;
      create role anon;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table public.characters (
        id text primary key, account_id uuid not null, location_id text not null
      );
    `);
    await db.exec(await readFile(SQL, 'utf8'));
    await db.exec(`
      insert into public.characters values
        ('char-one','${OWNER}','glassmarket'),
        ('char-two','${OTHER}','south-dock-pier');
      insert into public.social_npc_catalog(npc_id, room_id, enabled) values
        ('test_contact','glassmarket',true),
        ('test_pier','south-dock-pier',true),
        ('disabled_contact','glassmarket',false);
    `);

    async function identity(accountId, role='authenticated') {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[accountId]);
      await db.exec('set role '+role);
    }
    async function snapshot() {
      return (await db.query('select public.social_snapshot() as value')).rows[0].value;
    }
    async function record(npc,nonce) {
      return (await db.query('select public.social_record_visit($1,$2) as value',[npc,nonce])).rows[0].value;
    }
    async function admin(query) {
      await db.exec('reset role');
      await db.exec(query);
    }

    await t.test('anonymous clients have no RPC access and no direct table access', async () => {
      await identity('', 'anon');
      await assert.rejects(snapshot(), /permission denied/);
      await assert.rejects(db.query('select * from public.social_relationships'), /permission denied/);
      await assert.rejects(db.query('select * from public.social_npc_catalog'), /permission denied/);
    });

    await t.test('authenticated callers cannot read or write tables directly', async () => {
      await identity(OWNER);
      await assert.rejects(db.query('select * from public.social_relationships'), /permission denied/);
      await assert.rejects(db.query("update public.social_relationships set warmth=100"), /permission denied/);
    });

    await t.test('a character starts with an empty private snapshot', async () => {
      await identity(OWNER);
      assert.deepEqual(await snapshot(),{version:1,routines:[],relationships:[]});
    });

    await t.test('server verifies NPC and current location', async () => {
      await identity(OWNER);
      await assert.rejects(record('unknown',ID_ONE), /NPC is unavailable/);
      await assert.rejects(record('disabled_contact',ID_ONE), /NPC is unavailable/);
      await assert.rejects(record('test_pier',ID_ONE), /NPC is unavailable/);
      assert.deepEqual(await snapshot(),{version:1,routines:[],relationships:[]});
    });

    await t.test('an eligible visit saves two directional histories but no affection', async () => {
      await identity(OWNER);
      assert.deepEqual(await record('test_contact',ID_ONE),{recorded:true,replayed:false});
      const value=await snapshot();
      assert.equal(value.relationships.length,2);
      assert.equal(value.routines.length,2);
      for(const row of value.relationships) {
        assert.equal(row.familiarity,1);
        assert.equal(row.warmth,0);
        assert.equal(row.trust,0);
      }
      assert.deepEqual(new Set(value.relationships.map(x=>x.observer_key)),new Set(['npc:test_contact','player:char-one']));
      assert.equal(value.routines[0].encounters,1);
    });

    await t.test('retry with the same UUID never duplicates a social effect', async () => {
      await identity(OWNER);
      const before=await snapshot();
      assert.deepEqual(await record('test_contact',ID_ONE),{recorded:true,replayed:true});
      assert.deepEqual(await snapshot(),before);
      await assert.rejects(record('test_pier',ID_ONE), /different NPC/);
      assert.deepEqual(await snapshot(),before);
    });

    await t.test('new UUID on same NPC is rate-limited server-side', async () => {
      await identity(OWNER);
      await assert.rejects(record('test_contact',ID_TWO),/too frequently/);
      const value=await snapshot();
      assert.equal(value.routines[0].encounters,1);
    });

    await t.test('account B cannot see account A history or visit an NPC in another room', async () => {
      await identity(OTHER);
      assert.deepEqual(await snapshot(),{version:1,routines:[],relationships:[]});
      await assert.rejects(record('test_contact',ID_ONE),/NPC is unavailable/);
      assert.deepEqual(await record('test_pier',ID_ONE),{recorded:true,replayed:false});
      const value=await snapshot();
      assert.equal(value.relationships.length,2);
      assert.equal(value.relationships.some(x=>x.subject_key.includes('char-one')),false);
      assert.ok(value.relationships.every(x=>x.subject_key.includes('char-two') || x.subject_key.includes('test_pier')));
    });

    await t.test('location changes are respected; historical state remains scoped', async () => {
      await admin("update public.characters set location_id='south-dock-pier' where id='char-one'");
      await identity(OWNER);
      await assert.rejects(record('test_contact',ID_TWO),/NPC is unavailable/);
      assert.deepEqual(await record('test_pier',ID_TWO),{recorded:true,replayed:false});
      const value=await snapshot();
      assert.equal(value.relationships.length,4);
      assert.equal(value.routines.length,4);
    });

    await t.test('a new visit after cooldown increments capped familiarity only', async () => {
      await admin("update public.social_routines set last_encounter_at=now()-interval '2 minutes' where character_id='char-one' and observer_key='npc:test_pier'");
      await identity(OWNER);
      assert.deepEqual(await record('test_pier','cccccccc-cccc-4ccc-cccc-cccccccccccc'),{recorded:true,replayed:false});
      const value=await snapshot();
      const npc=value.relationships.find(x=>x.observer_key==='npc:test_pier');
      assert.equal(npc.familiarity,2);
      assert.equal(npc.warmth,0);
      assert.equal(value.routines.find(x=>x.observer_key==='npc:test_pier').encounters,2);
    });

    await t.test('functions reject missing authenticated account', async () => {
      await identity('33333333-3333-4333-8333-333333333333');
      await assert.rejects(snapshot(),/No playable character/);
      await assert.rejects(record('test_contact',ID_ONE),/No playable character/);
    });

    await t.test('function grants are scoped to authenticated only', async () => {
      await db.exec('reset role');
      const grantees=(await db.query(`
        select rolname, has_function_privilege(rolname,'public.social_snapshot()','execute') as allowed
        from pg_roles where rolname in ('anon','authenticated') order by rolname
      `)).rows;
      assert.deepEqual(grantees,[{rolname:'anon',allowed:false},{rolname:'authenticated',allowed:true}]);
    });
  } finally {
    await db.close();
  }
});
