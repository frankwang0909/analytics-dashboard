function Block({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded ${className}`} />;
}

export function KPICardSkeleton() {
  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 space-y-3">
      <Block className="h-3 w-20" />
      <Block className="h-8 w-28" />
      <Block className="h-3 w-16" />
    </div>
  );
}

export function ChartCardSkeleton({ tall = false }: { tall?: boolean }) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
      <Block className="h-4 w-40 mb-4" />
      <Block className={tall ? "h-72" : "h-52"} />
    </div>
  );
}

export function TableSkeleton() {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <Block className="h-4 w-28" />
      </div>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="px-5 py-3 flex items-center gap-8 border-b border-gray-50">
          <Block className="h-4 w-12" />
          <Block className="h-4 w-44" />
          <Block className="h-4 w-10" />
          <Block className="h-4 w-20" />
          <Block className="h-4 w-14" />
        </div>
      ))}
    </div>
  );
}
