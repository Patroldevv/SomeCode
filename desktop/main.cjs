const { app, BrowserWindow, shell } = require('electron');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// When a Linux desktop shell (such as Quickshell) starts apps with RLIMIT_RTTIME = 0 (Max realtime timeout = 0 us)
// while leaving RLIMIT_RTPRIO > 0, the kernel immediately sends SIGKILL (exit 9) to Electron's renderer the moment
// its audio thread switches to SCHED_RR. Dropping rtprio to 0 on the main process and its zygote children keeps every
// renderer thread on normal scheduling so the window never goes black.
if (process.platform === 'linux') {
  try {
    const limits = fs.readFileSync('/proc/self/limits', 'utf8');
    if (/^Max realtime timeout\s+0\s+/m.test(limits)) {
      const pids = new Set([process.pid]);
      let added = true;
      while (added) {
        added = false;
        for (const entry of fs.readdirSync('/proc')) {
          if (!/^\d+$/.test(entry) || pids.has(Number(entry))) continue;
          try {
            const st = fs.readFileSync(`/proc/${entry}/status`, 'utf8');
            const ppid = Number((st.match(/^PPid:\s+(\d+)/m) || [])[1]);
            if (pids.has(ppid)) {
              pids.add(Number(entry));
              added = true;
            }
          } catch {}
        }
      }
      for (const pid of pids) {
        try {
          execFileSync('prlimit', ['--rtprio=0', `--pid=${pid}`], { stdio: 'ignore' });
        } catch {}
      }
    }
  } catch {}
}

// Its own name and data folder: run as a bare `electron main.cjs` it would share ~/.config/Electron (and its profile
// lock and settings) with every other app that is started that way.
app.setName('SomeCode');
app.setPath('userData', path.join(app.getPath('appData'), 'SomeCode'));

const url = process.argv.find((arg) => arg.startsWith('http://') || arg.startsWith('https://')) || process.argv[2];

// SomeCode follows the computer: with a working GPU (a render node under /dev/dri) it uses GPU acceleration, without
// one it renders in software, and both ways it must just work. A watchdog below notices a black or blank window (or
// a dying GPU process) and restarts once without the GPU, remembering it. SOMECODE_GPU=0 forces software rendering,
// SOMECODE_GPU=1 forces the GPU and never falls back.
const flagFile = path.join(app.getPath('userData'), 'gpu-disabled');
const forced = process.env.SOMECODE_GPU;
const flagged = (() => {
  try {
    return fs.existsSync(flagFile);
  } catch {
    return false;
  }
})();
const gpuPresent = (() => {
  if (process.platform !== 'linux') return true;
  try {
    return fs.readdirSync('/dev/dri').some((name) => name.startsWith('renderD'));
  } catch {
    return false;
  }
})();
const useGpu = forced === '1' || (forced !== '0' && !flagged && gpuPresent);

// A short log next to the profile (~/.config/SomeCode/launcher.log): what was decided and what went wrong, so a
// black screen or a reloading page can be traced afterwards.
const logFile = path.join(app.getPath('userData'), 'launcher.log');
function log(message) {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 200_000) fs.renameSync(logFile, `${logFile}.old`);
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Logging must never break the window.
  }
}
log(`start electron=${process.versions.electron} gpu=${useGpu ? 'on' : 'off'} (present=${gpuPresent} flagged=${flagged} forced=${forced ?? '-'}) session=${process.env.XDG_SESSION_TYPE ?? '?'} ozoneHint=${process.env.ELECTRON_OZONE_PLATFORM_HINT ?? '-'}`);
if (!useGpu) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
}
// Vulkan does not work with Chromium on Wayland; ANGLE falls back to OpenGL without it.
app.commandLine.appendSwitch('disable-features', 'Vulkan');
// Chimes play without a first click in this window (it is the app's own window, not a web page).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Let Chromium pick Wayland or X11 itself instead of insisting on one.
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');

let fellBack = false;
let quitting = false;
app.on('before-quit', () => {
  quitting = true;
});
/** A process that was ended on purpose (the app closing, a kill from outside) is not a crash. */
const deliberate = (reason) => quitting || reason === 'clean-exit' || reason === 'killed';
/** Restart without the GPU (once) and remember that this computer cannot use it. */
function fallBackToSoftware(reason) {
  if (fellBack || !useGpu || forced === '1') return false;
  fellBack = true;
  console.error(`somecode: ${reason}; restarting without GPU acceleration`);
  log(`fallback to software: ${reason}`);
  try {
    fs.mkdirSync(path.dirname(flagFile), { recursive: true });
    fs.writeFileSync(flagFile, `${reason}\n${new Date().toISOString()}\n`);
  } catch {
    // The restart below still uses SOMECODE_GPU.
  }
  app.relaunch({ args: process.argv.slice(1), env: { ...process.env, SOMECODE_GPU: '0' } });
  app.exit(0);
  return true;
}

/** Whether a captured frame has anything on it besides the dark page background. */
function looksPainted(image) {
  const bitmap = image.toBitmap();
  for (let i = 0; i < bitmap.length; i += 4 * 61) {
    if (bitmap[i] + bitmap[i + 1] + bitmap[i + 2] > 120) return true;
  }
  return false;
}

function watchPaint(win) {
  let blank = 0;
  let checks = 0;
  const timer = setInterval(async () => {
    if (win.isDestroyed()) return clearInterval(timer);
    checks += 1;
    try {
      const painted = win.webContents.isLoading() || looksPainted(await win.webContents.capturePage());
      blank = painted ? 0 : blank + 1;
    } catch {
      return;
    }
    if (blank >= 2) {
      clearInterval(timer);
      // Black or empty twice in a row: without the GPU first, else just load the page again.
      if (!fallBackToSoftware('the window went black')) win.webContents.reloadIgnoringCache();
    } else if (checks >= 12) {
      clearInterval(timer);
    }
  }, 1200);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 840,
    minHeight: 560,
    title: 'SomeCode',
    backgroundColor: '#111111',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
    watchPaint(win);
  });

  // Open external links in system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      if (!url.includes('127.0.0.1') && !url.includes('localhost')) {
        shell.openExternal(url);
        return { action: 'deny' };
      }
    }
    return { action: 'allow' };
  });

  // A renderer crash leaves a black window: load the page again instead, but never in a loop.
  const reloads = [];
  const mayReload = () => {
    const now = Date.now();
    while (reloads.length > 0 && now - reloads[0] > 60_000) reloads.shift();
    if (reloads.length >= 3) return false;
    reloads.push(now);
    return true;
  };
  win.webContents.on('render-process-gone', (_event, details) => {
    log(`page process gone: ${details.reason} (exit ${details.exitCode})`);
    if (deliberate(details.reason) || win.isDestroyed() || !url) return;
    if (fallBackToSoftware(`the page process died (${details.reason})`)) return;
    if (mayReload()) setTimeout(() => win.loadURL(url), 500);
    else log('not reloading again: three page crashes within a minute');
  });
  win.webContents.on('did-fail-load', (_event, code, desc, failedUrl, isMainFrame) => {
    if (!isMainFrame) return;
    log(`page failed to load: ${desc} (${code}) ${String(failedUrl).split('#')[0]}`);
    if (code !== -3 && !win.isDestroyed() && url && mayReload()) setTimeout(() => win.loadURL(url), 1000);
  });
  // Every full page load is logged: the interface is one page and should load once.
  win.webContents.on('did-start-navigation', (_event, navUrl, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) log(`page load: ${String(navUrl).split('#')[0]}`);
  });
  // Pressing a link must not replace the interface: other addresses open in the browser.
  win.webContents.on('will-navigate', (event, navUrl) => {
    try {
      const target = new URL(navUrl);
      if (url && target.origin === new URL(url).origin) return;
      event.preventDefault();
      if (target.protocol === 'http:' || target.protocol === 'https:') shell.openExternal(navUrl);
    } catch {
      event.preventDefault();
    }
  });

  if (url) {
    win.loadURL(url);
  }
}

app.on('child-process-gone', (_event, details) => {
  log(`${details.type} process gone: ${details.reason} (exit ${details.exitCode})`);
  if (details.type === 'GPU' && !deliberate(details.reason)) fallBackToSoftware(`the GPU process died (${details.reason})`);
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
