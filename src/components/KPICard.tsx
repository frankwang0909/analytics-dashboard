interface KPICardProps {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
}

export default function KPICard({ label, value, sub, positive }: KPICardProps) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
      <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-2xl font-bold ${positive === undefined ? "text-gray-800" : positive ? "text-emerald-600" : "text-red-500"}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}
