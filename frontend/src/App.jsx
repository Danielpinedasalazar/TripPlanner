import { useRef, useState } from "react";
import TripForm from "./components/TripForm";
import MapView from "./components/MapView";
import StopsList from "./components/StopsList";
import LogSheet from "./components/LogSheet";
import { planTrip } from "./api/tripApi";
import { exportLogSheetsToPdf } from "./utils/exportPdf";

export default function App() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeSheet, setActiveSheet] = useState(0);
  const [exporting, setExporting] = useState(false);
  // One DOM ref per rendered LogSheet container, indexed by sheet position.
  // Used by the PDF exporter to rasterize every sheet (including currently
  // hidden ones, which we keep mounted off-screen).
  const sheetRefs = useRef([]);

  async function handleExportPdf() {
    if (!result?.log_sheets?.length || exporting) return;
    setExporting(true);
    try {
      const elements = sheetRefs.current.filter(Boolean);
      const firstDate = result.log_sheets[0]?.date ?? "trip";
      const dropoff = (result.route?.waypoints?.[2]?.label ?? "")
        .split(",")[0]
        .trim()
        .replace(/\s+/g, "_") || "log";
      await exportLogSheetsToPdf(
        elements,
        `eld-log_${dropoff}_${firstDate}.pdf`
      );
    } catch (err) {
      console.error("PDF export failed:", err);
      setError("PDF export failed: " + (err?.message || "unknown error"));
    } finally {
      setExporting(false);
    }
  }

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
              {/* Header row — title on the left, primary action on the right */}
              <div className="flex items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-100">
                <div>
                  <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide">
                    ELD Log Sheets
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {result.log_sheets.length} day{result.log_sheets.length === 1 ? "" : "s"} · FMCSA daily log
                  </p>
                </div>
                <button
                  onClick={handleExportPdf}
                  disabled={exporting}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold
                             bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50
                             disabled:cursor-not-allowed shadow-sm transition whitespace-nowrap"
                  title="Download all log sheets as a single PDF"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  {exporting ? "Exporting…" : "Export PDF"}
                </button>
              </div>

              {/* Day-tab navigation — its own row, no longer mixed with actions */}
              <div className="flex flex-wrap items-center gap-2 mb-4">
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

              {/* Every log sheet is mounted so the exporter can rasterize all
                  of them in one click. The active sheet displays in flow;
                  the rest are pushed off-screen but remain measurable. */}
              {result.log_sheets.map((sheet, i) => (
                <div
                  key={i}
                  ref={(el) => { sheetRefs.current[i] = el; }}
                  style={
                    i === activeSheet
                      ? {}
                      : {
                          position: "fixed",
                          left: "-99999px",
                          top: 0,
                          width: 1100,        // give it a stable width so layout matches the visible sheet
                          pointerEvents: "none",
                        }
                  }
                  aria-hidden={i !== activeSheet}
                >
                  <LogSheet sheet={sheet} />
                </div>
              ))}
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
