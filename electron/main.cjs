// Electron entry point for the desktop (Windows .exe) build of Super Animator Studio.
// The web app is bundled by Vite into `dist/` and served here through a custom
// privileged `app://` scheme, so IndexedDB, media APIs and relative asset paths
// behave exactly like they do on https (file:// has an opaque origin that blocks
// IndexedDB, which this app relies on for projects and media).
const {app, BrowserWindow, dialog, net, protocol, session, shell} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

const APP_SCHEME = 'app';
const APP_ORIGIN = `${APP_SCHEME}://studio`;
const DIST_DIR = path.join(__dirname, '..', 'dist');
const DEV_SERVER_URL = process.argv.includes('--dev') ? process.env.VITE_DEV_SERVER_URL || 'http://localhost:3000' : '';

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true},
  },
]);

// The studio plays and previews audio, which Chromium would otherwise block
// until the user interacts with the page.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let mainWindow = null;

function resolveLocalFile(pathname) {
  const relative = decodeURIComponent(pathname).replace(/^\/+/, '');
  const candidate = path.join(DIST_DIR, relative || 'index.html');
  if (!candidate.startsWith(DIST_DIR)) {
    return null;
  }
  return candidate;
}

async function handleAppRequest(request) {
  const {pathname} = new URL(request.url);
  let filePath = resolveLocalFile(pathname);

  if (!filePath) {
    return new Response('Not found', {status: 404});
  }

  try {
    const stats = await fs.stat(filePath);
    if (stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    } else if (stats.isFile()) {
      return net.fetch(pathToFileURL(filePath).toString());
    }
  } catch {
    // Fall through to the SPA entry point for client-side routes.
  }

  if (path.extname(filePath)) {
    return new Response('Not found', {status: 404});
  }
  return net.fetch(pathToFileURL(path.join(DIST_DIR, 'index.html')).toString());
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'Super Animator Studio',
    backgroundColor: '#0B0D11',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Links to the outside world belong in the user's browser, not in the app window.
  mainWindow.webContents.setWindowOpenHandler(({url}) => {
    if (/^https?:/i.test(url)) {
      shell.openExternal(url);
    }
    return {action: 'deny'};
  });

  const appUrl = `${APP_ORIGIN}/`;
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = DEV_SERVER_URL ? DEV_SERVER_URL.startsWith(url) || url.startsWith(DEV_SERVER_URL) : url.startsWith(appUrl);
    if (!allowed) {
      event.preventDefault();
      if (/^https?:/i.test(url)) {
        shell.openExternal(url);
      }
    }
  });

  await mainWindow.loadURL(DEV_SERVER_URL || appUrl);
}

app.whenReady().then(async () => {
  protocol.handle(APP_SCHEME, handleAppRequest);

  // Exports and renders download generated files: let the user pick where they go.
  session.defaultSession.on('will-download', (event, item) => {
    const target = dialog.showSaveDialogSync(mainWindow, {
      title: 'Salvar arquivo',
      defaultPath: path.join(app.getPath('downloads'), item.getFilename()),
    });
    if (target) {
      item.setSavePath(target);
    } else {
      item.cancel();
    }
  });

  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
