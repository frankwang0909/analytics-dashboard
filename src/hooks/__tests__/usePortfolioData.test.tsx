import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePortfolioData } from '../usePortfolioData';
import * as yahoo from '../../api/yahoo';

vi.mock('../../api/yahoo', () => ({
  fetchBatchQuotes:   vi.fn(),
  fetchPriceChanges:  vi.fn(),
  fetchHistoricalEOD: vi.fn(),
}));

const setApiKey = (key: string | undefined) => {
  vi.stubEnv('VITE_API_BASE', key ?? '');
};

const MOCK_QUOTES: yahoo.Quote[] = [
  { symbol: 'BND',  name: 'Vanguard Total Bond ETF',   price: 73.5,  changesPercentage: 0.1  },
  { symbol: 'VTI',  name: 'Vanguard Total Market ETF', price: 250.0, changesPercentage: 0.2  },
  { symbol: 'IEFA', name: 'iShares MSCI EAFE',         price: 72.0,  changesPercentage: 0.3  },
  { symbol: 'VNQ',  name: 'Vanguard Real Estate ETF',  price: 83.0,  changesPercentage: -0.1 },
  { symbol: 'AAPL', name: 'Apple Inc.',                price: 195.0, changesPercentage: -0.2 },
  { symbol: 'MSFT', name: 'Microsoft Corp.',           price: 415.0, changesPercentage:  0.5 },
  { symbol: 'GLD',  name: 'SPDR Gold Shares',          price: 234.0, changesPercentage:  0.8 },
  { symbol: 'NVDA', name: 'NVIDIA Corp.',              price: 880.0, changesPercentage:  1.2 },
];

const MOCK_CHANGES: yahoo.PriceChange[] = MOCK_QUOTES.map(q => ({
  symbol: q.symbol,
  ytd: q.symbol === 'AAPL' ? -6.3 : q.symbol === 'VNQ' ? -2.8 : 8.0,
  '1Y': 10, '6M': 5, '3M': 3, '1M': 1, '5D': 0.5, '1D': 0.1,
}));

const MOCK_SECTOR_CHANGES: yahoo.PriceChange[] = [
  { symbol: 'XLK',  ytd: 1.4,  '1Y': 10, '6M': 5, '3M': 3, '1M': 1, '5D': 0.5, '1D': 0.1 },
  { symbol: 'XLF',  ytd: 8.4,  '1Y': 10, '6M': 5, '3M': 3, '1M': 1, '5D': 0.5, '1D': 0.1 },
  { symbol: 'XLC',  ytd: 7.6,  '1Y': 10, '6M': 5, '3M': 3, '1M': 1, '5D': 0.5, '1D': 0.1 },
  { symbol: 'XLV',  ytd: 1.8,  '1Y': 10, '6M': 5, '3M': 3, '1M': 1, '5D': 0.5, '1D': 0.1 },
  { symbol: 'XLI',  ytd: 3.2,  '1Y': 10, '6M': 5, '3M': 3, '1M': 1, '5D': 0.5, '1D': 0.1 },
  { symbol: 'XLU',  ytd: 10.2, '1Y': 10, '6M': 5, '3M': 3, '1M': 1, '5D': 0.5, '1D': 0.1 },
  { symbol: 'XLRE', ytd: -2.1, '1Y': 10, '6M': 5, '3M': 3, '1M': 1, '5D': 0.5, '1D': 0.1 },
  { symbol: 'XLE',  ytd: -6.2, '1Y': 10, '6M': 5, '3M': 3, '1M': 1, '5D': 0.5, '1D': 0.1 },
];

// Single mock history works for all 11 calls (3 benchmarks + 8 holdings).
const MOCK_HISTORY: yahoo.HistoricalResult = {
  symbol: 'TEST',
  historical: [
    { date: '2024-12-31', close: 100 },
    { date: '2025-06-30', close: 103 },
    { date: '2025-12-31', close: 108 },
  ],
};

const SECTOR_TICKERS = ['XLK', 'XLF', 'XLC', 'XLV', 'XLI', 'XLU', 'XLRE', 'XLE'];

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

describe('usePortfolioData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setApiKey(undefined); // default: no API key
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('when no API key: hasApiKey false, isPending false, data undefined', () => {
    const { result } = renderHook(() => usePortfolioData(), { wrapper: createWrapper() });
    expect(result.current.hasApiKey).toBe(false);
    expect(result.current.isPending).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(yahoo.fetchBatchQuotes).not.toHaveBeenCalled();
  });

  it('starts in pending state when API key is configured', () => {
    setApiKey('test-key');
    vi.mocked(yahoo.fetchBatchQuotes).mockResolvedValue(MOCK_QUOTES);
    vi.mocked(yahoo.fetchPriceChanges).mockResolvedValue(MOCK_CHANGES);
    vi.mocked(yahoo.fetchHistoricalEOD).mockResolvedValue(MOCK_HISTORY);

    const { result } = renderHook(() => usePortfolioData(), { wrapper: createWrapper() });
    expect(result.current.isPending).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('resolves with live data when key is configured', async () => {
    setApiKey('test-key');
    vi.mocked(yahoo.fetchBatchQuotes).mockResolvedValue(MOCK_QUOTES);
    vi.mocked(yahoo.fetchPriceChanges).mockImplementation(async (tickers: string[]) =>
      tickers.some(t => SECTOR_TICKERS.includes(t)) ? MOCK_SECTOR_CHANGES : MOCK_CHANGES
    );
    vi.mocked(yahoo.fetchHistoricalEOD).mockResolvedValue(MOCK_HISTORY);

    const { result } = renderHook(() => usePortfolioData(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isPending).toBe(false));

    expect(result.current.data).toBeDefined();
    expect(result.current.isError).toBe(false);
    expect(yahoo.fetchBatchQuotes).toHaveBeenCalledOnce();
    // 2 calls: holdings tickers + sector ETF tickers
    expect(yahoo.fetchPriceChanges).toHaveBeenCalledTimes(2);
    // 3 benchmarks + 8 holdings = 11 history calls
    expect(yahoo.fetchHistoricalEOD).toHaveBeenCalledTimes(11);
  });

  it('surfaces an error when the API call fails', async () => {
    setApiKey('bad-key');
    vi.mocked(yahoo.fetchBatchQuotes).mockRejectedValue(new Error('401 Unauthorized'));
    vi.mocked(yahoo.fetchPriceChanges).mockRejectedValue(new Error('401 Unauthorized'));
    vi.mocked(yahoo.fetchHistoricalEOD).mockRejectedValue(new Error('401 Unauthorized'));

    const { result } = renderHook(() => usePortfolioData(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isPending).toBe(false));

    expect(result.current.isError).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('derives totalValue from holdings YTD returns', async () => {
    setApiKey('test-key');
    vi.mocked(yahoo.fetchBatchQuotes).mockResolvedValue(MOCK_QUOTES);
    vi.mocked(yahoo.fetchPriceChanges).mockImplementation(async (tickers: string[]) =>
      tickers.some(t => SECTOR_TICKERS.includes(t)) ? MOCK_SECTOR_CHANGES : MOCK_CHANGES
    );
    vi.mocked(yahoo.fetchHistoricalEOD).mockResolvedValue(MOCK_HISTORY);

    const { result } = renderHook(() => usePortfolioData(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined());

    const { summary, holdings } = result.current.data!;
    const expectedTotal = holdings.reduce((sum, h) => sum + h.value, 0);
    expect(summary.totalValue).toBe(expectedTotal);
    expect(summary.totalReturn).toBe(expectedTotal - 450_000);
  });
});
