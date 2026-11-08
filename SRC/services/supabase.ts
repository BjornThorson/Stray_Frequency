import {
  createClient,
  type AuthChangeEvent,
  type RealtimeChannel,
  type Session,
  type User
} from '@supabase/supabase-js';
import type { BodyType, Character } from '../core/types';

const supabase = createClient(
  'https://aikcmzqdzsbnknvcapvm.supabase.co',
  'sb_publishable_lF1shaFKY_Mcl8e0p7amqQ_UcBL_yV9'
);

export type AuthenticatedUser = User;
export type GameAction =
  | 'move_item' | 'equip' | 'unequip' | 'navigate'
  | 'salvage' | 'fish' | 'cook_shrimp' | 'eat_shrimp'
  | 'buy_salvage_bar' | 'sell_metal_scrap';

export interface RoomChatMessage {
  id: number;
  character_id: string;
  character_name: string;
  room_id: string;
  body: string;
  created_at: string;
}

export interface RoomPlayer {
  character_id: string;
  character_name: string;
  room_id: string;
}

let developerAccess = false;
let roomChatChannel: RealtimeChannel | null = null;

export function hasDeveloperAccess(): boolean { return developerAccess; }

export async function refreshDeveloperAccess(): Promise<boolean> {
  developerAccess = false;
  const { data, error } = await supabase.rpc('is_developer');
  if (error) {
    console.warn('Could not verify developer access.', error);
    return false;
  }
  developerAccess = data === true;
  return developerAccess;
}

export function developerSpawnItem(itemKey: string) {
  return supabase.rpc('developer_spawn_item', { p_item_key: itemKey });
}

export function getAuthSession() { return supabase.auth.getSession(); }

export function subscribeToAuthChanges(
  callback: (event: AuthChangeEvent, session: Session | null) => void
) {
  return supabase.auth.onAuthStateChange(callback);
}

export function registerAccount(email: string, password: string) {
  return supabase.auth.signUp({ email, password });
}

export function loginAccount(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

export function resendSignupConfirmation(email: string) {
  return supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: 'https://strayfrequency.co.uk' }
  });
}

export function logoutAccount() {
  developerAccess = false;
  void stopRoomChatSubscription();
  return supabase.auth.signOut();
}

export async function findCharacterByAccount(accountId: string) {
  const { data, error } = await supabase.from('characters')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();
  return { data: data as Character | null, error };
}

export async function createCharacter(input: {
  account_id: string;
  name: string;
  body_type: BodyType;
  appearance_skipped: true;
}) {
  void input.account_id;
  void input.appearance_skipped;
  const { data, error } = await supabase.rpc('create_player_character', {
    p_name: input.name,
    p_body_type: input.body_type
  });
  return { data: data as Character | null, error };
}

export function fetchGameSnapshot() {
  return supabase.rpc('game_snapshot');
}

export function performGameAction(action: GameAction, payload: Record<string, unknown> = {}) {
  return supabase.rpc('game_action', { p_action: action, p_payload: payload });
}

export async function fetchCurrentRoomChat(limit = 50) {
  const { data, error } = await supabase.rpc('current_room_chat', { p_limit: limit });
  return { data: (data ?? []) as RoomChatMessage[], error };
}

export function sendRoomChatMessage(body: string) {
  return supabase.rpc('send_room_chat_message', { p_body: body });
}

export async function fetchCurrentRoomPlayers() {
  const { data, error } = await supabase.rpc('current_room_players');
  return { data: (data ?? []) as RoomPlayer[], error };
}

export async function stopRoomChatSubscription(): Promise<void> {
  if (!roomChatChannel) return;
  const channel = roomChatChannel;
  roomChatChannel = null;
  await supabase.removeChannel(channel);
}

export async function subscribeToRoomChat(roomId: string, onChange: () => void): Promise<void> {
  await stopRoomChatSubscription();
  roomChatChannel = supabase
    .channel(`room-chat:${roomId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'room_chat_messages', filter: `room_id=eq.${roomId}` },
      () => onChange()
    )
    .subscribe();
}

/**
 * NPC social data is exposed only through authenticated, server-authoritative
 * RPCs. These methods intentionally do not expose direct table access.
 */
export function fetchSocialSnapshotRpc() {
  return supabase.rpc('social_snapshot');
}

export function recordSocialVisitRpc(npcId: string, requestId: string) {
  return supabase.rpc('social_record_visit', {
    p_npc_id: npcId,
    p_request_id: requestId
  });
}
