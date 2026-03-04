import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import type { PortfolioData } from "../hooks/usePortfolioData";

interface Props {
  riskMetrics: PortfolioData["riskMetrics"];
  summary: PortfolioData["summary"];
}

export default function RiskTab({ riskMetrics, summary }: Props) {
  // volatility === 0 means historical data was unavailable (premium-gated)
  const hasHistory = summary.volatility > 0;
  const na = "—";
  const positiveMonths = hasHistory ? Math.round(summary.winRate / 100 * 12) : null;
  const RISK_METRICS = [
    { label: "Annualized Volatility", value: hasHistory ? `${summary.volatility}%`  : na, note: "vs 18.4% S&P 500",           good: true  },
    { label: "Portfolio Beta",        value: hasHistory ? summary.beta               : na, note: "Below-market sensitivity",   good: true  },
    { label: "Sharpe Ratio",          value: hasHistory ? summary.sharpeRatio        : na, note: "vs ~0.18 S&P 500",           good: true  },
    { label: "Max Drawdown",          value: hasHistory ? `${summary.maxDrawdown}%`  : na, note: "Calendar year peak-to-trough", good: false },
    { label: "Win Rate (monthly)",    value: hasHistory ? `${summary.winRate}%`      : na, note: positiveMonths != null ? `${positiveMonths} of 12 months positive` : "Requires Yahoo Finance server", good: true  },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <h2 className="text-sm font-semibold text-gray-700 mb-1">Monthly Drawdown (%)</h2>
        <p className="text-xs text-gray-400 mb-4">
          {hasHistory
            ? `Max drawdown: ${summary.maxDrawdown}% (calendar year peak-to-trough)`
            : "Requires Yahoo Finance server for historical data"}
        </p>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={riskMetrics}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <ReferenceLine y={0} stroke="#9CA3AF" />
            <Bar dataKey="drawdown" name="Drawdown %" fill="#EF4444" radius={[0, 0, 4, 4]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Risk Summary</h2>
        <div className="space-y-4">
          {RISK_METRICS.map((m, i) => (
            <div key={i} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
              <div>
                <p className="text-sm font-medium text-gray-700">{m.label}</p>
                <p className="text-xs text-gray-400">{m.note}</p>
              </div>
              <span className={`text-lg font-bold ${m.good ? "text-emerald-600" : "text-red-500"}`}>
                {m.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
