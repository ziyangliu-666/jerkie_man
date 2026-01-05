# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Jerkie Man is a 2D multiplayer extraction shooter game (Tarkov-style) built as an MVP web application. It uses a client/server architecture with authoritative server-side simulation and client-side interpolation for smooth gameplay.

## Development Commands

### Setup
```powershell
npm install
```

### Development (Parallel Client + Server)
```powershell
npm run dev:all          # Starts both server and client concurrently
npm run dev:server       # Server only (tsx watch on port 18723)
npm run dev:client       # Client only (Vite dev server on port 5173)
```

### Building
```powershell
npm run build            # Builds all workspaces (shared → server → client)
npm run test:smoke       # Smoke test for basic game mechanics
```

### Workspace-Specific Commands
```powershell
# Build individual workspaces
npm run build --workspace=shared
npm run build --workspace=server
npm run build --workspace=client

# Watch mode for shared (useful during development)
npm run dev --workspace=shared
```

## Architecture Overview

### Monorepo Structure

This is an **npm workspaces** monorepo with three packages:

- **shared/**: Zod protocol schemas, game math utilities, equipment definitions, item catalog, shared simulation logic
- **server/**: Authoritative game server (WebSocket on port 18723, 20Hz tick loop, 10Hz snapshot broadcast)
- **client/**: Browser client (Vite, Canvas 2D rendering, 60Hz render loop with interpolation)

### Core Architectural Patterns

**1. Single Source of Truth (SSOT)**
- Server generates world seed (`mapConfig`, `seed`) and sends to clients via `S2C_WELCOME`
- Clients use server configuration as the single source of truth
- Fallback to local config only in compatibility mode (logs warning in HUD)

**2. Network Synchronization**
- **Server Tick**: 20Hz (50ms intervals) - processes inputs, updates game state
- **Snapshot Broadcast**: 10Hz (100ms intervals) - sends world state to all clients
- **Client Input**: 25Hz (40ms throttle) - sends inputs with sequence numbers
- **Client Interpolation**: 120ms delay buffer for smooth rendering between snapshots

**3. Input Queue Architecture**
- Server queues all inputs instead of processing immediately
- Tick loop processes up to 4 inputs per tick (prevents flooding/cheating)
- Sequence numbers ensure ordering
- Max 32 queued inputs per player (overflow protection)

**4. Lag Compensation**
- Server tracks player Round-Trip Time (RTT) via ping/pong
- Position history ring buffer (last N positions with timestamps)
- Bullet collision detection rewinds player positions by RTT/2
- Exponential moving average for RTT smoothing (90% old + 10% new)

**5. Client-Side Prediction**
- Bullets predicted locally via `BulletTrackManager` for immediate feedback
- Server sends `clientShotId` to reconcile predicted bullets with authoritative bullets
- Player positions interpolated, not predicted (trades latency for smoothness)

**6. Deterministic World Generation**
- All RNG uses seed-based `createRng()` from `shared/src/rng.ts`
- Obstacles, item spawns, and loot tables are reproducible from seed
- Server and client can generate identical worlds for validation

## Protocol (Zod-Validated Messages)

All network messages are defined in `shared/src/protocol.ts` using Zod schemas for runtime validation and TypeScript type inference.

### Client to Server (C2S)
- `C2S_HELLO`: Initial connection with accountId (persistent player profile UUID)
- `C2S_INPUT`: 25Hz input stream (WASD keys, mouse aim, shoot, reload, interact, seq number)
- `C2S_PING`: Latency measurement for lag compensation
- `C2S_ENTER_RAID`: Start a raid session
- `C2S_EQUIP`: Equipment management (weapons, armor, bags)
- `C2S_BUY` / `C2S_SELL`: Item economy transactions
- `C2S_ADMIN`: Development commands (reset_world, show_status)

### Server to Client (S2C)
- `S2C_WELCOME`: Session initialization with playerId, seed, mapConfig
- `S2C_WORLD_INIT`: Static world data (obstacles, initial item spawns)
- `S2C_SNAPSHOT`: 10Hz world state updates (players, bullets, worldItems, lootBags)
- `S2C_PROFILE`: Player profile data (stash, money, equipment, prep area)
- `S2C_COMBAT_EVENT`: Combat feedback (hit markers, dry fire, damage taken)
- `S2C_RAID_RESULT`: End-of-raid summary (extracted or died)
- `S2C_EVENT`: Server events for debug log
- `S2C_MELEE_SWING` / `S2C_EXPLOSION`: Visual effect broadcasts

## Key Systems

### Weapon System (Two-Layer Architecture)

Equipment definitions are split across two files:

1. **ITEM_CATALOG** (`shared/src/item_catalog.ts`): Economy layer
   - Price, rarity (common/uncommon/rare/epic), stackMax
   - Item categories: weapons, bags, armor, consumables, materials, quest items

2. **WEAPONS** (`shared/src/equipment.ts`): Combat mechanics
   - Damage, fire rate, magazine size, reload time
   - Bullet speed, spread angle, pellet count (shotguns)
   - Melee arc angle/range (for fists)
   - Burst fire configuration (burstSize, burstCooldown)

Weapons: Fists (melee), Pistol, SMG, Burst Rifle, DMR, Shotgun, Sniper, Grenade Launcher

### Inventory & Economy System

**Player Profile** (persisted in `server/data/profiles.json`):
- **Stash (仓库)**: Long-term item storage
- **Prep Area (整备区)**: Items to bring into next raid
- **Equipment Slots**: Primary weapon, armor, bag
- **Money**: In-game currency

**Item Flow**:
1. Buy from shop → Store in stash
2. Move from stash → Prep area
3. Enter raid → Prep items loaded into in-raid inventory
4. Loot items during raid
5. Extract → All items transferred to stash, money awarded
6. Death → All in-raid items lost

### Combat System

- **Hit Detection**: Continuous ray-casting (line segment vs circle) prevents bullet tunneling
- **Damage Calculation**: `finalDamage = weaponDamage * (1 - armorReduction)`
- **Armor**: Reduces damage by 0-50% based on armor type
- **Melee Combat**: Fists weapon with 140° arc detection, 50px range
- **Combat Events**: Hit confirmation, damage direction indicators, dry fire notifications

### Extraction System

- **Extraction Zone**: 200x200 area in bottom-right corner of map (configurable in mapConfig)
- **Extraction Mechanic**: Hold F key for 2 seconds (2000ms progress)
- **On Success**: Transfer inventory to stash, award money, return to hideout
- **On Death**: Lose all in-raid items, return to hideout with loss report

### Phase State Machine

Players transition through phases:
1. **NAME**: First-time user sets display name
2. **HIDEOUT**: Inventory management, shopping, equipment, raid preparation
3. **RAID**: Active gameplay (combat, looting, extraction)
4. **RESULT**: Post-raid summary screen

## Code Organization

### Server (`server/src/`)

- **main.ts**: WebSocket server setup, tick loop orchestration, message routing
- **room.ts**: Core game logic (2000+ lines) - player movement, shooting, collision, item pickup, extraction
- **player.ts**: Player entity class with health, position, inventory, equipment
- **profile.ts**: Profile persistence manager (load/save JSON, atomic operations)
- **logger.ts**: Structured logging utility (`[timestamp][tick=N][room=ID][player=PID] EVENT key=val`)

### Client (`client/src/`)

- **main.ts**: Client orchestration (3000+ lines) - game loop, UI management, state machine
- **renderer.ts**: Canvas 2D rendering (world space, camera transform, viewport culling)
- **network.ts**: WebSocket connection, auto-reconnection, message queue
- **snapshot.ts**: Ring buffer for snapshots, interpolation logic
- **hud.ts**: Debug HUD panel (right sidebar with connection status, player list, event log)
- **uiOverlay.ts**: In-game UI overlay (crosshair, damage flash, screen-space elements)
- **input.ts**: Keyboard/mouse input handling, 25Hz input throttling

### Shared (`shared/src/`)

- **protocol.ts**: Zod schemas for all C2S/S2C messages
- **equipment.ts**: Weapon, armor, bag definitions with combat stats
- **item_catalog.ts**: Item economy data (price, rarity, stack limits)
- **math.ts**: Vec2 class, collision detection (`circleVsAABB`, `segmentIntersectsCircle`)
- **content.ts**: Map configuration (size, extraction zone, obstacle generation)
- **sim.ts**: Shared simulation logic (`simulatePlayerMove` used by client and server)
- **rng.ts**: Seed-based RNG for deterministic world generation

## Important Implementation Details

### Adding New Weapons

1. Define economy data in `ITEM_CATALOG` (shared/src/item_catalog.ts)
2. Define combat stats in `WEAPONS` (shared/src/equipment.ts)
3. Client rendering uses weapon type for visual representation
4. No client-side code changes needed for basic weapons (system is data-driven)

### Modifying Network Protocol

1. Update Zod schema in `shared/src/protocol.ts`
2. TypeScript types are automatically inferred from Zod schemas
3. Rebuild shared package: `npm run build --workspace=shared`
4. Server and client will get compile errors if protocol changes break existing code

### Adding New Items

1. Add to `ITEM_CATALOG` with category, price, rarity
2. If item has special behavior (e.g., consumable effect), add handling in `room.ts` (server) and `main.ts` (client)
3. No changes needed for basic lootable items (system handles pickup/storage automatically)

### Debugging

**Server Logs**:
- Structured format: `[timestamp][tick=N][room=local][player=p1] EVENT key=val`
- Every 10 ticks prints summary log
- Enable verbose logging for specific events in `logger.ts`

**Client Debug Tools**:
- HUD panel (right sidebar): Connection status, player list, entity inspector, event log
- Click entities to inspect full state in "Selected Entity" panel
- `admin` global object (dev mode): `showRoom()`, `resetRoom()`, `showPlayers()`

**Smoke Test**:
```powershell
npm run test:smoke  # Runs automated test in server/src/smoke.ts
```

### Performance Considerations

- **Viewport Culling**: Client only renders entities within camera view
- **Input Queue Limiting**: Server processes max 4 inputs per tick to prevent abuse
- **Snapshot Throttling**: 10Hz snapshots reduce bandwidth (clients interpolate between them)
- **Position History**: Ring buffer with fixed size prevents memory leaks

## Common Gotchas

1. **Shared Package Changes**: Always rebuild shared (`npm run build --workspace=shared`) before testing server/client changes
2. **WebSocket Port**: Server uses port 18723 (not 8080 as mentioned in old README section)
3. **Interpolation Delay**: 120ms buffer means visual position lags behind authoritative position (intended for smoothness)
4. **Profile Persistence**: Player profiles stored in `server/data/profiles.json` - delete to reset all accounts
5. **Seed Determinism**: Changing RNG implementation breaks world generation reproducibility
6. **Input Sequence Numbers**: Must increment monotonically per player, server validates ordering
