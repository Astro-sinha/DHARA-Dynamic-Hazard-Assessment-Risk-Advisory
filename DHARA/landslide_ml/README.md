# Landslide Risk ML Module — SIH 26001 (AI-Based Early Warning & Landslide Risk Monitoring, NER)

This folder is the **AI/ML component** covering task items (a) and (b) of the
problem statement:
- Collect & analyse rainfall, soil moisture, terrain, historical landslide data
- Use AI/ML models to identify high-risk zones and predict landslide events

## What's here

```
landslide_ml/
├── data/
│   ├── weather_raw.csv                           # Open-Meteo export (Darjeeling, 2006-2026)
│   ├── open-meteo-27.52N88.59E1638m.csv          # Open-Meteo export (Darjeeling, 2016-2026, with wind/soil temp)
│   ├── open-meteo-25.69N94.11E1420m.csv          # Open-Meteo export (Manipur/NER, 2016-2026, with wind/soil temp)
│   ├── daily_features.csv                        # generated: engineered daily features
│   ├── labeled_features.csv                      # generated: features + risk labels
│   └── landslide_records_TEMPLATE.csv            # format for YOUR real landslide records
├── feature_engineering.py              # raw hourly data -> daily ML features (multi-source)
├── labeling.py                         # attaches labels (real records, or proxy fallback)
├── train_model.py                      # trains + evaluates + saves the model
├── predict_risk.py                     # inference wrapper for the dashboard/backend
├── models/
│   ├── landslide_risk_model.pkl        # trained RandomForest model
│   └── feature_columns.json            # feature list + label meaning + label source
└── outputs/
    ├── evaluation_report.txt
    ├── confusion_matrix.png
    └── feature_importance.png
```

## How to run it

```bash
pip install pandas numpy scikit-learn matplotlib seaborn joblib
py train_model.py        # trains and saves the model
py predict_risk.py       # scores the most recent day as a demo
```

## Methodology

**Data used:** Hourly weather data from **two geographic locations** across NER:
1. **Darjeeling/Kalimpong hills** (27.52N, 88.59E, 1638m) — rainfall,
   precipitation, soil moisture at two depths, temperature, wind speed, and
   soil temperature. Coverage: 2006-2026 (from `weather_raw.csv`) and
   2016-2026 with additional features (from `open-meteo-27.52N88.59E1638m.csv`).
2. **Manipur/NER** (25.69N, 94.11E, 1420m) — same variables. Coverage:
   2016-2026 (from `open-meteo-25.69N94.11E1420m.csv`).

All data sourced from Open-Meteo. The pipeline automatically discovers,
loads, and harmonises all CSV files in the `data/` directory.

**Feature engineering** (`feature_engineering.py`): raw hourly data is rolled
up to daily (per location), then enriched with the features landslide research
actually uses:
- Cumulative ("antecedent") rainfall over 3/7/15/30 days — captures slope
  saturation building up over time, which is the single biggest driver of
  rainfall-induced landslides.
- Rainy-day counts over the same windows.
- Peak hourly rainfall intensity per day, and a rainfall-intensity ratio vs
  the recent weekly average — captures sudden bursts on top of already-wet
  ground.
- Soil moisture level and its 3-day rate of change at both depths.
- **Wind speed** (mean and max per day) — strong winds can destabilise
  already-saturated slopes by exerting mechanical force on vegetation and soil.
- **Wind-rain interaction** — combined wind + rainfall stress metric.
- **Soil temperature** (deep layer mean and 3-day change) — freeze-thaw
  cycles weaken slope cohesion.
- **Elevation** and **location ID** — static site-specific features that let
  the model adapt thresholds per location.
- Month / monsoon flag — landslide risk in NER is heavily seasonal.

**Labels** (`labeling.py`):
- **Real landslide event records**: 253 historical landslide records are loaded from `data/landslide_records.csv` (or `data/landslide_records_TEMPLATE.csv`), spanning 2015–2025 across key hill stations in the Himalayan and Northeast regions.
- Dates are expanded by `LABEL_WINDOW_DAYS = 1` (+/- 1 day) and matched against the weather feature dates.
- Severity information is mapped to 3-class risk:
  - **Low (0)**: Baseline days with no recorded landslide event.
  - **Medium (1)**: Minor or moderate recorded landslide events.
  - **High (2)**: Major, severe, or critical landslide events.
- If records are absent in a new environment, the system automatically falls back to the physical composite proxy label.

**Model**: RandomForestClassifier (300 trees, max_depth=10, class-balanced weights, time-aware per-location train/test split so we test on the most recent ~20% of days for each location independently).

**Current result** (trained on **real ground-truth records**):
- Evaluated on test split: **~72.2% accuracy**, macro F1: **0.362**, weighted F1: **0.770**.
- The model artifacts (`models/landslide_risk_model.pkl` and `models/feature_columns.json`) are tagged with `"label_source": "real"`.

## What's still missing (be upfront about this to your team/judges)

1. **Terrain/slope data** — add SRTM/DEM-derived slope, aspect, and curvature per grid cell (via Bhuvan/USGS Earth Explorer) as extra features; slope angle is typically the top physical predictor.
3. **Satellite imagery** — for a hackathon scope, NDVI (vegetation loss can
   precede/reveal slope failure) from Sentinel-2/Bhuvan is the highest-value,
   lowest-effort addition; full imagery-based deep learning is a stretch goal.
4. **More spatial coverage** — we now have two locations instead of one,
   but for the "GIS heatmap across NER" requirement, you'll need this same
   feature pipeline run over a grid of points (or interpolated rainfall/soil-
   moisture rasters) across the region. Adding more Open-Meteo CSVs is easy:
   just drop them in `data/` and re-run training.
5. **Real-time feed** — swap the static CSV for a live IMD/Open-Meteo API
   call in `feature_engineering.py`'s `load_raw_weather` so `predict_risk.py`
   can score "right now" continuously.

## For your teammates building the dashboard/backend

Call `LandslideRiskPredictor` from `predict_risk.py` — it returns a JSON-
serializable dict with `risk_level`, `risk_score` (0-1), and per-class
probabilities. That's your API contract; wire it into the GIS dashboard's
risk heatmap and the SMS/app alert trigger (e.g. alert when `risk_score` >
some threshold).
