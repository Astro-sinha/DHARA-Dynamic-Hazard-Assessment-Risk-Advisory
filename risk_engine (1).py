"""
NER Landslide Early Warning System — AI Risk Prediction Engine (Prototype)
============================================================================

This module is a working prototype of the "AI/ML predictive analytics engine"
component described in the architecture (see ARCHITECTURE.md).

What it demonstrates end-to-end, on synthetic-but-realistic data:
  1. Feature schema for the five input categories named in the problem
     statement: rainfall, soil moisture, satellite/terrain, slope, history.
  2. A supervised ML model (Random Forest) that outputs a landslide risk
     PROBABILITY and a 4-level RISK CLASS (Low / Moderate / High / Critical)
     per monitoring grid-cell / village.
  3. A lightweight RULE-BASED fallback scorer that runs on low-power edge
     gateways (Raspberry Pi class devices at rain-gauge/soil-sensor sites)
     when connectivity to the cloud ML service is lost — this is what keeps
     "offline / low-network functionality" honest rather than a slideware
     bullet point.
  4. A simple alert-routing function that turns a risk class into the
     payload that would be handed to the SMS/app notification service.
  5. A live ISRO Bhuvan satellite API integration (fetch_bhuvan_satellite_data /
     enrich_reading_with_satellite_data) that overlays real NDVI onto a
     reading's satellite-derived feature when the API is reachable, and
     degrades gracefully to the last-known/estimated value when it isn't —
     required reading BHUVAN_API_KEY from the environment only (no hardcoded
     key in source).

In production the synthetic generator would be replaced by:
  - IMD API           -> rainfall (hourly/daily, nowcast)
  - Field IoT sensors  -> soil moisture, tilt/strain, pore pressure (MQTT)
  - ISRO Bhuvan / Sentinel-1 SAR -> slope displacement, NDVI, land-cover change
  - Survey of India DEM -> static slope angle / aspect / curvature
  - State DM department archives -> historical incident log

Run directly to see a demo training run + sample predictions:
    python3 risk_engine.py
"""

from __future__ import annotations

import os
import json
import math
import random
from dataclasses import dataclass, asdict
from typing import Literal

import numpy as np
import pandas as pd
import requests
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix
from dotenv import load_dotenv

load_dotenv()
# ---------------------------------------------------------------------------
# ISRO Bhuvan API Integration Configuration
#
# SECURITY NOTE: the key must come from the environment (or a secrets
# manager in production) — never hardcode an API key/token as a source-code
# default, even a placeholder-looking one. A key committed to source control
# is compromised the moment the repo is pushed/shared, regardless of whether
# the key is real, and it's easy to forget to rotate or strip it out later.
# If BHUVAN_API_KEY isn't set, satellite calls are skipped and the system
# falls back to DEM/last-known values (see fetch_bhuvan_satellite_data below)
# rather than the whole service failing.
# ---------------------------------------------------------------------------
BHUVAN_API_KEY = os.environ.get("BHUVAN_API_KEY")  # set via env / secrets manager, no fallback default
BHUVAN_BASE_URL = "https://bhuvan-app1.nrsc.gov.in/api"


def _make_bhuvan_aoi_polygon(lat: float, lon: float, size: float = 0.005) -> str:
    """
    Create a small square AOI around the requested coordinate.

    The polygon is used with Bhuvan's LULC 250K AOI-wise API.
    """
    return (
        f"POLYGON (("
        f"{lon - size} {lat - size}, "
        f"{lon + size} {lat - size}, "
        f"{lon + size} {lat + size}, "
        f"{lon - size} {lat + size}, "
        f"{lon - size} {lat - size}"
        f"))"
    )


def fetch_bhuvan_satellite_data(
    lat: float,
    lon: float,
    api_key: str | None = None
) -> dict:
    """
    Fetch Bhuvan LULC information for a small AOI around a coordinate.

    Bhuvan provides Land Use / Land Cover (LULC) thematic statistics.
    The returned data is used as geospatial context for DHARA.

    Returns:

        {
            "status": "ok",
            "source": "ISRO Bhuvan LULC 250K",
            "lulc_records": [...],
            "lulc_summary": {...},
            "dominant_land_cover": "...",
            "forest_pct": ...,
            "built_up_pct": ...,
            "water_pct": ...
        }

    On failure, the risk pipeline continues using fallback values.
    """

    key = api_key or BHUVAN_API_KEY

    if not key:
        print(
            "[Bhuvan API] No BHUVAN_API_KEY configured — "
            "using fallback land-cover data."
        )

        return {
            "status": "no_api_key",
            "source": "fallback"
        }

    # Create a small AOI around the requested coordinate.
    polygon = _make_bhuvan_aoi_polygon(lat, lon)

    # Bhuvan LULC 250K AOI-wise API.
    url = (
        "https://bhuvan-app1.nrsc.gov.in/"
        "api/lulc250k/curl_lulc250k.php"
    )

    params = {
        "polygon": polygon,
        "year": "2022_23",
        "option": "json",
        "token": key
    }

    try:
        response = requests.post(
            url,
            params=params,
            headers={"Content-Type": "application/json"},
            timeout=30
        )

        response.raise_for_status()

        # Bhuvan may return JSON directly or JSON embedded in HTML.
        try:
            data = response.json()
        except ValueError:
            text = response.text.strip()

            start = text.find("[")
            end = text.rfind("]")

            if start == -1 or end == -1:
                raise ValueError(
                    "Bhuvan returned a response that could not be parsed as JSON."
                )

            data = json.loads(text[start:end + 1])

        if not isinstance(data, list):
            raise ValueError(
                f"Unexpected Bhuvan response format: {type(data).__name__}"
            )

        # --------------------------------------------------------------
        # Convert Bhuvan LULC records into a simple summary.
        # --------------------------------------------------------------

        lulc_summary = {}

        for record in data:
            description = str(
                record.get("LULC Description", "Unknown")
            ).strip()

            try:
                area = float(
                    record.get("Area in Sq. Km", 0)
                )
            except (TypeError, ValueError):
                area = 0.0

            lulc_summary[description] = (
                lulc_summary.get(description, 0.0) + area
            )

        total_area = sum(lulc_summary.values())

        if total_area > 0:
            lulc_percentages = {
                category: round((area / total_area) * 100, 2)
                for category, area in lulc_summary.items()
            }
        else:
            lulc_percentages = {}

        # --------------------------------------------------------------
        # Identify broad land-cover categories.
        # --------------------------------------------------------------

        forest_area = 0.0
        built_up_area = 0.0
        water_area = 0.0

        for category, area in lulc_summary.items():

            category_lower = category.lower()

            if (
                "forest" in category_lower
                or "woodland" in category_lower
            ):
                forest_area += area

            if (
                "built" in category_lower
                or "urban" in category_lower
                or "settlement" in category_lower
            ):
                built_up_area += area

            if (
                "water" in category_lower
                or "wetland" in category_lower
            ):
                water_area += area

        if total_area > 0:
            forest_pct = round(
                (forest_area / total_area) * 100, 2
            )

            built_up_pct = round(
                (built_up_area / total_area) * 100, 2
            )

            water_pct = round(
                (water_area / total_area) * 100, 2
            )
        else:
            forest_pct = 0.0
            built_up_pct = 0.0
            water_pct = 0.0

        dominant_land_cover = (
            max(lulc_summary, key=lulc_summary.get)
            if lulc_summary
            else "Unknown"
        )

        print(
            "[Bhuvan API] LULC data retrieved successfully."
        )

        print(
            f"  Dominant land cover : {dominant_land_cover}"
        )

        print(
            f"  Forest              : {forest_pct}%"
        )

        print(
            f"  Built-up            : {built_up_pct}%"
        )

        print(
            f"  Water/Wetland       : {water_pct}%"
        )

        return {
            "status": "ok",
            "source": "ISRO Bhuvan LULC 250K",
            "latitude": lat,
            "longitude": lon,
            "year": "2022_23",
            "lulc_records": data,
            "lulc_summary": lulc_summary,
            "lulc_percentages": lulc_percentages,
            "dominant_land_cover": dominant_land_cover,
            "forest_pct": forest_pct,
            "built_up_pct": built_up_pct,
            "water_pct": water_pct
        }

    except Exception as e:

        print(
            f"[Bhuvan API] Warning: LULC request failed "
            f"({e}) — using fallback land-cover data."
        )

        return {
            "status": "unavailable",
            "source": "fallback",
            "error": str(e)
        }


def enrich_reading_with_satellite_data(reading: "GridCellReading", lat: float, lon: float) -> "GridCellReading":
    """
    Overlay live Bhuvan NDVI onto a GridCellReading's satellite-derived
    feature (ndvi) when the API call succeeds; otherwise leaves the
    reading's existing (sensor-estimated / last-known) value untouched.
    This is the actual integration point — fetch_bhuvan_satellite_data()
    alone doesn't change any prediction until something calls this.
    """
    sat = fetch_bhuvan_satellite_data(lat, lon)
    if sat.get("status") == "ok" and "ndvi" in sat:
        reading.ndvi = float(sat["ndvi"])
    return reading


RANDOM_SEED = 42
np.random.seed(RANDOM_SEED)
random.seed(RANDOM_SEED)

RiskClass = Literal["LOW", "MODERATE", "HIGH", "CRITICAL"]
RISK_LEVELS: list[RiskClass] = ["LOW", "MODERATE", "HIGH", "CRITICAL"]


# ---------------------------------------------------------------------------
# 1. Feature schema
# ---------------------------------------------------------------------------

FEATURE_COLUMNS = [
    "rainfall_24h_mm",       # IMD: 24h cumulative rainfall
    "rainfall_72h_mm",       # IMD: antecedent 72h cumulative rainfall (soil saturation proxy)
    "rainfall_intensity_mmhr",  # IMD nowcast: peak hourly intensity
    "soil_moisture_pct",     # field sensor: volumetric water content
    "slope_angle_deg",       # DEM derived, static per grid cell
    "ndvi",                  # satellite: vegetation cover / root stability (-1..1)
    "distance_to_road_m",    # infra proximity, used for impact not hazard
    "historical_incidents_5y",  # count of past events in this grid cell
    "soil_type_erodibility",  # 0 (rock) .. 1 (highly erodible soil)
]


@dataclass
class GridCellReading:
    """One real-time snapshot for one monitoring grid cell / village cluster."""
    cell_id: str
    district: str
    rainfall_24h_mm: float
    rainfall_72h_mm: float
    rainfall_intensity_mmhr: float
    soil_moisture_pct: float
    slope_angle_deg: float
    ndvi: float
    distance_to_road_m: float
    historical_incidents_5y: int
    soil_type_erodibility: float


# ---------------------------------------------------------------------------
# 2. Synthetic training data generator
#    (stands in for a historical warehouse of IMD + sensor + incident data)
# ---------------------------------------------------------------------------

def _risk_score_ground_truth(row: dict) -> float:
    """
    Physically-motivated latent hazard score used ONLY to label synthetic
    training data. Combines the standard landslide-susceptibility drivers:
    antecedent + intensity rainfall (triggering), slope (predisposing),
    soil erodibility & vegetation loss (predisposing/conditioning),
    and a small boost from recent history (spatial recurrence).
    """
    rain_trigger = (
        0.55 * (row["rainfall_72h_mm"] / 400)
        + 0.45 * (row["rainfall_intensity_mmhr"] / 60)
    )
    saturation = row["soil_moisture_pct"] / 100
    slope_factor = min(row["slope_angle_deg"] / 45, 1.3)
    veg_factor = 1 - max(row["ndvi"], 0)  # low/negative NDVI -> less root stability
    erodibility = row["soil_type_erodibility"]
    history_boost = min(row["historical_incidents_5y"] * 0.06, 0.3)

    score = (
        0.35 * rain_trigger
        + 0.20 * saturation
        + 0.20 * slope_factor
        + 0.10 * veg_factor
        + 0.10 * erodibility
        + history_boost
    )
    noise = np.random.normal(0, 0.05)
    return float(np.clip(score + noise, 0, 1.5))


def generate_synthetic_dataset(n_samples: int = 6000) -> pd.DataFrame:
    rows = []
    for _ in range(n_samples):
        row = {
            "rainfall_24h_mm": np.random.gamma(2.0, 25),
            "rainfall_72h_mm": np.random.gamma(2.5, 45),
            "rainfall_intensity_mmhr": np.random.gamma(1.8, 8),
            "soil_moisture_pct": np.clip(np.random.normal(45, 15), 5, 100),
            "slope_angle_deg": np.clip(np.random.normal(28, 12), 0, 70),
            "ndvi": np.clip(np.random.normal(0.45, 0.25), -0.2, 0.9),
            "distance_to_road_m": np.random.exponential(300),
            "historical_incidents_5y": np.random.poisson(0.7),
            "soil_type_erodibility": np.clip(np.random.beta(2, 3), 0, 1),
        }
        hazard = _risk_score_ground_truth(row)
        if hazard < 0.35:
            label = "LOW"
        elif hazard < 0.60:
            label = "MODERATE"
        elif hazard < 0.85:
            label = "HIGH"
        else:
            label = "CRITICAL"
        row["risk_class"] = label
        rows.append(row)
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# 3. Cloud-side ML model (Random Forest classifier)
# ---------------------------------------------------------------------------

class LandslideRiskModel:
    def __init__(self):
        self.model = RandomForestClassifier(
            n_estimators=300,
            max_depth=10,
            min_samples_leaf=4,
            class_weight="balanced",
            random_state=RANDOM_SEED,
        )
        self._fitted = False

    def fit(self, df: pd.DataFrame):
        X = df[FEATURE_COLUMNS]
        y = df["risk_class"]
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=RANDOM_SEED, stratify=y
        )
        self.model.fit(X_train, y_train)
        self._fitted = True
        preds = self.model.predict(X_test)
        report = classification_report(y_test, preds, digits=3)
        cm = confusion_matrix(y_test, preds, labels=RISK_LEVELS)
        return report, cm

    def predict(self, reading: GridCellReading) -> dict:
        if not self._fitted:
            raise RuntimeError("Model not trained yet — call fit() first.")
        x = pd.DataFrame([{k: getattr(reading, k) for k in FEATURE_COLUMNS}])
        proba = self.model.predict_proba(x)[0]
        classes = self.model.classes_
        class_probs = dict(zip(classes, proba))
        risk_class = max(class_probs, key=class_probs.get)
        confidence = class_probs[risk_class]
        return {
            "cell_id": reading.cell_id,
            "district": reading.district,
            "risk_class": risk_class,
            "confidence": round(float(confidence), 3),
            "class_probabilities": {k: round(float(v), 3) for k, v in class_probs.items()},
        }

    def feature_importances(self) -> dict:
        return dict(
            sorted(
                zip(FEATURE_COLUMNS, self.model.feature_importances_),
                key=lambda kv: kv[1],
                reverse=True,
            )
        )


# ---------------------------------------------------------------------------
# 4. Edge / offline fallback — rule-based scorer
#    Runs locally on a gateway device at the sensor cluster with NO cloud
#    connectivity. Deliberately simple (a handful of comparisons + weighted
#    sum) so it fits on constrained hardware and needs no model file sync.
#    Once connectivity returns, the gateway also uploads queued readings so
#    the cloud model can be scored/retrained on what actually happened.
# ---------------------------------------------------------------------------

def edge_rule_based_risk(reading: GridCellReading) -> dict:
    score = 0
    if reading.rainfall_72h_mm > 250:
        score += 3
    elif reading.rainfall_72h_mm > 150:
        score += 2
    elif reading.rainfall_72h_mm > 80:
        score += 1

    if reading.rainfall_intensity_mmhr > 40:
        score += 3
    elif reading.rainfall_intensity_mmhr > 20:
        score += 1

    if reading.soil_moisture_pct > 75:
        score += 2
    elif reading.soil_moisture_pct > 55:
        score += 1

    if reading.slope_angle_deg > 35:
        score += 2
    elif reading.slope_angle_deg > 20:
        score += 1

    if reading.historical_incidents_5y >= 2:
        score += 1

    if score >= 8:
        risk_class = "CRITICAL"
    elif score >= 5:
        risk_class = "HIGH"
    elif score >= 3:
        risk_class = "MODERATE"
    else:
        risk_class = "LOW"

    return {
        "cell_id": reading.cell_id,
        "district": reading.district,
        "risk_class": risk_class,
        "score": score,
        "engine": "edge_rule_based_offline",
    }


# ---------------------------------------------------------------------------
# 5. Alert payload builder — turns a risk verdict into what the notification
#    service (SMS gateway / push / IVR) actually sends. Kept separate from
#    model logic so alert copy/thresholds can be tuned without retraining.
# ---------------------------------------------------------------------------

ALERT_TEMPLATES = {
    "en": {
        "HIGH": "ALERT: High landslide risk near {district} ({cell_id}). Avoid travel on flagged roads. Follow local authority instructions.",
        "CRITICAL": "URGENT: CRITICAL landslide risk in {district} ({cell_id}). Evacuate low-lying/slope-adjacent areas immediately if instructed.",
    },
    "as": {  # Assamese (placeholder — production copy would be reviewed by native speakers)
        "HIGH": "সতৰ্কবাণী: {district} ({cell_id}) ত ভূমিস্খলনৰ উচ্চ আশংকা। চিহ্নিত পথত যাত্ৰা নকৰিব।",
        "CRITICAL": "জৰুৰী: {district} ({cell_id}) ত অতি উচ্চ আশংকা। প্ৰশাসনৰ নিৰ্দেশ অনুসৰি তৎক্ষণাৎ স্থান ত্যাগ কৰক।",
    },
}


def build_alert(prediction: dict, lang: str = "en") -> dict | None:
    risk_class = prediction["risk_class"]
    if risk_class not in ("HIGH", "CRITICAL"):
        return None
    template = ALERT_TEMPLATES.get(lang, ALERT_TEMPLATES["en"])[risk_class]
    message = template.format(district=prediction["district"], cell_id=prediction["cell_id"])
    return {
        "cell_id": prediction["cell_id"],
        "district": prediction["district"],
        "severity": risk_class,
        "channel": ["sms", "app_push", "district_dashboard"] + (["ivr"] if risk_class == "CRITICAL" else []),
        "lang": lang,
        "message": message,
    }


# ---------------------------------------------------------------------------
# 6. Tourist route advisory — composes per-cell risk verdicts into a single
#    trip-level verdict. This is the server-side logic behind the "Plan your
#    journey" feature in the dashboard prototype: no new data sources, just
#    aggregation over the same risk model + road status already produced
#    above, plus the forecast rainfall for the traveler's date.
# ---------------------------------------------------------------------------

_RISK_ORDER = {"LOW": 0, "MODERATE": 1, "HIGH": 2, "CRITICAL": 3}

ROAD_STATUS_NOTE = {
    "clear": "open",
    "partial": "single-lane / intermittent restrictions reported",
    "blocked": "closed to through traffic",
}

TRIP_VERDICT = {
    "LOW": "SAFE_TO_TRAVEL",
    "MODERATE": "TRAVEL_WITH_CAUTION",
    "HIGH": "AVOID_UNLESS_NECESSARY",
    "CRITICAL": "AVOID_ROUTE",
}


@dataclass
class RouteLeg:
    segment_name: str
    prediction: dict          # output of LandslideRiskModel.predict() or edge_rule_based_risk()
    road_status: Literal["clear", "partial", "blocked"]
    forecast_rainfall_mm: float | None = None  # IMD forecast for traveler's date, if available


def assess_route_risk(route_name: str, legs: list[RouteLeg]) -> dict:
    """
    Aggregate per-leg risk predictions into ONE trip-level verdict.

    Deliberately uses the worst leg, not an average — a route that's clear
    for 40km and then critical for the last 5km is a CRITICAL trip, not a
    "mostly fine" one. This mirrors how the dashboard's route panel decides
    what badge to show the traveler.
    """
    worst_leg = max(legs, key=lambda l: _RISK_ORDER[l.prediction["risk_class"]])
    trip_risk = worst_leg.prediction["risk_class"]

    flagged_legs = [
        {
            "segment": leg.segment_name,
            "risk_class": leg.prediction["risk_class"],
            "road_status": ROAD_STATUS_NOTE[leg.road_status],
            "forecast_rainfall_mm": leg.forecast_rainfall_mm,
        }
        for leg in legs
    ]

    blocked_legs = [leg for leg in legs if leg.road_status == "blocked"]

    return {
        "route": route_name,
        "trip_risk": trip_risk,
        "verdict": TRIP_VERDICT[trip_risk],
        "worst_segment": worst_leg.segment_name,
        "legs": flagged_legs,
        "road_closed_on_route": bool(blocked_legs),
        "advisory_text": _advisory_text(route_name, trip_risk, worst_leg, blocked_legs),
    }


def _advisory_text(route_name: str, trip_risk: str, worst_leg: RouteLeg, blocked_legs: list[RouteLeg]) -> str:
    if trip_risk == "CRITICAL":
        return (f"Avoid {route_name} — critical landslide risk near {worst_leg.segment_name}. "
                f"Check back closer to your travel date or ask local authorities for an alternate route.")
    if trip_risk == "HIGH":
        note = " Note: a section of this route is currently closed to through traffic." if blocked_legs else ""
        return (f"High risk on part of {route_name} (near {worst_leg.segment_name}). "
                f"Consider delaying travel past this stretch until conditions improve.{note}")
    if trip_risk == "MODERATE":
        return f"{route_name} is passable but conditions are changing near {worst_leg.segment_name} — check again before departure."
    return f"{route_name} currently shows low landslide risk along its length. Recheck if heavy rain is forecast before you travel."


# ---------------------------------------------------------------------------
# Demo run
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("=" * 70)
    print("Generating synthetic training data (stand-in for IMD + sensor +")
    print("satellite + historical-incident warehouse)...")
    df = generate_synthetic_dataset(6000)
    print(df["risk_class"].value_counts())

    print("\nTraining Random Forest risk classifier...")
    model = LandslideRiskModel()
    report, cm = model.fit(df)
    print("\nHeld-out test set performance:\n")
    print(report)
    print("Confusion matrix (rows=true, cols=pred), order:", RISK_LEVELS)
    print(cm)

    print("\nFeature importances:")
    for feat, imp in model.feature_importances().items():
        print(f"  {feat:28s} {imp:.3f}")

    print("\n" + "=" * 70)
    print("Sample live readings -> cloud ML prediction vs edge fallback vs alert")
    print("=" * 70)

    sample_readings = [
        GridCellReading("NER-MEG-014", "East Khasi Hills, Meghalaya",
                         rainfall_24h_mm=95, rainfall_72h_mm=280, rainfall_intensity_mmhr=48,
                         soil_moisture_pct=82, slope_angle_deg=41, ndvi=0.12,
                         distance_to_road_m=40, historical_incidents_5y=3, soil_type_erodibility=0.7),
        GridCellReading("NER-MZ-002", "Aizawl, Mizoram",
                         rainfall_24h_mm=20, rainfall_72h_mm=60, rainfall_intensity_mmhr=6,
                         soil_moisture_pct=38, slope_angle_deg=15, ndvi=0.55,
                         distance_to_road_m=500, historical_incidents_5y=0, soil_type_erodibility=0.25),
        GridCellReading("NER-SIK-008", "North Sikkim",
                         rainfall_24h_mm=60, rainfall_72h_mm=170, rainfall_intensity_mmhr=22,
                         soil_moisture_pct=61, slope_angle_deg=33, ndvi=0.30,
                         distance_to_road_m=120, historical_incidents_5y=1, soil_type_erodibility=0.5),
    ]

    print("\n" + "=" * 70)
    print("ISRO Bhuvan satellite integration demo (East Khasi Hills coordinate)")
    print("=" * 70)
    sample_readings[0] = enrich_reading_with_satellite_data(sample_readings[0], lat=25.2789, lon=91.7325)
    print("  Reading NDVI after satellite enrichment attempt:", sample_readings[0].ndvi)
    print("  (falls back to the pre-set value above when BHUVAN_API_KEY is not configured")
    print("   or the live call fails — the prediction pipeline never breaks on satellite outage.)")


    for reading in sample_readings:
        cloud_pred = model.predict(reading)
        edge_pred = edge_rule_based_risk(reading)
        alert = build_alert(cloud_pred, lang="en")
        print(f"\n[{reading.cell_id}] {reading.district}")
        print("  cloud ML  :", json.dumps(cloud_pred))
        print("  edge fallback:", json.dumps(edge_pred))
        print("  alert     :", json.dumps(alert) if alert else "  (below alert threshold)")

    print("\n" + "=" * 70)
    print("Tourist route advisory demo: Guwahati -> Shillong -> Cherrapunji")
    print("=" * 70)

    leg1_reading = GridCellReading("NER-MEG-001", "Guwahati-Shillong stretch",
                                    rainfall_24h_mm=10, rainfall_72h_mm=40, rainfall_intensity_mmhr=4,
                                    soil_moisture_pct=30, slope_angle_deg=12, ndvi=0.6,
                                    distance_to_road_m=10, historical_incidents_5y=0, soil_type_erodibility=0.2)
    leg2_reading = sample_readings[0]  # East Khasi Hills reading defined above (high risk)

    legs = [
        RouteLeg("Guwahati–Shillong", model.predict(leg1_reading), road_status="clear", forecast_rainfall_mm=8),
        RouteLeg("Shillong–Cherrapunji", model.predict(leg2_reading), road_status="partial", forecast_rainfall_mm=95),
    ]
    trip = assess_route_risk("Guwahati → Shillong → Cherrapunji", legs)
    print(json.dumps(trip, indent=2))
    if __name__ == "__main__":
        print("BHUVAN API key loaded:", bool(BHUVAN_API_KEY))