#!/usr/bin/env node
// ollama-quota — Day/Month Ollama Cloud quota line for the Claude Code statusline.
// Appends one line after an existing statusline (e.g. claude-hud). Zero dependencies.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const SELF = fileURLToPath(import.meta.url);
const HOME = os.homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude');
const RUNTIME_DIR = path.join(CLAUDE_DIR, 'ollama-quota');
const RUNTIME_SELF = path.join(RUNTIME_DIR, 'ollama-quota.mjs');
const HUD_WRAPPER = path.join(RUNTIME_DIR, 'hud-statusline.sh');
const CACHE = process.env.OLLAMA_QUOTA_CACHE || path.join(RUNTIME_DIR, 'cache.json');
const LOCK = `${CACHE}.lock`;
const SETTINGS = path.join(CLAUDE_DIR, 'settings.json');

const DEFAULT_LOCAL_URL = 'http://127.0.0.1:11434';
const DAILY_LIMIT = positiveNumber(process.env.OLLAMA_QUOTA_DAILY_LIMIT, 5);
const REFRESH_MS = 60_000;
const STALE_MS = 5 * 60_000;
const LOCK_STALE_MS = 30_000;
const FETCH_TIMEOUT_MS = 3_000;
const CACHE_VERSION = 1;

// Same palette and thresholds as claude-hud's Usage limits (getQuotaColor).
const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  blue: '\x1b[94m',
  magenta: '\x1b[95m',
  red: '\x1b[31m',
};

// ── small helpers ────────────────────────────────────────────────────────────

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseTs(value) {
  if (typeof value === 'number') {
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value !== 'string' || !value.trim()) return NaN;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : NaN;
}

function localDayStart(now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function nextLocalMidnight(now = Date.now()) {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

function clampPct(pct) {
  return Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
}

function fmtUsd(n) {
  return `$${Number(n).toFixed(2)}`;
}

function fmtLimit(n) {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

function formatUntil(target, now) {
  const delta = target - now;
  if (!Number.isFinite(delta) || delta <= 0) return '';
  const totalMin = Math.floor(delta / 60_000);
  if (totalMin < 1) return '<1m';
  if (totalMin < 60) return `${totalMin}m`;
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return hours ? `${days}d ${hours}h` : `${days}d`;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function resetSuffix(target, now) {
  const left = formatUntil(target, now);
  return left ? `, resets in ${left}` : '';
}

function barParts(pct) {
  const p = clampPct(pct);
  const filled = Math.round(p / 10);
  return { filled, empty: 10 - filled, color: p >= 90 ? 'red' : p >= 75 ? 'magenta' : 'blue' };
}

function barPlain(pct) {
  const { filled, empty } = barParts(pct);
  return `${'█'.repeat(filled)}${'░'.repeat(empty)}`;
}

function barColored(pct) {
  const { filled, empty, color } = barParts(pct);
  return `${C[color]}${'█'.repeat(filled)}${C.dim}${'░'.repeat(empty)}${C.reset}`;
}

function pctColored(pct) {
  const p = clampPct(pct);
  const color = p >= 90 ? 'red' : p >= 75 ? 'magenta' : 'blue';
  return `${C[color]}${Math.round(p)}%${C.reset}`;
}

// ── data ─────────────────────────────────────────────────────────────────────

// Share of a bucket's usage that falls inside [winStart, winEnd].
// The last bucket is partial: its usage_usd only covers the elapsed part.
function bucketShareUsd(bucket, winStart, winEnd, asOf) {
  const from = parseTs(bucket?.from);
  const untilRaw = parseTs(bucket?.until);
  const usd = Number(bucket?.usage_usd);
  if (![from, untilRaw, asOf, usd].every(Number.isFinite)) return 0;

  const until = Math.min(untilRaw, asOf);
  const denom = until - from;
  if (denom <= 0) return 0;

  const overlap = Math.max(0, Math.min(until, winEnd) - Math.max(from, winStart));
  return usd * Math.min(1, overlap / denom);
}

function daySpendUsd(buckets, now, fetchedAt) {
  const start = localDayStart(now);
  const asOf = Math.min(now, fetchedAt);
  if (!Number.isFinite(asOf) || asOf <= start) return 0;
  return (buckets || []).reduce(
    (sum, bucket) => sum + bucketShareUsd(bucket, start, asOf, asOf),
    0,
  );
}

function monthProgress(balance) {
  const included = balance?.included;
  const allowance = Number(included?.allowance_usd);
  const balanceUsd = Number(included?.balance_usd);
  if (!Number.isFinite(allowance) || allowance < 0 || !Number.isFinite(balanceUsd)) {
    return null;
  }
  const purchased = Number(balance?.purchased?.balance_usd) || 0;
  const used = Math.max(0, allowance - balanceUsd);
  return {
    allowance,
    used,
    left: balanceUsd + purchased,
    pct: allowance > 0 ? Math.min(100, Math.max(0, (used / allowance) * 100)) : 0,
    resetAt: included?.period?.until ?? null,
  };
}

// ── endpoint resolution ─────────────────────────────────────────────────────

function parseHttpUrl(raw, fallbackScheme = 'http') {
  const value = String(raw || '').trim();
  if (!value) return null;
  try {
    const parsed = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `${fallbackScheme}://${value}`,
    );
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

function isOllamaHost(url) {
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  return host === 'ollama.com' || host.endsWith('.ollama.com') || url.port === '11434';
}

function isCloudHost(url) {
  const host = url?.hostname.toLowerCase();
  return host === 'ollama.com' || Boolean(host?.endsWith('.ollama.com'));
}

function connectableUrl(url) {
  if (url.hostname === '0.0.0.0' || url.hostname === '::' || url.hostname === '[::]') {
    const next = new URL(url.href);
    next.hostname = '127.0.0.1';
    return next;
  }
  return url;
}

function authTokenFor(url, env) {
  if (!isCloudHost(url)) return null;
  const token = String(env.OLLAMA_API_KEY || env.ANTHROPIC_AUTH_TOKEN || '').trim();
  return token && token !== 'ollama' ? token : null;
}

function resolveEndpoint(env = process.env) {
  const explicit = parseHttpUrl(env.OLLAMA_QUOTA_URL);
  if (explicit) {
    const url = connectableUrl(explicit);
    return {
      baseUrl: `${url.origin}${url.pathname}`.replace(/\/+$/, ''),
      token: authTokenFor(url, env),
      cloud: isCloudHost(url),
    };
  }

  const anthropic = parseHttpUrl(env.ANTHROPIC_BASE_URL);
  if (anthropic && isOllamaHost(anthropic)) {
    const url = connectableUrl(anthropic);
    return { baseUrl: url.origin, token: authTokenFor(url, env), cloud: isCloudHost(url) };
  }

  const ollamaHost = parseHttpUrl(env.OLLAMA_HOST);
  if (ollamaHost) {
    const url = connectableUrl(ollamaHost);
    return { baseUrl: url.origin, token: authTokenFor(url, env), cloud: isCloudHost(url) };
  }

  return { baseUrl: DEFAULT_LOCAL_URL, token: null, cloud: false };
}

// ── session detection ────────────────────────────────────────────────────────

function isOllamaSession(env = process.env) {
  if (String(env.OLLAMA_QUOTA_URL || '').trim()) return true;
  const base = parseHttpUrl(env.ANTHROPIC_BASE_URL);
  if (base && isOllamaHost(base)) return true;
  return String(env.ANTHROPIC_AUTH_TOKEN || '') === 'ollama';
}

function isDisabled(env = process.env) {
  const value = String(env.CLAUDE_HUD_DISABLE || '').trim().toLowerCase();
  return value !== '' && !['0', 'false', 'off', 'no'].includes(value);
}

// ── cache ────────────────────────────────────────────────────────────────────

function readCache() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    return parsed?.version === CACHE_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
}

function needsRefresh(cache, now = Date.now()) {
  if (!cache?.fetchedAt) return true;
  const fetched = parseTs(cache.fetchedAt);
  if (!Number.isFinite(fetched)) return true;
  if (now - fetched > REFRESH_MS) return true;
  // After midnight the cached buckets no longer describe "today".
  return fetched < localDayStart(now);
}

function inBackoff(cache, now = Date.now()) {
  const retryAt = parseTs(cache?.retryAt);
  return Number.isFinite(retryAt) && retryAt > now;
}

function lockFresh(now = Date.now()) {
  try {
    return now - fs.statSync(LOCK).mtimeMs < LOCK_STALE_MS;
  } catch {
    return false;
  }
}

function acquireLock() {
  fs.mkdirSync(path.dirname(LOCK), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(LOCK, 'wx', 0o600);
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return () => { try { fs.unlinkSync(LOCK); } catch { /* already gone */ } };
    } catch (err) {
      if (err.code !== 'EEXIST') return null;
      let age = Infinity;
      try { age = Date.now() - fs.statSync(LOCK).mtimeMs; } catch { /* raced away */ }
      if (age > LOCK_STALE_MS) {
        try { fs.unlinkSync(LOCK); } catch { /* raced away */ }
        continue;
      }
      return null;
    }
  }
  return null;
}

// ── fetch ────────────────────────────────────────────────────────────────────

async function getJson(pathname) {
  const endpoint = resolveEndpoint();
  if (endpoint.cloud && !endpoint.token) {
    throw Object.assign(new Error('OLLAMA_API_KEY is required for ollama.com'), { kind: 'auth' });
  }

  const headers = { accept: 'application/json' };
  if (endpoint.token) headers.authorization = `Bearer ${endpoint.token}`;

  const res = await fetch(`${endpoint.baseUrl}${pathname}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers,
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    const retryAfter = Number(res.headers.get('retry-after'));
    if (Number.isFinite(retryAfter)) {
      err.retryAfterMs = Math.min(900_000, Math.max(5_000, retryAfter * 1000));
    }
    throw err;
  }
  return res.json();
}

function classifyError(err) {
  if (err?.kind) return err.kind;
  if (err?.status === 401 || err?.status === 403) return 'auth';
  if (err?.status === 429) return 'rate_limit';
  if (err?.status) return 'http';
  return 'offline';
}

function validatePayloads(balance, usage) {
  const included = balance?.included;
  const allowance = Number(included?.allowance_usd);
  const remaining = Number(included?.balance_usd);
  if (!Number.isFinite(allowance) || allowance < 0 || !Number.isFinite(remaining)) {
    throw Object.assign(new Error('unsupported balance format'), { kind: 'invalid' });
  }
  if (!Array.isArray(usage?.buckets)) {
    throw Object.assign(new Error('invalid usage response'), { kind: 'invalid' });
  }
}

async function refresh({ force = false, quiet = false } = {}) {
  const release = acquireLock();
  if (!release) return { ok: false, skipped: true, kind: 'busy' };

  try {
    const now = Date.now();
    const prev = readCache();
    if (!force && !needsRefresh(prev, now)) {
      return { ok: true, skipped: true, cache: prev };
    }
    if (!force && inBackoff(prev, now)) {
      return { ok: false, skipped: true, kind: prev?.error?.kind || 'backoff', cache: prev };
    }

    try {
      const [balance, usage] = await Promise.all([
        getJson('/api/balance'),
        getJson('/api/usage?range=24h'),
      ]);
      validatePayloads(balance, usage);

      const next = {
        version: CACHE_VERSION,
        fetchedAt: new Date(now).toISOString(),
        lastAttemptAt: new Date(now).toISOString(),
        error: null,
        retryAt: null,
        failures: 0,
        balance,
        usage,
      };
      writeJsonAtomic(CACHE, next);

      if (!quiet) {
        const today = daySpendUsd(usage.buckets, now, now);
        const month = monthProgress(balance);
        console.log(
          `refresh ok: allowance=${fmtUsd(month?.allowance ?? 0)} `
          + `balance=${fmtUsd(month?.left ?? 0)} today=${fmtUsd(today)}`,
        );
      }
      return { ok: true, cache: next };
    } catch (err) {
      const kind = classifyError(err);
      const failures = (prev?.failures || 0) + 1;
      const backoff = Math.min(60_000 * 2 ** (failures - 1), 900_000);
      const retryMs = kind === 'rate_limit' && err.retryAfterMs ? err.retryAfterMs : backoff;
      const failed = {
        ...(prev || { version: CACHE_VERSION }),
        lastAttemptAt: new Date(now).toISOString(),
        error: {
          kind,
          message: err instanceof Error ? err.message : 'unknown error',
          at: new Date(now).toISOString(),
        },
        retryAt: new Date(now + retryMs).toISOString(),
        failures,
      };
      writeJsonAtomic(CACHE, failed);
      if (!quiet) console.error(`refresh failed (${kind}): ${failed.error.message}`);
      return { ok: false, kind, cache: failed };
    }
  } finally {
    release();
  }
}

// ── render ───────────────────────────────────────────────────────────────────

function errorLabel(kind) {
  switch (kind) {
    case 'offline': return 'offline';
    case 'auth': return 'sign-in required';
    case 'rate_limit': return 'rate limited';
    case 'invalid': return 'unsupported balance';
    case 'http': return 'error';
    default: return kind || 'error';
  }
}

function renderLine(cache, now = Date.now()) {
  const limit = DAILY_LIMIT;
  const fetched = parseTs(cache?.fetchedAt);
  const buckets = cache?.usage?.buckets;

  let daySpent = null;
  let dayPct = null;
  if (Array.isArray(buckets) && Number.isFinite(fetched)) {
    daySpent = daySpendUsd(buckets, now, fetched);
    dayPct = Math.min(100, Math.max(0, (daySpent / limit) * 100));
  }

  const month = monthProgress(cache?.balance);
  const monthReset = month?.resetAt ? parseTs(month.resetAt) : NaN;

  const dayPart = daySpent === null
    ? `${C.dim}Day${C.reset} ${C.dim}${'░'.repeat(10)} —${C.reset} (${fmtLimit(limit)})`
    : `${C.dim}Day${C.reset} ${barColored(dayPct)} ${pctColored(dayPct)} `
      + `(${fmtUsd(daySpent)}/${fmtLimit(limit)}${resetSuffix(nextLocalMidnight(now), now)})`;

  const monthPart = month === null
    ? `${C.dim}Month${C.reset} ${C.dim}${'░'.repeat(10)} —${C.reset}`
    : `${C.dim}Month${C.reset} ${barColored(month.pct)} ${pctColored(month.pct)} `
      + `(${fmtUsd(month.left)} left${resetSuffix(monthReset, now)})`;

  let suffix = '';
  if (cache?.error?.kind) {
    suffix = ` ${C.dim}· ${errorLabel(cache.error.kind)}${C.reset}`;
  } else if (!cache) {
    suffix = ` ${C.dim}· no data${C.reset}`;
  } else if (Number.isFinite(fetched) && now - fetched > STALE_MS) {
    suffix = ` ${C.dim}· stale${C.reset}`;
  }

  return `${dayPart} ${C.dim}│${C.reset} ${monthPart}${suffix}`;
}

function render() {
  process.stdout.on('error', () => { /* statusline closed early */ });
  if (isDisabled() || !isOllamaSession()) return;

  const now = Date.now();
  const cache = readCache();
  maybeSpawnRefresh(cache, now);
  process.stdout.write(`${renderLine(cache, now)}\n`);
}

function maybeSpawnRefresh(cache, now) {
  if (!needsRefresh(cache, now) || inBackoff(cache, now) || lockFresh(now)) return;
  try {
    const child = spawn(process.execPath, [SELF, 'refresh', '--quiet'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {
    // statusline must never fail because refresh could not start
  }
}

// ── install ──────────────────────────────────────────────────────────────────

function shQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
  } catch {
    return {};
  }
}

function isOurCommand(command) {
  return typeof command === 'string'
    && command.includes('ollama-quota.mjs')
    && command.includes('render');
}

function resolveNodeBin() {
  const candidates = [
    process.env.NODE_BIN,
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
    process.execPath,
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // try the next stable path
    }
  }
  return process.execPath;
}

function buildCommand(includeWrapper) {
  const parts = [];
  if (includeWrapper) {
    parts.push(`/bin/bash ${shQuote(HUD_WRAPPER)}`);
  }
  parts.push(`exec ${shQuote(resolveNodeBin())} ${shQuote(RUNTIME_SELF)} render`);
  return parts.join('; ');
}

async function install({ dryRun = false } = {}) {
  const settings = readSettings();
  const current = settings?.statusLine?.command || '';
  const currentIsOurs = isOurCommand(current);
  const willWrap = Boolean(current) && !currentIsOurs;
  const includeWrapper = willWrap || (currentIsOurs && fs.existsSync(HUD_WRAPPER));
  const command = buildCommand(includeWrapper);
  const changed = current !== command;

  if (dryRun) {
    console.log(`dry-run: runtime -> ${RUNTIME_SELF}`);
    console.log(`dry-run: wrap existing statusline: ${willWrap ? 'yes' : 'no'}`);
    console.log(`dry-run: statusLine change: ${changed ? 'yes' : 'no'}`);
    return;
  }

  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  if (path.resolve(SELF) !== path.resolve(RUNTIME_SELF)) {
    fs.copyFileSync(SELF, RUNTIME_SELF);
  }
  fs.chmodSync(RUNTIME_SELF, 0o755);

  if (willWrap) {
    fs.writeFileSync(HUD_WRAPPER, `${current}\n`, { mode: 0o600 });
    try { fs.chmodSync(HUD_WRAPPER, 0o600); } catch { /* best effort */ }
  }

  if (changed) {
    if (fs.existsSync(SETTINGS)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backup = `${SETTINGS}.bak.${stamp}`;
      fs.copyFileSync(SETTINGS, backup);
      try { fs.chmodSync(backup, 0o600); } catch { /* best effort */ }
    }
    settings.statusLine = { type: 'command', command };
    writeJsonAtomic(SETTINGS, settings);
  }

  console.log(`install: runtime ${RUNTIME_SELF}`);
  console.log(`install: wrapped existing statusline: ${willWrap ? 'yes' : 'no'}`);
  console.log(`install: settings ${changed ? 'updated' : 'unchanged'}`);
  await refresh({ force: true });
  console.log('install: restart Claude Code to load the new statusline');
}

// ── selftest ─────────────────────────────────────────────────────────────────

function selftest() {
  assert.equal(fmtUsd(23.35948), '$23.36');
  assert.equal(fmtLimit(10), '$10');
  assert.equal(barPlain(0), '░'.repeat(10));
  assert.deepEqual(barParts(49.9), { filled: 5, empty: 5, color: 'blue' });
  assert.deepEqual(barParts(75), { filled: 8, empty: 2, color: 'magenta' });
  assert.deepEqual(barParts(90), { filled: 9, empty: 1, color: 'red' });
  assert.deepEqual(barParts(100), { filled: 10, empty: 0, color: 'red' });

  const month = monthProgress({
    included: { allowance_usd: 60, balance_usd: 23.35948, period: { until: '2026-12-20T06:58:30Z' } },
    purchased: { balance_usd: 5 },
  });
  assert.equal(month.used.toFixed(2), '36.64');
  assert.equal(month.left.toFixed(2), '28.36');
  assert.equal(Math.round(month.pct), 61);

  const dayStart = localDayStart(Date.now());
  const now = dayStart + 4 * 3600_000;

  // Completed bucket crossing local midnight: only the part after midnight counts.
  assert.equal(
    bucketShareUsd(
      { from: new Date(dayStart - 30 * 60_000).toISOString(), until: new Date(dayStart + 30 * 60_000).toISOString(), usage_usd: 1 },
      dayStart,
      dayStart + 30 * 60_000,
      dayStart + 30 * 60_000,
    ),
    0.5,
  );

  // Partial bucket: all usage accrued so far belongs to the day.
  assert.equal(
    bucketShareUsd(
      { from: new Date(dayStart).toISOString(), until: new Date(dayStart + 3600_000).toISOString(), usage_usd: 0.6 },
      dayStart,
      dayStart + 30 * 60_000,
      dayStart + 30 * 60_000,
    ),
    0.6,
  );

  assert.equal(
    daySpendUsd(
      [{ from: new Date(dayStart).toISOString(), until: new Date(dayStart + 3600_000).toISOString(), usage_usd: 2 }],
      now,
      now - 30_000,
    ),
    2,
  );

  assert.equal(formatUntil(now + 2 * 3600_000 + 45 * 60_000, now), '2h 45m');
  assert.equal(formatUntil(now + 25 * 86400_000, now), '25d');

  assert.equal(isOllamaSession({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:11434' }), true);
  assert.equal(isOllamaSession({ ANTHROPIC_BASE_URL: 'https://ollama.com' }), true);
  assert.equal(isOllamaSession({ ANTHROPIC_AUTH_TOKEN: 'ollama' }), true);
  assert.equal(isOllamaSession({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }), false);
  assert.equal(isOllamaSession({ ANTHROPIC_BASE_URL: 'http://192.168.1.5:11434' }), true);
  assert.equal(isOllamaSession({ OLLAMA_QUOTA_URL: 'http://127.0.0.1:11434' }), true);

  assert.equal(
    resolveEndpoint({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:11434' }).baseUrl,
    'http://127.0.0.1:11434',
  );
  assert.equal(resolveEndpoint({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:11434' }).token, null);
  assert.equal(
    resolveEndpoint({ ANTHROPIC_BASE_URL: 'https://ollama.com/v1', ANTHROPIC_AUTH_TOKEN: 'abc' }).baseUrl,
    'https://ollama.com',
  );
  assert.equal(
    resolveEndpoint({ ANTHROPIC_BASE_URL: 'https://ollama.com/v1', ANTHROPIC_AUTH_TOKEN: 'abc' }).token,
    'abc',
  );
  assert.equal(
    resolveEndpoint({ ANTHROPIC_BASE_URL: 'https://ollama.com', ANTHROPIC_AUTH_TOKEN: 'ollama' }).token,
    null,
  );
  assert.equal(
    resolveEndpoint({ OLLAMA_QUOTA_URL: 'http://0.0.0.0:11434' }).baseUrl,
    'http://127.0.0.1:11434',
  );
  assert.equal(
    resolveEndpoint({ OLLAMA_QUOTA_URL: 'http://127.0.0.1:11434/ollama/' }).baseUrl,
    'http://127.0.0.1:11434/ollama',
  );
  assert.equal(
    resolveEndpoint({ OLLAMA_HOST: '0.0.0.0:11434' }).baseUrl,
    'http://127.0.0.1:11434',
  );
  assert.equal(
    resolveEndpoint({ OLLAMA_QUOTA_URL: 'https://ollama.com', OLLAMA_API_KEY: 'key' }).token,
    'key',
  );

  const line = renderLine({
    version: CACHE_VERSION,
    fetchedAt: new Date(now - 30_000).toISOString(),
    error: null,
    usage: {
      buckets: [{
        from: new Date(dayStart).toISOString(),
        until: new Date(dayStart + 3600_000).toISOString(),
        usage_usd: 2,
      }],
    },
    balance: {
      included: { allowance_usd: 60, balance_usd: 23.35948, period: { until: new Date(now + 25 * 86400_000).toISOString() } },
      purchased: { balance_usd: 0 },
    },
  }, now);
  assert.match(line, /Day/);
  assert.match(line, /\$2\.00\/\$5/);
  assert.match(line, /61%/);
  assert.match(line, /\$23\.36 left/);
  assert.match(line, /resets in/);

  assert.equal(errorLabel('auth'), 'sign-in required');
  console.log('selftest ok');
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const mode = process.argv[2] || 'render';
  const force = process.argv.includes('--force');
  const quiet = process.argv.includes('--quiet');
  const dryRun = process.argv.includes('--dry-run');

  if (mode === 'render') return render();
  if (mode === 'refresh') return refresh({ force, quiet });
  if (mode === 'install') return install({ dryRun });
  if (mode === 'selftest') return selftest();

  console.error(`unknown mode: ${mode}`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(`ollama-quota: ${err instanceof Error ? err.message : 'unknown error'}`);
  process.exitCode = 1;
});
