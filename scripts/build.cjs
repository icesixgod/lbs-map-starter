'use strict';

// Build one self-contained HTML file using Node.js built-ins only.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');
const read = name => fs.readFileSync(path.join(src, name), 'utf8');
const script = source => '<script>' + source.replace(/<\/script/gi, '<\\/script') + '</script>';

function build({ staticDemo = false } = {}) {
  if (Number(process.versions.node.split('.')[0]) < 20) {
    throw new Error('LBS Map Starter requires Node.js 20 or newer.');
  }

  const modules = [
    'vendor/three-0.160.1.min.js', 'vendor/polygon-clipping-0.15.7.min.js',
    'coop-geography.js', 'coop-building-merge.js', 'coop-street-building-groups.js',
    'coop-city-blocks.js', 'coop-local-places.js', 'lbs-map-buildings.js',
    'lbs-map-work.js', 'lbs-map-stream.js', 'map-model.js', 'map-gestures.js',
  ];
  const workerModules = [
    'vendor/polygon-clipping-0.15.7.min.js', 'coop-geography.js',
    'coop-building-merge.js', 'coop-street-building-groups.js',
    'coop-city-blocks.js', 'coop-local-places.js', 'lbs-map-buildings.js',
    'lbs-map-stream.js', 'coop-district-scene.js',
  ];
  const workModule = read('lbs-map-work.js');
  const begin = '// LBS_MAP_WORKER_HANDLER_BEGIN\n';
  const end = '// LBS_MAP_WORKER_HANDLER_END';
  if (!workModule.includes(begin) || !workModule.includes(end)) {
    throw new Error('Map worker source markers are missing.');
  }
  const workerHandler = workModule.split(begin)[1].split(end)[0];
  const workerSource = [...workerModules.map(read), workerHandler, 'workerMain(globalThis);'].join('\n');
  const map = JSON.parse(read('assets/default-map.json'));
  if (map.center?.crs !== 'WGS84' || !Array.isArray(map.features) || !Array.isArray(map.places)) {
    throw new Error('src/assets/default-map.json must contain a WGS84 district map.');
  }
  const atlas = fs.readFileSync(path.join(src, 'assets/city-material-atlas-v1.png')).toString('base64');
  const sources = [
    'const LBS_MAP_WORKER_SOURCE=' + JSON.stringify(workerSource) + ';',
    ...modules.map(read),
    'const LBS_DISTRICT_DATA=' + JSON.stringify(map) + ';',
    "const LBS_CITY_ASSETS={atlas:'data:image/png;base64," + atlas + "'};",
    ...['lbs-city-art.js', 'coop-district-scene.js', 'map-client.js'].map(read),
  ];
  const bootstrap = script('globalThis.LBS_MAP_STATIC_DEMO=' + JSON.stringify(staticDemo) + ';\n' + read('lbs-map-bootstrap.js') + '\nLBSMapBoot.start(' + JSON.stringify(map.center) + ');');
  const legalFiles = [
    'LICENSE', 'THIRD_PARTY_NOTICES.md',
    'src/vendor/THREE-LICENSE.txt',
    'src/vendor/POLYGON-CLIPPING-LICENSE.txt',
    'src/vendor/VECTOR-TILE-LICENSE.txt',
  ];
  const licenses = legalFiles.map(name => name + '\n\n' + fs.readFileSync(path.join(root, name), 'utf8')).join('\n\n');
  const legal = '<script type="text/plain" id="third-party-licenses">' + licenses.replace(/<\/script/gi, '<\\/script') + '</script>';
  const html = read('map.template.html')
    .replace('<!-- LBS_BOOTSTRAP -->', () => bootstrap)
    .replace('<!-- LBS_STYLES -->', () => '<style>' + read('map.css') + '</style>')
    .replace('<!-- LBS_ENGINE -->', () => sources.map(script).join('\n') + '\n' + legal);
  if (html.includes('<!-- LBS_')) throw new Error('Unresolved HTML build marker.');
  fs.mkdirSync(dist, { recursive: true });
  const output = path.join(dist, 'index.html');
  fs.writeFileSync(output, html);
  console.log('Built dist/index.html (' + (Buffer.byteLength(html) / 1024 / 1024).toFixed(1) + ' MiB, includes map, materials and licenses).');
  return output;
}

if (require.main === module) {
  try { build({ staticDemo: process.argv.includes('--demo') }); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { build };
