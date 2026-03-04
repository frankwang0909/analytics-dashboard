import { render, screen } from '@testing-library/react';
import KPICard from '../KPICard';

describe('KPICard', () => {
  it('renders label and value', () => {
    render(<KPICard label="Total Value" value="$485,400" />);
    expect(screen.getByText('Total Value')).toBeInTheDocument();
    expect(screen.getByText('$485,400')).toBeInTheDocument();
  });

  it('renders sub text when provided', () => {
    render(<KPICard label="Total Value" value="$485,400" sub="As of Dec 2025" />);
    expect(screen.getByText('As of Dec 2025')).toBeInTheDocument();
  });

  it('does not render sub text when omitted', () => {
    render(<KPICard label="Total Value" value="$485,400" />);
    expect(screen.queryByText('As of Dec 2025')).not.toBeInTheDocument();
  });

  it('applies green color class when positive=true', () => {
    render(<KPICard label="Return" value="+7.9%" positive={true} />);
    expect(screen.getByText('+7.9%')).toHaveClass('text-emerald-600');
  });

  it('applies red color class when positive=false', () => {
    render(<KPICard label="Drawdown" value="-8.7%" positive={false} />);
    expect(screen.getByText('-8.7%')).toHaveClass('text-red-500');
  });

  it('applies neutral color class when positive is undefined', () => {
    render(<KPICard label="Beta" value="0.78" />);
    expect(screen.getByText('0.78')).toHaveClass('text-gray-800');
  });
});
