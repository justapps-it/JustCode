// Copies the built just-Code engine (../dist) and the GUI (../gui) into ./engine and
// syncs the desktop version with the npm package. Run `npm run build` in the repo root first.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desk = path.resolve(here, '..');
const root = path.resolve(desk, '..');
const app = path.join(desk, 'engine');

if (!fs.existsSync(path.join(root, 'dist', 'gui', 'server.js'))) {
  console.error('Missing ../dist — run `npm run build` in the repository root first.');
  process.exit(1);
}
fs.rmSync(app, { recursive: true, force: true });
fs.mkdirSync(app, { recursive: true });
// The GUI server needs no npm dependencies; the terminal UI (dist/ui, dist/cli.js) is not shipped.
fs.cpSync(path.join(root, 'dist'), path.join(app, 'dist'), {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(path.join(root, 'dist'), src).split(path.sep);
    return rel[0] !== 'ui' && rel[0] !== 'cli.js';
  },
});
fs.cpSync(path.join(root, 'gui'), path.join(app, 'gui'), { recursive: true });
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ type: 'module', version: rootPkg.version }, null, 2));

const pkgFile = path.join(desk, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
if (pkg.version !== rootPkg.version) {
  pkg.version = rootPkg.version;
  fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
}
console.log(`desktop app prepared (v${rootPkg.version})`);
