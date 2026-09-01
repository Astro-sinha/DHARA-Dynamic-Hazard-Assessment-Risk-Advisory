"""
feature_engineering.py
-----------------------
Turns raw hourly Open-Meteo weather data (rainfall, soil moisture, temperature,
wind speed, soil temperature) into a DAILY feature table useful for landslide-
risk modelling.

Supports **multiple data sources** — all Open-Meteo CSV files found in data/
are loaded, harmonised, tagged with a location identifier, and concatenated.
This lets the model learn from different geographic locations / elevation bands
across NER, which improves generalisation.

Why these features:
Landslides in hilly/Himalayan terrain are triggered mainly by two things:
 1. How much rain has fallen recently (antecedent rainfall) - this saturates
    the soil over days/weeks.
 2. How intense the rain is right now (short bursts) - this adds sudden
    pore-water pressure on top of already-saturated soil.
Soil moisture readings act as a direct proxy for "how saturated is the slope
right now", which is normally the hardest input to get in practice (it
usually needs real sensors) but here we already have it from Open-Meteo's
modelled soil moisture layers.

Additional features from the new datasets:
 - Wind speed: strong winds can destabilise already-saturated slopes by
   exerting mechanical force on vegetation and soil.
 - Soil temperature: freeze-thaw cycles weaken slope cohesion; deep-soil
   temperature trends help identify vulnerable periods.
 - Elevation / location: static features that let the model adapt its
   thresholds to each site's characteristics.
"""

import glob
import os
import pandas as pd
import numpy as np
from io import StringIO


# ─────────────────────────────────────────────────────────────────────
# 1.  Loading — handles both old (weather_raw.csv) and new Open-Meteo
#     CSV formats, including location metadata extraction.
# ─────────────────────────────────────────────────────────────────────

def _parse_location_metadata(csv_path: str) -> dict:
    """Read the first two lines of an Open-Meteo CSV to extract location info.

    Open-Meteo CSVs start with a metadata header like:
        latitude,longitude,elevation,utc_offset_seconds,timezone,...
        27.521967,88.58903,1638.0,19800,Asia/Kolkata,...
    """
    with open(csv_path, "r", encoding="utf-8") as f:
        header = f.readline().strip()
        values = f.readline().strip()

    meta_df = pd.read_csv(StringIO(header + "\n" + values))
    return {
        "latitude": float(meta_df["latitude"].iloc[0]),
        "longitude": float(meta_df["longitude"].iloc[0]),
        "elevation": float(meta_df["elevation"].iloc[0]),
        "utc_offset_seconds": int(meta_df["utc_offset_seconds"].iloc[0]),
    }


def _make_location_id(meta: dict) -> str:
    """Deterministic short ID from lat/lon, e.g. '27.52N_88.59E'."""
    lat = meta["latitude"]
    lon = meta["longitude"]
    lat_dir = "N" if lat >= 0 else "S"
    lon_dir = "E" if lon >= 0 else "W"
    return f"{abs(lat):.2f}{lat_dir}_{abs(lon):.2f}{lon_dir}"


def load_raw_weather(csv_path: str) -> pd.DataFrame:
    """Load a single Open-Meteo CSV (hourly block only).

    The file Open-Meteo exports may contain TWO stacked tables:
      1. An hourly block: time, rain, soil_moisture (2 depths), precipitation,
         temperature, weather_code, [wind_speed], [soil_temperature]
      2. A daily block appended after it: time, weather_code, rain_sum,
         sunset, sunrise

    We only need block (1) for hourly-resolution feature engineering, so we
    read from its header line up to (but not including) the second header.
    """
    with open(csv_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    header_lines = [i for i, l in enumerate(lines) if l.startswith("time,")]
    start = header_lines[0]
    end = header_lines[1] - 1 if len(header_lines) > 1 else len(lines)  # stop before 2nd header (and blank line before it)
    # strip trailing blank line before the second header, if present
    block = lines[start:end]
    while block and block[-1].strip() == "":
        block.pop()

    df = pd.read_csv(StringIO("".join(block)))
    df["time"] = pd.to_datetime(df["time"])

    # ---- Standardised column renames (handles both old and new formats) ----
    rename_map = {
        "rain (mm)": "rain_mm",
        "soil_moisture_28_to_100cm (m³/m³)": "soil_moisture_28_100cm",
        "soil_moisture_100_to_255cm (m³/m³)": "soil_moisture_100_255cm",
        "precipitation (mm)": "precip_mm",
        "temperature_2m (°C)": "temp_c",
        "weather_code (wmo code)": "weather_code",
        "wind_speed_10m (km/h)": "wind_speed_kmh",
        "soil_temperature_100_to_255cm (°C)": "soil_temp_deep_c",
    }
    df = df.rename(columns={k: v for k, v in rename_map.items() if k in df.columns})

    # ---- Ensure all expected columns exist (fill with NaN if missing) ----
    for col in ["rain_mm", "soil_moisture_28_100cm", "soil_moisture_100_255cm",
                "precip_mm", "temp_c", "wind_speed_kmh", "soil_temp_deep_c"]:
        if col not in df.columns:
            df[col] = np.nan

    # Drop weather_code if present — not used as a feature
    df = df.drop(columns=["weather_code"], errors="ignore")

    return df


def load_raw_weather_with_metadata(csv_path: str) -> pd.DataFrame:
    """Load a single CSV and attach location metadata columns."""
    meta = _parse_location_metadata(csv_path)
    loc_id = _make_location_id(meta)

    df = load_raw_weather(csv_path)

    # Normalise timezone: convert to UTC-based timestamps so all sources align
    utc_offset = pd.Timedelta(seconds=meta["utc_offset_seconds"])
    if utc_offset.total_seconds() != 0:
        df["time"] = df["time"] - utc_offset  # shift to UTC

    df["location_id"] = loc_id
    df["latitude"] = meta["latitude"]
    df["longitude"] = meta["longitude"]
    df["elevation"] = meta["elevation"]

    return df


def load_multiple_sources(data_dir: str = "data") -> pd.DataFrame:
    """Discover all Open-Meteo CSVs in data_dir, load & concatenate them.

    Files are matched by the pattern *.csv, but the template CSV
    (landslide_records_TEMPLATE.csv) and generated intermediates
    (daily_features.csv, labeled_features.csv) are excluded.
    """
    csv_files = sorted(glob.glob(os.path.join(data_dir, "*.csv")))
    skip_prefixes = ("daily_features", "labeled_features", "landslide_records")
    csv_files = [
        f for f in csv_files
        if not any(os.path.basename(f).startswith(prefix) for prefix in skip_prefixes)
    ]

    if not csv_files:
        raise FileNotFoundError(f"No weather CSV files found in {data_dir}/")

    frames = []
    for path in csv_files:
        try:
            df = load_raw_weather_with_metadata(path)
            print(f"  Loaded {os.path.basename(path):45s} "
                  f"| {len(df):>7,} rows | loc={df['location_id'].iloc[0]} "
                  f"| elev={df['elevation'].iloc[0]:.0f}m "
                  f"| {df['time'].min().date()} -> {df['time'].max().date()}")
            frames.append(df)
        except Exception as e:
            print(f"  SKIP  {os.path.basename(path)}: {e}")

    combined = pd.concat(frames, ignore_index=True)

    # Deduplicate: if two CSVs cover the same location and overlap in time,
    # keep the row with *more non-null columns* (i.e. the richer file wins).
    combined["_non_null"] = combined.notna().sum(axis=1)
    combined = (
        combined
        .sort_values("_non_null", ascending=False)
        .drop_duplicates(subset=["time", "location_id"], keep="first")
        .drop(columns=["_non_null"])
        .sort_values(["location_id", "time"])
        .reset_index(drop=True)
    )

    print(f"\n  Combined: {len(combined):,} rows across "
          f"{combined['location_id'].nunique()} location(s)")
    return combined


# ─────────────────────────────────────────────────────────────────────
# 2.  Daily aggregation
# ─────────────────────────────────────────────────────────────────────

def hourly_to_daily(df: pd.DataFrame) -> pd.DataFrame:
    """Aggregate hourly readings into one row per calendar day per location."""
    df = df.copy()
    df["date"] = df["time"].dt.date
    df["date"] = pd.to_datetime(df["date"])

    # Group by location + date to keep locations separate
    group_cols = ["location_id", "date"]

    agg_dict = {
        "rain_mm":                ("rain_mm", "sum"),
        "rain_mm_max_hourly":     ("rain_mm", "max"),          # peak rainfall intensity that day
        "precip_mm_sum":          ("precip_mm", "sum"),
        "soil_moisture_28_100cm_mean":  ("soil_moisture_28_100cm", "mean"),
        "soil_moisture_100_255cm_mean": ("soil_moisture_100_255cm", "mean"),
        "temp_c_mean":            ("temp_c", "mean"),
        "wind_speed_mean":        ("wind_speed_kmh", "mean"),
        "wind_speed_max":         ("wind_speed_kmh", "max"),
        "soil_temp_deep_mean":    ("soil_temp_deep_c", "mean"),
        "wet_hours":              ("rain_mm", lambda x: (x > 0.1).sum()),
        # Static columns — just take first (they're constant per location)
        "latitude":               ("latitude", "first"),
        "longitude":              ("longitude", "first"),
        "elevation":              ("elevation", "first"),
    }

    daily = df.groupby(group_cols).agg(**agg_dict).reset_index()

    # Rename rain_mm to rain_mm_sum for clarity
    daily = daily.rename(columns={"rain_mm": "rain_mm_sum"})

    return daily


# ─────────────────────────────────────────────────────────────────────
# 3.  Rolling / derived features (computed per-location)
# ─────────────────────────────────────────────────────────────────────

def add_rolling_features(daily: pd.DataFrame) -> pd.DataFrame:
    """Add antecedent-rainfall and soil-moisture-trend features.

    Rolling windows are computed **per location** so that one location's
    rainfall history doesn't bleed into another's.
    """
    daily = daily.sort_values(["location_id", "date"]).reset_index(drop=True)

    def _add_rolling_for_group(g):
        g = g.sort_values("date").reset_index(drop=True)

        for window in [3, 7, 15, 30]:
            g[f"rain_cum_{window}d"] = (
                g["rain_mm_sum"].rolling(window, min_periods=1).sum()
            )
            g[f"rainy_days_{window}d"] = (
                (g["rain_mm_sum"] > 1.0).rolling(window, min_periods=1).sum()
            )

        # Soil moisture trend: is the slope getting wetter or drying out?
        g["soil_moisture_28_100cm_chg_3d"] = (
            g["soil_moisture_28_100cm_mean"].diff(3)
        )
        g["soil_moisture_100_255cm_chg_3d"] = (
            g["soil_moisture_100_255cm_mean"].diff(3)
        )

        # Rainfall intensity relative to recent norm (helps flag sudden bursts)
        g["rain_intensity_ratio"] = g["rain_mm_sum"] / (
            g[f"rain_cum_7d"].replace(0, np.nan) / 7
        )
        g["rain_intensity_ratio"] = g["rain_intensity_ratio"].fillna(0)

        # Wind-rain interaction: high wind + heavy rain = extra slope stress
        g["wind_rain_interaction"] = g["wind_speed_max"] * g["rain_mm_sum"]

        # Soil temperature 3-day change (freeze-thaw indicator)
        g["soil_temp_deep_chg_3d"] = g["soil_temp_deep_mean"].diff(3)

        # Calendar features (monsoon seasonality matters a lot in NER/Himalaya)
        g["month"] = g["date"].dt.month
        g["is_monsoon"] = g["month"].isin([6, 7, 8, 9]).astype(int)

        return g

    # Process each location separately to avoid pandas groupby.apply() issues
    # with the grouping column across different pandas versions.
    parts = []
    for loc_id, group in daily.groupby("location_id"):
        part = _add_rolling_for_group(group.copy())
        parts.append(part)
    daily = pd.concat(parts, ignore_index=True)

    daily = daily.bfill().fillna(0)
    return daily


# ─────────────────────────────────────────────────────────────────────
# 4.  Public API — build feature tables
# ─────────────────────────────────────────────────────────────────────

def build_multi_location_feature_table(data_dir: str = "data") -> pd.DataFrame:
    """Full pipeline: load all sources → daily → rolling features.

    Used by train_model.py for training across multiple locations.
    """
    raw = load_multiple_sources(data_dir)
    daily = hourly_to_daily(raw)
    features = add_rolling_features(daily)
    return features


def build_feature_table(raw_csv_path: str) -> pd.DataFrame:
    """Single-source pipeline (backward-compatible).

    Used by predict_risk.py for scoring a single location's weather file.
    """
    raw = load_raw_weather_with_metadata(raw_csv_path)
    daily = hourly_to_daily(raw)
    features = add_rolling_features(daily)
    return features


if __name__ == "__main__":
    feats = build_multi_location_feature_table("data")
    print(f"\nFinal feature table: {feats.shape}")
    print(feats.head())
    print(f"\nLocations: {feats['location_id'].value_counts().to_dict()}")
    print(f"Date range: {feats['date'].min().date()} -> {feats['date'].max().date()}")
    print(f"Columns: {list(feats.columns)}")
    feats.to_csv("data/daily_features.csv", index=False)
    print("Saved -> data/daily_features.csv")
