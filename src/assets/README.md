# Bundled assets

| File | Purpose | Source / license |
| --- | --- | --- |
| `default-map.json` | Anonymous starting neighborhood geometry | OpenStreetMap contributors, served through OpenFreeMap / OpenMapTiles; ODbL |
| `district-water-surfaces.json` | Supplementary OSM river geometry used when a source window lacks a complete water surface | OpenStreetMap relation 8227206; ODbL |
| `city-material-atlas-v1.png` | Example material atlas for stylized walls, roofs and ground | Project sample asset distributed under the root MIT license; not OSM map data or real-world facade photography |

Map files retain their `source` metadata, including source links, attribution and retrieval information where available. They are distributed as sample data, not as runtime download caches.

Original feature names, translated names, aliases, descriptive POI fields and addresses are removed. Road material and width attributes are also removed; dimensions are retained only for tagged buildings or building parts. Geometry, IDs, building heights, semantic types and source attribution are retained.

These are modified OSM-derived databases, distributed under ODbL: labels and unnecessary properties are removed, map geometry is normalized, and supplementary water is assembled. This processing does not establish approval for publication in any jurisdiction.

The regression map is kept separately in `tests/fixtures/binjiang-map.json`. The runtime build only embeds `default-map.json` and the material atlas; it does not embed the regression map.

To refresh or replace the starting map, run `node scripts/fetch-map.cjs LAT LON src/assets/default-map.json`, then rebuild. Keep the resulting source metadata and visible attribution.
