"""
FMCSA HOS Engine — 70hr/8-day Property Carrier, single driver, no sleeper berth.

Rules enforced:
  - 11 hr max driving per shift                       (§395.3(a)(3))
  - 14 hr driving window from first on-duty           (§395.3(a)(2))
  - 30 min break after 8 cumulative driving hours     (§395.3(a)(3)(ii))
  - 10 consecutive hr off-duty between shifts         (§395.3(a)(1))
  - 70 hr / 8-day rolling cycle (true rolling window) (§395.3(b)(2))
  - 34-hr restart resets the rolling cycle            (§395.3(c))
  - Fuel stop every 1,000 miles (~30 min on-duty not driving)
  - 1 hr on-duty (not driving) at pickup
  - 1 hr on-duty (not driving) at dropoff
  - Day starts at 06:00 unless constrained by prior shift
"""

from __future__ import annotations
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Literal

# ──────────────────────────────────────────────
# Types
# ──────────────────────────────────────────────
Status = Literal["off_duty", "driving", "on_duty_not_driving", "sleeper_berth"]

MINUTES_PER_DAY = 1440  # 24 * 60

# HOS limits (all in minutes)
MAX_DRIVING = 11 * 60          # 660 min — driving per shift
MAX_WINDOW = 14 * 60           # 840 min — duty window per shift
BREAK_TRIGGER = 8 * 60         # 480 min — driving before mandatory break
BREAK_DURATION = 30            # min
RESET_OFF = 10 * 60            # 600 min — between shifts
RESTART_OFF = 34 * 60          # 2040 min — 34-hr cycle restart
FUEL_INTERVAL_MILES = 1000.0
FUEL_STOP_DURATION = 30        # min
PICKUP_DURATION = 60           # min
DROPOFF_DURATION = 60          # min
CYCLE_MAX = 70 * 60            # 70 hr in minutes


@dataclass
class Segment:
    status: Status
    start_min: int    # minutes since midnight of log_date (0..1440)
    end_min: int      # minutes since midnight of log_date (0..1440); 1440 == midnight
    location: str
    log_date: date    # which calendar day this segment belongs to

    @property
    def duration_min(self) -> int:
        return self.end_min - self.start_min

    @property
    def start_hhmm(self) -> str:
        return _fmt(self.start_min)

    @property
    def end_hhmm(self) -> str:
        return _fmt(self.end_min)


@dataclass
class LogSheet:
    date: date
    segments: list[Segment] = field(default_factory=list)
    driving_miles: float = 0.0

    @property
    def total_hours(self) -> float:
        return round(sum(s.duration_min for s in self.segments) / 60, 2)

    @property
    def driving_hours(self) -> float:
        return round(
            sum(s.duration_min for s in self.segments if s.status == "driving") / 60, 2
        )

    def to_dict(self) -> dict:
        return {
            "date": str(self.date),
            "driving_miles": round(self.driving_miles, 1),
            "driving_hours": self.driving_hours,
            "segments": [
                {
                    "status": s.status,
                    "start": s.start_hhmm,
                    "end": s.end_hhmm,
                    "location": s.location,
                    "duration_hours": round(s.duration_min / 60, 2),
                }
                for s in self.segments
            ],
            "total_hours": self.total_hours,
            "remarks": _build_remarks(self.segments),
        }


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────
def _fmt(minutes: int) -> str:
    """Convert minutes-of-day (0..1440) to HH:MM. 1440 → '24:00'."""
    if minutes >= MINUTES_PER_DAY:
        return "24:00"
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _build_remarks(segments: list[Segment]) -> list[dict]:
    """
    One remark per duty-status change.
    Returns structured dicts so the frontend can position city labels on the grid.
    """
    remarks = []
    last_status = None
    for s in segments:
        if s.status == last_status:
            continue
        remarks.append({
            "time": s.start_hhmm,
            "time_minutes": s.start_min,
            "location": s.location or "",
            "status": s.status,
        })
        last_status = s.status
    return remarks


def _minutes_to_hours(m: int) -> float:
    return round(m / 60, 2)


# ──────────────────────────────────────────────
# Main engine
# ──────────────────────────────────────────────
def plan_trip(
    *,
    current_location: str,
    pickup_location: str,
    dropoff_location: str,
    leg1_miles: float,
    leg1_hours: float,
    leg2_miles: float,
    leg2_hours: float,
    current_cycle_used_hours: float,
    start_date: date,
) -> dict:
    """
    Simulate a complete trip and return route stops + log sheet data.

    Parameters
    ----------
    leg1_miles/hours          : current_location → pickup_location
    leg2_miles/hours          : pickup_location  → dropoff_location
    current_cycle_used_hours  : on-duty hours already used in the rolling 70/8 cycle
    start_date                : calendar date the trip begins
    """

    total_trip_miles = leg1_miles + leg2_miles

    # ── Cycle state: track on-duty minutes per calendar day for rolling window ──
    on_duty_per_day: dict[date, int] = {}
    initial_used = int(round(current_cycle_used_hours * 60))
    if initial_used > 0:
        # Park initial cycle usage on the day before start; it ages out
        # of the 8-day window naturally as the trip progresses.
        on_duty_per_day[start_date - timedelta(days=1)] = initial_used

    # Last absolute minute when on-duty ended; used to detect 34-hr restart
    last_on_duty_end_abs: int | None = None

    # Current absolute time pointer (minutes from midnight of start_date)
    now_min: int = 6 * 60   # start at 06:00

    # Per-shift counters (reset after 10hr off-duty)
    driving_min: int = 0
    window_start_min: int | None = None
    cumulative_driving_since_break: int = 0

    # Mileage tracking
    miles_since_fuel: float = 0.0
    miles_from_start: float = 0.0
    drive_miles_per_day: dict[date, float] = {}

    all_segments: list[Segment] = []
    stops: list[dict] = []

    # ── Helpers ──────────────────────────────────────────────────────────
    def current_date_for(abs_min: int) -> date:
        return start_date + timedelta(days=abs_min // MINUTES_PER_DAY)

    def current_date() -> date:
        return current_date_for(now_min)

    def maybe_apply_34hr_restart():
        """If a continuous off-duty stretch of ≥34 hrs has occurred, reset the cycle.
        Called whenever the cycle is read or new on-duty time is logged so the
        reset applies eagerly, before driving could falsely trip the cycle cap."""
        nonlocal on_duty_per_day, last_on_duty_end_abs
        if last_on_duty_end_abs is None:
            return
        if now_min - last_on_duty_end_abs >= RESTART_OFF:
            on_duty_per_day = {}
            last_on_duty_end_abs = None

    def cycle_used_min() -> int:
        maybe_apply_34hr_restart()
        today = current_date()
        window_start = today - timedelta(days=7)  # 8 days inclusive
        return sum(m for d, m in on_duty_per_day.items() if d >= window_start)

    def cycle_remaining_min() -> int:
        return CYCLE_MAX - cycle_used_min()

    def record_on_duty_minutes(abs_start: int, abs_end: int):
        """Distribute on-duty minutes across calendar days for rolling cycle accounting."""
        nonlocal last_on_duty_end_abs
        cur = abs_start
        while cur < abs_end:
            day_end_abs = (cur // MINUTES_PER_DAY + 1) * MINUTES_PER_DAY
            chunk_end = min(abs_end, day_end_abs)
            d = current_date_for(cur)
            on_duty_per_day[d] = on_duty_per_day.get(d, 0) + (chunk_end - cur)
            cur = chunk_end
        last_on_duty_end_abs = abs_end

    def add_segment(status: Status, duration_min: int, location: str):
        """Append one or more Segments (split at midnight) and advance now_min."""
        nonlocal now_min
        if duration_min <= 0:
            return

        # 34-hr restart check fires *before* logging new on-duty time
        if status in ("driving", "on_duty_not_driving"):
            maybe_apply_34hr_restart()

        abs_start = now_min
        abs_end = now_min + duration_min

        cur = abs_start
        while cur < abs_end:
            day_end_abs = (cur // MINUTES_PER_DAY + 1) * MINUTES_PER_DAY
            seg_end_abs = min(abs_end, day_end_abs)

            seg_end_local = seg_end_abs - (cur // MINUTES_PER_DAY) * MINUTES_PER_DAY
            all_segments.append(Segment(
                status=status,
                start_min=cur % MINUTES_PER_DAY,
                end_min=seg_end_local,
                location=location,
                log_date=current_date_for(cur),
            ))
            cur = seg_end_abs

        if status in ("driving", "on_duty_not_driving"):
            record_on_duty_minutes(abs_start, abs_end)

        now_min = abs_end

    def check_cycle_available(minutes_needed: int):
        if cycle_remaining_min() < minutes_needed:
            raise ValueError(
                f"70hr/8-day cycle would be exceeded. Used: "
                f"{_minutes_to_hours(cycle_used_min())}hr, "
                f"need: {_minutes_to_hours(minutes_needed)}hr more."
            )

    def on_duty_not_driving(duration_min: int, location: str,
                            stop_type: str | None = None,
                            mile_marker: float | None = None):
        nonlocal window_start_min
        check_cycle_available(duration_min)
        if window_start_min is None:
            window_start_min = now_min
        start_abs = now_min
        add_segment("on_duty_not_driving", duration_min, location)
        if stop_type:
            stops.append(_stop(stop_type, location, start_abs, now_min, mile_marker))

    def take_break(location: str, mile_marker: float | None = None):
        nonlocal cumulative_driving_since_break
        start_abs = now_min
        add_segment("off_duty", BREAK_DURATION, location)
        cumulative_driving_since_break = 0
        stops.append(_stop("break", location, start_abs, now_min, mile_marker))

    def take_rest(location: str, mile_marker: float | None = None):
        nonlocal driving_min, window_start_min, cumulative_driving_since_break
        start_abs = now_min
        add_segment("off_duty", RESET_OFF, location)
        driving_min = 0
        window_start_min = None
        cumulative_driving_since_break = 0
        stops.append(_stop("rest", location, start_abs, now_min, mile_marker))

    def fuel_stop(location: str, mile_marker: float | None = None):
        nonlocal miles_since_fuel
        on_duty_not_driving(FUEL_STOP_DURATION, location,
                            stop_type="fuel", mile_marker=mile_marker)
        miles_since_fuel = 0.0

    def drive_segment(miles: float, location_from: str, location_to: str,
                      actual_hours: float = 0,
                      base_miles_from_start: float = 0):
        """
        Drive `miles` from location_from toward location_to, respecting all HOS limits.
        actual_hours sets the real average speed for this leg; defaults to 55 mph.
        """
        nonlocal driving_min, window_start_min, cumulative_driving_since_break
        nonlocal miles_since_fuel, miles_from_start, now_min

        if miles <= 0:
            return

        speed_mph = (miles / actual_hours) if actual_hours > 0 else 55.0
        remaining_miles = miles

        while remaining_miles > 0.001:
            if window_start_min is None:
                window_start_min = now_min

            window_used = now_min - window_start_min
            window_remaining = MAX_WINDOW - window_used
            driving_remaining = MAX_DRIVING - driving_min
            break_remaining = BREAK_TRIGGER - cumulative_driving_since_break
            cycle_remaining = cycle_remaining_min()

            miles_to_fuel = FUEL_INTERVAL_MILES - miles_since_fuel
            fuel_time_min = (miles_to_fuel / speed_mph) * 60 if speed_mph > 0 else float("inf")

            done_fraction = 1 - remaining_miles / miles
            mid_location = _interpolate_location(location_from, location_to, done_fraction)
            mid_mile_marker = base_miles_from_start + (miles - remaining_miles)

            # Need a 10-hr rest first?
            if driving_remaining <= 0 or window_remaining <= 0 or cycle_remaining <= 0:
                if cycle_remaining <= 0:
                    # Only a 34-hr restart frees more cycle hours
                    take_rest_until_restart(mid_location, mid_mile_marker)
                else:
                    take_rest(mid_location, mid_mile_marker)
                    _advance_to_next_morning()
                continue

            # Need a 30-min break first?
            if break_remaining <= 0:
                take_break(mid_location, mid_mile_marker)
                continue

            driveable_min = min(
                driving_remaining,
                window_remaining,
                break_remaining,
                fuel_time_min,
                cycle_remaining,
            )
            driveable_miles = (driveable_min / 60) * speed_mph

            if driveable_miles <= 0.001:
                # Forced stop (shouldn't normally happen — guards above)
                take_break(mid_location, mid_mile_marker)
                continue

            chunk_miles = min(driveable_miles, remaining_miles)
            chunk_min = max(1, int(round((chunk_miles / speed_mph) * 60)))

            check_cycle_available(chunk_min)
            seg_day = current_date_for(now_min)
            add_segment("driving", chunk_min, mid_location)
            driving_min += chunk_min
            cumulative_driving_since_break += chunk_min
            miles_since_fuel += chunk_miles
            miles_from_start += chunk_miles
            remaining_miles -= chunk_miles
            drive_miles_per_day[seg_day] = (
                drive_miles_per_day.get(seg_day, 0.0) + chunk_miles
            )

            # Hit fuel threshold mid-trip?
            if miles_since_fuel >= FUEL_INTERVAL_MILES and remaining_miles > 0.001:
                done_fraction = 1 - remaining_miles / miles
                mid_loc = _interpolate_location(location_from, location_to, done_fraction)
                mid_mm = base_miles_from_start + (miles - remaining_miles)
                fuel_stop(mid_loc, mile_marker=mid_mm)

    def _advance_to_next_morning():
        """After a 10-hr (or 34-hr) reset, fast-forward off-duty until the
        nearest upcoming 06:00 — same calendar day if we're still before 06:00,
        otherwise the next day."""
        nonlocal now_min, window_start_min, driving_min, cumulative_driving_since_break
        next_600 = ((now_min - 6 * 60) // MINUTES_PER_DAY + 1) * MINUTES_PER_DAY + 6 * 60
        if now_min < next_600:
            gap = next_600 - now_min
            pad_loc = all_segments[-1].location if all_segments else ""
            add_segment("off_duty", gap, pad_loc)
        window_start_min = None
        driving_min = 0
        cumulative_driving_since_break = 0

    def take_rest_until_restart(location: str, mile_marker: float | None = None):
        """Take a 34-hr restart to reset the 70/8 cycle."""
        nonlocal driving_min, window_start_min, cumulative_driving_since_break
        start_abs = now_min
        add_segment("off_duty", RESTART_OFF, location)
        driving_min = 0
        window_start_min = None
        cumulative_driving_since_break = 0
        # Cycle reset happens on next on-duty add via maybe_apply_34hr_restart()
        stops.append(_stop("restart", location, start_abs, now_min, mile_marker))
        _advance_to_next_morning()

    def _stop(stop_type: str, location: str, abs_start: int, abs_end: int,
              mile_marker: float | None) -> dict:
        return {
            "type": stop_type,
            "location": location,
            "arrival": _fmt(abs_start % MINUTES_PER_DAY),
            "departure": _fmt(abs_end % MINUTES_PER_DAY),
            "arrival_date": str(current_date_for(abs_start)),
            "departure_date": str(current_date_for(abs_end - 1)),
            "lat": None,
            "lng": None,
            "mile_marker": round(mile_marker, 1) if mile_marker is not None else None,
        }

    # ── Trip simulation ──────────────────────────────────────────────────

    # Pre-trip: midnight → 06:00 on day 0 logged as off-duty
    if now_min > 0:
        all_segments.append(Segment(
            status="off_duty",
            start_min=0,
            end_min=now_min,
            location=current_location,
            log_date=start_date,
        ))

    # Record start as a "stop" so the UI shows it cleanly
    stops.append({
        "type": "start",
        "location": current_location,
        "arrival": _fmt(now_min % MINUTES_PER_DAY),
        "departure": _fmt(now_min % MINUTES_PER_DAY),
        "arrival_date": str(current_date()),
        "departure_date": str(current_date()),
        "lat": None,
        "lng": None,
        "mile_marker": 0.0,
    })

    # Leg 1: current → pickup
    drive_segment(leg1_miles, current_location, pickup_location,
                  actual_hours=leg1_hours, base_miles_from_start=0.0)

    # Pickup: 1 hr on-duty not driving
    on_duty_not_driving(PICKUP_DURATION, pickup_location,
                        stop_type="pickup", mile_marker=leg1_miles)

    # Leg 2: pickup → dropoff
    drive_segment(leg2_miles, pickup_location, dropoff_location,
                  actual_hours=leg2_hours, base_miles_from_start=leg1_miles)

    # Dropoff: 1 hr on-duty not driving
    on_duty_not_driving(DROPOFF_DURATION, dropoff_location,
                        stop_type="dropoff", mile_marker=total_trip_miles)

    # Final 10-hr rest to close out the trip
    take_rest(dropoff_location, mile_marker=total_trip_miles)

    # ── Build log sheets (one per calendar day) ──────────────────────────
    sheets = _build_log_sheets(all_segments)
    for sheet in sheets.values():
        _fill_to_24h(sheet)

    # Attach driving miles to each sheet
    for d, sheet in sheets.items():
        sheet.driving_miles = drive_miles_per_day.get(d, 0.0)

    # Sort, then trim trailing days that contain no driving or on-duty work
    # (the final 10-hr rest can spill past midnight into an otherwise empty day,
    # which adds no trip information for the planner UI).
    ordered = sorted(sheets.values(), key=lambda x: x.date)
    while ordered and not any(
        seg.status in ("driving", "on_duty_not_driving")
        for seg in ordered[-1].segments
    ):
        ordered.pop()

    return {
        "stops": stops,
        "log_sheets": [s.to_dict() for s in ordered],
        "cycle_summary": {
            "starting_cycle_hours": current_cycle_used_hours,
            "ending_cycle_hours": _minutes_to_hours(cycle_used_min()),
            "cycle_max_hours": _minutes_to_hours(CYCLE_MAX),
        },
    }


def _interpolate_location(loc_from: str, loc_to: str, fraction: float) -> str:
    """Simple label for mid-route position."""
    if fraction <= 0.05:
        return loc_from
    if fraction >= 0.95:
        return loc_to
    return f"En route ({loc_from} → {loc_to})"


def _build_log_sheets(segments: list[Segment]) -> dict[date, LogSheet]:
    sheets: dict[date, LogSheet] = {}
    for seg in segments:
        d = seg.log_date
        if d not in sheets:
            sheets[d] = LogSheet(date=d)
        sheets[d].segments.append(seg)
    return sheets


def _fill_to_24h(sheet: LogSheet):
    """
    Pad a log sheet's segments so they cover exactly 1440 minutes (midnight→midnight).
    Gaps are filled as off_duty.
    """
    if not sheet.segments:
        sheet.segments.append(Segment(
            status="off_duty",
            start_min=0,
            end_min=MINUTES_PER_DAY,
            location="",
            log_date=sheet.date,
        ))
        return

    sheet.segments.sort(key=lambda s: s.start_min)

    filled: list[Segment] = []
    cursor = 0
    last_location = sheet.segments[0].location

    for seg in sheet.segments:
        if seg.start_min > cursor:
            filled.append(Segment(
                status="off_duty",
                start_min=cursor,
                end_min=seg.start_min,
                location=last_location,
                log_date=sheet.date,
            ))
        filled.append(seg)
        cursor = seg.end_min
        last_location = seg.location

    if cursor < MINUTES_PER_DAY:
        filled.append(Segment(
            status="off_duty",
            start_min=cursor,
            end_min=MINUTES_PER_DAY,
            location=last_location,
            log_date=sheet.date,
        ))

    sheet.segments = filled
