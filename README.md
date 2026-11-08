# SomeCode

A local web app (Linux) for working with coding agents — Claude, OpenCode and Antigravity — over ACP, in a Codex/ChatGPT-style interface. Everything runs on your computer; the agents sign in with their own CLIs.

## Install

For you only (installs to `~/.local`):

```bash
curl -fsSL https://raw.githubusercontent.com/Patroldevv/SomeCode/main/install.sh | bash
```

For every user on the machine:

```bash
curl -fsSL https://raw.githubusercontent.com/Patroldevv/SomeCode/main/install.sh | sudo bash
```

Then run `somecode`. The installer downloads the latest [release](https://github.com/Patroldevv/SomeCode/releases), verifies its checksum and, if Node 26+ is missing, fetches Node's official build into the install folder. Linux x86_64 only for now.

Pin a version or remove it:

```bash
curl -fsSL https://raw.githubusercontent.com/Patroldevv/SomeCode/main/install.sh | bash -s -- --version v0.1.0
curl -fsSL https://raw.githubusercontent.com/Patroldevv/SomeCode/main/install.sh | bash -s -- --uninstall
```

## From source

Needs Node 26+.

```bash
npm ci && npm -w apps/web run build && npm start
```

`scripts/package.sh` builds the release tarball (`release/somecode-linux-x64.tar.gz`).
