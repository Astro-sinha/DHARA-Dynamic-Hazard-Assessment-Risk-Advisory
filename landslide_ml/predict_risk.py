"""
predict_risk.py
----------------
Lightweight inference wrapper. This is what the backend/dashboard team calls
to get a risk score for "today" (or any day) once the model is trained.

Usage as a library (from project root via server.py):
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'landslide_ml'))
    from predict_risk import LandslideRiskPredictor
    predictor = LandslideRiskPredictor()
    result = predictor.predict_from_dashboard_params(...)

Usage from landslide_ml/ directly:
    from predict_risk import LandslideRiskPredictor
    predictor = LandslideRiskPredictor()
    result = predictor.predict_latest("data/weather_raw.csv")

Usage from CLI (quick demo on the most recent day in the dataset):
    python3 predict_risk.py
"""

import json
import os
import joblib
import pandas as pd
import numpy as np

# ── Path resolution — works whether called from landslide_ml/ or project root ──
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))

MODEL_PATH = os.path.join(_THIS_DIR, "models", "landslide_risk_model.pkl")
META_PATH  = os.path.join(_THIS_DIR, "models", "feature_columns.json")

# Default data directory (used by predict_latest convenience method)
_DATA_DIR = os.path.join(_THIS_DIR, "data")


class LandslideRiskPredictor:
    def __init__(self, model_path: str = MODEL_PATH, meta_path: str = META_PATH):
        self.model = joblib.load(model_path)
        with open(meta_path) as f:
            meta = json.load(f)
        self.feature_columns     = meta["feature_columns"]
        self.risk_labels         = {int(k): v for k, v in meta["risk_labels"].items()}
        self.label_source        = meta["label_source"]
        self.location_encoding   = meta.get("location_encoding", {})

    # ──────────────────────────────────────────────────────────────────────────
    # Core: predict from a fully-formed feature row (pandas Series or dict)
    # ──────────────────────────────────────────────────────────────────────────
    def predict_from_feature_row(self, row: pd.Series) -> dict:
        """Score a single pre-engineered feature row."""
        row_dict = row.to_dict() if hasattr(row, "to_dict") else dict(row)
        for col in self.feature_columns:
            if col not in row_dict or pd.isna(row_dict.get(col)):
                row_dict[col] = 0

        X = pd.DataFrame([row_dict])[self.feature_columns]
        pred_class = int(self.model.predict(X)[0])
        proba = self.model.predict_proba(X)[0]
        class_probabilities = {
            self.risk_labels.get(cls, str(cls)): round(float(p), 3)
            for cls, p in zip(self.model.classes_, proba)
        }
        # risk_score: probability mass on Medium+High (the non-Low classes)
        risk_score = round(
            sum(p for cls, p in zip(self.model.classes_, proba) if cls != 0), 3
        )
        return {
            "risk_level":          self.risk_labels.get(pred_class, str(pred_class)),
            "risk_score":          risk_score,       # 0-1, higher = more dangerous
            "class_probabilities": class_probabilities,
            "model_trained_on":    self.label_source,
        }

    # ──────────────────────────────────────────────────────────────────────────
    # Dashboard helper: convert UI slider/station params → 27-feature vector
    # ──────────────────────────────────────────────────────────────────────────
    def predict_from_dashboard_params(
        self,
        rainfall_72h_mm: float         = 0.0,
        rainfall_intensity_mmhr: float = 0.0,
        soil_moisture_pct: float       = 50.0,
        slope_angle_deg: float         = 20.0,
        historical_incidents_5y: int   = 0,
        elevation: float               = 1000.0,
        lat: float                     = 25.69,
        lon: float                     = 94.11,
        month: int                     = None,
        **kwargs,
    ) -> dict:
        """
        Convert the minimal UI parameters (sliders) into the full 27-feature
        vector that the trained Random Forest expects, then return a prediction.

        Derived / imputed features use realistic domain relationships where
        the UI only captures a subset of the full feature schema.
        """
        import datetime
        if month is None:
            month = datetime.datetime.now().month

        # Monsoon season: June–September (months 6-9)
        is_monsoon = 1 if 6 <= month <= 9 else 0

        # Derive antecedent cumulative rainfall from the 72h value
        rain_mm_sum          = rainfall_72h_mm / 3.0          # approx daily avg from 72h window
        rain_mm_max_hourly   = rainfall_intensity_mmhr
        precip_mm_sum        = rain_mm_sum * 1.05             # precip ≈ rain (slight offset)

        # Soil moisture at two modelled depths (28-100cm and 100-255cm)
        sm_shallow           = soil_moisture_pct / 100.0      # normalised 0-1
        sm_deep              = sm_shallow * 0.85              # deep layer lags behind

        # Temperature & wind defaults (mid-range for NER monsoon season)
        temp_c_mean          = 20.0
        wet_hours            = min(max(int(rainfall_intensity_mmhr / 5), 0), 24)
        wind_speed_mean      = 3.5
        wind_speed_max       = wind_speed_mean * 2.0
        soil_temp_deep_mean  = 18.0

        # Cumulative rainfall windows — derived from 72h value using
        # exponential decay approximation (longer windows = higher totals)
        rain_cum_3d          = rainfall_72h_mm
        rain_cum_7d          = rainfall_72h_mm * 1.8
        rain_cum_15d         = rainfall_72h_mm * 2.8
        rain_cum_30d         = rainfall_72h_mm * 4.0

        # Rainy-day counts (rough proportion of window that was rainy)
        rainy_days_3d        = min(3,  max(0, int(rain_cum_3d  / 20)))
        rainy_days_7d        = min(7,  max(0, int(rain_cum_7d  / 20)))
        rainy_days_15d       = min(15, max(0, int(rain_cum_15d / 20)))
        rainy_days_30d       = min(30, max(0, int(rain_cum_30d / 20)))

        # Soil moisture change over 3 days (proxy: positive during heavy rain)
        sm_shallow_chg_3d    = sm_shallow * 0.10
        sm_deep_chg_3d       = sm_deep    * 0.06

        # Intensity ratio vs weekly baseline
        weekly_daily_avg     = rain_cum_7d / 7.0
        rain_intensity_ratio = (rain_mm_sum / weekly_daily_avg) if weekly_daily_avg > 0 else 1.0

        # Wind-rain interaction
        wind_rain_interaction = wind_speed_max * rain_mm_sum / 100.0

        # Soil temp change (small)
        soil_temp_deep_chg_3d = -0.5

        # Location encoding
        loc_id = f"{abs(lat):.2f}{'N' if lat >= 0 else 'S'}_{abs(lon):.2f}{'E' if lon >= 0 else 'W'}"
        location_id_encoded = self.location_encoding.get(loc_id, 0)

        feature_row = {
            "rain_mm_sum":                    round(rain_mm_sum, 3),
            "rain_mm_max_hourly":             round(rain_mm_max_hourly, 3),
            "precip_mm_sum":                  round(precip_mm_sum, 3),
            "soil_moisture_28_100cm_mean":    round(sm_shallow, 4),
            "soil_moisture_100_255cm_mean":   round(sm_deep, 4),
            "temp_c_mean":                    temp_c_mean,
            "wet_hours":                      wet_hours,
            "wind_speed_mean":                wind_speed_mean,
            "wind_speed_max":                 wind_speed_max,
            "soil_temp_deep_mean":            soil_temp_deep_mean,
            "rain_cum_3d":                    round(rain_cum_3d, 3),
            "rain_cum_7d":                    round(rain_cum_7d, 3),
            "rain_cum_15d":                   round(rain_cum_15d, 3),
            "rain_cum_30d":                   round(rain_cum_30d, 3),
            "rainy_days_3d":                  rainy_days_3d,
            "rainy_days_7d":                  rainy_days_7d,
            "rainy_days_15d":                 rainy_days_15d,
            "rainy_days_30d":                 rainy_days_30d,
            "soil_moisture_28_100cm_chg_3d":  round(sm_shallow_chg_3d, 4),
            "soil_moisture_100_255cm_chg_3d": round(sm_deep_chg_3d, 4),
            "rain_intensity_ratio":           round(rain_intensity_ratio, 4),
            "wind_rain_interaction":          round(wind_rain_interaction, 4),
            "soil_temp_deep_chg_3d":          soil_temp_deep_chg_3d,
            "elevation":                      elevation,
            "location_id_encoded":            location_id_encoded,
            "month":                          month,
            "is_monsoon":                     is_monsoon,
        }

        result = self.predict_from_feature_row(feature_row)
        result["features_used"] = feature_row
        return result

    # ──────────────────────────────────────────────────────────────────────────
    # Real Weather Dataset & Rolling Antecedent Pipeline Helper
    # ──────────────────────────────────────────────────────────────────────────
    def predict_from_weather_observation(
        self,
        rainfall_mm: float             = 0.0,
        avg_temp: float                = 20.0,
        wind_speed: float              = 3.5,
        elevation: float               = 1000.0,
        lat: float                     = 25.69,
        lon: float                     = 94.11,
        month: int                     = None,
        rain_cum_3d: float             = None,
        rain_cum_7d: float             = None,
        rain_cum_15d: float            = None,
        rain_cum_30d: float            = None,
        rainy_days_3d: int             = None,
        rainy_days_7d: int             = None,
        rainy_days_15d: int            = None,
        rainy_days_30d: int            = None,
        min_temp: float                = None,
        max_temp: float                = None,
        air_pressure: float            = None,
        **kwargs,
    ) -> dict:
        """
        Map real meteorological observations (from india_weather_rainfall_data.xlsx
        or rolling historical sums) directly into the strict 27-feature Random Forest vector.
        """
        import datetime
        if month is None:
            month = datetime.datetime.now().month

        is_monsoon = 1 if 6 <= month <= 9 else 0

        # Primary rainfall
        rain_mm_sum = float(rainfall_mm) if rainfall_mm is not None and not pd.isna(rainfall_mm) else 0.0
        precip_mm_sum = round(rain_mm_sum * 1.05, 3)
        # Peak hourly intensity approximation from daily total if not provided
        rain_mm_max_hourly = round(min(rain_mm_sum / 3.0, 60.0), 3) if rain_mm_sum > 0 else 0.0

        # Cumulative windows (prefer exact rolling sums from historical dataset)
        if rain_cum_3d is None:
            rain_cum_3d = rain_mm_sum * 2.5
        if rain_cum_7d is None:
            rain_cum_7d = rain_cum_3d * 1.8
        if rain_cum_15d is None:
            rain_cum_15d = rain_cum_7d * 1.6
        if rain_cum_30d is None:
            rain_cum_30d = rain_cum_15d * 1.4

        # Rainy days in window
        if rainy_days_3d is None:
            rainy_days_3d = min(3, max(0, int(rain_cum_3d / 15.0))) if rain_cum_3d > 0 else 0
        if rainy_days_7d is None:
            rainy_days_7d = min(7, max(0, int(rain_cum_7d / 15.0))) if rain_cum_7d > 0 else 0
        if rainy_days_15d is None:
            rainy_days_15d = min(15, max(0, int(rain_cum_15d / 15.0))) if rain_cum_15d > 0 else 0
        if rainy_days_30d is None:
            rainy_days_30d = min(30, max(0, int(rain_cum_30d / 15.0))) if rain_cum_30d > 0 else 0

        # Hydro-physical soil saturation curve from 72h / 7d antecedent precipitation
        sat_proxy = min(1.0, max(0.15, (rain_cum_3d / 200.0) * 0.6 + (rain_cum_7d / 350.0) * 0.4))
        sm_shallow = round(sat_proxy, 4)
        sm_deep = round(sm_shallow * 0.85, 4)

        temp_val = float(avg_temp) if avg_temp is not None and not pd.isna(avg_temp) else 20.0
        wind_val = float(wind_speed) if wind_speed is not None and not pd.isna(wind_speed) else 3.5
        wind_max = round(wind_val * 1.5, 3)

        wet_hours = min(max(int(rain_mm_sum / 4.0), 0), 24) if rain_mm_sum > 0 else 0
        soil_temp_deep_mean = round(max(5.0, temp_val - 2.0), 2)
        sm_shallow_chg_3d = round(sm_shallow * 0.08, 4)
        sm_deep_chg_3d = round(sm_deep * 0.05, 4)

        weekly_daily_avg = rain_cum_7d / 7.0 if rain_cum_7d else 0.0
        rain_intensity_ratio = round((rain_mm_sum / weekly_daily_avg), 4) if weekly_daily_avg > 0 else 1.0
        wind_rain_interaction = round((wind_max * rain_mm_sum) / 100.0, 4)
        soil_temp_deep_chg_3d = -0.5

        # Location encoding
        loc_id = f"{abs(lat):.2f}{'N' if lat >= 0 else 'S'}_{abs(lon):.2f}{'E' if lon >= 0 else 'W'}"
        location_id_encoded = self.location_encoding.get(loc_id, 0)

        feature_row = {
            "rain_mm_sum":                    round(rain_mm_sum, 3),
            "rain_mm_max_hourly":             round(rain_mm_max_hourly, 3),
            "precip_mm_sum":                  round(precip_mm_sum, 3),
            "soil_moisture_28_100cm_mean":    sm_shallow,
            "soil_moisture_100_255cm_mean":   sm_deep,
            "temp_c_mean":                    round(temp_val, 2),
            "wet_hours":                      wet_hours,
            "wind_speed_mean":                round(wind_val, 2),
            "wind_speed_max":                 wind_max,
            "soil_temp_deep_mean":            soil_temp_deep_mean,
            "rain_cum_3d":                    round(float(rain_cum_3d), 3),
            "rain_cum_7d":                    round(float(rain_cum_7d), 3),
            "rain_cum_15d":                   round(float(rain_cum_15d), 3),
            "rain_cum_30d":                   round(float(rain_cum_30d), 3),
            "rainy_days_3d":                  int(rainy_days_3d),
            "rainy_days_7d":                  int(rainy_days_7d),
            "rainy_days_15d":                 int(rainy_days_15d),
            "rainy_days_30d":                 int(rainy_days_30d),
            "soil_moisture_28_100cm_chg_3d":  sm_shallow_chg_3d,
            "soil_moisture_100_255cm_chg_3d": sm_deep_chg_3d,
            "rain_intensity_ratio":           rain_intensity_ratio,
            "wind_rain_interaction":          wind_rain_interaction,
            "soil_temp_deep_chg_3d":          soil_temp_deep_chg_3d,
            "elevation":                      float(elevation) if elevation is not None and not pd.isna(elevation) else 1000.0,
            "location_id_encoded":            location_id_encoded,
            "month":                          int(month),
            "is_monsoon":                     is_monsoon,
        }

        result = self.predict_from_feature_row(feature_row)
        result["features_used"] = feature_row
        return result

    # ──────────────────────────────────────────────────────────────────────────
    # Feature importances (for Analytics tab Chart.js rendering)
    # ──────────────────────────────────────────────────────────────────────────
    def get_feature_importances(self) -> list[dict]:
        """Return feature importances sorted descending by importance."""
        importances = self.model.feature_importances_
        result = [
            {"feature": name, "importance": round(float(imp), 5)}
            for name, imp in zip(self.feature_columns, importances)
        ]
        result.sort(key=lambda x: x["importance"], reverse=True)
        return result

    # ──────────────────────────────────────────────────────────────────────────
    # Convenience: score the latest day from a raw weather CSV
    # ──────────────────────────────────────────────────────────────────────────
    def predict_latest(self, raw_weather_csv: str = None) -> dict:
        """Recompute features from a raw weather CSV and score the last day."""
        # Lazy import — avoids heavy dependency when just doing dashboard inference
        import sys
        sys.path.insert(0, _THIS_DIR)
        from feature_engineering import build_feature_table

        if raw_weather_csv is None:
            raw_weather_csv = os.path.join(_DATA_DIR, "weather_raw.csv")

        features = build_feature_table(raw_weather_csv)

        if "location_id_encoded" in self.feature_columns and "location_id" in features.columns:
            loc_id = features["location_id"].iloc[0]
            features["location_id_encoded"] = self.location_encoding.get(loc_id, -1)

        latest_row = features.iloc[-1]
        result = self.predict_from_feature_row(latest_row)
        result["date"] = str(latest_row["date"].date())
        if "location_id" in features.columns:
            result["location"] = features["location_id"].iloc[0]
        return result


if __name__ == "__main__":
    predictor = LandslideRiskPredictor()
    result = predictor.predict_latest()
    print(json.dumps(result, indent=2))
