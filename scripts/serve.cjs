'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { createMapService } = require('./district-map-service.cjs');
const { createMapUpstream } = require('./map-upstream.cjs');

const outputDir = path.resolve(__dirname, '../dist');

function sendJSON(req, res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Vary': 'Accept-Encoding',
  };
  const gzip = String(req.headers['accept-encoding'] || '').split(',').some(part =>
    /^\s*gzip\b/i.test(part) && !/(?:^|;)\s*q\s*=\s*0(?:\.0*)?\s*$/i.test(part));
  if (body.length > 2048 && gzip) {
    zlib.gzip(body, { level: 3 }, (error, compressed) => {
      if (res.destroyed) return;
      if (!error) headers['Content-Encoding'] = 'gzip';
      res.writeHead(status, headers);
      res.end(error ? body : compressed);
    });
  } else {
    res.writeHead(status, headers);
    res.end(body);
  }
}

function createMapServer(options = {}) {
  const mapOptions = { ...options.mapOptions };
  mapOptions.upstream ??= createMapUpstream(mapOptions);
  const map = createMapService(mapOptions);
  const baseMap = createMapService({
    ...mapOptions,
    baseOnly: true,
    ...(mapOptions.cacheDir && { cacheDir: path.join(mapOptions.cacheDir, 'base') }),
  });

  const server = http.createServer(async (req, res) => {
    const json = (status, value) => sendJSON(req, res, status, value);
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch { json(400, { error: '无效请求地址' }); return; }
    if (req.method !== 'GET') { json(405, { error: '仅支持读取' }); return; }

    if (url.pathname === '/api/map') {
      const ownOrigin = 'http://' + req.headers.host;
      if (req.headers.origin && req.headers.origin !== ownOrigin) {
        json(403, { error: '地图请求来源不匹配' });
        return;
      }
      const input = {
        lat: url.searchParams.get('lat'),
        lon: url.searchParams.get('lon'),
        radius: url.searchParams.get('radius'),
        preload: url.searchParams.get('preload') === '1',
      };

      if (url.searchParams.get('stream') === '1' && url.searchParams.get('layer') !== 'base') {
        const controller = new AbortController();
        const abort = () => { if (!res.writableEnded) controller.abort(); };
        res.on('close', abort);
        const send = data => {
          controller.signal.throwIfAborted();
          if (!res.headersSent) {
            res.writeHead(200, {
              'Content-Type': 'application/x-ndjson; charset=utf-8',
              'Cache-Control': 'no-store',
              'X-Accel-Buffering': 'no',
            });
            res.flushHeaders();
          }
          res.write(JSON.stringify(data) + '\n');
        };
        try {
          const result = await map.stream(input, { signal: controller.signal, onData: send });
          send(result);
          res.end();
        } catch (error) {
          if (!res.destroyed) {
            if (res.headersSent) res.end(JSON.stringify({ error: error.message || '建筑稍后补齐' }) + '\n');
            else json(error.status || 503, { error: error.message || '建筑稍后补齐' });
          }
        } finally {
          res.removeListener('close', abort);
        }
        return;
      }

      try {
        let result;
        if (url.searchParams.get('layer') === 'base') {
          const cached = map.peek(input, true);
          result = cached ? {
            ...cached,
            features: cached.features.filter(feature => feature.kind !== 'building'),
            places: [],
            gameNodes: [],
            generation: {
              ...cached.generation,
              baseOnly: true,
              counts: { ...cached.generation.counts, buildings: 0, places: 0 },
            },
          } : await baseMap.load(input);
        } else result = await map.load(input);
        json(200, result);
      } catch (error) {
        json(error.status || 503, { error: error.message });
      }
      return;
    }

    if (url.pathname !== '/' && url.pathname !== '/index.html') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    fs.readFile(path.join(outputDir, 'index.html'), (error, bytes) => {
      if (error) {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('请先在项目目录运行 npm run build，再启动地图。');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(bytes);
    });
  });

  return {
    server,
    warmCatalog: () => mapOptions.upstream.warmCatalog?.() ?? Promise.resolve(),
    close: () => new Promise(resolve => {
      map.close();
      baseMap.close();
      mapOptions.upstream.close?.();
      server.closeAllConnections();
      server.close(resolve);
    }),
  };
}

function parseOptions(args) {
  const options = { port: Number(process.env.LBS_PORT || 8789), cache: true, help: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port') options.port = Number(args[++i]);
    else if (args[i] === '--no-cache') options.cache = false;
    else if (args[i] === '--help' || args[i] === '-h') options.help = true;
    else throw new Error('未知参数：' + args[i] + '。使用 --help 查看启动参数。');
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error('端口必须是 1～65535 之间的整数。');
  }
  return options;
}

function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: npm start -- [--port 8789] [--no-cache]\nDefault: http://localhost:8789 (127.0.0.1 only). Stop with Ctrl+C.');
    return;
  }
  const app = createMapServer({ mapOptions: { cacheDir: options.cache ? undefined : false } });
  app.warmCatalog().catch(error => console.warn('地图目录读取稍后重试：' + error.message));
  app.server.listen(options.port, '127.0.0.1', () => {
    const url = 'http://localhost:' + options.port;
    console.log('LBS Map Starter: ' + url + '\n按 Ctrl+C 停止服务。');
    if (process.env.LBS_OPEN_BROWSER === '1' && process.platform === 'darwin') {
      require('node:child_process').spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    }
  });
  app.server.on('error', error => {
    console.error(error.code === 'EADDRINUSE'
      ? '端口 ' + options.port + ' 已被占用。请使用 npm start -- --port ' + (options.port === 8790 ? 8791 : 8790)
      : error.message);
    app.close().finally(() => { process.exitCode = 1; });
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close().then(() => process.exit(0)));
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { createMapServer };
