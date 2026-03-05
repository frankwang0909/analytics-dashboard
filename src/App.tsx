import { lazy, Suspense } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { usePortfolioData, type PortfolioData } from "./hooks/usePortfolioData";
import KPICard from "./components/KPICard";
import ErrorBoundary from "./components/ErrorBoundary";
import { KPICardSkeleton, ChartCardSkeleton, TableSkeleton } from "./components/Skeleton";

const OverviewTab = lazy(() => import("./components/OverviewTab"));
const RiskTab     = lazy(() => import("./components/RiskTab"));
const HoldingsTab = lazy(() => import("./components/HoldingsTab"));

const NAV_LINKS = [
  { to: "/overview", label: "Overview" },
  { to: "/risk",     label: "Risk"     },
  { to: "/holdings", label: "Holdings" },
];

function LoadingSkeleton() {
  const { pathname } = useLocation();
  const isHoldings = pathname.startsWith("/holdings");
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => <KPICardSkeleton key={i} />)}
      </div>
      {isHoldings ? (
        <TableSkeleton />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2"><ChartCardSkeleton tall /></div>
          <ChartCardSkeleton />
          <div className="lg:col-span-3"><ChartCardSkeleton /></div>
        </div>
      )}
    </>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="text-lg font-semibold text-gray-800 mb-1">Failed to load portfolio data</p>
      <p className="text-sm text-gray-400 mb-4">{message}</p>
      <button
        onClick={onRetry}
        className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-full hover:bg-blue-700 transition-colors"
      >
        Retry
      </button>
    </div>
  );
}

function Dashboard({ data }: { data: PortfolioData }) {
  const { summary } = data;
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KPICard
          label="Total Portfolio Value"
          value={`$${summary.totalValue.toLocaleString()}`}
          sub="As of Dec 2025"
        />
        <KPICard
          label="Total Return"
          value={`${summary.totalReturn >= 0 ? '+' : ''}$${Math.abs(summary.totalReturn).toLocaleString()}`}
          sub={`${summary.returnRate >= 0 ? '+' : ''}${summary.returnRate}% YTD`}
          positive={summary.totalReturn >= 0}
        />
        <KPICard
          label="Sharpe Ratio"
          value={summary.sharpeRatio.toString()}
          sub="Risk-adjusted return"
          positive={summary.sharpeRatio > 1}
        />
        <KPICard
          label="Portfolio Beta"
          value={summary.beta.toString()}
          sub={`Volatility: ${summary.volatility}%`}
        />
      </div>

      <Suspense fallback={<div className="grid grid-cols-1 lg:grid-cols-3 gap-6"><div className="lg:col-span-2"><ChartCardSkeleton tall /></div><ChartCardSkeleton /></div>}>
        <Routes>
          <Route index element={<Navigate to="/overview" replace />} />
          <Route
            path="/overview"
            element={
              <OverviewTab
                monthlyPerformance={data.monthlyPerformance}
                assetAllocation={data.assetAllocation}
                sectorPerformance={data.sectorPerformance}
              />
            }
          />
          <Route
            path="/risk"
            element={<RiskTab riskMetrics={data.riskMetrics} summary={data.summary} />}
          />
          <Route
            path="/holdings"
            element={<HoldingsTab holdings={data.holdings} />}
          />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
    isActive
      ? "bg-blue-600 text-white"
      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
  }`;

function NoApiKeyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="text-lg font-semibold text-gray-800 mb-2">Local server not running</p>
      <p className="text-sm text-gray-400 mb-4 max-w-sm">
        Start the Twelvedata proxy server, then set{" "}
        <code className="bg-gray-100 px-1 rounded">.env.local</code>:
      </p>
      <code className="bg-gray-100 text-gray-700 text-sm px-4 py-2 rounded-lg font-mono">
        VITE_API_BASE=http://localhost:3001
      </code>
    </div>
  );
}

export default function App() {
  const { data, hasApiKey, isPending, isError, error, refetch } = usePortfolioData();

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      <header className="bg-white border-b border-gray-200 px-8 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Portfolio Analytics</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Live portfolio analytics · Twelvedata · Fiscal year 2025
          </p>
        </div>
        <nav className="flex gap-2">
          {NAV_LINKS.map(({ to, label }) => (
            <NavLink key={to} to={to} className={navLinkClass}>
              {label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="px-8 py-6 max-w-7xl mx-auto">
        {!hasApiKey && <NoApiKeyState />}
        {isPending  && <LoadingSkeleton />}
        {isError    && <ErrorState message={error?.message ?? "Unknown error"} onRetry={refetch} />}
        {data       && (
          <ErrorBoundary>
            <Dashboard data={data} />
          </ErrorBoundary>
        )}
      </main>
    </div>
  );
}
