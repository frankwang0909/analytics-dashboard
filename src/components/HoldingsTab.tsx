import { useState, useMemo } from "react";
import type { PortfolioData } from "../hooks/usePortfolioData";

interface Props {
  holdings: PortfolioData["holdings"];
}

type SortKey = "ticker" | "name" | "weight" | "value" | "return";
type SortDir = "asc" | "desc";
type Filter = "all" | "gainers" | "losers";

const COLUMNS: { label: string; key: SortKey }[] = [
  { label: "Ticker", key: "ticker" },
  { label: "Name", key: "name" },
  { label: "Weight", key: "weight" },
  { label: "Value", key: "value" },
  { label: "Return", key: "return" },
];

const FILTERS: Filter[] = ["all", "gainers", "losers"];

export default function HoldingsTab({ holdings }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filter, setFilter] = useState<Filter>("all");

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const rows = useMemo(() => {
    const filtered = holdings.filter((h) => {
      if (filter === "gainers") return h.return > 0;
      if (filter === "losers") return h.return < 0;
      return true;
    });

    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp =
        typeof av === "string"
          ? av.localeCompare(bv as string)
          : (av as number) - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filter, sortKey, sortDir]);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Top Holdings</h2>
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filter === f
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            {COLUMNS.map(({ label, key }) => (
              <th
                key={key}
                onClick={() => handleSort(key)}
                className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-700"
              >
                <span className="flex items-center gap-1">
                  {label}
                  {sortKey === key && (
                    <span className="text-blue-500">{sortDir === "asc" ? "↑" : "↓"}</span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map((h, i) => (
            <tr key={i} className="hover:bg-blue-50 transition-colors">
              <td className="px-5 py-3 font-bold text-blue-600">{h.ticker}</td>
              <td className="px-5 py-3 text-gray-700">{h.name}</td>
              <td className="px-5 py-3 text-gray-600">{h.weight}%</td>
              <td className="px-5 py-3 text-gray-700">${h.value.toLocaleString()}</td>
              <td className="px-5 py-3">
                <span className={`font-semibold ${h.return >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  {h.return >= 0 ? "+" : ""}{h.return}%
                </span>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="px-5 py-8 text-center text-sm text-gray-400">
                No holdings match the selected filter.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
