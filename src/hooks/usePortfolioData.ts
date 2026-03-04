import { useQuery, useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  fetchBatchQuotes,
  fetchPriceChanges,
  fetchHistoricalEOD,
  type Quote,
  type PriceChange,
  type HistoricalDay,
} from '../api/yahoo';

// ── Static portfolio configuration ───────────────────────────────────────────

const HOLDINGS_CONFIG = [
  { ticker: 'BND',  name: 'Vanguard Total Bond ETF',    weight: 22.0, assetClass: 'Fixed Income'    },
  { ticker: 'VTI',  name: 'Vanguard Total Market ETF',  weight: 18.0, assetClass: 'US Equities'     },
  { ticker: 'IEFA', name: 'iShares Core MSCI EAFE ETF', weight: 13.0, assetClass: "Int'l Equities"  },
  { ticker: 'VNQ',  name: 'Vanguard Real Estate ETF',   weight: 12.0, assetClass: 'Real Estate'     },
  { ticker: 'AAPL', name: 'Apple Inc.',                 weight:  9.0, assetClass: 'US Equities'     },
  { ticker: 'MSFT', name: 'Microsoft Corp.',            weight:  9.0, assetClass: 'US Equities'     },
  { ticker: 'GLD',  name: 'SPDR Gold Shares',           weight:  9.0, assetClass: 'Commodities'     },
  { ticker: 'NVDA', name: 'NVIDIA Corp.',               weight:  8.0, assetClass: 'US Equities'     },
] as const;

// S&P 500 sector proxy ETFs for the sector performance chart
const SECTOR_ETFS = [
  { ticker: 'XLK',  sector: 'Technology',  weight: 22 },
  { ticker: 'XLF',  sector: 'Financials',  weight: 18 },
  { ticker: 'XLC',  sector: 'Comm. Svcs',  weight: 12 },
  { ticker: 'XLV',  sector: 'Healthcare',  weight: 15 },
  { ticker: 'XLI',  sector: 'Industrials', weight: 13 },
  { ticker: 'XLU',  sector: 'Utilities',   weight:  7 },
  { ticker: 'XLRE', sector: 'Real Estate', weight:  8 },
  { ticker: 'XLE',  sector: 'Energy',      weight:  5 },
] as const;

const BENCHMARKS = [
  { ticker: 'SPY', key: 'sp500'  as const },
  { ticker: 'QQQ', key: 'nasdaq' as const },
  { ticker: 'DIA', key: 'dow'    as const },
] as const;

const HOLDING_TICKERS = HOLDINGS_CONFIG.map(h => h.ticker) as unknown as string[];
const SECTOR_TICKERS  = SECTOR_ETFS.map(s => s.ticker)    as unknown as string[];
const INITIAL_INVESTMENT = 450_000;
const RISK_FREE_RATE = 4.5; // approximate 2025 T-bill rate (%)

const ASSET_CLASS_COLORS: Record<string, string> = {
  'US Equities':    '#3B82F6',
  'Fixed Income':   '#10B981',
  "Int'l Equities": '#6366F1',
  'Real Estate':    '#F59E0B',
  'Commodities':    '#EF4444',
};

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

// ── PortfolioData shape ────────────────────────────────────────────────────────

export interface PortfolioData {
  summary: {
    totalValue:  number;
    totalReturn: number;
    returnRate:  number;
    sharpeRatio: number;
    volatility:  number;
    beta:        number;
    maxDrawdown: number; // peak-to-trough %, negative (e.g. -8.7)
    winRate:     number; // % of positive months 0-100 (e.g. 75)
  };
  monthlyPerformance: {
    month:     string;
    portfolio: number;
    sp500:     number;
    nasdaq:    number;
    dow:       number;
  }[];
  assetAllocation:   { name: string; value: number; color: string }[];
  sectorPerformance: { sector: string; return: number; weight: number }[];
  riskMetrics:       { month: string; drawdown: number }[];
  holdings: {
    ticker: string;
    name:   string;
    weight: number;
    value:  number;
    return: number;
  }[];
}

// ── Transformation helpers ─────────────────────────────────────────────────────

function holdingsFromAPI(
  quotes:  Quote[],
  changes: PriceChange[],
): PortfolioData['holdings'] {
  const quoteMap  = new Map(quotes.map(q => [q.symbol, q]));
  const changeMap = new Map(changes.map(c => [c.symbol, c]));

  return HOLDINGS_CONFIG.map(cfg => {
    const ytd   = changeMap.get(cfg.ticker)?.ytd ?? 0;
    const value = Math.round(INITIAL_INVESTMENT * (cfg.weight / 100) * (1 + ytd / 100));
    return {
      ticker: cfg.ticker,
      name:   quoteMap.get(cfg.ticker)?.name ?? cfg.name,
      weight: cfg.weight,
      value,
      return: Math.round(ytd * 10) / 10,
    };
  });
}

/**
 * Converts Yahoo Finance daily EOD data into portfolio-equivalent monthly values starting
 * at INITIAL_INVESTMENT. Picks the last trading day of each month and uses
 * Dec of the prior year as the base (= 0 % YTD).
 */
function buildMonthlyValues(
  historical: HistoricalDay[],
  year: number,
): Partial<Record<string, number>> {
  const sorted = [...historical].sort((a, b) => a.date.localeCompare(b.date));
  const price  = (d: HistoricalDay) => d.adjClose ?? d.close;

  const baseClose = sorted.filter(d => d.date.startsWith(`${year - 1}-`)).at(-1);
  if (!baseClose) return {};
  const base = price(baseClose);

  const byMonth = new Map<string, HistoricalDay>();
  for (const day of sorted.filter(d => d.date.startsWith(`${year}-`))) {
    byMonth.set(day.date.slice(0, 7), day);
  }

  const result: Partial<Record<string, number>> = {};
  for (const [monthKey, day] of byMonth) {
    const idx = parseInt(monthKey.split('-')[1], 10) - 1;
    result[MONTH_LABELS[idx]] = Math.round(INITIAL_INVESTMENT * (price(day) / base));
  }
  return result;
}

/** Monthly USD contribution of a single holding (allocationUSD x relative return). */
function buildHoldingMonthlyValue(
  historical:    HistoricalDay[],
  allocationUSD: number,
  year:          number,
): Partial<Record<string, number>> {
  const sorted = [...historical].sort((a, b) => a.date.localeCompare(b.date));
  const price  = (d: HistoricalDay) => d.adjClose ?? d.close;

  const baseClose = sorted.filter(d => d.date.startsWith(`${year - 1}-`)).at(-1);
  if (!baseClose) return {};
  const base = price(baseClose);

  const byMonth = new Map<string, HistoricalDay>();
  for (const day of sorted.filter(d => d.date.startsWith(`${year}-`))) {
    byMonth.set(day.date.slice(0, 7), day);
  }

  const result: Partial<Record<string, number>> = {};
  for (const [monthKey, day] of byMonth) {
    const idx = parseInt(monthKey.split('-')[1], 10) - 1;
    result[MONTH_LABELS[idx]] = Math.round(allocationUSD * (price(day) / base));
  }
  return result;
}

/** Derives asset allocation from HOLDINGS_CONFIG weights — no API call needed. */
function buildAssetAllocation(): PortfolioData['assetAllocation'] {
  const groups = new Map<string, number>();
  for (const cfg of HOLDINGS_CONFIG) {
    groups.set(cfg.assetClass, (groups.get(cfg.assetClass) ?? 0) + cfg.weight);
  }
  return Array.from(groups.entries()).map(([name, value]) => ({
    name,
    value,
    color: ASSET_CLASS_COLORS[name] ?? '#9CA3AF',
  }));
}

/** Maps sector ETF YTD returns to sector performance rows. */
function buildSectorPerformance(changes: PriceChange[]): PortfolioData['sectorPerformance'] {
  const changeMap = new Map(changes.map(c => [c.symbol, c]));
  return [...SECTOR_ETFS]
    .map(({ ticker, sector, weight }) => ({
      sector,
      return: parseFloat((changeMap.get(ticker)?.ytd ?? 0).toFixed(1)),
      weight,
    }))
    .sort((a, b) => b.return - a.return);
}

/**
 * Computes risk metrics from monthly portfolio and SPY values.
 * Both maps use MONTH_LABELS as keys, normalised to INITIAL_INVESTMENT scale.
 * Uses monthly returns to compute annualised volatility, Sharpe, and beta.
 */
function computeRiskAndPerformance(
  portfolioMonthly: Partial<Record<string, number>>,
  spyMonthly:       Partial<Record<string, number>>,
): {
  riskMetrics: PortfolioData['riskMetrics'];
  volatility:  number;
  sharpe:      number;
  beta:        number;
  maxDrawdown: number;
  winRate:     number;
} {
  const months = MONTH_LABELS.filter(m => portfolioMonthly[m] != null && spyMonthly[m] != null);

  if (months.length < 2) {
    return {
      riskMetrics: MONTH_LABELS.map(m => ({ month: m, drawdown: 0 })),
      volatility: 0, sharpe: 0, beta: 0, maxDrawdown: 0, winRate: 0,
    };
  }

  const pValues = [INITIAL_INVESTMENT, ...months.map(m => portfolioMonthly[m]!)];
  const sValues = [INITIAL_INVESTMENT, ...months.map(m => spyMonthly[m]!)];

  const pReturns = pValues.slice(1).map((v, i) => v / pValues[i] - 1);
  const sReturns = sValues.slice(1).map((v, i) => v / sValues[i] - 1);

  const n     = pReturns.length;
  const pMean = pReturns.reduce((s, r) => s + r, 0) / n;
  const sMean = sReturns.reduce((s, r) => s + r, 0) / n;
  const pVar  = pReturns.reduce((s, r) => s + (r - pMean) ** 2, 0) / n;
  const sVar  = sReturns.reduce((s, r) => s + (r - sMean) ** 2, 0) / n;
  const cov   = pReturns.reduce((s, r, i) => s + (r - pMean) * (sReturns[i] - sMean), 0) / n;

  const volatility = parseFloat((Math.sqrt(pVar * 12) * 100).toFixed(1));
  const annReturn  = (pValues[pValues.length - 1] / INITIAL_INVESTMENT - 1) * 100;
  const sharpe     = volatility > 0 ? parseFloat(((annReturn - RISK_FREE_RATE) / volatility).toFixed(2)) : 0;
  const beta       = sVar > 0 ? parseFloat((cov / sVar).toFixed(2)) : 0;
  const winRate    = Math.round((pReturns.filter(r => r > 0).length / n) * 100);

  // Rolling peak drawdown from inception
  let peak = INITIAL_INVESTMENT;
  let maxDrawdown = 0;
  const riskMetrics = MONTH_LABELS.map(month => {
    const value = portfolioMonthly[month];
    if (value == null) return { month, drawdown: 0 };
    if (value > peak) peak = value;
    const dd = parseFloat(((value - peak) / peak * 100).toFixed(1));
    if (dd < maxDrawdown) maxDrawdown = dd;
    return { month, drawdown: dd };
  });

  return { riskMetrics, volatility, sharpe, beta, maxDrawdown: parseFloat(maxDrawdown.toFixed(1)), winRate };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function usePortfolioData() {
  const hasApiKey = !!import.meta.env.VITE_API_BASE;

  // 1. Holdings: current quotes + YTD returns (single round-trip via Promise.all)
  const holdingsQuery = useQuery({
    queryKey: ['portfolio', 'holdings'],
    enabled:  hasApiKey,
    queryFn:  async () => {
      const [quotes, changes] = await Promise.all([
        fetchBatchQuotes(HOLDING_TICKERS),
        fetchPriceChanges(HOLDING_TICKERS),
      ]);
      return { quotes, changes };
    },
    staleTime: 5 * 60 * 1000,
  });

  // 2. Sector ETF YTD returns — optional, degrades to empty if premium-gated
  const sectorQuery = useQuery({
    queryKey: ['portfolio', 'sectors'],
    enabled:  hasApiKey,
    retry:    0,
    queryFn:  () => fetchPriceChanges(SECTOR_TICKERS),
    staleTime: 5 * 60 * 1000,
  });

  // 3. Benchmark historical (SPY / QQQ / DIA) — optional, retry: 0 avoids wasting free-tier quota
  const benchmarkQueries = useQueries({
    queries: BENCHMARKS.map(({ ticker }) => ({
      queryKey: ['portfolio', 'benchmark', ticker, 2025],
      enabled:  hasApiKey,
      retry:    0,
      queryFn:  async () => {
        const result = await fetchHistoricalEOD(ticker, '2024-12-01', '2025-12-31');
        return buildMonthlyValues(result.historical, 2025);
      },
      staleTime: Infinity,
    })),
  });

  // 4. Per-holding historical — optional, needed for portfolio line + risk metrics
  const holdingHistoryQueries = useQueries({
    queries: HOLDINGS_CONFIG.map(({ ticker, weight }) => ({
      queryKey: ['portfolio', 'history', ticker, 2025],
      enabled:  hasApiKey,
      retry:    0,
      queryFn:  async () => {
        const result = await fetchHistoricalEOD(ticker, '2024-12-01', '2025-12-31');
        return buildHoldingMonthlyValue(result.historical, INITIAL_INVESTMENT * (weight / 100), 2025);
      },
      staleTime: Infinity,
    })),
  });

  const data = useMemo<PortfolioData | undefined>(() => {
    // Only holdingsQuery is required; all others degrade gracefully.
    if (!hasApiKey || !holdingsQuery.data) return undefined;

    const { quotes, changes } = holdingsQuery.data;
    const holdings    = holdingsFromAPI(quotes, changes);
    const totalValue  = holdings.reduce((sum, h) => sum + h.value, 0);
    const totalReturn = totalValue - INITIAL_INVESTMENT;
    const returnRate  = parseFloat(((totalReturn / INITIAL_INVESTMENT) * 100).toFixed(1));

    const assetAllocation   = buildAssetAllocation();
    const sectorPerformance = sectorQuery.data ? buildSectorPerformance(sectorQuery.data) : [];

    const [spyMap, qqqMap, diaMap] = benchmarkQueries.map(q => q.data ?? {});

    // Sum per-holding monthly contributions into portfolio monthly total
    const holdingMonthlies = holdingHistoryQueries.map(q => q.data ?? {});
    const portfolioMonthly: Partial<Record<string, number>> = {};
    for (const month of MONTH_LABELS) {
      const total = holdingMonthlies.reduce((sum, m) => sum + (m[month] ?? 0), 0);
      if (total > 0) portfolioMonthly[month] = Math.round(total);
    }

    const { riskMetrics, volatility, sharpe, beta, maxDrawdown, winRate } =
      computeRiskAndPerformance(portfolioMonthly, spyMap ?? {});

    const monthlyPerformance = MONTH_LABELS
      .filter(m => portfolioMonthly[m] != null || spyMap[m] != null)
      .map(month => ({
        month,
        portfolio: portfolioMonthly[month] ?? 0,
        sp500:     spyMap[month]  ?? 0,
        nasdaq:    qqqMap[month]  ?? 0,
        dow:       diaMap[month]  ?? 0,
      }));

    return {
      summary: {
        totalValue,
        totalReturn,
        returnRate,
        sharpeRatio: sharpe,
        volatility,
        beta,
        maxDrawdown,
        winRate,
      },
      monthlyPerformance,
      assetAllocation,
      sectorPerformance,
      riskMetrics,
      holdings,
    };
  }, [hasApiKey, holdingsQuery.data, sectorQuery.data, benchmarkQueries, holdingHistoryQueries]);

  // Only holdingsQuery is critical — app shows error if it fails.
  // Optional queries (sector, benchmarks, histories) are silently degraded:
  // errored optional queries are excluded from isPending so they don't block the UI.
  const isPending = hasApiKey && (
    holdingsQuery.isPending ||
    (!sectorQuery.isError && sectorQuery.isPending) ||
    benchmarkQueries.some(q => !q.isError && q.isPending)      ||
    holdingHistoryQueries.some(q => !q.isError && q.isPending)
  );

  const isError = hasApiKey && holdingsQuery.isError;
  const error: Error | null = isError ? holdingsQuery.error as Error | null : null;

  return {
    data,
    hasApiKey,
    isPending,
    isError,
    error,
    refetch: () => {
      holdingsQuery.refetch();
      sectorQuery.refetch();
      benchmarkQueries.forEach(q => q.refetch());
      holdingHistoryQueries.forEach(q => q.refetch());
    },
  };
}
