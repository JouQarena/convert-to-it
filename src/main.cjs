/**
 * Convert to it! — desktop wrapper (Electron main process)
 * --------------------------------------------------------
 * Serves the bundled offline web app (convert.to.it) over the app:// protocol
 * with the COOP/COEP headers its WASM engines need, and adds the two things the
 * plain web app / upstream desktop build does not have:
 *
 *   1. "Open with" / file associations — a file the OS hands us is loaded
 *      straight into the converter UI (window drop-injection, see preload.cjs).
 *   2. Automatic background updates via electron-updater (GitHub provider).
 *
 * The protocol handler and the offline web app come from p2r3/convert
 * (GPL-2.0) — see THIRD-PARTY-NOTICES.md.
 */
const { app, BrowserWindow, protocol, net, shell, ipcMain, Menu, dialog } = require("electron");
const { URL, pathToFileURL } = require("node:url");
const path = require("node:path");
const fs = require("node:fs");

const APP_LABEL = "Convert to it!";
const HOME_PAGE = "https://p2r3.github.io/convert/";
const DIST_PATH = path.join(__dirname, "..", "web");
const PRELOAD_PATH = path.join(__dirname, "preload.cjs");
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

let mainWindow = null;
let windowReady = false;
/** Files the OS asked us to open before the window was ready. */
const pendingFiles = [];

/* ------------------------------------------------------------------ *
 * Files handed over by the operating system ("Open with …")          *
 * ------------------------------------------------------------------ */

function isUserFile(candidate) {
  if (typeof candidate !== "string" || candidate.length === 0) return false;
  if (candidate.startsWith("-") || candidate.startsWith("--")) return false;
  if (candidate === process.execPath) return false;
  if (candidate.endsWith(".asar")) return false;

  let resolved;
  try {
    resolved = path.resolve(candidate);
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size === 0) return false;
  } catch {
    return false;
  }

  // Never treat anything inside our own installation as a user file.
  try {
    const appDir = path.dirname(process.execPath);
    if (resolved === appDir || resolved.startsWith(appDir + path.sep)) return false;
  } catch {
    /* ignore */
  }
  return true;
}

/** Pull file paths out of a process argv array (Windows/Linux "Open with"). */
function filesFromArgv(argv) {
  return argv.slice(1).filter(isUserFile);
}

function deliverFiles(files) {
  const clean = (files || []).filter(isUserFile);
  if (clean.length === 0) return;
  if (mainWindow && !mainWindow.isDestroyed() && windowReady) {
    mainWindow.webContents.send("convert:open-files", clean);
  } else {
    for (const file of clean) {
      if (!pendingFiles.includes(file)) pendingFiles.push(file);
    }
  }
}

function flushPendingFiles() {
  if (pendingFiles.length === 0) return;
  const files = pendingFiles.splice(0, pendingFiles.length);
  deliverFiles(files);
}

/* ------------------------------------------------------------------ *
 * Window                                                             *
 * ------------------------------------------------------------------ */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 560,
    autoHideMenuBar: true,
    title: APP_LABEL,
    backgroundColor: "#0f1115",
    webPreferences: {
      preload: PRELOAD_PATH,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      sandbox: false,
    },
  });

  mainWindow.loadURL("app://-/index.html");

  mainWindow.webContents.on("did-finish-load", () => {
    windowReady = true;
    flushPendingFiles();
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    if (errorCode === -3) return; // aborted (e.g. a redirect), harmless
    mainWindow.webContents
      .loadURL(
        "data:text/html;charset=utf-8," +
          encodeURIComponent(
            `<body style="font:15px/1.5 system-ui;background:#0f1115;color:#e6e6e6;padding:40px">` +
              `<h2 style="font-weight:600">Convert to it! could not start</h2>` +
              `<p>${errorDescription || "Unknown error"} (code ${errorCode}).</p>` +
              `<p>The bundled offline app files may be missing — reinstall the app.</p>` +
              `</body>`
          )
      )
      .catch(() => {});
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    windowReady = false;
  });

  // External links go to the real browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") shell.openExternal(url);
    return { action: "deny" };
  });
}

/* ------------------------------------------------------------------ *
 * Automatic updates                                                  *
 * ------------------------------------------------------------------ */

function setupAutoUpdate() {
  if (!app.isPackaged) return; // no update feed for a dev checkout

  // electron-updater is loaded lazily so a dev checkout without the
  // dependency installed still runs.
  let autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch {
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  app
    .whenReady()
    .then(() => {
      autoUpdater.checkForUpdatesAndNotify({ title: APP_LABEL }).catch(() => {});
      const timer = setInterval(() => {
        autoUpdater.checkForUpdates().catch(() => {});
      }, CHECK_INTERVAL_MS);
      if (typeof timer.unref === "function") timer.unref();
    })
    .catch(() => {});
}

function checkForUpdatesFromMenu() {
  if (!app.isPackaged) {
    dialog.showMessageBox({
      type: "info",
      title: APP_LABEL,
      message: "Updates are only available in the installed app.",
    });
    return;
  }
  const { autoUpdater } = require("electron-updater");
  autoUpdater
    .checkForUpdates()
    .then(({ updateInfo }) => {
      if (updateInfo && updateInfo.version && updateInfo.version !== app.getVersion()) {
        dialog.showMessageBox({
          type: "info",
          title: APP_LABEL,
          message: `Version ${updateInfo.version} is downloading in the background.`,
          detail: "It will be installed automatically the next time you close the app.",
        });
      } else {
        dialog.showMessageBox({
          type: "info",
          title: APP_LABEL,
          message: "You are running the latest version.",
        });
      }
    })
    .catch((error) => {
      dialog.showMessageBox({
        type: "error",
        title: APP_LABEL,
        message: "Could not check for updates.",
        detail: String((error && error.message) || error),
      });
    });
}

/* ------------------------------------------------------------------ *
 * Application menu                                                   *
 * ------------------------------------------------------------------ */

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open File…",
          accelerator: "Control+O",
          click: openFileDialog,
        },
        { type: "separator" },
        {
          label: "Check for Updates…",
          click: checkForUpdatesFromMenu,
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      role: "help",
      submenu: [
        {
          label: "convert.to.it website",
          click: () => shell.openExternal(HOME_PAGE),
        },
        {
          label: "About Convert to it!",
          click: () =>
            dialog.showMessageBox({
              type: "info",
              title: "About Convert to it!",
              message: "Convert to it! — offline desktop edition",
              detail:
                "A truly universal, private, on-device file converter.\n" +
                "Every conversion happens locally on this computer.\n\n" +
                "Original project: convert.to.it\n" +
                "by PortalRunner (p2r3), licensed under GPL-2.0\n" +
                "https://p2r3.github.io/convert/\n" +
                "https://github.com/p2r3/convert\n\n" +
                "This desktop edition only adds the packaging: file\n" +
                "associations (Open with) and automatic updates.\n\n" +
                `App version: ${app.getVersion()}\n` +
                `Electron: ${process.versions.electron}`,
              buttons: ["OK"],
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function openFileDialog() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  dialog
    .showOpenDialog(mainWindow, {
      title: "Open with Convert to it!",
      properties: ["openFile", "multiSelections"],
    })
    .then(({ filePaths }) => deliverFiles(filePaths || []))
    .catch(() => {});
}

/* ------------------------------------------------------------------ *
 * IPC                                                                *
 * ------------------------------------------------------------------ */

ipcMain.handle("convert:get-initial-files", () => {
  const files = pendingFiles.splice(0, pendingFiles.length);
  return files;
});

ipcMain.handle("convert:info", () => ({
  platform: process.platform,
  arch: process.arch,
  version: app.getVersion(),
  isPackaged: app.isPackaged,
}));

ipcMain.handle("convert:pick-files", () => openFileDialogAndReturn());

function openFileDialogAndReturn() {
  if (!mainWindow || mainWindow.isDestroyed()) return [];
  return dialog
    .showOpenDialog(mainWindow, {
      title: "Open with Convert to it!",
      properties: ["openFile", "multiSelections"],
    })
    .then(({ filePaths }) => filePaths || [])
    .catch(() => []);
}

/* ------------------------------------------------------------------ *
 * Protocol: serve the bundled offline app from app://                *
 * ------------------------------------------------------------------ */

app.whenReady().then(() => {
  // Map every app:// request to a local file inside web/
  protocol.handle("app", async (request) => {
    try {
      const parsedUrl = new URL(request.url);
      if (parsedUrl.protocol !== "app:" || parsedUrl.hostname !== "-") {
        return new Response("Invalid Request", { status: 400 });
      }

      // Strip everything unneeded
      let urlPath = parsedUrl.pathname;
      if (urlPath.startsWith("/")) urlPath = urlPath.slice(1);
      if (urlPath.startsWith("convert/")) urlPath = urlPath.replace("convert/", "");

      // Decode URL until stable
      let decodedPath = urlPath;
      try {
        while (decodedPath !== decodeURIComponent(decodedPath)) {
          decodedPath = decodeURIComponent(decodedPath);
        }
      } catch {
        return new Response("Malformed URL", { status: 400 });
      }
      urlPath = decodedPath;

      const resolvedPath = path.resolve(DIST_PATH, urlPath);
      const relativePath = path.relative(DIST_PATH, resolvedPath);
      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        throw new Error("File requested not in dist.");
      }

      // Fetch the local file
      const fileUrl = pathToFileURL(resolvedPath).href;
      const response = await net.fetch(fileUrl);

      // COR headers so the WASM engines can use SharedArrayBuffer
      const headers = new Headers(response.headers);
      headers.set("Cross-Origin-Opener-Policy", "same-origin");
      headers.set("Cross-Origin-Embedder-Policy", "credentialless");

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: headers,
      });
    } catch {
      return new Response("File Not Found", { status: 404 });
    }
  });

  buildMenu();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (parsedUrl.protocol !== "app:") {
      event.preventDefault();
      if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
        shell.openExternal(navigationUrl);
      }
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/* ------------------------------------------------------------------ *
 * Single instance + files opened while already running              *
 * ------------------------------------------------------------------ */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const files = filesFromArgv(argv);
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    deliverFiles(files);
  });
}

// macOS delivers files through this event instead of argv.
app.on("open-file", (event, filePath) => {
  event.preventDefault();
  deliverFiles([filePath]);
});

// Windows / Linux: files arrive as command line arguments.
app.whenReady().then(() => {
  deliverFiles(filesFromArgv(process.argv));
});

setupAutoUpdate();
