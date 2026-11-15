// just-Code desktop: an Electron shell around the just-Code GUI server.
// Each window works on one project folder and runs its own local server (127.0.0.1 + token).
import { app, BrowserWindow, Menu, dialog, nativeTheme, shell } from 'electron';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const engine = (p) => import(pathToFileURL(path.join(here, 'engine', 'dist', p)).href);
const STATE = () => path.join(app.getPath('userData'), 'state.json');

// Apps started from the Finder / a desktop launcher get a minimal PATH: take the login shell's,
// so the agents find node, npm, git, python… exactly as in a terminal.
function fixPath() {
  if (process.platform === 'win32') return;
  try {
    const shellBin = process.env.SHELL || '/bin/sh';
    const out = execFileSync(shellBin, ['-ilc', 'printf "__JC_PATH__%s" "$PATH"'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    const p = out.split('__JC_PATH__').pop()?.trim();
    if (p) process.env.PATH = p;
  } catch {
    /* keep the default PATH */
  }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE(), 'utf8'));
  } catch {
    return { recent: [] };
  }
}
function remember(folder) {
  const s = readState();
  s.recent = [folder, ...(s.recent ?? []).filter((f) => f !== folder)].filter((f) => fs.existsSync(f)).slice(0, 8);
  try {
    fs.writeFileSync(STATE(), JSON.stringify(s, null, 2));
  } catch {
    /* ignore */
  }
  if (process.platform !== 'linux') app.addRecentDocument(folder);
  buildMenu();
}

const windows = new Map(); // BrowserWindow -> { folder, close }

async function openFolder(folder) {
  for (const [w, info] of windows) if (info.folder === folder) return w.focus();
  const { startGui } = await engine('gui/server.js');
  const { loadConfig } = await engine('config.js');
  const gui = await startGui({ cwd: folder, config: loadConfig(), version: app.getVersion(), open: false });
  const origin = new URL(gui.url).origin;

  const dark = nativeTheme.shouldUseDarkColors;
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 640,
    minHeight: 480,
    title: `just-Code — ${path.basename(folder)}`,
    backgroundColor: dark ? '#141414' : '#f2efe6',
    icon: process.platform === 'linux' ? path.join(here, 'build', 'icon.png') : undefined,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  windows.set(win, { folder, close: gui.close });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    windows.get(win)?.close();
    windows.delete(win);
  });
  // Links (API key pages, docs…) open in the real browser; the window never leaves just-Code.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });
  await win.loadURL(gui.url);
  remember(folder);
  return win;
}

async function pickFolder() {
  const r = await dialog.showOpenDialog({
    title: 'Open a project folder',
    buttonLabel: 'Open',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  await openFolder(r.filePaths[0]);
  return r.filePaths[0];
}

function buildMenu() {
  const recent = (readState().recent ?? []).filter((f) => fs.existsSync(f));
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: () => void pickFolder() },
        {
          label: 'Open Recent',
          submenu: recent.length
            ? recent.map((f) => ({ label: f, click: () => void openFolder(f) }))
            : [{ label: 'No recent folders', enabled: false }],
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'just-Code website', click: () => void shell.openExternal('https://code.justapps.it') },
        { label: 'Report a problem', click: () => void shell.openExternal('https://github.com/justapps-it/JustCode/issues') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** A project folder passed on the command line (skipping the executable and, in dev, the app dir). */
function folderArg(argv) {
  const self = path.resolve(app.getAppPath());
  return argv
    .slice(1)
    .filter((a) => !a.startsWith('-'))
    .map((a) => path.resolve(a))
    .find((a) => a !== self && fs.existsSync(a) && fs.statSync(a).isDirectory());
}

/** First folder: from the command line, else the last one used, else ask. */
async function start(argv) {
  const arg = folderArg(argv);
  if (arg) return openFolder(arg);
  const last = (readState().recent ?? []).find((f) => fs.existsSync(f));
  if (last) return openFolder(last);
  if (!(await pickFolder()) && windows.size === 0) app.quit();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_e, argv) => {
    const arg = folderArg(argv);
    if (arg) void openFolder(arg);
    else [...windows.keys()][0]?.focus();
  });
  app.whenReady().then(async () => {
    fixPath();
    buildMenu();
    try {
      await start(process.argv);
    } catch (e) {
      dialog.showErrorBox('just-Code', String(e?.stack ?? e));
      app.quit();
    }
    app.on('activate', () => {
      if (windows.size === 0) void start([]);
    });
  });
  app.on('window-all-closed', () => {
    for (const { close } of windows.values()) close();
    if (process.platform !== 'darwin') app.quit();
  });
}
