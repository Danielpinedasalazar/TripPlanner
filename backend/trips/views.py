import math
import traceback
from datetime import date

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
import requests as http_requests

from .serializers import TripPlanRequestSerializer
from . import routing, hos_engine


class PlaceAutocompleteView(APIView):
    """GET /api/places/autocomplete/?q=chic — typeahead suggestions for cities."""
    def get(self, request):
        q = request.query_params.get("q", "").strip()
        if len(q) < 2:
            return Response({"results": []})
        try:
            results = routing.autocomplete(q)
            return Response({"results": results})
        except http_requests.HTTPError as exc:
            return Response(
                {"error": f"Autocomplete failed: {exc.response.status_code}",
                 "results": []},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        except Exception as exc:
            traceback.print_exc()
            return Response({"error": str(exc), "results": []},
                            status=status.HTTP_502_BAD_GATEWAY)


class TripPlanView(APIView):
    def post(self, request):
        ser = TripPlanRequestSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        d = ser.validated_data
        current_loc = d["current_location"]
        pickup_loc = d["pickup_location"]
        dropoff_loc = d["dropoff_location"]
        cycle_used = d["current_cycle_used"]
        driver_info = {
            "driver_name": d.get("driver_name", ""),
            "carrier_name": d.get("carrier_name", ""),
            "main_office_address": d.get("main_office_address", ""),
            "vehicle_numbers": d.get("vehicle_numbers", ""),
            "shipping_number": d.get("shipping_number", ""),
            "co_driver_name": d.get("co_driver_name", ""),
        }

        try:
            # ── Geocode ──────────────────────────────────────────────
            current_coords = routing.geocode(current_loc)
            pickup_coords = routing.geocode(pickup_loc)
            dropoff_coords = routing.geocode(dropoff_loc)

            # ── Route (3-point in one call) ───────────────────────────
            route_data = routing.get_combined_route(
                current_coords, pickup_coords, dropoff_coords
            )

            leg1_miles = route_data["leg_miles"][0]
            leg1_hours = route_data["leg_hours"][0]
            leg2_miles = route_data["leg_miles"][1]
            leg2_hours = route_data["leg_hours"][1]

            # ── HOS simulation ────────────────────────────────────────
            hos_result = hos_engine.plan_trip(
                current_location=current_loc,
                pickup_location=pickup_loc,
                dropoff_location=dropoff_loc,
                leg1_miles=leg1_miles,
                leg1_hours=leg1_hours,
                leg2_miles=leg2_miles,
                leg2_hours=leg2_hours,
                current_cycle_used_hours=cycle_used,
                start_date=date.today(),
            )

            # ── Resolve stop coordinates ─────────────────────────────
            named_coords = {
                current_loc: current_coords,
                pickup_loc: pickup_coords,
                dropoff_loc: dropoff_coords,
            }
            geometry = route_data.get("geojson", {})
            cumulative = _cumulative_miles(geometry)

            for stop in hos_result["stops"]:
                # Named locations: use exact geocoded coords
                coords = named_coords.get(stop["location"])
                if coords:
                    stop["lat"], stop["lng"] = coords
                    continue
                # Mid-route stops: interpolate along the route polyline
                mm = stop.get("mile_marker")
                if mm is not None and cumulative:
                    pt = _point_at_distance(geometry, cumulative, mm)
                    if pt:
                        stop["lat"], stop["lng"] = pt

            # Embed driver_info into every log sheet for the frontend header
            log_sheets = []
            for sheet in hos_result["log_sheets"]:
                log_sheets.append({**sheet, "driver_info": driver_info})

            return Response({
                "route": {
                    "geojson": route_data["geojson"],
                    "total_miles": round(route_data["total_miles"], 1),
                    "total_duration_hours": round(route_data["total_duration_hours"], 2),
                    "waypoints": [
                        {"label": current_loc, "lat": current_coords[0], "lng": current_coords[1]},
                        {"label": pickup_loc, "lat": pickup_coords[0], "lng": pickup_coords[1]},
                        {"label": dropoff_loc, "lat": dropoff_coords[0], "lng": dropoff_coords[1]},
                    ],
                },
                "stops": hos_result["stops"],
                "log_sheets": log_sheets,
                "cycle_summary": hos_result["cycle_summary"],
            })

        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except http_requests.HTTPError as exc:
            traceback.print_exc()
            code = exc.response.status_code if exc.response is not None else "?"
            body = ""
            try:
                body = exc.response.json().get("error", {}).get("message", "") or exc.response.text[:300]
            except Exception:
                pass
            if code == 404:
                msg = (
                    "Could not find a driveable route between those locations. "
                    "Check that the addresses are reachable by road and try again."
                )
            elif code == 403:
                msg = "Routing API key is invalid or quota exceeded. Check your OPENROUTESERVICE_API_KEY."
            elif code == 429:
                msg = "Routing API rate limit hit. Wait a moment and try again."
            else:
                msg = f"Routing API error ({code}): {body}" if body else f"Routing API error ({code})."
            return Response({"error": msg}, status=status.HTTP_502_BAD_GATEWAY)
        except Exception as exc:
            traceback.print_exc()
            return Response(
                {"error": f"Trip planning failed: {str(exc)}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )


# ──────────────────────────────────────────────
# Geometry helpers — interpolate a (lat, lng) at a given mile marker
# along the route LineString returned by OpenRouteService.
# ──────────────────────────────────────────────
_EARTH_RADIUS_MI = 3958.7613


def _haversine_miles(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Distance in miles between two (lng, lat) GeoJSON points."""
    lng1, lat1 = a
    lng2, lat2 = b
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dlmb = math.radians(lng2 - lng1)
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * _EARTH_RADIUS_MI * math.asin(math.sqrt(h))


def _cumulative_miles(geometry: dict) -> list[float]:
    """Cumulative distance (miles) at each vertex of a GeoJSON LineString."""
    if not geometry or geometry.get("type") != "LineString":
        return []
    coords = geometry.get("coordinates", [])
    if len(coords) < 2:
        return []
    out = [0.0]
    for i in range(1, len(coords)):
        out.append(out[-1] + _haversine_miles(coords[i - 1], coords[i]))
    return out


def _point_at_distance(geometry: dict, cumulative: list[float],
                       mile_marker: float) -> tuple[float, float] | None:
    """Return (lat, lng) at `mile_marker` along the polyline, or None."""
    coords = geometry.get("coordinates", [])
    if not coords or not cumulative:
        return None
    target = max(0.0, min(mile_marker, cumulative[-1]))
    # Binary-search would be faster, but routes are small enough for linear scan
    for i in range(1, len(cumulative)):
        if cumulative[i] >= target:
            seg_len = cumulative[i] - cumulative[i - 1]
            if seg_len <= 0:
                lng, lat = coords[i]
                return lat, lng
            t = (target - cumulative[i - 1]) / seg_len
            lng1, lat1 = coords[i - 1]
            lng2, lat2 = coords[i]
            return (lat1 + (lat2 - lat1) * t, lng1 + (lng2 - lng1) * t)
    lng, lat = coords[-1]
    return lat, lng
