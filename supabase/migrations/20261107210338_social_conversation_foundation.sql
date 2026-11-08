-- Stray Frequency social persistence: a deliberately narrow, server-authoritative
-- encounter boundary. Applying it creates no enabled NPC encounters.
-- All social tables remain private to client roles; only two vetted RPCs are public.
-- NPC content is opt-in via social_npc_catalog.enabled (no NPCs are enabled here).

create table if not exists public.social_npc_catalog (
  npc_id text primary key check (npc_id ~ '^[a-z][a-z0-9_-]{1,63}$'),
  room_id text not null,
  enabled boolean not null default false
);

-- Existing Glassmarket merchant, intentionally disabled until a verified
-- game build has the encounter UI and hosted schema migration available.
insert into public.social_npc_catalog (npc_id, room_id, enabled)
values ('marrow_kest', 'glassmarket', false)
on conflict (npc_id) do nothing;

create table if not exists public.social_relationships (
  character_id text not null,
  observer_key text not null,
  subject_key text not null,
  familiarity integer not null default 0 check (familiarity between 0 and 100),
  warmth integer not null default 0 check (warmth between -100 and 100),
  trust integer not null default 0 check (trust between -100 and 100),
  reliability integer not null default 0 check (reliability between -100 and 100),
  respect integer not null default 0 check (respect between -100 and 100),
  discretion integer not null default 0 check (discretion between -100 and 100),
  fear integer not null default 0 check (fear between 0 and 100),
  indebtedness integer not null default 0 check (indebtedness between -100 and 100),
  last_perceived_at timestamptz,
  primary key (character_id, observer_key, subject_key),
  check (observer_key <> subject_key)
);

create table if not exists public.social_routines (
  character_id text not null,
  observer_key text not null,
  subject_key text not null,
  encounters integer not null default 0 check (encounters >= 0),
  last_encounter_at timestamptz not null,
  primary key (character_id, observer_key, subject_key),
  check (observer_key <> subject_key)
);

-- Intentional, unbounded audit receipts for now: never prune without designing
-- a corresponding idempotency-retention policy. No personal conversation text.
create table if not exists public.social_encounter_receipts (
  character_id text not null,
  request_id uuid not null,
  npc_id text not null references public.social_npc_catalog(npc_id),
  occurred_at timestamptz not null default now(),
  primary key (character_id, request_id)
);

create index if not exists social_encounter_receipts_character_time
  on public.social_encounter_receipts(character_id, occurred_at desc);

alter table public.social_npc_catalog enable row level security;
alter table public.social_relationships enable row level security;
alter table public.social_routines enable row level security;
alter table public.social_encounter_receipts enable row level security;

-- No direct access for browser roles even when historic defaults grant access.
revoke all on table
  public.social_npc_catalog,
  public.social_relationships,
  public.social_routines,
  public.social_encounter_receipts
  from public, anon, authenticated;

-- These functions accept no owner ID. Ownership is always resolved from
-- auth.uid() against the existing public.characters table.
create or replace function public.social_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_character_id text;
  v_relations jsonb;
  v_routines jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select c.id::text into v_character_id
  from public.characters c
  where c.account_id = auth.uid()
  order by c.id limit 1;

  if v_character_id is null then
    raise exception 'No playable character' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(
    to_jsonb(r) - 'character_id'
    order by r.observer_key, r.subject_key
  ), '[]'::jsonb) into v_relations
  from public.social_relationships r
  where r.character_id = v_character_id;

  select coalesce(jsonb_agg(
    to_jsonb(h) - 'character_id'
    order by h.observer_key, h.subject_key
  ), '[]'::jsonb) into v_routines
  from public.social_routines h
  where h.character_id = v_character_id;

  return jsonb_build_object(
    'version', 1,
    'relationships', v_relations,
    'routines', v_routines
  );
end;
$$;

-- A visit is a factual, limited contact, NOT a friendship gain or a claim that
-- a scripted conversation, off-duty meeting, or significant event occurred.
-- The caller supplies a retry identifier; the server supplies the actual actor,
-- NPC eligibility, location, time, and the result. One visit can only increment
-- familiarity once per request ID. More meaningful effects require additional
-- server-authoritative gameplay actions and explicit consent.
create or replace function public.social_record_visit(
  p_npc_id text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_character_id text;
  v_room_id text;
  v_npc_room text;
  v_previous_npc text;
  v_npc_key text;
  v_player_key text;
  v_now timestamptz := now();
  v_last_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_npc_id is null or p_request_id is null then
    raise exception 'NPC and retry ID required' using errcode = '22023';
  end if;

  -- Lock the character across concurrent movement and social actions. The
  -- existing game_action() changes the character row for navigation.
  select c.id::text, c.location_id::text
    into v_character_id, v_room_id
  from public.characters c
  where c.account_id = auth.uid()
  order by c.id
  limit 1
  for update of c;

  if v_character_id is null then
    raise exception 'No playable character' using errcode = 'P0001';
  end if;

  -- Idempotent retries work even after the regular cooldown begins.
  select e.npc_id into v_previous_npc
  from public.social_encounter_receipts e
  where e.character_id = v_character_id and e.request_id = p_request_id;

  if v_previous_npc is not null then
    if v_previous_npc <> p_npc_id then
      raise exception 'Retry ID was already used for a different NPC' using errcode = '22023';
    end if;
    return jsonb_build_object('recorded', true, 'replayed', true);
  end if;

  select n.room_id into v_npc_room
  from public.social_npc_catalog n
  where n.npc_id = p_npc_id and n.enabled = true;

  if v_npc_room is null or v_room_id is distinct from v_npc_room then
    raise exception 'NPC is unavailable in the current location' using errcode = 'P0001';
  end if;

  v_npc_key := 'npc:' || p_npc_id;
  v_player_key := 'player:' || v_character_id;

  select h.last_encounter_at into v_last_at
  from public.social_routines h
  where h.character_id = v_character_id and
    h.observer_key = v_npc_key and h.subject_key = v_player_key;

  if v_last_at is not null and v_last_at > v_now - interval '30 seconds' then
    raise exception 'Contact attempted too frequently' using errcode = 'P0001';
  end if;

  insert into public.social_encounter_receipts
    (character_id, request_id, npc_id, occurred_at)
  values (v_character_id, p_request_id, p_npc_id, v_now);

  insert into public.social_relationships
    (character_id, observer_key, subject_key, familiarity, last_perceived_at)
  values
    (v_character_id, v_npc_key, v_player_key, 1, v_now),
    (v_character_id, v_player_key, v_npc_key, 1, v_now)
  on conflict (character_id, observer_key, subject_key)
  do update set
    familiarity = least(100, public.social_relationships.familiarity + 1),
    last_perceived_at = excluded.last_perceived_at;

  insert into public.social_routines
    (character_id, observer_key, subject_key, encounters, last_encounter_at)
  values
    (v_character_id, v_npc_key, v_player_key, 1, v_now),
    (v_character_id, v_player_key, v_npc_key, 1, v_now)
  on conflict (character_id, observer_key, subject_key)
  do update set
    encounters = public.social_routines.encounters + 1,
    last_encounter_at = excluded.last_encounter_at;

  return jsonb_build_object('recorded', true, 'replayed', false);
end;
$$;

-- Restrict API function use explicitly, including PostgreSQL's PUBLIC role.
revoke execute on function public.social_snapshot() from public, anon, authenticated;
revoke execute on function public.social_record_visit(text, uuid) from public, anon, authenticated;
grant execute on function public.social_snapshot() to authenticated;
grant execute on function public.social_record_visit(text, uuid) to authenticated;
