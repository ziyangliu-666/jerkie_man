# Map Editor Guide

## Overview

The game uses a text-based map format (MAPTEXT v1) that is designed to be easy for both humans and LLMs to read, write, and modify.

## Quick Start

### Using a Pre-made Map

```bash
# Start server with urban ruins map
MAP_TEMPLATE=urban_ruins npm run server

# Start server with forest outpost map
MAP_TEMPLATE=forest_outpost npm run server

# Start server with random generation (default)
npm run server
```

### Creating a New Map

1. Create a file in `shared/maps/` with `.map.txt` extension
2. Follow the format in `shared/maps/README.md`
3. Load it with `MAP_TEMPLATE=your_map_id npm run server`

## Map Format Features

### LLM-Friendly Design

The format is designed to be easy for LLMs to generate:

- **Simple syntax**: Key-value pairs with clear semantics
- **Self-documenting**: Comments explain each section
- **Flexible**: Supports both positional and named parameters
- **Extensible**: Easy to add new directive types

### Supported Elements

1. **Obstacles**: Solid walls and buildings
2. **Spawn Points**: Player starting locations
3. **POIs**: Named locations (buildings, landmarks)
4. **Zones**: Functional areas (loot, PvP, safe zones)
5. **Extract Zone**: Safe extraction area

## Example: Creating a Simple Map

```
# MAPTEXT v1
@meta id=simple_map name="Simple Map" desc="A basic test map"

@map width=1500 height=1500 seed=12345

@extract x=1300 y=1300 w=150 h=150

# Central building
@obstacle x=650 y=650 w=200 h=200

# Corner spawns
@spawn x=200 y=200
@spawn x=1300 y=200
@spawn x=200 y=1300

# Mark the central building
@poi x=750 y=750 id=center type=building name="Central Building"

# Define a PvP zone around the center
@zone x=600 y=600 w=300 h=300 id=center_zone type=pvp name="Center Zone"
```

## Advanced Features

### POI System

POIs (Points of Interest) mark important locations:

```
@poi x=450 y=275 id=warehouse type=building name="Warehouse" desc="High loot building"
```

**Use cases:**
- Mark loot buildings
- Identify landmarks for navigation
- Define quest objectives (future)
- Create narrative elements

### Zone System

Zones define functional areas:

```
@zone x=150 y=150 w=650 h=400 id=north type=loot name="North District"
```

**Zone types:**
- `loot`: Areas with resources
- `pvp`: High-traffic combat zones
- `safe`: Low-risk areas
- `danger`: High-risk areas

**Use cases:**
- Control loot distribution
- Create risk/reward balance
- Guide player movement
- Define tactical areas

## Map Design Guidelines

### For Tactical Gameplay

1. **Multiple Paths**: Create at least 2-3 routes between key areas
2. **Cover Variety**: Mix large buildings with small cover
3. **Sightlines**: Balance open areas with blocked views
4. **Chokepoints**: Create strategic bottlenecks
5. **Spawn Balance**: Distribute spawns evenly

### For LLM Generation

When prompting an LLM to generate a map:

```
Create a 2000x2000 tactical map with:
- 3-4 major buildings (200-300px each)
- 10-15 small cover objects (40-80px)
- 5-6 spawn points around the perimeter
- Extract zone in one corner
- Central PvP zone
- 2-3 loot zones
- Clear corridors for movement
```

## Runtime Commands

### Admin Commands (Server Console)

```javascript
// List available maps
admin.listMapTemplates()

// Switch to a different map (resets room)
admin.setMapTemplate('urban_ruins')

// Switch to random generation
admin.setMapTemplate(null)

// Reload map files from disk
admin.reloadMapTemplates()

// Show current map info
admin.showRoom()
```

## Map Validation

The parser validates:
- ✅ Required fields present
- ✅ Valid number formats
- ✅ Non-negative coordinates
- ✅ Positive dimensions
- ✅ Unique IDs within categories

## Future Enhancements

Planned features:
- [ ] Visual map editor (web-based)
- [ ] Loot spawn points
- [ ] Dynamic events
- [ ] Biome system
- [ ] Multi-level structures
- [ ] Interactive objects

## Troubleshooting

### Map Not Loading

1. Check file is in `shared/maps/` directory
2. Verify file has `.map.txt` extension
3. Check `@meta id` matches `MAP_TEMPLATE` value
4. Look for parser errors in server console

### Syntax Errors

Common issues:
- Missing required parameters
- Invalid number formats
- Unquoted strings with spaces
- Typos in directive names

### Testing Maps

1. Start server with your map
2. Connect with client
3. Use `admin.showRoom()` to verify map loaded
4. Check spawn points are accessible
5. Verify extract zone is reachable

## Examples

See `shared/maps/` for complete examples:
- `urban_ruins.map.txt`: Tactical urban combat map
- `forest_outpost.map.txt`: Military outpost in forest
- `example.map.txt`: Minimal example

## Contributing Maps

To contribute a map:
1. Create map file following the format
2. Test thoroughly
3. Add description and design notes
4. Submit with clear documentation
