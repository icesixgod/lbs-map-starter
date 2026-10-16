'use strict';

// Check the standalone map entry and its embedded map worker.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const files = fs.readdirSync(output).filter(name => /\.(?:html|js)$/.test(name)).sort();
const required = ['index.html'];
for (const name of required) {
  if (!files.includes(name)) throw new Error('Missing generated entry: dist/' + name);
}
let programs = 0;
let workers = 0;
const errors = [];
function check(code, filename) {
  try { new vm.Script(code, { filename }); programs++; }
  catch (error) { errors.push(filename + ': ' + error.message); }
}
for (const name of files) {
  const source = fs.readFileSync(path.join(output, name), 'utf8');
  if (name.endsWith('.js')) {
    check(source, 'dist/' + name);
    continue;
  }
  let index = 0;
  for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    index++;
    const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(match[1])?.[1];
    if (type && !/^(?:text|application)\/(?:java|ecma)script$/i.test(type)) {
      if (type === 'module') errors.push(name + ': module script requires a module-aware syntax check');
      continue;
    }
    check(match[2], 'dist/' + name + '#script-' + index);
  }
  // The build scripts serialize workers with JSON.stringify/json.dumps. Decode
  // the literal only; do not execute browser/game code during syntax checking.
  const workerPattern = /\bconst\s+(LBS_MAP_WORKER_SOURCE|simulationWorkerSource)\s*=\s*("(?:[^"\\]|\\.)*")\s*;/g;
  for (const match of source.matchAll(workerPattern)) {
    try {
      check(JSON.parse(match[2]), 'dist/' + name + '#' + match[1]);
      workers++;
    } catch (error) { errors.push(name + '#' + match[1] + ': ' + error.message); }
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Checked ' + files.length + ' generated files, ' + programs + ' programs, including ' + workers + ' embedded workers.');
}
