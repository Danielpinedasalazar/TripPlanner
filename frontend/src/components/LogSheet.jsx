/**
 * SVG ELD Daily Log Sheet renderer.
 * Draws one FMCSA-standard 24-hour grid per sheet.
 * Total hours must equal 24 (guaranteed by backend _fill_to_24h).
 */

const GRID_LEFT = 140;      // px left of the 24hr grid area
const GRID_TOP = 60;        // px from top of grid area to first row
const ROW_H = 32;           // px per HOS row
const ROW_GAP = 4;
const HOUR_W = 36;          // px per hour (24 * 36 = 864px grid width)
const GRID_W = 24 * HOUR_W; // 864
const TOTAL_ROWS = 4;
const GRID_H = TOTAL_ROWS * (ROW_H + ROW_GAP) - ROW_GAP;
const SVG_W = GRID_LEFT + GRID_W + 80;   // right margin for totals
// Remarks ruler sits below the status rows
const REMARKS_RULER_PAD = 14;   // gap between grid bottom and ruler line
const REMARKS_TICK_H = 38;      // length of vertical tick from ruler down
const REMARKS_LABEL_H = 110;    // vertical space for angled city labels
const REMARKS_BOTTOM_PAD = 16;

const ROW_LABELS = ["Off Duty", "Sleeper\nBerth", "Driving", "On Duty\n(Not Drv)"];
const ROW_STATUS = ["off_duty", "sleeper_berth", "driving", "on_duty_not_driving"];
const STATUS_TO_ROW = {
  off_duty: 0,
  sleeper_berth: 1,
  driving: 2,
  on_duty_not_driving: 3,
};

function minuteToX(minutes) {
  return GRID_LEFT + (minutes / 60) * HOUR_W;
}

function rowY(rowIdx) {
  return GRID_TOP + rowIdx * (ROW_H + ROW_GAP);
}

export default function LogSheet({ sheet }) {
  if (!sheet) return null;

  const segments = sheet.segments ?? [];
  const remarks = sheet.remarks ?? [];   // structured: [{time, time_minutes, location, status}]

  const REMARKS_RULER_Y = GRID_TOP + GRID_H + REMARKS_RULER_PAD;
  const SVG_H = REMARKS_RULER_Y + REMARKS_TICK_H + REMARKS_LABEL_H + REMARKS_BOTTOM_PAD;

  // Group segments by status row
  const rowSegments = ROW_STATUS.map((status) =>
    segments.filter((s) => s.status === status)
  );

  // Sum per-row hours
  const rowTotals = rowSegments.map((segs) =>
    segs.reduce((acc, s) => acc + s.duration_hours, 0)
  );

  // Build hour-tick X positions
  const hourTicks = Array.from({ length: 25 }, (_, i) => i);

  // Half-hour and quarter-hour minor ticks
  const quarterTicks = [];
  for (let h = 0; h < 24; h++) {
    for (let q = 1; q < 4; q++) {
      quarterTicks.push(h + q * 0.25);
    }
  }

  // Build a single continuous step-polyline that traces status across all 4 rows.
  // Sort segments by start; for each, append [xStart, rowMidY] then [xEnd, rowMidY].
  // The polyline connector between consecutive segments naturally renders the
  // vertical drop at the status-change moment.
  const sortedSegs = [...segments].sort(
    (a, b) => _hhmm_to_min(a.start) - _hhmm_to_min(b.start)
  );
  const linePoints = [];
  sortedSegs.forEach((s) => {
    const ri = STATUS_TO_ROW[s.status];
    if (ri === undefined) return;
    const yMid = rowY(ri) + ROW_H / 2;
    const startMin = _hhmm_to_min(s.start);
    const endMin = _hhmm_to_min(s.end) || 1440;
    linePoints.push([minuteToX(startMin), yMid]);
    linePoints.push([minuteToX(endMin), yMid]);
  });
  const polylineStr = linePoints.map(([x, y]) => `${x},${y}`).join(" ");

  const info = sheet.driver_info ?? {};
  const [year, month, day] = (sheet.date ?? "").split("-").map(Number);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm font-sans text-slate-800">

      {/* ── FMCSA log sheet header ── */}
      <div className="border-b border-slate-300 px-4 pt-3 pb-2 space-y-2 text-xs">

        {/* Row 1 — title + date + miles + vehicle */}
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <p className="text-[10px] text-slate-400 uppercase tracking-widest">U.S. Department of Transportation</p>
            <p className="font-extrabold text-sm tracking-wide text-slate-800 mt-0.5">DRIVER'S DAILY LOG</p>
            <p className="text-[10px] text-slate-400">ONE CALENDAR DAY — 24 HOURS</p>
          </div>
          <div className="flex gap-4 text-center">
            <Field label="Month" value={month ? String(month).padStart(2,"0") : ""} w="w-10" />
            <Field label="Day"   value={day   ? String(day).padStart(2,"0")   : ""} w="w-10" />
            <Field label="Year"  value={year  ? String(year)                  : ""} w-14={true} />
            <Field label="Total Miles Driving Today" value={sheet.driving_miles != null ? sheet.driving_miles.toFixed(0) : ""} w="w-20" />
          </div>
          <Field label="Vehicle Numbers (show each unit)" value={info.vehicle_numbers} w="w-36" />
        </div>

        {/* Row 2 — carrier + signature */}
        <div className="flex gap-4">
          <Field label="Name of Carrier or Carriers" value={info.carrier_name} className="flex-1" />
          <Field label="Driver's Signature in Full" value={info.driver_name ? `/ ${info.driver_name} /` : ""} className="flex-1" italic />
        </div>

        {/* Row 3 — office address + co-driver + total hours */}
        <div className="flex gap-4">
          <Field label="Main Office Address" value={info.main_office_address} className="flex-1" />
          <Field label="Name of Co-Driver" value={info.co_driver_name} className="flex-1" />
          <div className="text-center">
            <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-0.5">Total Hours</p>
            <p className="font-extrabold text-lg text-slate-800 leading-none">{sheet.total_hours}</p>
          </div>
        </div>

        {/* Row 4 — shipping number */}
        {info.shipping_number && (
          <Field label="Pro or Shipping No." value={info.shipping_number} w="w-48" />
        )}
      </div>

      {/* SVG grid — scales to container width via viewBox so the full 24-hour
          grid is always visible. On very narrow viewports it scrolls. */}
      <div className="overflow-x-auto w-full">
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        preserveAspectRatio="xMidYMin meet"
        className="font-mono block"
        style={{ width: "100%", minWidth: 640, height: "auto" }}
      >
        {/* Row backgrounds */}
        {ROW_STATUS.map((_, ri) => (
          <rect
            key={ri}
            x={GRID_LEFT}
            y={rowY(ri)}
            width={GRID_W}
            height={ROW_H}
            fill="#fafafa"
            stroke="#e2e8f0"
            strokeWidth={1}
          />
        ))}

        {/* Quarter-hour minor ticks */}
        {quarterTicks.map((h) => {
          const x = GRID_LEFT + h * HOUR_W;
          const isHalf = Math.abs(h % 1 - 0.5) < 0.01;
          return (
            <line
              key={h}
              x1={x} y1={GRID_TOP}
              x2={x} y2={GRID_TOP + GRID_H}
              stroke="#e2e8f0"
              strokeWidth={isHalf ? 0.8 : 0.4}
              strokeDasharray={isHalf ? "" : "2,2"}
            />
          );
        })}

        {/* Hour major tick lines */}
        {hourTicks.map((h) => {
          const x = GRID_LEFT + h * HOUR_W;
          return (
            <g key={h}>
              <line
                x1={x} y1={GRID_TOP - 8}
                x2={x} y2={GRID_TOP + GRID_H}
                stroke="#94a3b8"
                strokeWidth={h === 0 || h === 24 ? 1.5 : 1}
              />
              {h < 24 && (
                <text
                  x={x + HOUR_W / 2}
                  y={GRID_TOP - 12}
                  textAnchor="middle"
                  fontSize={9}
                  fill="#94a3b8"
                >
                  {h === 0 ? "M" : h <= 12 ? h : h - 12}{h === 12 ? "N" : ""}
                </text>
              )}
            </g>
          );
        })}

        {/* Continuous FMCSA-style status step-line across all 4 rows */}
        {polylineStr && (
          <polyline
            points={polylineStr}
            fill="none"
            stroke="#0f172a"
            strokeWidth={1.75}
            strokeLinejoin="miter"
            strokeLinecap="square"
          />
        )}

        {/* Row labels */}
        {ROW_LABELS.map((label, ri) => {
          const lines = label.split("\n");
          const cy = rowY(ri) + ROW_H / 2;
          return (
            <g key={ri}>
              {lines.map((line, li) => (
                <text
                  key={li}
                  x={GRID_LEFT - 6}
                  y={cy + (li - (lines.length - 1) / 2) * 11}
                  textAnchor="end"
                  fontSize={9.5}
                  fill="#334155"
                  fontWeight={600}
                >
                  {line}
                </text>
              ))}
            </g>
          );
        })}

        {/* Right-side row totals */}
        {rowTotals.map((hrs, ri) => (
          <text
            key={ri}
            x={GRID_LEFT + GRID_W + 8}
            y={rowY(ri) + ROW_H / 2 + 4}
            fontSize={10}
            fill="#1e293b"
            fontWeight={700}
          >
            {hrs.toFixed(1)}
          </text>
        ))}
        <text
          x={GRID_LEFT + GRID_W + 8}
          y={GRID_TOP - 12}
          fontSize={9}
          fill="#94a3b8"
        >
          hrs
        </text>

        {/* ── REMARKS section — FMCSA style ── */}

        {/* "REMARKS" label */}
        <text
          x={GRID_LEFT - 6}
          y={REMARKS_RULER_Y + 4}
          textAnchor="end"
          fontSize={8}
          fontWeight={700}
          fill="#334155"
          letterSpacing={0.5}
        >
          REMARKS
        </text>

        {/* Horizontal ruler line */}
        <line
          x1={GRID_LEFT} y1={REMARKS_RULER_Y}
          x2={GRID_LEFT + GRID_W} y2={REMARKS_RULER_Y}
          stroke="#94a3b8"
          strokeWidth={1}
        />

        {/* Minor ruler ticks — every 15 min */}
        {Array.from({ length: 24 * 4 + 1 }, (_, i) => i).map((q) => {
          const x = GRID_LEFT + (q / 4) * HOUR_W;
          const isHour = q % 4 === 0;
          return (
            <line
              key={`rt-${q}`}
              x1={x} y1={REMARKS_RULER_Y}
              x2={x} y2={REMARKS_RULER_Y + (isHour ? 7 : 4)}
              stroke="#94a3b8"
              strokeWidth={isHour ? 1 : 0.5}
            />
          );
        })}

        {/* Per-remark: small rectangular flag on the ruler + angled top-down label */}
        {remarks.map((r, i) => {
          const min = typeof r.time_minutes === "number"
            ? r.time_minutes
            : _hhmm_to_min(r.time);
          if (min === 0 && i === 0) return null; // skip midnight label
          const x = minuteToX(min);
          const loc = _shortLocation(r.location || "");
          if (!loc) return null;
          // Small filled rectangle straddling the ruler line — FMCSA marker style
          const FLAG_W = 5;
          const FLAG_H = 12;
          const flagX = x - FLAG_W / 2;
          const flagY = REMARKS_RULER_Y - FLAG_H / 2;
          // Angled label that reads top-to-bottom (rotate +60° clockwise)
          const labelStartY = REMARKS_RULER_Y + FLAG_H / 2 + 2;
          return (
            <g key={`rm-${i}`}>
              <rect
                x={flagX}
                y={flagY}
                width={FLAG_W}
                height={FLAG_H}
                fill="#1e293b"
                stroke="#0f172a"
                strokeWidth={0.5}
              />
              <text
                x={x}
                y={labelStartY}
                fontSize={8.5}
                fill="#1e293b"
                fontWeight={500}
                textAnchor="start"
                transform={`rotate(60, ${x}, ${labelStartY})`}
              >
                {loc.length > 22 ? loc.slice(0, 20) + "…" : loc}
              </text>
            </g>
          );
        })}

        {/* Total hours label */}
        <text
          x={GRID_LEFT + GRID_W + 8}
          y={REMARKS_RULER_Y + 4}
          fontSize={9}
          fill="#94a3b8"
        >
          Total
        </text>
        <text
          x={GRID_LEFT + GRID_W + 8}
          y={REMARKS_RULER_Y + 18}
          fontSize={11}
          fontWeight={700}
          fill="#0f172a"
        >
          {sheet.total_hours}h
        </text>
      </svg>
      </div>

      {/* ── Trip summary (below the grid) ── */}
      <div className="border-t border-slate-200 px-4 py-3 flex flex-wrap items-center gap-2">
        <span className="text-[10px] text-slate-400 uppercase tracking-widest mr-1">
          Trip summary
        </span>
        {[
          { label: "Driving",  value: rowTotals[2].toFixed(1),                          color: "text-blue-700 bg-blue-50 border-blue-200" },
          { label: "On Duty",  value: (rowTotals[2] + rowTotals[3]).toFixed(1),         color: "text-slate-700 bg-slate-50 border-slate-200" },
          { label: "Off Duty", value: (rowTotals[0] + rowTotals[1]).toFixed(1),         color: "text-slate-500 bg-slate-50 border-slate-200" },
          { label: "Total",    value: sheet.total_hours,                                color: "text-slate-800 bg-white border-slate-300" },
        ].map(({ label, value, color }) => (
          <span key={label} className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${color}`}>
            {label}: {value} hr
          </span>
        ))}
      </div>
    </div>
  );
}

function Field({ label, value, w, className = "", italic = false }) {
  return (
    <div className={`${w ?? ""} ${className}`}>
      <div className={`border-b border-slate-400 min-h-[18px] text-xs pb-0.5 ${italic ? "italic" : ""} ${value ? "text-slate-800" : "text-transparent"}`}>
        {value || "—"}
      </div>
      <p className="text-[9px] text-slate-400 uppercase tracking-wide mt-0.5">{label}</p>
    </div>
  );
}

function _hhmm_to_min(hhmm) {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

// Strip "En route (X)" → "X"; keep first city when comma-separated; cap length.
function _shortLocation(loc) {
  if (!loc) return "";
  let out = loc.trim();
  const m = out.match(/^en\s*route\s*\((.+)\)\s*$/i);
  if (m) out = m[1].trim();
  // Keep just "City, ST" — drop ", USA" or county tail
  const parts = out.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    out = `${parts[0]}, ${parts[1]}`;
  }
  return out;
}
