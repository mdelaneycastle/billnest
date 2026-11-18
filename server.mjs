import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const port = Number(process.env.PORT ?? 4173);
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json'
};

createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname.replace(/^\/(?:billnest\/)?/, '');
    const path = pathname || 'index.html';
    if (!/^(?:icons\/)?[a-z0-9.-]+$/.test(path) || !Object.hasOwn(contentTypes, extname(path))) {
      response.writeHead(404).end('Not found');
      return;
    }
    const bytes = await readFile(new URL('./dist/' + path, import.meta.url));
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(path)], 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY'
    }).end(request.method === 'HEAD' ? undefined : bytes);
  } catch {
    response.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => process.stdout.write('Open http://localhost:' + port + '/billnest/\n'));
