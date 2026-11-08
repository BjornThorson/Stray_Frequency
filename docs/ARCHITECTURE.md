# Stray Frequency Architecture

## Purpose

Stray Frequency is a browser RPG built with TypeScript, Vite, Supabase and a deliberately small module architecture. The goal is separation of responsibility, not a framework inside the game.

`SRC/main.ts` is the bootstrap. Gameplay rules, persistence, data definitions and shell markup belong in their respective modules.

## Dependency direction

```text
main
  -> UI orchestration
       -> systems
       -> services
       -> data
       -> core

systems -> data -> core
systems --------> core
services -> data/core and external services
data ------------> core
core ------------> no application layer
```

Lower layers should not import UI modules. Systems should not depend on the DOM. Data modules describe things rather than mutating runtime state.

## Source responsibilities

### `core/`

Shared domain types, constants, runtime state and asset URL construction. `assets.ts` is the central TypeScript source for public asset references.

### `data/`

Static definitions for items, rooms, skills and other authored game data. Data says what exists; systems decide what happens.

### `systems/`

Gameplay rules and state mutation: inventory, equipment, navigation, gathering, fishing, cooking, skills and related mechanics.

### `services/`

External-infrastructure boundary. Supabase authentication/database/realtime access and character persistence live here. UI and gameplay systems should not operate the Supabase client directly.

### `ui/`

Rendering and input orchestration. `gateway.ts` owns account/character entry flows. `shell.ts` owns the main shell, layout editor, compact-landscape HUD arrangement and fullscreen integration. Focused modules render scenes, panels, character state, minimap/log content and interactions.

### `styles/`

`styles/index.css` is the single stylesheet entry point. Styles are split by responsibility and include dedicated responsive/mobile-landscape layers. Import order matters.

## Application flow

The runtime should be treated as four layers:

1. **Universal application** — authentication connection, login/account UI, shared application structure, styles and infrastructure required before entering the game.
2. **Authenticated character session** — persistent character-owned facts such as identity, inventory, equipment, skills, health, currency and current location.
3. **Current location context** — the active scene surface, scene interaction nodes, local multiplayer context and other location-owned information.
4. **Interaction context** — vendor, NPC, bank, gathering, crafting or other detailed interfaces loaded when the player actually opens or uses them.

Authentication should not wait for game-world artwork that is not needed by the gateway. After authentication, load the authoritative character state, determine the current location, then load that location's scene context.

Character-owned state persists across scene changes. Moving between locations must not cause unchanged inventory, equipment, skills or other character-owned facts to be rediscovered merely because the scene changed.

## Runtime state and presentation rules

### Persistent state stores facts, not presentation

Persistent character and world state should store stable identifiers and authoritative values rather than presentation payloads.

For item ownership this means facts such as:

```text
item_id
quantity
slot or equipment position where applicable
```

Names, descriptions, images, flavour text and other presentation data are resolved separately. A stable item identifier must remain usable even if its display name, description or artwork later changes.

This separation applies beyond inventory: storage, equipment, quests and future systems should keep authoritative facts independent from the interfaces and assets used to present them.

### Synchronise changes, not screens

Once authoritative character state has been established, the client should preserve unchanged state across navigation and interactions.

Server responses should ultimately allow the client to determine what changed and update the affected state/UI rather than treating every action as a reason to rediscover or redraw the entire character and screen.

Structural changes such as entering another location may replace a scene context. A quantity, XP or health change should update the relevant character state without unnecessarily rebuilding unrelated regions.

### Knowledge does not grant action authority

Knowing persistent state does not imply permission to act upon it.

For example, a future bank preview or read-only API may reveal that a character owns an item in storage. Withdrawing or moving that item still requires the appropriate authorised gameplay interaction.

This preserves the persistent-state security boundary while allowing useful read-only views and future third-party tools.

## Scene loading and hot-cache contract

Scene resources should be loaded according to player context rather than globally at application startup.

- The **current scene context** is hot.
- The **immediately previous scene context** is also hot so ordinary backtracking does not require unchanged scene data or scene resources to be fetched/decoded unnecessarily.
- Moving to a third distinct scene makes the older non-current context eligible for eviction.
- Scene surfaces for directly connected destinations may be preloaded opportunistically when doing so does not block current gameplay.
- A connected scene may have its surface asset prepared without loading its complete interaction state.
- Detailed interaction contexts should load when the player actually opens or uses them.

The contract is outcome-based: implementations do not have to preserve an entire previous DOM tree if retaining prepared data/assets provides the same fast-backtracking result.

Browser/HTTP asset caching remains separate from the application's hot scene-context cache. Evicting a scene context does not require forcing the browser to discard an underlying cached asset.

## Persistent-state boundary

The browser may request an action. It must not dictate a persistent result.

Authoritative persistent changes belong behind Supabase Row Level Security and server-side RPC/database rules. Client-side checks are useful for UX but are not a security boundary.

## Authentication and multiplayer

Supabase Auth owns account sessions. Email confirmation is sent through the configured custom SMTP provider.

Room chat is cloud-backed and uses Supabase realtime/database operations. `ROOM` is multiplayer chat for the current room; `GAME` and `SYSTEM` remain local presentation channels. Current Nearby data is persisted room membership, not full online-presence truth.

## UI architecture

The world is presented as location -> scene -> interaction nodes -> actions rather than free WASD movement.

Desktop/portrait use the shared shell. Compact mobile landscape reparents status, tabs/panel and chat into movable HUD containers over a full-screen scene. Layout configuration persists; editing state does not.

See [UI-CONTRACT.md](./UI-CONTRACT.md) for the current shell/HUD contract.

## Assets

Public assets live under `public/`. Runtime references are centralized through `SRC/core/assets.ts` and derived from `import.meta.env.BASE_URL`.

The production site currently uses the root deployment base `/`, but feature code should not hard-code the production domain or historical GitHub Pages prefix.

See [ASSET-GUIDE.md](./ASSET-GUIDE.md).

## Experimental NPC social simulation

The sandbox contains a standalone relationship, memory, behaviour and social
interaction engine plus a locally tested, opt-in persistence migration. These
modules are not yet connected to live gameplay. See
[SOCIAL-SIMULATION.md](./SOCIAL-SIMULATION.md) for responsibilities, data
authority and rollout constraints.


## Adding a gameplay system

1. Put static definitions in `data/` and genuinely shared vocabulary in `core/`.
2. Implement rules/state mutation in a focused `systems/<feature>.ts` module.
3. Keep systems independent of the DOM.
4. Route persistent changes through the authoritative service/server boundary.
5. Keep authoritative facts separate from presentation data and assets.
6. Render the feature through existing UI scene/panel/dialog boundaries.
7. Scope styles to the feature and verify desktop, portrait and compact-landscape behavior.
8. Run TypeScript checking and the production build.
9. Explicitly verify runtime asset references where assets changed.

## Repository documentation

- root `README.md` — project/repository entry point;
- root `BACKLOG.md` — official working backlog;
- `docs/UI-CONTRACT.md` — current interface structure and layout rules;
- `docs/ASSET-GUIDE.md` — asset hierarchy and reference policy;
- this file — module/dependency architecture.
