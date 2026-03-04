import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { usePortfolioData } from './hooks/usePortfolioData';

const mockData = {
  summary: {
    totalValue: 485_400, totalReturn: 35_400, returnRate: 7.9,
    sharpeRatio: 0.62, volatility: 14.2, beta: 0.78,
    maxDrawdown: -8.7, winRate: 75,
  },
  monthlyPerformance: [
    { month: 'Jan', portfolio: 459_900, sp500: 462_200, nasdaq: 473_400, dow: 456_800 },
  ],
  assetAllocation: [
    { name: 'US Equities', value: 44, color: '#3B82F6' },
  ],
  sectorPerformance: [
    { sector: 'Utilities', return: 10.2, weight: 7 },
  ],
  riskMetrics: [
    { month: 'Jan', drawdown: 0 },
  ],
  holdings: [
    { ticker: 'BND', name: 'Vanguard Total Bond ETF', weight: 22, value: 106_788, return: 1.2 },
  ],
};

vi.mock('./hooks/usePortfolioData', () => ({
  usePortfolioData: vi.fn(() => ({
    hasApiKey: true,
    isPending: false,
    isError:   false,
    data:      mockData,
    error:     null,
    refetch:   vi.fn(),
  })),
}));

global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function renderApp(initialPath = '/overview') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
    </MemoryRouter>
  );
}

describe('App', () => {
  it('renders the page header', () => {
    renderApp();
    expect(screen.getByText('Portfolio Analytics')).toBeInTheDocument();
  });

  it('renders all three nav links', () => {
    renderApp();
    expect(screen.getByRole('link', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Risk' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Holdings' })).toBeInTheDocument();
  });

  it('shows KPI cards after loading', () => {
    renderApp();
    expect(screen.getByText('Total Portfolio Value')).toBeInTheDocument();
    expect(screen.getByText('Total Return')).toBeInTheDocument();
    expect(screen.getByText('Sharpe Ratio')).toBeInTheDocument();
    expect(screen.getByText('Portfolio Beta')).toBeInTheDocument();
  });

  it('switches to Holdings tab on click', async () => {
    renderApp();
    userEvent.click(screen.getByRole('link', { name: 'Holdings' }));
    expect(await screen.findByText('Top Holdings')).toBeInTheDocument();
  });

  it('Overview link is active on /overview', () => {
    renderApp('/overview');
    const link = screen.getByRole('link', { name: 'Overview' });
    expect(link.className).toMatch(/bg-blue-600/);
  });

  it('shows no-api-key prompt when hasApiKey is false', () => {
    vi.mocked(usePortfolioData).mockReturnValueOnce({
      hasApiKey: false, isPending: false, isError: false,
      data: undefined, error: null, refetch: vi.fn(),
    });
    renderApp();
    expect(screen.getByText('Local server not running')).toBeInTheDocument();
  });
});
