'use strict';

const { execFile } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

/**
 * Backend for Infra Dock.
 *
 * Local servers on macOS are managed canonically through Homebrew's
 * `brew services` mechanism. This module is a thin, safe wrapper around it
 * (no shell interpolation, arguments are passed as an array) plus a curated
 * catalog of well-known servers with their default ports, config files and
 * log locations so the UI can offer "configure" and "view logs" actions.
 */

// Candidate locations for the brew binary (Apple Silicon first, then Intel).
const BREW_CANDIDATES = [
  '/opt/homebrew/bin/brew',
  '/usr/local/bin/brew',
  '/home/linuxbrew/.linuxbrew/bin/brew',
];

let cachedBrewPath = null;
let cachedPrefix = null;

async function resolveBrew() {
  if (cachedBrewPath) return cachedBrewPath;
  for (const candidate of BREW_CANDIDATES) {
    try {
      await fs.access(candidate);
      cachedBrewPath = candidate;
      return candidate;
    } catch (_) {
      // keep looking
    }
  }
  // Fall back to whatever is on PATH.
  cachedBrewPath = 'brew';
  return cachedBrewPath;
}

// A GUI app launched from Finder inherits a minimal PATH, so we enrich it.
function buildEnv() {
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
  const current = process.env.PATH || '';
  const merged = Array.from(new Set([...extra, ...current.split(':')])).join(':');
  return { ...process.env, PATH: merged };
}

function run(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { env: buildEnv(), maxBuffer: 1024 * 1024 * 16, timeout: opts.timeout || 120000 },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          return reject(error);
        }
        resolve({ stdout: stdout || '', stderr: stderr || '' });
      }
    );
  });
}

async function brew(args, opts) {
  const bin = await resolveBrew();
  return run(bin, args, opts);
}

async function brewPrefix() {
  if (cachedPrefix) return cachedPrefix;
  try {
    const { stdout } = await brew(['--prefix']);
    cachedPrefix = stdout.trim();
  } catch (_) {
    cachedPrefix = '/opt/homebrew';
  }
  return cachedPrefix;
}

/**
 * Curated catalog of popular dev servers. `formula` is the Homebrew package
 * name; `config` and `logs` are paths relative to the brew prefix (resolved at
 * runtime). Anything installed but not listed here still shows up dynamically.
 */
const CATALOG = [
  {
    id: 'redis',
    formula: 'redis',
    name: 'Redis',
    category: 'Cache / Key-Value',
    icon: '🟥',
    port: 6379,
    description: 'In-memory data structure store, used as a cache and message broker.',
    config: 'etc/redis.conf',
    logs: 'var/log/redis.log',
  },
  {
    id: 'mysql',
    formula: 'mysql',
    name: 'MySQL',
    category: 'Database',
    icon: '🐬',
    port: 3306,
    description: 'The world\u2019s most popular open-source relational database.',
    config: 'etc/my.cnf',
    logs: 'var/mysql',
  },
  {
    id: 'mariadb',
    formula: 'mariadb',
    name: 'MariaDB',
    category: 'Database',
    icon: '🦭',
    port: 3306,
    description: 'Community-developed, MySQL-compatible relational database.',
    config: 'etc/my.cnf',
    logs: 'var/mysql',
  },
  {
    id: 'postgresql@16',
    formula: 'postgresql@16',
    name: 'PostgreSQL 16',
    category: 'Database',
    icon: '🐘',
    port: 5432,
    description: 'Advanced open-source object-relational database system.',
    config: 'var/postgresql@16/postgresql.conf',
    logs: 'var/log/postgresql@16.log',
  },
  {
    id: 'mongodb-community',
    formula: 'mongodb-community',
    tap: 'mongodb/brew',
    name: 'MongoDB',
    category: 'Database',
    icon: '🍃',
    port: 27017,
    description: 'Document-oriented NoSQL database.',
    config: 'etc/mongod.conf',
    logs: 'var/log/mongodb/mongo.log',
  },
  {
    id: 'memcached',
    formula: 'memcached',
    name: 'Memcached',
    category: 'Cache / Key-Value',
    icon: '🧊',
    port: 11211,
    description: 'High-performance distributed memory object caching system.',
    config: null,
    logs: null,
  },
  {
    id: 'rabbitmq',
    formula: 'rabbitmq',
    name: 'RabbitMQ',
    category: 'Message Queue',
    icon: '🐰',
    port: 5672,
    description: 'Reliable, mature message broker supporting AMQP.',
    config: 'etc/rabbitmq/rabbitmq.conf',
    logs: 'var/log/rabbitmq',
  },
  {
    id: 'nginx',
    formula: 'nginx',
    name: 'NGINX',
    category: 'Web Server',
    icon: '🌐',
    port: 8080,
    description: 'High-performance HTTP server, reverse proxy and load balancer.',
    config: 'etc/nginx/nginx.conf',
    logs: 'var/log/nginx',
  },
  {
    id: 'httpd',
    formula: 'httpd',
    name: 'Apache HTTP',
    category: 'Web Server',
    icon: '🪶',
    port: 8080,
    description: 'The Apache HTTP Server project.',
    config: 'etc/httpd/httpd.conf',
    logs: 'var/log/httpd',
  },
  {
    id: 'elasticsearch',
    formula: 'elasticsearch',
    tap: 'elastic/tap',
    name: 'Elasticsearch',
    category: 'Search',
    icon: '🔎',
    port: 9200,
    description: 'Distributed, RESTful search and analytics engine.',
    config: 'etc/elasticsearch/elasticsearch.yml',
    logs: 'var/log/elasticsearch',
  },
];

const CATALOG_BY_FORMULA = new Map(CATALOG.map((c) => [c.formula, c]));

function prettyName(formula) {
  return formula
    .replace(/@.*/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

/**
 * Parse `brew services list --json` and merge with the catalog so the UI
 * receives a single, complete list of cards.
 */
async function listServices() {
  let installed = [];
  let brewAvailable = true;
  try {
    const { stdout } = await brew(['services', 'list', '--json']);
    installed = JSON.parse(stdout || '[]');
  } catch (err) {
    // brew might be missing, or `services` not yet bootstrapped.
    brewAvailable = false;
    installed = [];
  }

  const installedByName = new Map(installed.map((s) => [s.name, s]));
  const prefix = await brewPrefix();

  const result = [];

  // 1. Everything Homebrew knows about (installed + has a service).
  for (const svc of installed) {
    const meta = CATALOG_BY_FORMULA.get(svc.name) || {};
    result.push(buildEntry(svc.name, meta, svc, prefix, true));
  }

  // 2. Catalog entries that aren't installed yet (offer to install).
  for (const meta of CATALOG) {
    if (!installedByName.has(meta.formula)) {
      result.push(buildEntry(meta.formula, meta, null, prefix, false));
    }
  }

  result.sort((a, b) => {
    if (a.installed !== b.installed) return a.installed ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { brewAvailable, services: result };
}

function buildEntry(formula, meta, svc, prefix, installed) {
  const status = svc ? svc.status : 'not-installed';
  return {
    id: meta.id || formula,
    formula,
    name: meta.name || prettyName(formula),
    category: meta.category || 'Other',
    icon: meta.icon || '📦',
    port: meta.port || null,
    description: meta.description || 'Homebrew-managed service.',
    tap: meta.tap || null,
    installed,
    status, // started | stopped | none | error | not-installed | scheduled
    running: status === 'started',
    user: svc ? svc.user : null,
    plist: svc ? svc.file : null,
    exitCode: svc ? svc.exit_code : null,
    configPath: meta.config ? path.join(prefix, meta.config) : null,
    logsPath: meta.logs ? path.join(prefix, meta.logs) : null,
  };
}

async function controlService(action, formula) {
  if (!['start', 'stop', 'restart', 'run'].includes(action)) {
    throw new Error(`Unsupported action: ${action}`);
  }
  const { stdout, stderr } = await brew(['services', action, formula]);
  return { ok: true, output: (stdout + stderr).trim() };
}

async function installService(formula, tap) {
  if (tap) {
    await brew(['tap', tap], { timeout: 300000 });
  }
  const { stdout, stderr } = await brew(['install', formula], { timeout: 1800000 });
  return { ok: true, output: (stdout + stderr).trim() };
}

async function readConfig(filePath) {
  const stat = await fs.stat(filePath);
  if (stat.isDirectory()) {
    const entries = await fs.readdir(filePath);
    return {
      isDirectory: true,
      path: filePath,
      content: `# ${filePath}\n# This is a directory. Contents:\n\n` +
        entries.map((e) => `  - ${e}`).join('\n'),
      readOnly: true,
    };
  }
  const content = await fs.readFile(filePath, 'utf8');
  return { isDirectory: false, path: filePath, content, readOnly: false };
}

async function writeConfig(filePath, content) {
  // Keep a timestamped backup before overwriting.
  try {
    const backup = `${filePath}.infradock-bak`;
    await fs.copyFile(filePath, backup);
  } catch (_) {
    // best effort
  }
  await fs.writeFile(filePath, content, 'utf8');
  return { ok: true };
}

async function readLogs(logPath, maxBytes = 200 * 1024) {
  let target = logPath;
  const stat = await fs.stat(logPath);
  if (stat.isDirectory()) {
    // Pick the most recently modified log-like file in the directory.
    const entries = await fs.readdir(logPath);
    const candidates = [];
    for (const e of entries) {
      const full = path.join(logPath, e);
      try {
        const s = await fs.stat(full);
        if (s.isFile()) candidates.push({ full, mtime: s.mtimeMs });
      } catch (_) {}
    }
    if (!candidates.length) {
      return { path: logPath, content: '(no log files found in directory)' };
    }
    candidates.sort((a, b) => b.mtime - a.mtime);
    target = candidates[0].full;
  }

  const fh = await fs.open(target, 'r');
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - maxBytes);
    const length = size - start;
    const buf = Buffer.alloc(length);
    await fh.read(buf, 0, length, start);
    let text = buf.toString('utf8');
    if (start > 0) text = '\u2026 (truncated, showing last ' + Math.round(length / 1024) + ' KB)\n\n' + text;
    return { path: target, content: text || '(log file is empty)' };
  } finally {
    await fh.close();
  }
}

async function systemInfo() {
  const info = {
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    brewAvailable: false,
    brewVersion: null,
    brewPrefix: null,
  };
  try {
    const { stdout } = await brew(['--version']);
    info.brewAvailable = true;
    info.brewVersion = stdout.split('\n')[0].trim();
    info.brewPrefix = await brewPrefix();
  } catch (_) {}
  return info;
}

module.exports = {
  listServices,
  controlService,
  installService,
  readConfig,
  writeConfig,
  readLogs,
  systemInfo,
};
