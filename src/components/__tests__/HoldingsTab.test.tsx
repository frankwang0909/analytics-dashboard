import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HoldingsTab from '../HoldingsTab';

// 8 holdings — 6 gainers (BND VTI IEFA MSFT GLD NVDA), 2 losers (VNQ AAPL).
const holdings = [
  { ticker: 'BND',  name: 'Vanguard Total Bond ETF',    weight: 22.0, return:  1.2, value: 106_788 },
  { ticker: 'VTI',  name: 'Vanguard Total Market ETF',  weight: 18.0, return:  7.2, value:  87_372 },
  { ticker: 'IEFA', name: 'iShares Core MSCI EAFE ETF', weight: 13.0, return:  3.5, value:  63_102 },
  { ticker: 'VNQ',  name: 'Vanguard Real Estate ETF',   weight: 12.0, return: -2.8, value:  58_248 },
  { ticker: 'AAPL', name: 'Apple Inc.',                 weight:  9.0, return: -6.3, value:  43_686 },
  { ticker: 'MSFT', name: 'Microsoft Corp.',            weight:  9.0, return: 11.2, value:  43_686 },
  { ticker: 'GLD',  name: 'SPDR Gold Shares',           weight:  9.0, return: 26.8, value:  43_686 },
  { ticker: 'NVDA', name: 'NVIDIA Corp.',               weight:  8.0, return: 28.4, value:  38_832 },
];

const getDataRows = () => screen.getAllByRole('row').slice(1); // skip header
const firstTicker = () => within(getDataRows()[0]).getAllByRole('cell')[0].textContent;

describe('HoldingsTab — filter', () => {
  it('renders all 8 holdings by default', () => {
    render(<HoldingsTab holdings={holdings} />);
    expect(getDataRows()).toHaveLength(8);
  });

  it('shows only gainers when Gainers filter is active', () => {
    render(<HoldingsTab holdings={holdings} />);
    userEvent.click(screen.getByRole('button', { name: 'Gainers' }));
    expect(getDataRows()).toHaveLength(6);
    expect(screen.queryByText('AAPL')).not.toBeInTheDocument();
    expect(screen.queryByText('VNQ')).not.toBeInTheDocument();
  });

  it('shows only losers when Losers filter is active', () => {
    render(<HoldingsTab holdings={holdings} />);
    userEvent.click(screen.getByRole('button', { name: 'Losers' }));
    expect(getDataRows()).toHaveLength(2);
    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText('VNQ')).toBeInTheDocument();
  });

  it('restores all rows when switching back to All', () => {
    render(<HoldingsTab holdings={holdings} />);
    userEvent.click(screen.getByRole('button', { name: 'Losers' }));
    userEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(getDataRows()).toHaveLength(8);
  });
});

describe('HoldingsTab — sort', () => {
  it('default sort is value descending — BND has highest value', () => {
    render(<HoldingsTab holdings={holdings} />);
    expect(firstTicker()).toBe('BND');
  });

  it('clicking Ticker sorts descending (↓) on first click', () => {
    render(<HoldingsTab holdings={holdings} />);
    const header = screen.getByRole('columnheader', { name: /ticker/i });
    userEvent.click(header);
    expect(header).toHaveTextContent('↓');
    expect(firstTicker()).toBe('VTI'); // last alphabetically
  });

  it('clicking Ticker twice reverses to ascending (↑)', () => {
    render(<HoldingsTab holdings={holdings} />);
    const header = screen.getByRole('columnheader', { name: /ticker/i });
    userEvent.click(header);
    userEvent.click(header);
    expect(header).toHaveTextContent('↑');
    expect(firstTicker()).toBe('AAPL'); // first alphabetically
  });

  it('clicking a different column resets direction to descending', () => {
    render(<HoldingsTab holdings={holdings} />);
    const tickerHeader = screen.getByRole('columnheader', { name: /ticker/i });
    userEvent.click(tickerHeader);
    userEvent.click(tickerHeader); // now asc

    const returnHeader = screen.getByRole('columnheader', { name: /return/i });
    userEvent.click(returnHeader); // new column → always starts desc
    expect(returnHeader).toHaveTextContent('↓');
    expect(firstTicker()).toBe('NVDA'); // highest return +28.4%
  });
});
