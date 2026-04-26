const STOP_CONFIG = {
  start: { label: "Start", bg: "bg-blue-100", text: "text-blue-700", icon: "🚚" },
  pickup: { label: "Pickup", bg: "bg-emerald-100", text: "text-emerald-700", icon: "📦" },
  dropoff: { label: "Dropoff", bg: "bg-violet-100", text: "text-violet-700", icon: "🏁" },
  rest: { label: "10-hr Rest", bg: "bg-amber-100", text: "text-amber-700", icon: "🛏" },
  restart: { label: "34-hr Restart", bg: "bg-orange-100", text: "text-orange-700", icon: "🔄" },
  fuel: { label: "Fuel Stop", bg: "bg-sky-100", text: "text-sky-700", icon: "⛽" },
  break: { label: "30-min Break", bg: "bg-rose-100", text: "text-rose-700", icon: "☕" },
};

export default function StopsList({ stops, totalMiles, totalHours }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-4 text-sm text-slate-500 pb-2 border-b border-slate-100">
        <span><span className="font-semibold text-slate-700">{totalMiles?.toFixed(1)}</span> mi</span>
        <span><span className="font-semibold text-slate-700">{totalHours?.toFixed(1)}</span> driving hrs</span>
      </div>

      {stops.map((stop, i) => {
        const cfg = STOP_CONFIG[stop.type] ?? {
          label: stop.type, bg: "bg-slate-100", text: "text-slate-600", icon: "📍",
        };
        return (
          <div key={i} className="flex items-start gap-3">
            <div className={`${cfg.bg} ${cfg.text} rounded-full w-8 h-8 flex items-center justify-center text-base flex-shrink-0`}>
              {cfg.icon}
            </div>
            <div className="min-w-0">
              <p className={`text-xs font-bold uppercase tracking-wide ${cfg.text}`}>{cfg.label}</p>
              <p className="text-sm text-slate-700 font-medium truncate">{stop.location || "—"}</p>
              <p className="text-xs text-slate-400">
                {stop.arrival} → {stop.departure}
                {stop.mile_marker != null && (
                  <span className="ml-2 text-slate-300">· mi {stop.mile_marker.toFixed(0)}</span>
                )}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
