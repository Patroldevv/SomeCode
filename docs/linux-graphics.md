# Linux: GPU acceleration and the app window

`desktop/main.cjs` opens SomeCode's window (Electron). It follows the computer:

- **A GPU is present** (a render node under `/dev/dri`): GPU acceleration is on.
- **No GPU**: software rendering. Everything works the same, only the drawing is done by the CPU.
- A **watchdog** notices a window that stays black or blank, or a GPU/page process that dies, restarts the window once without
  the GPU and remembers it (`~/.config/SomeCode/gpu-disabled`; delete the file to try the GPU again).
- A page process that was ended on purpose (the window closing, a kill from outside) is not treated as a crash, and a
  crashing page is reloaded at most three times a minute.
- `SOMECODE_GPU=0` forces software rendering, `SOMECODE_GPU=1` forces the GPU and turns the fallback off.

What the launcher decided and what went wrong is written to `~/.config/SomeCode/launcher.log` (every full page load is
logged too: the interface is one page and should load once).

## Other Electron apps (Discord, Spotify, ChatGPT ...)

`--in-process-gpu` makes the GPU work run inside the app itself: any GPU error then closes the whole app, which looks like
"the app opens, goes black and closes". Leave that flag out (and `--enable-zero-copy`, which fails on some NVIDIA setups).
With the flags `--ozone-platform=x11 --ignore-gpu-blocklist --enable-gpu-rasterization` the GPU runs in its own process
and a GPU error can no longer take the app with it.
