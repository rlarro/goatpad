import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron';
import { dirname, join, basename, extname, resolve as pathResolve } from 'node:path';
import { promises as fs } from 'node:fs';

const isDev = !app.isPackaged;
const PRELOAD = join(__dirname, '../preload/index.js');
const RENDERER_HTML = join(__dirname, '../renderer/index.html');

let mainWindow: BrowserWindow | null = null;

const RECENT_FILE = () => join(app.getPath('userData'), 'recent.json');

interface RecentState {
  recentFiles: string[];
  recentFolders: string[];
  lastFolder: string | null;
}

async function loadRecent(): Promise<RecentState> {
  try {
    const buf = await fs.readFile(RECENT_FILE(), 'utf8');
    const parsed = JSON.parse(buf);
    return {
      recentFiles: parsed.recentFiles ?? [],
      recentFolders: parsed.recentFolders ?? [],
      lastFolder: parsed.lastFolder ?? null,
    };
  } catch {
    return { recentFiles: [], recentFolders: [], lastFolder: null };
  }
}

async function saveRecent(state: RecentState): Promise<void> {
  await fs.writeFile(RECENT_FILE(), JSON.stringify(state, null, 2), 'utf8');
}

async function pushRecent(kind: 'file' | 'folder', p: string): Promise<void> {
  const state = await loadRecent();
  const list = kind === 'file' ? state.recentFiles : state.recentFolders;
  const idx = list.indexOf(p);
  if (idx >= 0) list.splice(idx, 1);
  list.unshift(p);
  if (list.length > 20) list.length = 20;
  if (kind === 'folder') state.lastFolder = p;
  await saveRecent(state);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(RENDERER_HTML);
  }
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const send = (channel: string, ...args: unknown[]) =>
    mainWindow?.webContents.send(channel, ...args);

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const },
          ],
        }]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New',
          accelerator: 'CmdOrCtrl+N',
          click: () => send('menu:new-file'),
        },
        {
          label: 'Open File…',
          accelerator: 'CmdOrCtrl+O',
          click: () => send('menu:open-file'),
        },
        {
          label: 'Open Folder…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => send('menu:open-folder'),
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => send('menu:save'),
        },
        {
          label: 'Save as Next Version',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => send('menu:save-next-version'),
        },
        { type: 'separator' },
        ...(isMac
          ? [{ role: 'close' as const }]
          : [{ role: 'quit' as const }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find',
          accelerator: 'CmdOrCtrl+F',
          click: () => send('menu:find'),
        },
        {
          label: 'Find and Replace',
          accelerator: 'CmdOrCtrl+Alt+F',
          click: () => send('menu:replace'),
        },
      ],
    },
    {
      label: 'Format',
      submenu: [
        { label: 'Bold', accelerator: 'CmdOrCtrl+B', click: () => send('menu:format', 'bold') },
        { label: 'Italic', accelerator: 'CmdOrCtrl+I', click: () => send('menu:format', 'italic') },
        { type: 'separator' },
        { label: 'Heading 1', accelerator: 'CmdOrCtrl+1', click: () => send('menu:format', 'h1') },
        { label: 'Heading 2', accelerator: 'CmdOrCtrl+2', click: () => send('menu:format', 'h2') },
        { label: 'Heading 3', accelerator: 'CmdOrCtrl+3', click: () => send('menu:format', 'h3') },
        { label: 'Body / Plain Paragraph', accelerator: 'CmdOrCtrl+0', click: () => send('menu:format', 'p') },
        { type: 'separator' },
        { label: 'Bulleted List', accelerator: 'CmdOrCtrl+Shift+8', click: () => send('menu:format', 'ul') },
        { label: 'Numbered List', accelerator: 'CmdOrCtrl+Shift+7', click: () => send('menu:format', 'ol') },
        { type: 'separator' },
        { label: 'Section Break (* * *)', accelerator: 'CmdOrCtrl+Shift+H', click: () => send('menu:format', 'hr') },
        { type: 'separator' },
        { label: 'Move Section Up', accelerator: 'CmdOrCtrl+Shift+Up', click: () => send('menu:section-move', 'up') },
        { label: 'Move Section Down', accelerator: 'CmdOrCtrl+Shift+Down', click: () => send('menu:section-move', 'down') },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Source / Live View',
          accelerator: 'CmdOrCtrl+/',
          click: () => send('menu:toggle-source'),
        },
        {
          label: 'Font',
          submenu: [
            { label: 'Monospace', click: () => send('menu:font', 'mono') },
            { label: 'Serif (Iowan Old Style)', click: () => send('menu:font', 'serif') },
            { label: 'Sans-Serif (SF Pro)', click: () => send('menu:font', 'sans') },
          ],
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' as const }, { role: 'front' as const }] : []),
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc(): void {
  ipcMain.handle('dialog:open-file', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const content = await fs.readFile(filePath, 'utf8');
    await pushRecent('file', filePath);
    return { path: filePath, content };
  });

  ipcMain.handle('dialog:open-folder', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const folderPath = result.filePaths[0];
    const files = await listMarkdownFiles(folderPath);
    await pushRecent('folder', folderPath);
    return { path: folderPath, files };
  });

  ipcMain.handle('folder:list', async (_e, folderPath: string) => {
    return await listMarkdownFiles(folderPath);
  });

  ipcMain.handle('file:read', async (_e, filePath: string) => {
    const content = await fs.readFile(filePath, 'utf8');
    await pushRecent('file', filePath);
    return content;
  });

  ipcMain.handle('file:write', async (_e, filePath: string, content: string) => {
    await fs.writeFile(filePath, content, { encoding: 'utf8' });
    return { path: filePath };
  });

  ipcMain.handle('file:write-next-version', async (_e, filePath: string, content: string) => {
    const nextPath = nextVersionPath(filePath);
    await fs.writeFile(nextPath, content, { encoding: 'utf8' });
    await pushRecent('file', nextPath);
    return { path: nextPath };
  });

  ipcMain.handle('file:snapshot', async (_e, filePath: string, content: string) => {
    const folder = dirname(filePath);
    const snapDir = join(folder, '.goatpad', 'snapshots');
    await fs.mkdir(snapDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const base = basename(filePath, extname(filePath));
    const ext = extname(filePath);
    const snapPath = join(snapDir, `${base}__${ts}${ext}`);
    await fs.writeFile(snapPath, content, { encoding: 'utf8' });
    return { path: snapPath };
  });

  ipcMain.handle('recent:get', async () => {
    return await loadRecent();
  });

  ipcMain.handle('selftest:roundtrip', async (_e, filePath: string) => {
    const original = await fs.readFile(filePath);
    const asString = original.toString('utf8');
    const reEncoded = Buffer.from(asString, 'utf8');
    const identical = original.equals(reEncoded);
    return { identical, originalBytes: original.length, reEncodedBytes: reEncoded.length };
  });
}

async function listMarkdownFiles(folderPath: string): Promise<{ name: string; path: string; mtimeMs: number }[]> {
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  const out: { name: string; path: string; mtimeMs: number }[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (e.name.startsWith('.')) continue;
    const ext = extname(e.name).toLowerCase();
    if (ext !== '.md' && ext !== '.markdown') continue;
    const full = join(folderPath, e.name);
    const stat = await fs.stat(full);
    out.push({ name: e.name, path: full, mtimeMs: stat.mtimeMs });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  return out;
}

function nextVersionPath(filePath: string): string {
  const dir = dirname(filePath);
  const ext = extname(filePath);
  const stem = basename(filePath, ext);
  const m = stem.match(/^(.*?)(?:_v(\d+))?$/);
  if (!m) return pathResolve(dir, `${stem}_v2${ext}`);
  const base = m[1];
  const current = m[2] ? parseInt(m[2], 10) : 1;
  return pathResolve(dir, `${base}_v${current + 1}${ext}`);
}

app.whenReady().then(async () => {
  // In dev mode the packaged .icns isn't applied, so the dock would show
  // the default Electron hexagon. Set the icon explicitly so daily-use dev
  // matches the eventual packaged build.
  if (process.platform === 'darwin' && !app.isPackaged && app.dock) {
    const iconPath = join(app.getAppPath(), 'resources', 'icon.png');
    app.dock.setIcon(iconPath);
  }

  registerIpc();
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
