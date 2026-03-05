/**
 * Analytics Dashboard — Twelvedata proxy server
 *
 * Setup:
 *   cd server && npm install
 *   TWELVEDATA_API_KEY=your-key npm run dev   # starts on http://localhost:3001
 *
 * Endpoints:
 *   GET /api/quotes?tickers=BND,VTI,...
 *   GET /api/price-changes?tickers=BND,VTI,...
 *   GET /api/history?ticker=SPY&from=2024-12-01&to=2025-12-31
 */

import express from 'express';
import cors from 'cors';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = join(__dirname, 'cache.json');

const app    = express();
const PORT   = Number(process.env.PORT ?? 3001);
const TD_KEY = process.env.TWELVEDATA_API_KEY ?? '';
const TD_URL = 'https://api.twelvedata.com';

if (!TD_KEY) {
  console.warn('[warn] TWELVEDATA_API_KEY not set — API requests will fail');
}

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, Postman, same-origin SSR)
    if (!origin) return cb(null, true);
    if (/localhost/.test(origin) || /\.vercel\.app$/.test(origin)) return cb(null, true);
    cb(new Error(`CORS: blocked origin ${origin}`));
  },
}));

// ── In-memory cache ───────────────────────────────────────────────────────────

interface CacheEntry<T> { data: T; expiresAt: number }
const cache = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(key: string): T | undefined {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return undefined; }
  return entry.data;
}

function cacheSet<T>(key: string, data: T, ttlMs: number): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  if (isDiskKey(key)) scheduleSave();
}

loadDiskCache();

const TTL_QUOTES  = 5 * 60 * 1000;         // 5 minutes
const TTL_HISTORY = Number.MAX_SAFE_INTEGER; // never expires — use cache.json as source of truth

// ── Disk cache ────────────────────────────────────────────────────────────────
// Historical data (hist: / hist-pc: keys) is written to cache.json so it
// survives server restarts. Quotes are short-lived and stay in memory only.

const DISK_PREFIXES = ['hist:', 'hist-pc:'];
const isDiskKey = (key: string) => DISK_PREFIXES.some(p => key.startsWith(p));

function loadDiskCache(): void {
  if (!existsSync(CACHE_FILE)) return;
  try {
    const entries = JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as Array<[string, CacheEntry<unknown>]>;
    let loaded = 0;
    for (const [key, entry] of entries) {
      cache.set(key, entry); loaded++;
    }
    if (loaded > 0) console.log(`[startup] Loaded ${loaded} entries from disk cache (${CACHE_FILE})`);
  } catch (err) {
    console.warn('[startup] Could not load disk cache:', err);
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const entries = [...cache.entries()].filter(([k]) => isDiskKey(k));
      writeFileSync(CACHE_FILE, JSON.stringify(entries));
      console.log(`[cache] Saved ${entries.length} entries to disk`);
    } catch (err) {
      console.warn('[cache] Failed to write disk cache:', err);
    }
    saveTimer = null;
  }, 500); // debounce: wait for burst writes to settle
}

// ── Rate-limited request queue ────────────────────────────────────────────────
// Twelvedata free tier: 8 req/min → one call every 8 s stays safely under limit.

const INTER_REQUEST_DELAY    = 8_000;   // ms between consecutive Twelvedata calls
const RATE_LIMIT_RETRY_DELAY = 15_000;  // ms to wait after a 429
const MAX_RETRIES = 3;

async function tdCall<T>(fn: () => Promise<T>, ctx: string): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Too Many Requests') && attempt < MAX_RETRIES) {
        const wait = RATE_LIMIT_RETRY_DELAY * attempt;
        console.warn(`[${ts()}] rate-limit ${ctx} (attempt ${attempt}/${MAX_RETRIES}), waiting ${wait}ms…`);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
  throw new Error('unreachable');
}

class AsyncQueue {
  private pending: Array<() => Promise<void>> = [];
  private running = false;

  add<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.push(async () => {
        try { resolve(await fn()); }
        catch (err) { reject(err); }
      });
      void this.drain();
    });
  }

  private async drain() {
    if (this.running) return;
    this.running = true;
    while (this.pending.length > 0) {
      await this.pending.shift()!();
      if (this.pending.length > 0) await sleep(INTER_REQUEST_DELAY);
    }
    this.running = false;
  }
}

const tdQueue = new AsyncQueue();

// ── Request logger ────────────────────────────────────────────────────────────

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms  = Date.now() - start;
    const ok  = res.statusCode < 400;
    const sym = ok ? '→' : '✗';
    console.log(`[${ts()}] ${req.method} ${req.url} ${sym} ${res.statusCode} (${ms}ms)`);
  });
  next();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const ts    = () => new Date().toISOString();
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function logError(ctx: string, err: unknown) {
  const msg   = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? `\n${err.stack}` : '';
  console.error(`[${ts()}] ERROR ${ctx}: ${msg}${stack}`);
}

// ── Twelvedata fetch helper ───────────────────────────────────────────────────

type TDResponse = Record<string, unknown>;

async function tdFetch(path: string): Promise<TDResponse> {
  const url = `${TD_URL}${path}&apikey=${TD_KEY}`;
  const res = await fetch(url);
  if (res.status === 429) throw new Error('Too Many Requests');
  const json = await res.json() as TDResponse;
  if (json['status'] === 'error') {
    if (Number(json['code']) === 429) throw new Error('Too Many Requests');
    throw new Error(String(json['message'] ?? 'Twelvedata error'));
  }
  return json;
}

// ── Twelvedata response types ─────────────────────────────────────────────────

interface TDQuote {
  symbol:         string;
  name:           string;
  close:          string;  // current price as string
  percent_change: string;  // e.g. "-1.07"
  status?:        string;
}

interface TDBar {
  datetime: string;  // "YYYY-MM-DD"
  close:    string;
}

interface TDTimeSeries {
  values?: TDBar[];
}

// ── GET /api/quotes?tickers=BND,VTI,... ──────────────────────────────────────

app.get('/api/quotes', async (req, res) => {
  const tickers = String(req.query.tickers ?? '').split(',').filter(Boolean);
  if (tickers.length === 0) {
    res.status(400).json({ error: 'tickers query param required' });
    return;
  }

  const cacheKey = `quotes:${[...tickers].sort().join(',')}`;
  const cached = cacheGet<object[]>(cacheKey);
  if (cached) {
    console.log(`[${ts()}] quotes  → cache hit`);
    res.json(cached);
    return;
  }

  console.log(`[${ts()}] quotes  → ${tickers.join(', ')}`);
  try {
    const raw = await tdQueue.add(() =>
      tdCall(() => tdFetch(`/quote?symbol=${tickers.join(',')}&dp=2`), 'quotes')
    );

    // Single symbol → flat TDQuote. Multiple → { AAPL: TDQuote, MSFT: TDQuote, ... }
    const entries: TDQuote[] = tickers.length === 1
      ? [raw as unknown as TDQuote]
      : tickers.map(t => (raw as Record<string, TDQuote>)[t]).filter(q => q?.status !== 'error');

    const result = entries.map(q => ({
      symbol:            q.symbol,
      name:              q.name ?? q.symbol,
      price:             parseFloat(q.close ?? '0'),
      changesPercentage: parseFloat(q.percent_change ?? '0'),
    }));

    cacheSet(cacheKey, result, TTL_QUOTES);
    res.json(result);
  } catch (err) {
    logError('/api/quotes', err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /api/price-changes?tickers=BND,VTI,... ───────────────────────────────

app.get('/api/price-changes', async (req, res) => {
  const tickers = String(req.query.tickers ?? '').split(',').filter(Boolean);
  if (tickers.length === 0) {
    res.status(400).json({ error: 'tickers query param required' });
    return;
  }

  const cacheKey = `price-changes:${[...tickers].sort().join(',')}`;
  const cached = cacheGet<object[]>(cacheKey);
  if (cached) {
    console.log(`[${ts()}] price-changes → cache hit`);
    res.json(cached);
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const from  = new Date(Date.now() - 400 * 86_400_000).toISOString().split('T')[0];
  console.log(`[${ts()}] price-changes → ${tickers.join(', ')} (${from} ~ ${today})`);

  try {
    const results = await Promise.all(
      tickers.map(async ticker => {
        const histKey = `hist-pc:${ticker}:${from}:${today}`;
        let rows = cacheGet<Row[]>(histKey);
        if (!rows) {
          try {
            const data = await tdQueue.add(() =>
              tdCall(
                () => tdFetch(`/time_series?symbol=${ticker}&interval=1day&start_date=${from}&end_date=${today}&outputsize=500&dp=4`),
                ticker,
              )
            ) as TDTimeSeries;
            // Twelvedata returns newest-first → reverse to oldest-first
            rows = (data.values ?? []).reverse().map(b => ({
              date:  new Date(b.datetime + 'T12:00:00Z'),
              close: parseFloat(b.close),
            }));
            console.log(`[${ts()}]   ${ticker}: ${rows.length} bars`);
            cacheSet(histKey, rows, TTL_HISTORY);
          } catch (err) {
            logError(`price-changes[${ticker}]`, err);
            rows = [];
          }
        } else {
          console.log(`[${ts()}]   ${ticker}: cache hit`);
        }
        return computePriceChanges(ticker, rows);
      }),
    );

    cacheSet(cacheKey, results, TTL_QUOTES);
    res.json(results);
  } catch (err) {
    logError('/api/price-changes', err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /api/history?ticker=SPY&from=2024-12-01&to=2025-12-31 ────────────────

app.get('/api/history', async (req, res) => {
  const { ticker, from, to } = req.query as Record<string, string>;
  if (!ticker) {
    res.status(400).json({ error: 'ticker query param required' });
    return;
  }

  const cacheKey = `hist:${ticker}:${from}:${to}`;
  const cached = cacheGet<object>(cacheKey);
  if (cached) {
    console.log(`[${ts()}] history → ${ticker} cache hit`);
    res.json(cached);
    return;
  }

  console.log(`[${ts()}] history → ${ticker} (${from} ~ ${to})`);
  try {
    const data = await tdQueue.add(() =>
      tdCall(
        () => tdFetch(`/time_series?symbol=${ticker}&interval=1day&start_date=${from}&end_date=${to}&outputsize=500&dp=4`),
        ticker,
      )
    ) as TDTimeSeries;

    // Reverse to oldest-first
    const values = (data.values ?? []).reverse();
    console.log(`[${ts()}]   ${ticker}: ${values.length} bars`);

    const result = {
      symbol:     ticker,
      historical: values.map(b => ({
        date:  b.datetime,
        close: parseFloat(b.close),
      })),
    };

    cacheSet(cacheKey, result, TTL_HISTORY);
    res.json(result);
  } catch (err) {
    logError(`/api/history [${ticker}]`, err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[${ts()}] ✓ API server running at http://localhost:${PORT}`);
});

// ── Computation helpers ───────────────────────────────────────────────────────

type Row = { date: Date | string; close: number };

const emptyChange = (symbol: string) => ({
  symbol, ytd: 0, '1Y': 0, '6M': 0, '3M': 0, '1M': 0, '5D': 0, '1D': 0,
});

function computePriceChanges(ticker: string, rows: Row[]) {
  if (rows.length === 0) return emptyChange(ticker);

  // Normalize date: JSON deserialization turns Date objects into strings
  const normalized = rows.map(r => ({
    date:  r.date instanceof Date ? r.date : new Date(r.date as string),
    close: r.close,
  }));
  const sorted  = [...normalized].sort((a, b) => a.date.getTime() - b.date.getTime());
  const latest  = sorted[sorted.length - 1];
  const curYear = latest.date.getFullYear();

  const ytdBase = sorted.filter(r => r.date.getFullYear() < curYear).at(-1);
  const ytd     = ytdBase ? (latest.close / ytdBase.close - 1) * 100 : 0;

  const change = (days: number) => {
    const cutoff = latest.date.getTime() - days * 86_400_000;
    const base   = sorted.filter(r => r.date.getTime() <= cutoff).at(-1);
    return base ? (latest.close / base.close - 1) * 100 : 0;
  };

  const fmt = (n: number) => parseFloat(n.toFixed(2));
  return {
    symbol: ticker,
    ytd:  fmt(ytd),
    '1Y': fmt(change(365)),
    '6M': fmt(change(180)),
    '3M': fmt(change(90)),
    '1M': fmt(change(30)),
    '5D': fmt(change(5)),
    '1D': fmt(change(1)),
  };
}
