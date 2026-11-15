// code.justapps.it
//  - www.code.justapps.it → code.justapps.it
//  - /latest.tgz → latest GitHub release package (used by `npm install -g https://code.justapps.it/latest.tgz`)
//  - /download/<mac-arm64|mac-x64|windows|linux> → desktop app of the latest release
//  - everything else: the static site in ./public, embedded at build time (tools/gen-files.mjs)
import { FILES } from './files.gen.js';

const LATEST = 'https://github.com/justapps-it/JustCode/releases/latest';
const RELEASE = `${LATEST}/download/just-code.tgz`;
// CI also uploads these version-less names to every release
const DESKTOP = {
  'mac-arm64': 'just-Code-mac-arm64.dmg',
  'mac-x64': 'just-Code-mac-x64.dmg',
  windows: 'just-Code-windows-x64.exe',
  linux: 'just-Code-linux-x86_64.AppImage',
};

const decoded = new Map();
function body(f) {
  if (f.text !== undefined) return f.text;
  if (!decoded.has(f)) decoded.set(f, Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0)));
  return decoded.get(f);
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.hostname.startsWith('www.')) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }
    const p = url.pathname;
    if (p === '/latest.tgz' || p === '/just-code.tgz') return Response.redirect(RELEASE, 302);
    if (p === '/download' || p === '/download/') return Response.redirect(LATEST, 302);
    if (p.startsWith('/download/')) {
      const file = DESKTOP[p.slice('/download/'.length)];
      return Response.redirect(file ? `${LATEST}/download/${file}` : LATEST, 302);
    }
    // /privacy.html → /privacy (canonical, like before)
    if (p.endsWith('.html')) {
      url.pathname = p === '/index.html' ? '/' : p.slice(0, -5);
      return Response.redirect(url.toString(), 301);
    }
    const key = p === '/' ? '/index.html' : FILES[p] ? p : FILES[p.replace(/\/$/, '') + '.html'] ? p.replace(/\/$/, '') + '.html' : null;
    const f = key && FILES[key];
    if (!f) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    const html = f.type.startsWith('text/html');
    const headers = {
      'content-type': f.type,
      'cache-control': html || /\.(sh|ps1)$/.test(key) ? 'no-cache' : 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    };
    if (request.method === 'HEAD') return new Response(null, { headers });
    return new Response(body(f), { headers });
  },
};
