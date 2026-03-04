/**
 * Analytics Dashboard — Yahoo Finance proxy server
 *
 * Setup:
 *   cd server && npm install
 *   npm run dev          # starts on http://localhost:3001 with hot-reload
 *
 * Endpoints:
 *   GET /api/quotes?tickers=BND,VTI,...
 *   GET /api/price-changes?tickers=BND,VTI,...
 *   GET /api/history?ticker=SPY&from=2024-12-01&to=2025-12-31
 */

import express from 'express';
import cors from 'cors';
import _YahooFinance from 'yahoo-finance2';

// v3 TypeScript types don't expose the constructor signature, but the runtime
// object IS a class. Cast via any to construct it, then re-cast to the proper
// type so method calls (quote, chart, …) are still fully typed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const yf = new (_YahooFinance as any)({ suppressNotices: ['yahooSurvey'] }) as typeof _YahooFinance;

const app  = express();
const PORT = Number(process.env.PORT ?? 3001);

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
}

const TTL_QUOTES  = 5  * 60 * 1000;       // 5 minutes
const TTL_HISTORY = 4  * 60 * 60 * 1000;  // 4 hours

// ── Global Yahoo Finance request queue ───────────────────────────────────────
// Serializes all yf calls with a delay to avoid rate limiting.

const INTER_REQUEST_DELAY  = 800;   // ms between consecutive Yahoo Finance calls
const RATE_LIMIT_RETRY_DELAY = 5_000; // ms to wait after a 429 before retrying
const MAX_RETRIES = 3;

async function yfCall<T>(fn: () => Promise<T>, ctx: string): Promise<T> {
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

const yfQueue = new AsyncQueue();

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
    const raw = await yfQueue.add(() => yfCall(() => yf.quote(tickers), 'quotes'));
    const arr = Array.isArray(raw) ? raw : [raw];
    const result = arr.map(q => ({
      symbol:            q.symbol,
      name:              q.longName ?? q.shortName ?? q.symbol,
      price:             q.regularMarketPrice         ?? 0,
      changesPercentage: q.regularMarketChangePercent ?? 0,
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
            type ChartResult = Awaited<ReturnType<typeof yf.chart>>;
            const chartResult = await yfQueue.add(() =>
              yfCall<ChartResult>(() => yf.chart(ticker, { period1: from, period2: today, interval: '1d' }), ticker)
            );
            rows = chartResult.quotes as Row[];
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
    type ChartResult = Awaited<ReturnType<typeof yf.chart>>;
    const chartResult = await yfQueue.add(() =>
      yfCall<ChartResult>(() => yf.chart(ticker, { period1: from, period2: to, interval: '1d' }), ticker)
    );
    const rows = chartResult.quotes;
    console.log(`[${ts()}]   ${ticker}: ${rows.length} bars`);
    const result = {
      symbol:     ticker,
      historical: rows.map((r: Row) => ({
        date:     r.date.toISOString().split('T')[0],
        close:    r.close,
        adjClose: r.adjclose ?? r.close,
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

// v3 chart() quotes shape
type Row = { date: Date; close: number; adjclose?: number | null };

const emptyChange = (symbol: string) => ({
  symbol, ytd: 0, '1Y': 0, '6M': 0, '3M': 0, '1M': 0, '5D': 0, '1D': 0,
});

function computePriceChanges(ticker: string, rows: Row[]) {
  if (rows.length === 0) return emptyChange(ticker);

  const sorted  = [...rows].sort((a, b) => a.date.getTime() - b.date.getTime());
  const price   = (r: Row) => r.adjclose ?? r.close;
  const latest  = sorted[sorted.length - 1];
  const curYear = latest.date.getFullYear();

  const ytdBase = sorted.filter(r => r.date.getFullYear() < curYear).at(-1);
  const ytd     = ytdBase ? (price(latest) / price(ytdBase) - 1) * 100 : 0;

  const change = (days: number) => {
    const cutoff = latest.date.getTime() - days * 86_400_000;
    const base   = sorted.filter(r => r.date.getTime() <= cutoff).at(-1);
    return base ? (price(latest) / price(base) - 1) * 100 : 0;
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
