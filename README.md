# Infra Dock

A native-feeling **macOS desktop app** to configure, start, stop and manage all of
your local development servers — Redis, MySQL, MariaDB, PostgreSQL, MongoDB,
Memcached, RabbitMQ, NGINX, Apache and Elasticsearch — from one place.

Infra Dock is an [Electron](https://www.electronjs.org/) app that drives
[Homebrew's `brew services`](https://docs.brew.sh/) under the hood, which is the
canonical way to manage background services on macOS. Anything you already have
installed via Homebrew shows up automatically.

## Features

- **One dashboard for every server** — see each server's live status (running /
  stopped / error) at a glance.
- **Start · Stop · Restart** any installed service with a single click.
- **Install missing servers** straight from the curated catalog (`brew install`,
  including taps like `mongodb/brew`).
- **Edit configuration files** in-app (e.g. `redis.conf`, `my.cnf`,
  `postgresql.conf`) — a `.infradock-bak` backup is written before every save.
- **Tail logs** for each service without leaving the app.
- **Search & filter** by name, status, or category (Database / Cache / Queue /
  Web Server / Search).
- **Reveal in Finder / open externally** for any config or log file.
- Secure by design: the UI runs sandboxed with context isolation; all system
  access goes through a small, fixed IPC bridge.

## Requirements

- macOS (Apple Silicon or Intel)
- [Homebrew](https://brew.sh) — Infra Dock manages servers through it
- [Node.js](https://nodejs.org) 18+ and npm (for running / building from source)

## Getting started

```bash
npm install
npm start
```

To open with DevTools attached:

```bash
npm run dev
```

## Building a distributable `.app` / `.dmg`

```bash
npm run dist
```

The packaged app is written to `release/`.

## How it works

```
electron/
  main.js       Electron main process + IPC handlers
  preload.js    Secure contextBridge exposed to the renderer as window.infraDock
  services.js   Homebrew wrapper (brew services list/start/stop/restart, install)
                + curated server catalog (ports, config & log paths)
renderer/
  index.html    App shell
  styles.css    Modern dark UI
  app.js        Dashboard, controls, config/log editor, toasts
```

The backend never uses a shell string — every Homebrew invocation passes its
arguments as an array via `execFile`, so service names can't be injected. A
GUI-launched app inherits a minimal `PATH`, so common Homebrew bin directories
are added automatically and the `brew` binary is located explicitly.

## Adding more servers

Add an entry to the `CATALOG` array in `electron/services.js`:

```js
{
  id: 'valkey',
  formula: 'valkey',
  name: 'Valkey',
  category: 'Cache / Key-Value',
  icon: '🔑',
  port: 6379,
  description: 'Redis-compatible in-memory data store.',
  config: 'etc/valkey/valkey.conf', // relative to brew --prefix
  logs: 'var/log/valkey.log',
}
```

Servers you install through Homebrew outside the catalog still appear on the
dashboard automatically (with generic metadata).

## Notes & limitations

- Some services (e.g. system-level MySQL setups) may require `sudo`; Infra Dock
  runs `brew services` at the user level. If a command needs elevated
  privileges, run it once in a terminal.
- Config/log file paths follow standard Homebrew conventions; if a formula uses
  a non-standard location the "Configure"/"Logs" buttons may not appear.

## License

MIT
