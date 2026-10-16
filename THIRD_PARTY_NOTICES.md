# Third-party notices

The root MIT license covers original project code. It does not replace the licenses of the map databases or third-party components below. Original notices are retained in `src/vendor/`; the builder also embeds those notices in `dist/index.html`.

## JavaScript libraries

| Component | Version | License / notice |
| --- | --- | --- |
| [Three.js](https://github.com/mrdoob/three.js) | 0.160.1 | MIT; [original notice](src/vendor/THREE-LICENSE.txt) |
| [polygon-clipping](https://github.com/mfogel/polygon-clipping) | 0.15.7 | MIT; [original and bundled dependency notices](src/vendor/POLYGON-CLIPPING-LICENSE.txt) |
| splaytree, bundled with polygon-clipping | 3.1.2 | MIT; included in the polygon-clipping notice |
| robust-predicates, bundled with polygon-clipping | 3.0.2 | Unlicense; included in the polygon-clipping notice |
| Microsoft TypeScript helpers, bundled with polygon-clipping | as vendored | Apache-2.0; included in the polygon-clipping notice |
| [@mapbox/vector-tile](https://github.com/mapbox/vector-tile-js) | 3.0.0 | BSD-3-Clause; [original notice](src/vendor/VECTOR-TILE-LICENSE.txt) |
| @mapbox/point-geometry, bundled with the tile decoder | 1.1.0 | ISC; included in the tile decoder notice |
| [pbf](https://github.com/mapbox/pbf) | 5.1.2 | BSD-3-Clause; included in the tile decoder notice |

## Map data and attribution

Map data is © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/). This includes the bundled starting map, the OSM water extract, and OSM-derived regression fixtures. Source URLs, retrieval information and attribution are retained where available in each data file.

The default online vector source is [OpenFreeMap](https://openfreemap.org/), using the [OpenMapTiles schema](https://openmaptiles.org/). Its attribution is © OpenStreetMap contributors · © OpenMapTiles · OpenFreeMap. OpenMapTiles describes its schema under CC-BY and its implementation under BSD; see its [schema documentation](https://openmaptiles.org/docs/schema/).

The application retains visible OSM, OpenMapTiles and OpenFreeMap attribution. If you change map providers or redistribute other datasets, retain the source's corresponding attribution and license information.

## Project material atlas

`src/assets/city-material-atlas-v1.png` is the project's bundled example material atlas, distributed with this starter under the root MIT license. It is used for stylized surfaces and does not depict surveyed building facades or satellite imagery. See [asset provenance](src/assets/README.md) for the distinction between this material and the OSM datasets.
