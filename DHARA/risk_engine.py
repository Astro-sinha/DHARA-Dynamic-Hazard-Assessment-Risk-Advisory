"""
NER Landslide Early Warning System — AI Risk Prediction Engine (Prototype)
============================================================================

This module is a working prototype of the "AI/ML predictive analytics engine"
component described in the architecture.
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

BHUVAN_API_KEY = os.environ.get("BHUVAN_API_KEY")
BHUVAN_BASE_URL = "https://bhuvan-app1.nrsc.gov.in/api"


def fetch_bhuvan_satellite_data(lat: float, lon: float, api_key: str | None = None) -> dict:
    key = api_key or BHUVAN_API_KEY
    if not key:
        print("[Bhuvan API] No BHUVAN_API_KEY configured — skipping live satellite call, using fallback terrain data.")
        return {"status": "no_api_key"}

    params = {"lat": lat, "lon": lon, "token": key, "format": "json"}
    try:
        response = requests.get(f"{BHUVAN_BASE_URL}/terrain/info", params=params, timeout=5)
        response.raise_for_status()
        data = response.json()
        data["status"] = "ok"
        return data
    except Exception as e:
        print(f"[Bhuvan API] Warning: Failed to query Bhuvan service ({e}) — using fallback terrain data.")
        return {"status": "unavailable", "error": str(e)}


RANDOM_SEED = 42
np.random.seed(RANDOM_SEED)
random.seed(RANDOM_SEED)

RiskClass = Literal["LOW", "MODERATE", "HIGH", "CRITICAL"]
RISK_LEVELS: list[RiskClass] = ["LOW", "MODERATE", "HIGH", "CRITICAL"]

FEATURE_COLUMNS = [
    "rainfall_24h_mm",
    "rainfall_72h_mm",
    "rainfall_intensity_mmhr",
    "soil_moisture_pct",
    "slope_angle_deg",
    "ndvi",
    "distance_to_road_m",
    "historical_incidents_5y",
    "soil_type_erodibility",
]


@dataclass
class GridCellReading:
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


def _risk_score_ground_truth(row: dict) -> float:
    rain_trigger = (
        0.55 * (row["rainfall_72h_mm"] / 400)
        + 0.45 * (row["rainfall_intensity_mmhr"] / 60)
    )
    saturation = row["soil_moisture_pct"] / 100
    slope_factor = min(row["slope_angle_deg"] / 45, 1.3)
    veg_factor = 1 - max(row["ndvi"], 0)
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


if __name__ == "__main__":
    print("Training DHARA Landslide Risk RF Classifier...")
    df = generate_synthetic_dataset(6000)
    model = LandslideRiskModel()
    report, cm = model.fit(df)
    print(report)
