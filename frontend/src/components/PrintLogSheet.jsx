/**
 * PrintLogSheet — print/PDF-only renderer of the FMCSA "Driver's Daily Log".
 *
 * Modeled after the standard FMCSA paper form: black grid header, 4-row
 * status grid with HH:MM totals, remarks ruler with bracket markers, the
 * shipping-documents block with the heavy left bar, the recap block, and
 * the bottom mileage / carrier / address fields.
 *
 * Renders to fixed pixel dimensions (1280 × ~1000) so that html2canvas can
 * rasterize it cleanly and the PDF exporter can fit it onto Letter
 * landscape with consistent margins.
 *
 * The on-screen LogSheet keeps its modern Tailwind styling — this
 * component is mounted off-screen purely for PDF capture.
 */

const W = 1280;
const PAD_X = 24;

// Grid geometry
const GRID_LEFT = 180;
const GRID_RIGHT = W - 92;          // leaves room for "Total Hours" column
const GRID_W = GRID_RIGHT - GRID_LEFT;
const HOUR_W = GRID_W / 24;
const ROW_H = 36;
const ROWS = 4;
const GRID_H = ROWS * ROW_H;

// Remarks geometry
const REMARKS_RULER_H = 26;          // height of ruler ticks
const REMARKS_LABELS_H = 180;        // generous space so angled labels never
                                     // collide with the shipping-docs block
const REMARKS_H = REMARKS_RULER_H + REMARKS_LABELS_H;

const STATUS_TO_ROW = {
  off_duty: 0,
  sleeper_berth: 1,
  driving: 2,
  on_duty_not_driving: 3,
};
const ROW_LABELS = [
  "1. Off Duty",
  "2. Sleeper\nBerth",
  "3. Driving",
  "4. On Duty\n(not driving)",
];
const ROW_STATUS = ["off_duty", "sleeper_berth", "driving", "on_duty_not_driving"];

export default function PrintLogSheet({ sheet, fromLabel = "", toLabel = "", cumulativeMiles = null }) {
  if (!sheet) return null;

  const segments = sheet.segments ?? [];
  const remarks = sheet.remarks ?? [];
  const info = sheet.driver_info ?? {};
  const [year, month, day] = (sheet.date ?? "").split("-").map(Number);

  // Per-row totals (decimal hours) → HH:MM
  const rowTotals = ROW_STATUS.map((status) =>
    segments
      .filter((s) => s.status === status)
      .reduce((acc, s) => acc + s.duration_hours, 0)
  );

  // On-duty today = driving + on_duty_not_driving
  const onDutyToday = rowTotals[2] + rowTotals[3];

  // Step polyline across all 4 rows
  const sortedSegs = [...segments].sort(
    (a, b) => hhmmToMin(a.start) - hhmmToMin(b.start)
  );
  const linePoints = [];
  sortedSegs.forEach((s) => {
    const ri = STATUS_TO_ROW[s.status];
    if (ri === undefined) return;
    const yMid = ri * ROW_H + ROW_H / 2;
    const startMin = hhmmToMin(s.start);
    const endMin = hhmmToMin(s.end) || 1440;
    linePoints.push([minuteToX(startMin), yMid]);
    linePoints.push([minuteToX(endMin), yMid]);
  });
  const polylineStr = linePoints.map(([x, y]) => `${x},${y}`).join(" ");

  // Sub-hour ticks (every 15 min) drawn at top/bottom of each row, with the
  // :30 mark intentionally taller than :15/:45 — like the printed form.
  const subTicks = [];
  for (let h = 0; h < 24; h++) {
    for (let q = 1; q < 4; q++) {
      subTicks.push({
        x: GRID_LEFT + (h + q * 0.25) * HOUR_W,
        isHalf: q === 2,
      });
    }
  }
  const TICK_SHORT = 6;
  const TICK_TALL = 12;

  return (
    <div
      style={{
        width: W,
        background: "#fff",
        color: "#000",
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 12,
        lineHeight: 1.2,
        padding: 0,
      }}
    >
      {/* ───────── Title block ───────── */}
      {/* Absolute positioning is the most reliable layout for html2canvas —
          flex/table can silently drop columns when sibling widths are fluid. */}
      <div style={{ position: "relative", height: 90, padding: `0 ${PAD_X}px` }}>
        {/* Left: title */}
        <div style={{ position: "absolute", left: PAD_X, top: 16 }}>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 0.2 }}>
            Drivers Daily Log
          </div>
          <div style={{ fontSize: 12, marginTop: 2, marginLeft: 38 }}>(24 hours)</div>
        </div>

        {/* Center: date boxes — hardcoded left so no transform is needed */}
        <div style={{ position: "absolute", left: 420, top: 16 }}>
          <DateBoxRow
            month={month ? String(month).padStart(2, "0") : ""}
            day={day ? String(day).padStart(2, "0") : ""}
            year={year ? String(year) : ""}
          />
        </div>

        {/* Right: Original / Duplicate */}
        <div style={{
          position: "absolute",
          right: PAD_X,
          top: 16,
          width: 340,
          textAlign: "right",
          fontSize: 12,
          lineHeight: "1.6",
        }}>
          <div style={{ fontWeight: 700 }}>Original - File at home terminal.</div>
          <div>Duplicate - Driver retains in his/her possession for 8 days.</div>
        </div>
      </div>

      {/* From / To — two spans with clear label + underlined value */}
      <div style={{ padding: `0 ${PAD_X}px 14px`, display: "flex", gap: 40 }}>
        <FromTo label="From:" value={fromLabel} />
        <FromTo label="To:" value={toLabel} />
      </div>

      {/* ───────── Grid section (black header bar + 4 rows + Total Hours) ───────── */}
      <div style={{ position: "relative", padding: `0 ${PAD_X}px` }}>
        {/* Black hour-header bar */}
        <BlackHourBar />

        {/* Status grid */}
        <div style={{ position: "relative", height: GRID_H, borderLeft: "1px solid #000", borderRight: "1px solid #000" }}>
          <svg
            width={W - PAD_X * 2}
            height={GRID_H}
            viewBox={`0 0 ${W - PAD_X * 2} ${GRID_H}`}
            style={{ display: "block" }}
          >
            {/* Row separators */}
            {Array.from({ length: ROWS + 1 }, (_, i) => (
              <line
                key={`rs-${i}`}
                x1={0}
                y1={i * ROW_H}
                x2={W - PAD_X * 2}
                y2={i * ROW_H}
                stroke="#000"
                strokeWidth={i === 0 || i === ROWS ? 1.5 : 0.8}
              />
            ))}

            {/* Hour vertical major lines (full height across all 4 rows) */}
            {Array.from({ length: 25 }, (_, h) => {
              const x = GRID_LEFT - PAD_X + h * HOUR_W;
              return (
                <line
                  key={`hv-${h}`}
                  x1={x}
                  y1={0}
                  x2={x}
                  y2={GRID_H}
                  stroke="#000"
                  strokeWidth={h === 0 || h === 24 ? 1.4 : 0.7}
                />
              );
            })}

            {/* Sub-hour ticks at top and bottom of every row */}
            {Array.from({ length: ROWS }, (_, ri) => {
              const yTop = ri * ROW_H;
              const yBot = (ri + 1) * ROW_H;
              return (
                <g key={`sub-${ri}`}>
                  {subTicks.map(({ x, isHalf }, ti) => {
                    const tx = x - PAD_X;
                    const len = isHalf ? TICK_TALL : TICK_SHORT;
                    return (
                      <g key={ti}>
                        <line x1={tx} y1={yTop} x2={tx} y2={yTop + len} stroke="#000" strokeWidth={isHalf ? 0.8 : 0.5} />
                        <line x1={tx} y1={yBot - len} x2={tx} y2={yBot} stroke="#000" strokeWidth={isHalf ? 0.8 : 0.5} />
                      </g>
                    );
                  })}
                </g>
              );
            })}

            {/* Status step-line across all 4 rows */}
            {polylineStr && (
              <polyline
                points={shiftPoints(polylineStr, -PAD_X)}
                fill="none"
                stroke="#000"
                strokeWidth={2}
                strokeLinejoin="miter"
                strokeLinecap="square"
              />
            )}

            {/* Row labels (left of the grid) */}
            {ROW_LABELS.map((label, ri) => {
              const lines = label.split("\n");
              const cy = ri * ROW_H + ROW_H / 2;
              return (
                <g key={`rl-${ri}`}>
                  {lines.map((line, li) => (
                    <text
                      key={li}
                      x={GRID_LEFT - PAD_X - 8}
                      y={cy + (li - (lines.length - 1) / 2) * 12 + 4}
                      textAnchor="end"
                      fontSize={11}
                      fontWeight={700}
                      fill="#000"
                    >
                      {line}
                    </text>
                  ))}
                </g>
              );
            })}

            {/* Right-side HH:MM totals */}
            {rowTotals.map((hrs, ri) => (
              <text
                key={`rt-${ri}`}
                x={GRID_RIGHT - PAD_X + 12}
                y={ri * ROW_H + ROW_H / 2 + 4}
                fontSize={12}
                fontWeight={700}
                fill="#000"
              >
                {decimalToHHMM(hrs)}
              </text>
            ))}
          </svg>
        </div>

        {/* ───────── Remarks section ───────── */}
        <RemarksSection
          remarks={remarks}
          totalHours={sheet.total_hours}
        />
      </div>

      {/* ───────── Shipping Documents block + instructions ───────── */}
      <ShippingDocsBlock />

      {/* ───────── Recap section ───────── */}
      <RecapSection onDutyToday={onDutyToday} />

      {/* ───────── Bottom block (mileage / carrier / addresses) ───────── */}
      <BottomBlock
        miles={sheet.driving_miles}
        cumulativeMiles={cumulativeMiles}
        carrier={info.carrier_name}
        office={info.main_office_address}
        homeTerminal={info.home_terminal_address}
        vehicle={info.vehicle_numbers}
      />
    </div>
  );
}

/* ───────── Sub-components ───────── */

function BlackHourBar() {
  // Same column geometry as the grid below — rendered as one black SVG bar
  // so the column ticks line up perfectly with the status grid lines.
  const innerW = W - PAD_X * 2;
  return (
    <div style={{ height: 26, position: "relative" }}>
      <svg width={innerW} height={26} style={{ display: "block" }}>
        <rect x={0} y={0} width={innerW} height={26} fill="#000" />
        <text x={GRID_LEFT - PAD_X - 8} y={10} fontSize={9} fill="#fff" textAnchor="end">Mid-</text>
        <text x={GRID_LEFT - PAD_X - 8} y={20} fontSize={9} fill="#fff" textAnchor="end">night</text>
        {Array.from({ length: 24 }, (_, h) => {
          const x = GRID_LEFT - PAD_X + h * HOUR_W + HOUR_W / 2;
          let label;
          if (h === 0) label = "";   // "Mid-night" already on the left
          else if (h === 12) label = "Noon";
          else if (h < 12) label = String(h);
          else label = String(h - 12);
          return (
            <text key={h} x={x} y={17} fontSize={11} fill="#fff" textAnchor="middle" fontWeight={600}>
              {label}
            </text>
          );
        })}
        <text x={innerW - 8} y={11} fontSize={10} fill="#fff" textAnchor="end" fontWeight={700}>Total</text>
        <text x={innerW - 8} y={22} fontSize={10} fill="#fff" textAnchor="end" fontWeight={700}>Hours</text>
      </svg>
    </div>
  );
}

function RemarksSection({ remarks, totalHours }) {
  const innerW = W - PAD_X * 2;
  const rulerY = 28;     // y of the horizontal ruler line, inside the SVG
  const labelStartY = rulerY + 14;
  const ROT = 50;        // angle in degrees — gentler than 60° to keep
                          // labels inside the allotted vertical space
  const LINE_GAP = 11;
  const totalH = REMARKS_RULER_H + REMARKS_LABELS_H;

  return (
    <div style={{ position: "relative", marginTop: 0 }}>
      <svg width={innerW} height={totalH} style={{ display: "block" }}>
        {/* Faint hour header (above the ruler) */}
        <text x={GRID_LEFT - PAD_X - 8} y={9} fontSize={8} textAnchor="end" fill="#000">Mid-</text>
        <text x={GRID_LEFT - PAD_X - 8} y={18} fontSize={8} textAnchor="end" fill="#000">night</text>
        {Array.from({ length: 24 }, (_, h) => {
          const x = GRID_LEFT - PAD_X + h * HOUR_W + HOUR_W / 2;
          let label;
          if (h === 0) label = "";
          else if (h === 12) label = "Noon";
          else if (h < 12) label = String(h);
          else label = String(h - 12);
          return (
            <text key={h} x={x} y={14} fontSize={9} fill="#000" textAnchor="middle">
              {label}
            </text>
          );
        })}

        {/* "Remarks" label */}
        <text x={GRID_LEFT - PAD_X - 8} y={rulerY + 4} fontSize={11} fontWeight={700} textAnchor="end" fill="#000">
          Remarks
        </text>

        {/* Horizontal ruler */}
        <line
          x1={GRID_LEFT - PAD_X}
          y1={rulerY}
          x2={GRID_RIGHT - PAD_X}
          y2={rulerY}
          stroke="#000"
          strokeWidth={1}
        />

        {/* 15-min ticks on the ruler */}
        {Array.from({ length: 24 * 4 + 1 }, (_, q) => {
          const x = GRID_LEFT - PAD_X + (q / 4) * HOUR_W;
          const isHour = q % 4 === 0;
          return (
            <line
              key={`rt-${q}`}
              x1={x}
              y1={rulerY}
              x2={x}
              y2={rulerY + (isHour ? 8 : 5)}
              stroke="#000"
              strokeWidth={isHour ? 1 : 0.6}
            />
          );
        })}

        {/* Bracket markers + stacked angled labels per remark */}
        {remarks.map((r, i) => {
          const startMin =
            typeof r.time_minutes === "number" ? r.time_minutes : hhmmToMin(r.time);
          const endMin =
            typeof r.end_minutes === "number" ? r.end_minutes : startMin + 15;
          const loc = shortLocation(r.location || "");
          const descriptions = Array.isArray(r.descriptions) ? r.descriptions : [];
          // First line(s): each purpose; last line: city. Matches the FMCSA
          // reference image where the descriptor sits above the location.
          const lines = [...descriptions, loc].filter(Boolean);
          if (lines.length === 0) return null;

          const x1 = GRID_LEFT - PAD_X + (startMin / 60) * HOUR_W;
          const x2raw = GRID_LEFT - PAD_X + (endMin / 60) * HOUR_W;
          const x2 = Math.max(x2raw, x1 + 4);
          const cx = (x1 + x2) / 2;

          return (
            <g key={`rm-${i}`}>
              <path
                d={`M ${x1} ${rulerY} L ${x1} ${rulerY + 8} L ${x2} ${rulerY + 8} L ${x2} ${rulerY}`}
                fill="none"
                stroke="#000"
                strokeWidth={1.2}
                strokeLinejoin="miter"
              />
              <text
                x={cx}
                y={labelStartY}
                fontSize={10}
                fill="#000"
                textAnchor="start"
                transform={`rotate(${ROT}, ${cx}, ${labelStartY})`}
              >
                {lines.map((ln, li) => (
                  <tspan
                    key={li}
                    x={cx}
                    dy={li === 0 ? 0 : LINE_GAP}
                    fontWeight={li === lines.length - 1 ? 700 : 500}
                  >
                    {ln.length > 28 ? ln.slice(0, 26) + "…" : ln}
                  </tspan>
                ))}
              </text>
            </g>
          );
        })}

        {/* "24:00" total to the right */}
        <text x={innerW - 8} y={rulerY + 4} fontSize={12} fontWeight={700} textAnchor="end" fill="#000">
          {decimalToHHMM(totalHours ?? 24)}
        </text>
      </svg>
    </div>
  );
}

function ShippingDocsBlock() {
  // Heavy left vertical bar + 3 underlined fields, matching the FMCSA form.
  return (
    <div style={{ display: "flex", margin: `4px ${PAD_X}px 0`, borderTop: "2px solid #000" }}>
      <div style={{ width: 8, background: "#000", flex: "0 0 8px" }} />
      <div style={{ flex: "0 0 280px", padding: "10px 14px", borderRight: "1px solid #000" }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Shipping</div>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Documents:</div>
        <div style={{ borderBottom: "1px solid #000", height: 14, marginBottom: 4 }} />
        <div style={{ fontWeight: 700, marginBottom: 2 }}>DVL or Manifest No.</div>
        <div style={{ marginBottom: 4 }}>or</div>
        <div style={{ borderBottom: "1px solid #000", height: 14, marginBottom: 4 }} />
        <div style={{ fontWeight: 700 }}>Shipper &amp; Commodity</div>
      </div>
      <div style={{ flex: 1, padding: "10px 14px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center" }}>
        <div style={{ fontWeight: 700 }}>
          Enter name of place you reported and where released from work and when and where each change of duty occurred.
        </div>
        <div style={{ fontWeight: 700, marginTop: 4 }}>Use time standard of home terminal.</div>
      </div>
    </div>
  );
}

function RecapSection({ onDutyToday }) {
  const cellStyle = {
    flex: 1,
    padding: "8px 10px",
    borderRight: "1px solid #000",
    fontSize: 10,
    lineHeight: 1.25,
  };
  const lastCell = { ...cellStyle, borderRight: "none" };

  return (
    <div style={{ margin: `0 ${PAD_X}px`, borderTop: "2px solid #000", display: "flex" }}>
      <div style={{ ...cellStyle, flex: "0 0 110px" }}>
        <div style={{ fontWeight: 700 }}>Recap:</div>
        <div style={{ fontWeight: 700 }}>Complete at</div>
        <div style={{ fontWeight: 700 }}>end of day</div>
      </div>

      <div style={{ ...cellStyle, flex: "0 0 130px", textAlign: "center" }}>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>
          {decimalToHHMM(onDutyToday)}
        </div>
        <div>On duty hours today,</div>
        <div>Total lines 3 &amp; 4</div>
      </div>

      {/* 70 Hour / 8 Day Drivers */}
      <div style={{ ...cellStyle, flex: "0 0 100px" }}>
        <div style={{ fontWeight: 700 }}>70 Hour/</div>
        <div style={{ fontWeight: 700 }}>8 Day</div>
        <div style={{ fontWeight: 700 }}>Drivers</div>
      </div>
      <RecapField letter="A." text="Total hours on duty last 7 days including today." />
      <RecapField letter="B." text="Total hours available tomorrow 70 hr. minus A*" />
      <RecapField letter="C." text="Total hours on duty last 5 days including today." />

      {/* 60 Hour / 7 Day Drivers */}
      <div style={{ ...cellStyle, flex: "0 0 100px" }}>
        <div style={{ fontWeight: 700 }}>60 Hour/ 7</div>
        <div style={{ fontWeight: 700 }}>Day Drivers</div>
      </div>
      <RecapField letter="A." text="Total hours on duty last 8 days including today." />
      <RecapField letter="B." text="Total hours available tomorrow 60 hr. minus A*" />
      <RecapField letter="C." text="Total hours on duty last 7 days including today." />

      <div style={{ ...lastCell, flex: "0 0 130px", fontSize: 9 }}>
        *If you took 34 consecutive hours off duty you have 60/70 hours available
      </div>
    </div>
  );
}

function RecapField({ letter, text }) {
  return (
    <div style={{ flex: 1, padding: "8px 10px", borderRight: "1px solid #000", fontSize: 9, lineHeight: 1.25 }}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>{letter}</div>
      <div style={{ marginTop: 6 }}>{letter} {text}</div>
    </div>
  );
}

function BottomBlock({ miles, cumulativeMiles, carrier, office, homeTerminal, vehicle }) {
  const milesStr = miles != null ? Number(miles).toFixed(1) : "";
  const cumStr   = cumulativeMiles != null ? Number(cumulativeMiles).toFixed(1) : milesStr;
  return (
    <div style={{ margin: `0 ${PAD_X}px 16px`, borderTop: "2px solid #000", display: "flex", gap: 0 }}>
      <div style={{ flex: "0 0 200px", padding: "10px 12px", borderRight: "1px solid #000" }}>
        <BoxField value={milesStr} label="Total Miles Driving Today" />
      </div>
      <div style={{ flex: "0 0 200px", padding: "10px 12px", borderRight: "1px solid #000" }}>
        <BoxField value={cumStr} label="Total Mileage Today" />
      </div>
      <div style={{ flex: "0 0 280px", padding: "10px 12px", borderRight: "1px solid #000" }}>
        <BoxField value={vehicle} label="Truck/Tractor and Trailer Numbers or License Plate(s)/State (show each unit)" tall />
      </div>
      <div style={{ flex: 1, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 12 }}>
        <UnderlineField value={carrier} label="Name of Carrier or Carriers" />
        <UnderlineField value={office} label="Main Office Address" />
        <UnderlineField value={homeTerminal} label="Home Terminal Address" />
      </div>
    </div>
  );
}

function BoxField({ value, label, tall = false }) {
  return (
    <div>
      <div
        style={{
          border: "1px solid #000",
          height: tall ? 44 : 30,
          padding: "6px 8px 0",  // push value down from top border; gap at bottom
          fontSize: 13,
          fontWeight: 700,
          lineHeight: "normal",
        }}
      >
        {value || ""}
      </div>
      <div style={{ fontSize: 10, fontWeight: 700, marginTop: 5, textAlign: "center", lineHeight: 1.3 }}>{label}</div>
    </div>
  );
}

function UnderlineField({ value, label }) {
  return (
    <div>
      <div style={{
        borderBottom: "1px solid #000",
        fontSize: 12,
        padding: "4px 6px 6px",   // top space + bottom gap so text isn't glued to the line
      }}>
        {value || " "}
      </div>
      <div style={{ fontSize: 10, fontWeight: 700, marginTop: 3, textAlign: "center" }}>{label}</div>
    </div>
  );
}

// Inline date-box row — avoids flex/inline-flex inside absolutelypositioned
// containers, where html2canvas can misplace children.
function DateBoxRow({ month, day, year }) {
  const boxBase = {
    display: "inline-block",
    border: "2px solid #000",
    textAlign: "center",
    fontSize: 16,
    fontWeight: 800,
    verticalAlign: "top",
  };
  const slash = {
    display: "inline-block",
    fontSize: 20,
    fontWeight: 700,
    verticalAlign: "top",
    lineHeight: "36px",
    margin: "0 6px",
  };
  const cell = (value, label, w) => (
    <span style={{ display: "inline-block", textAlign: "center", verticalAlign: "top" }}>
      <span style={{ ...boxBase, width: w, lineHeight: "34px" }}>{value}</span>
      <br />
      <span style={{ fontSize: 10, display: "block", marginTop: 2 }}>{label}</span>
    </span>
  );
  return (
    <span>
      {cell(month, "(month)", 58)}
      <span style={slash}>/</span>
      {cell(day, "(day)", 58)}
      <span style={slash}>/</span>
      {cell(year, "(year)", 76)}
    </span>
  );
}

function FromTo({ label, value }) {
  return (
    <div style={{ display: "inline-block", marginRight: 40 }}>
      <span style={{ fontWeight: 700, fontSize: 13, marginRight: 6 }}>{label}</span>
      <span style={{
        display: "inline-block",
        borderBottom: "1px solid #000",
        minWidth: 280,
        fontSize: 12,
        fontWeight: 500,
        paddingBottom: 5,
        paddingLeft: 4,
        verticalAlign: "bottom",
      }}>
        {value || ""}
      </span>
    </div>
  );
}

/* ───────── Helpers ───────── */

function minuteToX(minutes) {
  return GRID_LEFT + (minutes / 60) * HOUR_W;
}

function hhmmToMin(hhmm) {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

function decimalToHHMM(decimalHours) {
  if (decimalHours == null || isNaN(decimalHours)) return "0:00";
  const totalMin = Math.round(decimalHours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function shortLocation(loc) {
  if (!loc) return "";
  let out = loc.trim();
  const m = out.match(/^en\s*route\s*\((.+)\)\s*$/i);
  if (m) out = m[1].trim();
  const parts = out.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) out = `${parts[0]}, ${parts[1]}`;
  return out;
}

// Shift every "x,y" pair in a polyline points string by dx pixels on x.
// Used because the row/grid SVG is itself drawn at x=0, but minuteToX
// returns coordinates relative to the page (offset by PAD_X).
function shiftPoints(pointsStr, dx) {
  return pointsStr
    .split(" ")
    .map((p) => {
      const [x, y] = p.split(",").map(Number);
      return `${x + dx},${y}`;
    })
    .join(" ");
}
