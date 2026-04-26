import requests
from django.conf import settings

ORS_BASE = "https://api.openrouteservice.org"
ORS_PROFILE = "driving-car"


def _headers():
    return {"Authorization": settings.OPENROUTESERVICE_API_KEY}


def geocode(address: str) -> tuple[float, float]:
    """Return (lat, lng) for a plain-text address."""
    url = f"{ORS_BASE}/geocode/search"
    resp = requests.get(
        url,
        headers=_headers(),
        params={"text": address, "size": 1},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    features = data.get("features", [])
    if not features:
        raise ValueError(f"Could not geocode address: {address!r}")
    lng, lat = features[0]["geometry"]["coordinates"]
    return lat, lng


def autocomplete(query: str, size: int = 6) -> list[dict]:
    """
    Return up to `size` city/place suggestions for partial text.
    Uses ORS /geocode/autocomplete and returns a compact, frontend-friendly shape.
    """
    if not query or len(query.strip()) < 2:
        return []
    url = f"{ORS_BASE}/geocode/autocomplete"
    resp = requests.get(
        url,
        headers=_headers(),
        params={
            "text": query,
            "size": size,
            "layers": "locality,region,county,localadmin,neighbourhood",
        },
        timeout=8,
    )
    resp.raise_for_status()
    data = resp.json()
    out: list[dict] = []
    for feat in data.get("features", []):
        props = feat.get("properties", {})
        coords = feat.get("geometry", {}).get("coordinates", [None, None])
        lng, lat = coords[0], coords[1]
        out.append({
            "label": props.get("label") or props.get("name") or "",
            "name": props.get("name", ""),
            "region": props.get("region", ""),
            "country": props.get("country_a") or props.get("country", ""),
            "lat": lat,
            "lng": lng,
        })
    return out


def get_route(
    origin_coords: tuple[float, float],
    dest_coords: tuple[float, float],
) -> dict:
    """
    Get driving route between two (lat, lng) pairs.
    Returns:
        {
            "geojson": LineString GeoJSON,
            "distance_miles": float,
            "duration_hours": float,
        }
    """
    url = f"{ORS_BASE}/v2/directions/driving-car/geojson"
    body = {
        "coordinates": [
            [origin_coords[1], origin_coords[0]],
            [dest_coords[1], dest_coords[0]],
        ],
        "radiuses": [-1, -1],  # snap to nearest road regardless of distance
    }
    resp = requests.post(url, headers=_headers(), json=body, timeout=15)
    resp.raise_for_status()
    data = resp.json()

    feature = data["features"][0]
    summary = feature["properties"]["summary"]
    distance_meters = summary["distance"]
    duration_seconds = summary["duration"]

    return {
        "geojson": feature["geometry"],
        "distance_miles": distance_meters * 0.000621371,
        "duration_hours": duration_seconds / 3600,
    }


def get_combined_route(
    coords_a: tuple[float, float],
    coords_b: tuple[float, float],
    coords_c: tuple[float, float],
) -> dict:
    """
    Attempt a single 3-waypoint ORS call; if that fails (e.g. 404 / 400 on
    some regional networks), fall back to two separate leg calls and merge.
    """
    try:
        return _combined_route_single_call(coords_a, coords_b, coords_c)
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code in (400, 404):
            return _combined_route_two_legs(coords_a, coords_b, coords_c)
        raise


def _combined_route_single_call(coords_a, coords_b, coords_c) -> dict:
    url = f"{ORS_BASE}/v2/directions/driving-car/geojson"
    body = {
        "coordinates": [
            [coords_a[1], coords_a[0]],
            [coords_b[1], coords_b[0]],
            [coords_c[1], coords_c[0]],
        ],
        "radiuses": [-1, -1, -1],
    }
    resp = requests.post(url, headers=_headers(), json=body, timeout=15)
    resp.raise_for_status()
    data = resp.json()

    feature = data["features"][0]
    summary = feature["properties"]["summary"]
    segments = feature["properties"].get("segments", [])

    leg_miles = [seg["distance"] * 0.000621371 for seg in segments]
    leg_hours = [seg["duration"] / 3600 for seg in segments]

    return {
        "geojson": feature["geometry"],
        "total_miles": summary["distance"] * 0.000621371,
        "total_duration_hours": summary["duration"] / 3600,
        "leg_miles": leg_miles,
        "leg_hours": leg_hours,
    }


def _combined_route_two_legs(coords_a, coords_b, coords_c) -> dict:
    """Fallback: call ORS twice (A→B, B→C) and merge the LineStrings."""
    leg1 = get_route(coords_a, coords_b)
    leg2 = get_route(coords_b, coords_c)

    # Merge coordinates — drop the duplicate midpoint at the join
    coords1 = leg1["geojson"]["coordinates"]
    coords2 = leg2["geojson"]["coordinates"]
    merged_coords = coords1 + coords2[1:]

    total_miles = leg1["distance_miles"] + leg2["distance_miles"]
    total_hours = leg1["duration_hours"] + leg2["duration_hours"]

    return {
        "geojson": {"type": "LineString", "coordinates": merged_coords},
        "total_miles": total_miles,
        "total_duration_hours": total_hours,
        "leg_miles": [leg1["distance_miles"], leg2["distance_miles"]],
        "leg_hours": [leg1["duration_hours"], leg2["duration_hours"]],
    }
