// code.justapps.it
//  - www.code.justapps.it → code.justapps.it
//  - /latest.tgz → latest GitHub release package (used by `npm install -g https://code.justapps.it/latest.tgz`)
//  - /download/<mac-arm64|mac-x64|windows|linux> → desktop app of the latest release
//  - everything else: static site in ./public
const LATEST = 'https://github.com/justapps-it/JustCode/releases/latest';
const RELEASE = `${LATEST}/download/just-code.tgz`;
// /download/<os> → desktop app of the latest release (CI also uploads these version-less names)
const DESKTOP = {
  'mac-arm64': 'just-Code-mac-arm64.dmg',
  'mac-x64': 'just-Code-mac-x64.dmg',
  windows: 'just-Code-windows-x64.exe',
  linux: 'just-Code-linux-x86_64.AppImage',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname.startsWith('www.')) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname === '/latest.tgz' || url.pathname === '/just-code.tgz') {
      return Response.redirect(RELEASE, 302);
    }
    if (url.pathname === '/download' || url.pathname === '/download/') return Response.redirect(LATEST, 302);
    if (url.pathname.startsWith('/download/')) {
      const file = DESKTOP[url.pathname.slice('/download/'.length)];
      return Response.redirect(file ? `${LATEST}/download/${file}` : LATEST, 302);
    }
    const res = await env.ASSETS.fetch(request);
    if (url.pathname.endsWith('.sh') || url.pathname.endsWith('.ps1')) {
      const h = new Headers(res.headers);
      h.set('content-type', 'text/plain; charset=utf-8');
      h.set('cache-control', 'no-cache');
      return new Response(res.body, { status: res.status, headers: h });
    }
    return res;
  },
};
