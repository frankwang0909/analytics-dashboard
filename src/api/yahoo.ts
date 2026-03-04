/**
 * HTTP client for the local Express proxy server (server/index.ts).
 * The server fetches data from Yahoo Finance via yahoo-finance2.
 *
 * Set VITE_API_BASE in .env.local to point at the running server.
 * Without it the app falls back to built-in sample data automatically.
 */

const BASE = import.meta.env.VITE_API_BASE as string | undefined ?? 'http://localhost:3001';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `API ${res.status}: ${res.statusText}`,
    );
  }
  return res.json() as Promise<T>;
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Quote {
  symbol: string;
  name: string;
  price: number;
  changesPercentage: number; // 1-day % change
}

export interface PriceChange {
  symbol: string;
  ytd: number;
  '1Y': number;
  '6M': number;
  '3M': number;
  '1M': number;
  '5D': number;
  '1D': number;
}

export interface HistoricalDay {
  date: string;    // "YYYY-MM-DD"
  close: number;
  adjClose?: number;
}

export interface HistoricalResult {
  symbol: string;
  historical: HistoricalDay[];
}

// ── Endpoints ──────────────────────────────────────────────────────────────────

export const fetchBatchQuotes = (tickers: string[]): Promise<Quote[]> =>
  get(`/api/quotes?tickers=${tickers.join(',')}`);

export const fetchPriceChanges = (tickers: string[]): Promise<PriceChange[]> =>
  get(`/api/price-changes?tickers=${tickers.join(',')}`);

export const fetchHistoricalEOD = (
  ticker: string,
  from: string,
  to: string,
): Promise<HistoricalResult> =>
  get(`/api/history?ticker=${ticker}&from=${from}&to=${to}`);
