# Map Template Format Guide

## Overview

This directory contains map templates in a simple text format designed to be easy for both humans and LLMs to read and write.

## File Format

Map files use the `.map.txt` extension and follow the MAPTEXT v1 format.

## Directives

### @meta - Map Metadata
Defines the map's identity and description.

```
@meta id=map_id name="Display Name" desc="Map description"
```

**Parameters:**
- `id` (required): Unique identifier for the map
- `name` (optional): Human-readable display name
- `desc` (optional): Brief description of the map

### @map - Map Configuration
Defines the map dimensions and seed.

```
@map width=2000 height=2000 seed=12345
```

**Parameters:**
- `width` (required): Map width in pixels
- `height` (required): Map height in pixels
- `seed` (required): Random seed for reproducibility

### @extract - Extraction Zone
Defines the safe extraction area (rectangular).

```
@extract x=1800 y=1800 w=200 h=200
```

**Parameters:**
- `x` (required): X coordinate of top-left corner
- `y` (required): Y coordinate of top-left corner
- `w` (required): Width of the zone
- `h` (required): Height of the zone

### @obstacle - Obstacle/Building
Defines a solid obstacle (wall, building, etc.).

```
@obstacle x=300 y=300 w=200 h=150 type=wall
```

**Parameters:**
- `x` (required): X coordinate of top-left corner
- `y` (required): Y coordinate of top-left corner
- `w` (required): Width of the obstacle
- `h` (required): Height of the obstacle
- `type` (optional): Obstacle type (default: `wall`)

**Obstacle Types:**
- `wall`: Stone wall - indestructible, blocks everything
- `crate`: Wooden crate - destructible (HP: 100), blocks everything
- `bush`: Bush - passable, provides concealment
- `water`: Water - impassable, bullets pass through

### @spawn - Spawn Point
Defines a player spawn location.

```
@spawn x=200 y=200
```

**Parameters:**
- `x` (required): X coordinate
- `y` (required): Y coordinate

### @poi - Point of Interest
Defines a notable location (building, landmark, etc.).

```
@poi x=450 y=275 id=warehouse type=building name="Warehouse" desc="Large storage building"
```

**Parameters:**
- `x` (required): X coordinate
- `y` (required): Y coordinate
- `id` (required): Unique identifier
- `type` (required): POI type (building, landmark, resource, etc.)
- `name` (optional): Display name
- `desc` (optional): Description

### @zone - Functional Zone
Defines a rectangular area with specific properties.

```
@zone x=150 y=150 w=650 h=400 id=north_district type=loot name="North District" desc="High loot area"
```

**Parameters:**
- `x` (required): X coordinate of top-left corner
- `y` (required): Y coordinate of top-left corner
- `w` (required): Width of the zone
- `h` (required): Height of the zone
- `id` (required): Unique identifier
- `type` (required): Zone type (safe, danger, loot, pvp, etc.)
- `name` (optional): Display name
- `desc` (optional): Description

## Zone Types

- `safe`: Low-risk area
- `danger`: High-risk area
- `loot`: Area with resources
- `pvp`: High-traffic combat zone
- `generic`: Unspecified zone type

## POI Types

- `building`: Structure or building
- `landmark`: Notable location
- `resource`: Resource gathering point
- `generic`: Unspecified POI type

## Example Map

See `urban_ruins.map.txt` for a complete example of a tactical PvP map.

## Usage

### Loading a Map

Set the `MAP_TEMPLATE` environment variable when starting the server:

```bash
# Use a specific map
MAP_TEMPLATE=urban_ruins npm run server

# Use random generation (default)
npm run server
```

### Creating a New Map

1. Create a new `.map.txt` file in this directory
2. Start with the required directives: `@meta`, `@map`, `@extract`
3. Add obstacles, spawns, POIs, and zones as needed
4. Test by loading with `MAP_TEMPLATE=your_map_id`

## Tips for LLM Map Generation

When generating maps, consider:

1. **Balance**: Distribute spawns evenly around the perimeter
2. **Cover**: Mix large obstacles (buildings) with small cover
3. **Flow**: Create corridors and chokepoints for tactical gameplay
4. **Zones**: Define functional areas (loot, PvP, safe zones)
5. **Scale**: Keep dimensions reasonable (1500-3000 pixels)
6. **Density**: Don't overcrowd - leave open spaces for movement

## Coordinate System

- Origin (0, 0) is at the top-left corner
- X increases to the right
- Y increases downward
- All coordinates are in pixels

## Validation

The parser will validate:
- Required fields are present
- Numbers are valid and non-negative
- Dimensions are positive
- IDs are unique within their category
