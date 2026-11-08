-- READ-ONLY Supabase preflight for the Stray Frequency social migration.
-- Run against the intended Supabase project after confirming its identity.
-- Does not inspect user rows, change permissions, or create anything.

-- Does the real characters table match our current TypeScript assumptions?
select column_name, data_type, udt_name, is_nullable
from information_schema.columns
where table_schema='public' and table_name='characters'
  and column_name in ('id','account_id','location_id')
order by ordinal_position;

-- Does the app enforce at most one playable character per account?
select c.conname, pg_get_constraintdef(c.oid) as definition
from pg_constraint c
join pg_class rel on rel.oid=c.conrelid
join pg_namespace n on n.oid=rel.relnamespace
where n.nspname='public' and rel.relname='characters'
order by c.conname;

-- What existing game functions might conflict with encounter authority?
select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer,
       pg_get_function_result(p.oid) as result_type
from pg_proc p
join pg_namespace n on p.pronamespace=n.oid
where n.nspname='public' and p.proname in
  ('game_action','game_snapshot','social_record_visit','social_snapshot')
order by p.proname;

-- Expected to return zero before migration; confirms no collision.
select table_name
from information_schema.tables
where table_schema='public' and table_name in
  ('social_npc_catalog','social_relationships',
   'social_routines','social_encounter_receipts')
order by table_name;
