import { useEffect, useRef, useState } from "react";
import { autocompletePlace } from "../api/tripApi";

const DEBOUNCE_MS = 220;

export default function LocationInput({
  name,
  value,
  onChange,
  placeholder,
  required = false,
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef(null);
  const abortRef = useRef(null);
  const lastQueryRef = useRef("");

  // Debounced fetch on value changes
  useEffect(() => {
    const q = (value ?? "").trim();
    // Don't re-fetch right after a user picks a suggestion (value === lastQuery)
    if (q.length < 2 || q === lastQueryRef.current) {
      setSuggestions([]);
      return;
    }
    const handle = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      try {
        const results = await autocompletePlace(q, ctrl.signal);
        setSuggestions(results);
        setOpen(results.length > 0);
        setHighlighted(-1);
      } catch (err) {
        if (err.name !== "CanceledError" && err.name !== "AbortError") {
          setSuggestions([]);
        }
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [value]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function pickSuggestion(s) {
    lastQueryRef.current = s.label;
    onChange({ target: { name, value: s.label } });
    setOpen(false);
    setSuggestions([]);
    setHighlighted(-1);
  }

  function handleKeyDown(e) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && highlighted >= 0) {
      e.preventDefault();
      pickSuggestion(suggestions[highlighted]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        name={name}
        value={value}
        onChange={(e) => {
          lastQueryRef.current = "";
          onChange(e);
        }}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        required={required}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-800
                   text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                   placeholder-slate-400 transition"
      />

      {loading && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
          <div className="w-3 h-3 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin" />
        </div>
      )}

      {open && suggestions.length > 0 && (
        <ul
          className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg
                     shadow-lg z-20 max-h-64 overflow-auto py-1 text-sm"
        >
          {suggestions.map((s, i) => (
            <li
              key={`${s.label}-${i}`}
              onMouseDown={(e) => {
                e.preventDefault(); // keep input focused
                pickSuggestion(s);
              }}
              onMouseEnter={() => setHighlighted(i)}
              className={`px-3 py-2 cursor-pointer flex items-center gap-2 ${
                highlighted === i ? "bg-blue-50" : "hover:bg-slate-50"
              }`}
            >
              <span className="text-slate-400 text-xs">📍</span>
              <span className="flex-1 truncate">
                <span className="text-slate-800 font-medium">{s.name || s.label}</span>
                {s.region && (
                  <span className="text-slate-400 ml-1">
                    · {s.region}
                    {s.country ? `, ${s.country}` : ""}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
