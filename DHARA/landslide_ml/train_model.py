"""
train_model.py
---------------
End-to-end training pipeline for the landslide risk classifier.

Run:
    python3 train_model.py

Outputs:
    models/landslide_risk_model.pkl   <- trained model (joblib)
    models/feature_columns.json       <- exact feature list/order the model expects
    outputs/feature_importance.png
    outputs/confusion_matrix.png
    outputs/evaluation_report.txt
"""

import os
import shutil
import json
import joblib
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns

from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    classification_report, confusion_matrix, accuracy_score, f1_score
)

from feature_engineering import build_multi_location_feature_table, build_feature_table
from labeling import attach_labels

DATA_DIR = "data"
RANDOM_STATE = 42

FEATURE_COLUMNS = [
    "rain_mm_sum", "rain_mm_max_hourly", "precip_mm_sum",
    "soil_moisture_28_100cm_mean", "soil_moisture_100_255cm_mean",
    "temp_c_mean", "wet_hours",
    "wind_speed_mean", "wind_speed_max",
    "soil_temp_deep_mean",
    "rain_cum_3d", "rain_cum_7d", "rain_cum_15d", "rain_cum_30d",
    "rainy_days_3d", "rainy_days_7d", "rainy_days_15d", "rainy_days_30d",
    "soil_moisture_28_100cm_chg_3d", "soil_moisture_100_255cm_chg_3d",
    "rain_intensity_ratio",
    "wind_rain_interaction", "soil_temp_deep_chg_3d",
    "elevation", "location_id_encoded",
    "month", "is_monsoon",
]

RISK_LABELS = {0: "Low", 1: "Medium", 2: "High"}


def main():
    os.makedirs("models", exist_ok=True)
    os.makedirs("outputs", exist_ok=True)
    os.makedirs(DATA_DIR, exist_ok=True)

    # Sync records template to data/landslide_records.csv if not already present
    template_path = os.path.join(DATA_DIR, "landslide_records_TEMPLATE.csv")
    standard_path = os.path.join(DATA_DIR, "landslide_records.csv")
    if os.path.exists(template_path) and not os.path.exists(standard_path):
        import shutil
        shutil.copyfile(template_path, standard_path)
        print(f"[setup] Synced {template_path} -> {standard_path}")

    print("=" * 60)
    print("STEP 1: Feature engineering from ALL weather data sources")
    print("=" * 60)
    features = build_multi_location_feature_table(DATA_DIR)

    # Save daily features
    daily_out = os.path.join(DATA_DIR, "daily_features.csv")
    features.to_csv(daily_out, index=False)
    print(f"Saved intermediate -> {daily_out}")

    # Encode location_id as an integer so the model can use it
    loc_ids = sorted(features["location_id"].unique())
    loc_map = {loc: i for i, loc in enumerate(loc_ids)}
    features["location_id_encoded"] = features["location_id"].map(loc_map)
    print(f"\nLocation encoding: {loc_map}")

    print("\n" + "=" * 60)
    print("STEP 2: Attach labels (real landslide records if available)")
    print("=" * 60)
    labeled, label_mode = attach_labels(features)

    # Save labeled features
    labeled_out = os.path.join(DATA_DIR, "labeled_features.csv")
    labeled.to_csv(labeled_out, index=False)
    print(f"Saved intermediate -> {labeled_out}")

    X = labeled[FEATURE_COLUMNS]
    y = labeled["label"]

    labels_present = sorted(y.unique())
    if set(labels_present) == {0, 1}:
        risk_labels = {0: "Low", 1: "High"}
    else:
        risk_labels = {0: "Low", 1: "Medium", 2: "High"}

    print(f"Active risk labels: {risk_labels}")

    print("\n" + "=" * 60)
    print("STEP 3: Train / test split (time-aware, per-location)")
    print("=" * 60)
    # Time-series-safe split PER LOCATION: train on earlier years, test on
    # most recent period, for each location independently. This avoids
    # leaking future data and is realistic for an early-warning system.
    train_mask = pd.Series(False, index=labeled.index)
    for loc in loc_ids:
        loc_mask = labeled["location_id"] == loc
        loc_indices = labeled[loc_mask].index
        split_idx = int(len(loc_indices) * 0.8)
        train_mask.iloc[loc_indices[:split_idx]] = True

    X_train, X_test = X[train_mask], X[~train_mask]
    y_train, y_test = y[train_mask], y[~train_mask]
    print(f"Train: {len(X_train)} days | Test: {len(X_test)} days")
    print(f"Locations in train: {labeled[train_mask]['location_id'].nunique()} | "
          f"Locations in test: {labeled[~train_mask]['location_id'].nunique()}")

    print("\n" + "=" * 60)
    print("STEP 4: Train Random Forest classifier")
    print("=" * 60)
    model = RandomForestClassifier(
        n_estimators=300,
        max_depth=10,
        min_samples_leaf=5,
        class_weight="balanced",   # landslide/high-risk days are rare -> reweight
        random_state=RANDOM_STATE,
        n_jobs=-1,
    )
    model.fit(X_train, y_train)

    print("\n" + "=" * 60)
    print("STEP 5: Evaluate")
    print("=" * 60)
    y_pred = model.predict(X_test)
    acc = accuracy_score(y_test, y_pred)
    f1 = f1_score(y_test, y_pred, average="macro", zero_division=0)
    target_names = [risk_labels.get(l, str(l)) for l in labels_present]
    report = classification_report(
        y_test, y_pred, labels=labels_present, target_names=target_names, zero_division=0
    )

    print(f"Accuracy: {acc:.3f} | Macro F1: {f1:.3f}")
    print(report)

    with open("outputs/evaluation_report.txt", "w") as f:
        f.write(f"Label source: {label_mode}\n")
        f.write(f"Accuracy: {acc:.3f}\nMacro F1: {f1:.3f}\n\n")
        f.write(report)
    print("Saved -> outputs/evaluation_report.txt")

    # Confusion matrix
    cm = confusion_matrix(y_test, y_pred, labels=labels_present)
    plt.figure(figsize=(5, 4))
    sns.heatmap(cm, annot=True, fmt="d", cmap="Reds",
                xticklabels=target_names, yticklabels=target_names)
    plt.xlabel("Predicted")
    plt.ylabel("Actual")
    plt.title("Confusion Matrix - Landslide Risk Classifier")
    plt.tight_layout()
    plt.savefig("outputs/confusion_matrix.png", dpi=150)
    plt.close()
    print("Saved -> outputs/confusion_matrix.png")

    # Feature importance
    importances = pd.Series(model.feature_importances_, index=FEATURE_COLUMNS)
    importances = importances.sort_values(ascending=True)
    plt.figure(figsize=(7, 6))
    importances.plot(kind="barh", color="#c0392b")
    plt.title("Feature Importance - What Drives Predicted Risk")
    plt.tight_layout()
    plt.savefig("outputs/feature_importance.png", dpi=150)
    plt.close()
    print("Saved -> outputs/feature_importance.png")

    print("\n" + "=" * 60)
    print("STEP 6: Save trained model")
    print("=" * 60)
    joblib.dump(model, "models/landslide_risk_model.pkl")
    with open("models/feature_columns.json", "w") as f:
        json.dump({
            "feature_columns": FEATURE_COLUMNS,
            "risk_labels": risk_labels,
            "label_source": label_mode,
            "location_encoding": loc_map,
        }, f, indent=2)
    print("Saved -> models/landslide_risk_model.pkl")
    print("Saved -> models/feature_columns.json")

    if label_mode == "proxy":
        print("\n*** REMINDER: model trained on PROXY labels (rainfall/soil-"
              "saturation heuristic), not confirmed landslide events. Add "
              "data/landslide_records.csv (see data/landslide_records_TEMPLATE.csv) "
              "and re-run this script to train on real events. ***")
    else:
        print("\n*** SUCCESS: Model trained on REAL landslide records! ***")


if __name__ == "__main__":
    main()
