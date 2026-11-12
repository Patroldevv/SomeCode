// A hidden Chromium for the agents' browser tools, used when no Chrome/Chromium is installed. It only opens one
// invisible window; the tools drive it over the DevTools protocol on the port they started it with.
const { app, BrowserWindow } = require('electron');
const { execFileSync } = require('child_process');
const fs = require('fs');

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

app.commandLine.appendSwitch('disable-features', 'Vulkan');
app.whenReady().then(() => {
  new BrowserWindow({ show: false, frame: false, useContentSize: true, width: 1280, height: 800, webPreferences: { backgroundThrottling: false, sandbox: true, offscreen: true } }).loadURL('about:blank');
});
// Closing the window the tools drive must not end the process: they close it by ending the process.
app.on('window-all-closed', () => {});
