import { useState, useMemo } from "react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import type { PortfolioData } from "../hooks/usePortfolioData";

type SectorFilter = "all" | "gainers" | "losers";
const SECTOR_FILTERS: SectorFilter[] = ["all", "gainers", "losers"];

interface Props {
  monthlyPerformance: PortfolioData["monthlyPerformance"];
  assetAllocation: PortfolioData["assetAllocation"];
  sectorPerformance: PortfolioData["sectorPerformance"];
}

// Jan 1 2025 starting value — used to normalize all series to % return.
const BASE_VALUE = 450_000;

interface LineConfig {
  key: string;
  label: string;
  color: string;
  strokeWidth: number;
  dashed: boolean;
}

const ALL_LINES: LineConfig[] = [
  { key: "portfolio", label: "Portfolio",  color: "#3B82F6", strokeWidth: 2.5, dashed: false },
  { key: "sp500",     label: "S&P 500",    color: "#6B7280", strokeWidth: 1.5, dashed: true  },
  { key: "nasdaq",    label: "NASDAQ",     color: "#8B5CF6", strokeWidth: 1.5, dashed: true  },
  { key: "dow",       label: "Dow Jones",  color: "#F59E0B", strokeWidth: 1.5, dashed: true  },
];

const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

export default function OverviewTab({ monthlyPerformance, assetAllocation, sectorPerformance }: Props) {
  const [sectorFilter, setSectorFilter] = useState<SectorFilter>("all");
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  // Convert absolute values → % return from start so all series share the same scale.
  // Values of 0 mean the data point is unavailable (premium-gated) — map to null so
  // Recharts renders a gap instead of a misleading -100% value.
  const norm = (v: number) => v > 0 ? +((v / BASE_VALUE - 1) * 100).toFixed(2) : null;
  const normalizedData = useMemo(
    () =>
      monthlyPerformance.map((d) => ({
        month:     d.month,
        portfolio: norm(d.portfolio),
        sp500:     norm(d.sp500),
        nasdaq:    norm(d.nasdaq),
        dow:       norm(d.dow),
      })),
    [monthlyPerformance]
  );

  const hasPortfolioData = normalizedData.some(d => d.portfolio != null);
  const hasBenchmarkData = normalizedData.some(d => d.sp500 != null);

  const filteredSectors = useMemo(() => {
    if (sectorFilter === "gainers") return sectorPerformance.filter((s) => s.return > 0);
    if (sectorFilter === "losers")  return sectorPerformance.filter((s) => s.return < 0);
    return sectorPerformance;
  }, [sectorFilter, sectorPerformance]);

  const sectorDomain = useMemo((): [number, number] => {
    if (filteredSectors.length === 0) return [-5, 5];
    const values = filteredSectors.map((s) => s.return);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = Math.max(Math.abs(max - min) * 0.15, 0.5);
    if (sectorFilter === 'gainers') return [0, parseFloat((max + pad).toFixed(1))];
    if (sectorFilter === 'losers')  return [parseFloat((min - pad).toFixed(1)), 0];
    return [
      parseFloat((Math.min(min, 0) - pad).toFixed(1)),
      parseFloat((Math.max(max, 0) + pad).toFixed(1)),
    ];
  }, [filteredSectors, sectorFilter]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* ── Performance Chart ─────────────────────────────── */}
      <div className="lg:col-span-2 bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700">Portfolio vs Benchmarks (YTD 2025)</h2>
          {!hasPortfolioData && hasBenchmarkData && (
            <span className="text-xs text-amber-500 bg-amber-50 px-2 py-0.5 rounded-full">
              Portfolio history requires Twelvedata server
            </span>
          )}
        </div>

        {!hasBenchmarkData ? (
          <div className="flex items-center justify-center h-64 text-sm text-gray-400">
            Historical data requires Twelvedata server
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={270}>
            <LineChart data={normalizedData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis
                tickFormatter={pct}
                tick={{ fontSize: 12 }}
                width={58}
              />
              <Tooltip
                formatter={(value, key) => [
                  value != null ? pct(value as number) : "—",
                  ALL_LINES.find((l) => l.key === key)?.label ?? String(key ?? ""),
                ]}
              />
              <ReferenceLine y={0} stroke="#D1D5DB" strokeDasharray="3 3" />

              {ALL_LINES
                .filter(({ key }) => key !== "portfolio" || hasPortfolioData)
                .map(({ key, color, strokeWidth, dashed }) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stroke={color}
                    strokeWidth={strokeWidth}
                    dot={false}
                    connectNulls={false}
                    strokeDasharray={dashed ? "5 4" : undefined}
                    hide={hidden.has(key)}
                    legendType="none"
                  />
                ))}
            </LineChart>
          </ResponsiveContainer>
        )}

        {/* Clickable custom legend */}
        <div className="flex flex-wrap justify-center gap-5 mt-3">
          {ALL_LINES
            .filter(({ key }) => key !== "portfolio" || hasPortfolioData)
            .map(({ key, label, color, dashed }) => (
              <button
                key={key}
                onClick={() => toggle(key)}
                className={`flex items-center gap-1.5 text-xs select-none transition-opacity ${
                  hidden.has(key) ? "opacity-30" : "opacity-100"
                }`}
              >
                <svg width="22" height="10" className="flex-shrink-0">
                  <line
                    x1="1" y1="5" x2="21" y2="5"
                    stroke={color}
                    strokeWidth={key === "portfolio" ? 2.5 : 1.5}
                    strokeDasharray={dashed ? "5 4" : undefined}
                  />
                </svg>
                <span className="text-gray-600">{label}</span>
              </button>
            ))}
        </div>
      </div>

      {/* ── Asset Allocation Pie ───────────────────────────── */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Asset Allocation</h2>
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie
              data={assetAllocation}
              cx="50%" cy="50%"
              innerRadius={55} outerRadius={85}
              dataKey="value"
              paddingAngle={2}
            >
              {assetAllocation.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip formatter={(v) => `${v}%`} />
          </PieChart>
        </ResponsiveContainer>
        <div className="grid grid-cols-2 gap-1 mt-2">
          {assetAllocation.map((a, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs text-gray-600">
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: a.color }}
              />
              {a.name} ({a.value}%)
            </div>
          ))}
        </div>
      </div>

      {/* ── Sector Performance Bar ────────────────────────── */}
      <div className="lg:col-span-3 bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700">Sector Performance (%)</h2>
          {sectorPerformance.length > 0 && (
            <div className="flex gap-1">
              {SECTOR_FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setSectorFilter(f)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    sectorFilter === f
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  }`}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          )}
        </div>
        {sectorPerformance.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-sm text-gray-400">
            Sector data requires Twelvedata server
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={filteredSectors} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
              <XAxis dataKey="sector" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} domain={sectorDomain} tickFormatter={(v) => `${v}%`} />
              <Tooltip />
              <ReferenceLine y={0} stroke="#9CA3AF" />
              <Bar dataKey="return" name="Return %" radius={[4, 4, 0, 0]}>
                {filteredSectors.map((entry, i) => (
                  <Cell key={i} fill={entry.return >= 0 ? "#3B82F6" : "#EF4444"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
