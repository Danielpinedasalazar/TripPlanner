import { useState } from "react";
import TripForm from "./components/TripForm";
import MapView from "./components/MapView";
import StopsList from "./components/StopsList";
import LogSheet from "./components/LogSheet";
import { planTrip } from "./api/tripApi";

export default function App() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeSheet, setActiveSheet] = useState(0);

  async function handleSubmit(payload) {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await planTrip(payload);
      setResult(data);
      setActiveSheet(0);
    } catch (err) {
      const msg =
        err.response?.data?.error ||
        err.response?.data?.detail ||
        err.message ||
        "Unknown error";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 overflow-x-hidden">
      {/* Top nav */}
      <header className="sticky top-0 z-50 bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm">
          ELD
        </div>
        <span className="text-lg font-bold text-slate-800">Trip Planner</span>
        <span className="ml-1 text-xs text-slate-400 font-medium">FMCSA 70hr/8-day</span>
      </header>

      <div className="max-w-screen-xl mx-auto px-4 py-6 grid grid-cols-1 xl:grid-cols-[340px_1fr] gap-6">
        {/* ── Left panel ── */}
        <aside className="flex flex-col gap-5 min-w-0">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-4">
              Trip Details
            </h2>
            <TripForm onSubmit={handleSubmit} loading={loading} />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
              <strong>Error:</strong> {error}
            </div>
          )}

          {result && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-4">
                Trip Stops
              </h2>
              <StopsList
                stops={result.stops}
                totalMiles={result.route?.total_miles}
                totalHours={result.route?.total_duration_hours}
              />
            </div>
          )}
        </aside>

        {/* ── Right panel ── */}
        <main className="flex flex-col gap-5 min-w-0">
          {/* Map */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden w-full" style={{ height: "420px" }}>
            <MapView
              geojson={result?.route?.geojson}
              waypoints={result?.route?.waypoints}
              stops={result?.stops}
            />
          </div>

          {/* ELD log sheets */}
          {result?.log_sheets?.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide mr-auto">
                  ELD Log Sheets
                </h2>
                {result.log_sheets.map((sheet, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveSheet(i)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
                      activeSheet === i
                        ? "bg-blue-600 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    Day {i + 1} · {sheet.date}
                  </button>
                ))}
              </div>
              <LogSheet sheet={result.log_sheets[activeSheet]} />
            </div>
          )}

          {/* Empty state */}
          {!result && !loading && (
            <div className="flex-1 flex items-center justify-center text-center py-24 text-slate-400">
              <div>
                <div className="text-5xl mb-4">🗺️</div>
                <p className="text-sm font-medium">Enter trip details to plan your route</p>
                <p className="text-xs mt-1">Route, stops, and ELD log sheets will appear here</p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
