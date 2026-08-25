"""
labeling.py
-----------
Attaches a target label to each day in the feature table.

TWO MODES:

1. REAL LABELS (preferred - use this once you have your GSI/NDMA/Bhuvan
   landslide records):
   Put a CSV at data/landslide_records.csv with AT LEAST a date column.
   Expected columns (flexible naming, see COLUMN_ALIASES below):
       date        - date of the landslide event (YYYY-MM-DD)
       severity    - optional: minor/major/severe or a 0-3 number
   Every date in the feature table that matches (or falls within
   LABEL_WINDOW_DAYS of) a recorded event is labelled as a landslide day.

2. PROXY LABELS (fallback, used automatically if the file above is missing):
   Landslide occurrence records are not available yet, so we derive a
   *placeholder* risk label from the weather features themselves, using the
   well-established idea that landslides are triggered by a combination of
   (a) high antecedent rainfall (multi-day cumulative) AND
   (b) high soil saturation.
   We rank every day using a composite index built from the 7d/15d cumulative
   rainfall and the soil moisture level, then bucket the top 5% of days as
   "High" risk trigger-days, the next 15% as "Medium", and the rest "Low".

   *** THIS PROXY IS FOR DEMO / DEVELOPMENT PURPOSES ONLY. ***
   It tells the model "which days looked most dangerous based on rainfall
   and soil physics", not "which days a landslide actually happened". Swap
   in real records via data/landslide_records.csv as soon as you have them -
   no other code changes needed, this module and train_model.py will pick
   real labels up automatically.
"""

import os
import pandas as pd
import numpy as np

LANDSLIDE_RECORDS_CANDIDATES = [
    "data/landslide_records.csv",
    "data/landslide_records_TEMPLATE.csv",
]
LABEL_WINDOW_DAYS = 1  # match landslide date to feature date within +/- N days

COLUMN_ALIASES = {
    "date": ["date", "event_date", "incident_date", "Date", "DATE"],
    "severity": ["severity", "risk_level", "magnitude", "Severity", "SEVERITY", "level"],
    "location": ["location", "place", "district", "Location", "LOCATION"],
}

SEVERITY_MAP = {
    "low": 1,
    "minor": 1,
    "moderate": 1,
    "medium": 1,
    "major": 2,
    "severe": 2,
    "critical": 2,
    "high": 2,
}


def _find_col(df, candidates):
    for c in candidates:
        if c in df.columns:
            return c
    return None


def resolve_records_path(records_path: str | None = None) -> str | None:
    """Find a valid landslide records CSV file from candidates."""
    if records_path and os.path.exists(records_path):
        return records_path
    for path in LANDSLIDE_RECORDS_CANDIDATES:
        if os.path.exists(path):
            return path
    return None


def load_real_landslide_labels(
    features: pd.DataFrame, records_path: str | None = None
) -> tuple[pd.Series | None, str | None, dict | None]:
    """Load real landslide records and map to target labels.

    If severity information is available in the records, maps to 3-class risk:
        0 = Low (no recorded event)
        1 = Medium (minor / moderate event)
        2 = High (major / severe / critical event)
    If no severity is available, maps binary:
        0 = Low (no event)
        1 = High (landslide event)
    """
    actual_path = resolve_records_path(records_path)
    if actual_path is None:
        return None, None, None

    records = pd.read_csv(actual_path)
    date_col = _find_col(records, COLUMN_ALIASES["date"])
    if date_col is None:
        raise ValueError(
            f"Could not find a date column in {actual_path}. "
            f"Expected one of {COLUMN_ALIASES['date']}"
        )

    records[date_col] = pd.to_datetime(records[date_col]).dt.normalize()
    sev_col = _find_col(records, COLUMN_ALIASES["severity"])

    if sev_col is not None:
        # Map severity to 1 (Medium) or 2 (High)
        def _map_sev(val):
            if pd.isna(val):
                return 1
            s = str(val).strip().lower()
            if s in SEVERITY_MAP:
                return SEVERITY_MAP[s]
            try:
                num = float(s)
                return 2 if num >= 2 else (1 if num >= 1 else 0)
            except ValueError:
                return 1

        records["_risk_class"] = records[sev_col].apply(_map_sev)
        has_multiclass = True
    else:
        records["_risk_class"] = 1
        has_multiclass = False

    # Build mapping from date to maximum risk severity within +/- LABEL_WINDOW_DAYS
    date_to_risk = {}
    for _, row in records.iterrows():
        d = row[date_col]
        rc = row["_risk_class"]
        for offset in range(-LABEL_WINDOW_DAYS, LABEL_WINDOW_DAYS + 1):
            dt = d + pd.Timedelta(days=offset)
            date_to_risk[dt] = max(date_to_risk.get(dt, 0), rc)

    labels = features["date"].dt.normalize().map(date_to_risk).fillna(0).astype(int)

    meta_info = {
        "records_file": actual_path,
        "total_records": len(records),
        "unique_event_dates": int(records[date_col].nunique()),
        "has_multiclass": has_multiclass,
    }

    return labels, actual_path, meta_info


def build_proxy_labels(features: pd.DataFrame) -> pd.Series:
    """Composite rainfall + soil-saturation + wind risk index -> 3-class proxy label.

    Labels are computed **per location** so that each site's own distribution
    defines the quantile thresholds — a 'High' day at one elevation/region
    should reflect that region's own norms, not the combined average.
    """
    has_wind = (features["wind_speed_max"].notna() & (features["wind_speed_max"] > 0)).any()

    def _label_group(g):
        idx = (
            0.35 * _z(g["rain_cum_7d"]) +
            0.25 * _z(g["rain_cum_15d"]) +
            0.20 * _z(g["soil_moisture_28_100cm_mean"]) +
            0.10 * _z(g["rain_mm_max_hourly"])
        )
        if has_wind:
            idx += 0.10 * _z(g["wind_speed_max"])
        else:
            # redistribute the wind weight to rainfall
            idx += 0.10 * _z(g["rain_cum_7d"])

        q85, q95 = idx.quantile([0.85, 0.95])
        labels = pd.cut(
            idx, bins=[-np.inf, q85, q95, np.inf], labels=[0, 1, 2]
        ).astype(int)
        return labels

    if "location_id" in features.columns:
        return features.groupby("location_id", group_keys=False).apply(_label_group)
    else:
        return _label_group(features)


def _z(series: pd.Series) -> pd.Series:
    return (series - series.mean()) / (series.std() + 1e-9)


def attach_labels(features: pd.DataFrame, records_path: str | None = None):
    real_labels, used_path, meta_info = load_real_landslide_labels(features, records_path)
    if real_labels is not None:
        features = features.copy()
        features["label"] = real_labels
        features["label_source"] = "real_records"
        n_events = int((real_labels > 0).sum())
        print(f"[labeling] Using REAL landslide records from {used_path}")
        print(f"           Total events: {meta_info['total_records']}, "
              f"Unique dates: {meta_info['unique_event_dates']}")
        print(f"           Matched -> {n_events} event-days out of {len(features)} feature-days.")
        return features, "real"
    else:
        features = features.copy()
        features["label"] = build_proxy_labels(features)
        features["label_source"] = "proxy"
        print(f"[labeling] No landslide records found -> using PROXY rainfall/soil-"
              f"saturation risk labels (0=Low, 1=Medium, 2=High).")
        return features, "proxy"


if __name__ == "__main__":
    feats = pd.read_csv("data/daily_features.csv", parse_dates=["date"]) if os.path.exists("data/daily_features.csv") else None
    if feats is None:
        from feature_engineering import build_multi_location_feature_table
        feats = build_multi_location_feature_table("data")
        feats.to_csv("data/daily_features.csv", index=False)

    labeled, mode = attach_labels(feats)
    print("\nLabel distribution:")
    print(labeled["label"].value_counts())
    if "location_id" in labeled.columns:
        print("\nPer-location label distribution:")
        print(labeled.groupby("location_id")["label"].value_counts().unstack(fill_value=0))
    labeled.to_csv("data/labeled_features.csv", index=False)
    print("Saved -> data/labeled_features.csv")
