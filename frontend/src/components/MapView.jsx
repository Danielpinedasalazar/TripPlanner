import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { useEffect } from "react";

// Fix Leaflet's default icon paths when bundled with Vite
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const STOP_COLORS = {
  start: "#1d4ed8",
  pickup: "#10b981",
  dropoff: "#8b5cf6",
  rest: "#f59e0b",
  restart: "#ea580c",
  fuel: "#0ea5e9",
  break: "#f43f5e",
};

function makeIcon(color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 24 32">
    <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20S24 21 24 12C24 5.4 18.6 0 12 0z"
          fill="${color}" stroke="white" stroke-width="2"/>
    <circle cx="12" cy="12" r="5" fill="white"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [24, 32],
    iconAnchor: [12, 32],
    popupAnchor: [0, -32],
  });
}

const waypointIcon = makeIcon("#1d4ed8");

function FitBounds({ coords }) {
  const map = useMap();
  useEffect(() => {
    if (coords && coords.length > 1) {
      map.fitBounds(L.latLngBounds(coords), { padding: [40, 40] });
    }
  }, [coords, map]);
  return null;
}

export default function MapView({ geojson, waypoints, stops }) {
  const routeCoords = geojson?.coordinates?.map(([lng, lat]) => [lat, lng]) ?? [];

  // Waypoints already render start/pickup/dropoff — skip those here to avoid duplicates.
  const MID_STOPS = new Set(["rest", "restart", "fuel", "break"]);
  const namedStops =
    stops?.filter((s) => s.lat && s.lng && MID_STOPS.has(s.type)) ?? [];

  return (
    <MapContainer
      center={[39.5, -98.35]}
      zoom={4}
      className="w-full h-full rounded-xl"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {routeCoords.length > 1 && (
        <>
          <Polyline
            positions={routeCoords}
            pathOptions={{ color: "#1d4ed8", weight: 5, opacity: 0.85 }}
          />
          <FitBounds coords={routeCoords} />
        </>
      )}

      {waypoints?.map((wp, i) => (
        <Marker key={i} position={[wp.lat, wp.lng]} icon={waypointIcon}>
          <Popup>
            <strong>{wp.label}</strong>
          </Popup>
        </Marker>
      ))}

      {namedStops.map((stop, i) => (
        <Marker
          key={`stop-${i}`}
          position={[stop.lat, stop.lng]}
          icon={makeIcon(STOP_COLORS[stop.type] ?? "#64748b")}
        >
          <Popup>
            <strong className="capitalize">{stop.type}</strong>
            <br />
            {stop.location}
            <br />
            <span className="text-xs text-gray-500">
              {stop.arrival} → {stop.departure}
            </span>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
