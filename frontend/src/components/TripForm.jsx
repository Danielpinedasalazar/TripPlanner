import { useState } from "react";
import LocationInput from "./LocationInput";

const LOCATION_FIELDS = [
  { name: "current_location", label: "Current Location" },
  { name: "pickup_location", label: "Pickup Location" },
  { name: "dropoff_location", label: "Dropoff Location" },
];

const DRIVER_FIELDS = [
  { name: "driver_name", label: "Driver Name" },
  { name: "carrier_name", label: "Carrier Name" },
  { name: "main_office_address", label: "Main Office Address" },
  { name: "vehicle_numbers", label: "Vehicle / Truck Numbers" },
  { name: "co_driver_name", label: "Co-Driver Name" },
  { name: "shipping_number", label: "Pro / Shipping Number" },
];

// Today @ 06:00 in the user's local timezone, formatted for <input type="datetime-local">.
function defaultStartDatetime() {
  const d = new Date();
  d.setHours(6, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

export default function TripForm({ onSubmit, loading }) {
  const [form, setForm] = useState({
    current_location: "",
    pickup_location: "",
    dropoff_location: "",
    current_cycle_used: "",
    start_datetime: defaultStartDatetime(),
    driver_name: "",
    carrier_name: "",
    main_office_address: "",
    vehicle_numbers: "",
    co_driver_name: "",
    shipping_number: "",
  });
  const [showDriverInfo, setShowDriverInfo] = useState(false);

  function handle(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  function submit(e) {
    e.preventDefault();
    // datetime-local gives "YYYY-MM-DDTHH:MM" with no timezone — ship it as
    // a naive ISO string so the backend interprets it as local wall-clock time.
    const payload = {
      ...form,
      current_cycle_used: parseFloat(form.current_cycle_used) || 0,
    };
    if (!payload.start_datetime) delete payload.start_datetime;
    onSubmit(payload);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {/* Trip location fields */}
      {LOCATION_FIELDS.map(({ name, label }) => (
        <div key={name}>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
            {label}
          </label>
          <LocationInput
            name={name}
            value={form[name]}
            onChange={handle}
            required
            placeholder="City, State or full address"
          />
        </div>
      ))}

      <div>
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
          Current Cycle Used (hours, 0–70)
        </label>
        <input
          type="number"
          name="current_cycle_used"
          value={form.current_cycle_used}
          onChange={handle}
          required
          min={0}
          max={70}
          step="0.5"
          placeholder="e.g. 20.5"
          className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-800
                     text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                     placeholder-slate-400 transition"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
          Trip Start (date &amp; time)
        </label>
        <input
          type="datetime-local"
          name="start_datetime"
          value={form.start_datetime}
          onChange={handle}
          className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-800
                     text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                     placeholder-slate-400 transition"
        />
        <p className="text-[11px] text-slate-400 mt-1">
          When the driver actually begins the trip. Defaults to today at 06:00.
        </p>
      </div>

      {/* Optional driver / vehicle info */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setShowDriverInfo((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 bg-slate-50
                     hover:bg-slate-100 transition text-xs font-semibold text-slate-500
                     uppercase tracking-wide"
        >
          <span>Driver &amp; Vehicle Info</span>
          <span className="text-slate-400 text-base leading-none">
            {showDriverInfo ? "−" : "+"}
          </span>
        </button>

        {showDriverInfo && (
          <div className="p-3 space-y-3 border-t border-slate-200">
            <p className="text-xs text-slate-400">
              Optional — appears on the printed log sheet header.
            </p>
            {DRIVER_FIELDS.map(({ name, label }) => (
              <div key={name}>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  {label}
                </label>
                <input
                  type="text"
                  name={name}
                  value={form[name]}
                  onChange={handle}
                  placeholder={`Enter ${label.toLowerCase()}`}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white
                             text-slate-800 text-sm focus:outline-none focus:ring-2
                             focus:ring-blue-500 focus:border-transparent
                             placeholder-slate-400 transition"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300
                   text-white font-semibold text-sm tracking-wide transition"
      >
        {loading ? "Calculating route…" : "Plan Trip"}
      </button>
    </form>
  );
}
