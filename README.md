# DHARA — AI/ML Landslide Early Warning & Risk Prediction System

**DHARA** (Landslide Early Warning System) is an interactive, ISRO Bhuvan Geo-Portal inspired web platform and predictive ML analytics engine designed for real-time landslide risk assessment, transport corridor advisories, and multi-lingual emergency alert routing.

![ISRO Bhuvan Aesthetic](https://img.shields.io/badge/GIS-ISRO%20Bhuvan%20Telemetry-00e5ff?style=for-the-badge)
![Flask Backend](https://img.shields.io/badge/Backend-Flask%20REST%20API-3b82f6?style=for-the-badge)
![ML Engine](https://img.shields.io/badge/ML%20Engine-Random%20Forest%20%2B%20Edge%20Rule%20Fallback-10b981?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)

---

## 🌟 Key Features

1. **User Authentication & Database Security**:
   - **SQLite Database (`dhara_users.db`)**: Persistent user store with unique username constraint and SHA-256 salted password hashing.
   - **Full-Screen Glassmorphic Auth Portal (`/login`)**: Animated toggle between Login and Sign Up with live username availability checker and password strength indicator.
   - **Session Tokens & Route Guards**: Protected dashboard access with automatic redirect, user profile chip in header, and one-click logout.

2. **ISRO Bhuvan GIS Map Viewer**:
   - High-resolution Bhuvan Satellite Imagery + Hybrid Road Networks.
   - Survey of India Topographic DEM and Dark Vector layers.
   - Live Latitude, Longitude, and Zoom Level cursor tracking.

3. **North-East & Himalayan Sub-district Divisions**:
   - High-resolution monitoring station grid cells across all 8 North-Eastern states + Himalayan belts.
   - Color-coded micro-grid polygons (`LOW`, `MODERATE`, `HIGH`, `CRITICAL`).

4. **Dual-Engine AI Risk Prediction**:
   - **Flask ML API (Random Forest)**: Real-time server-side inference using the trained `landslide_risk_model.pkl` model trained on real ground-truth data.
   - **Edge Gateway Scorer**: Offline rule-based scorer for low-power edge devices when internet connection is lost.
   - Seamless automatic fallback: if Flask API is not running, the app uses the local JavaScript surrogate model.

5. **Tourist & Transport Route Advisory Planner**:
   - Trip-level risk evaluator for National Highway corridors.

6. **Multilingual Emergency Alerts**:
   - Generates SMS, App Push, and IVR alerts in **English**, **Assamese (অসমীয়া)**, and **Hindi (हिन्दी)**.

7. **Live Analytics Dashboard**:
   - Feature Importance bar chart — loads live from Flask API when connected.
   - Soil Saturation vs. Rainfall Hazard scatter plot.

8. **Centralized Persistent Field Reporting**:
   - Field reports are persisted centrally through the Flask backend.
   - Report metadata is stored in SQLite (`dhara_users.db`), while uploaded images are stored on the server under `uploads/field_reports/`.
   - All authenticated users retrieve reports through `GET /api/field-reports`.
   - Dynamic report count badge, EXIF geotag extraction, and interactive Leaflet map markers.

---

## 📁 Repository Structure

```
DHARA/
├── index.html            # Main Bhuvan-inspired GIS application view (Protected)
├── login.html            # Login & Sign Up portal with live validation
├── auth.js               # Client-side session management & page guard
├── dhara_users.db        # SQLite database (users, sessions, field_reports, field_report_images)
├── uploads/
│   └── field_reports/   # Server-side persistent storage for uploaded field photos
├── styles.css            # Glassmorphic dark design system & GIS map styling
├── app.js                # Leaflet map orchestrator & dynamic HUD coordinate tracker
├── risk_engine.js        # JS port of AI Risk Prediction Engine & sub-division datasets
├── flask_client.js       # Flask ML & Field Reports API client
├── server.py             # Flask REST API backend + Auth + Persistent Field Reporting
├── requirements.txt      # Python dependencies
├── start_server.command  # One-click launcher for macOS
├── start_server.bat      # One-click launcher for Windows
├── README.md             # Project documentation
└── landslide_ml/

    ├── predict_risk.py       # Inference wrapper (dashboard-param helper added)
    ├── train_model.py        # Training pipeline
    ├── feature_engineering.py
    ├── labeling.py
    ├── models/
    │   ├── landslide_risk_model.pkl  # Trained Random Forest (11 MB)
    │   └── feature_columns.json      # 27 feature schema + label mapping
    ├── data/                          # Historical weather + landslide records
    └── outputs/                       # Training evaluation plots & reports
```

---

## 🚀 How to Run Locally

### Option 1: Flask Backend + ML API (Recommended)

```bash
# Install Python dependencies
pip install -r requirements.txt

# Start the Flask server (serves the full app + ML API)
python server.py

# Open the web app
# → http://localhost:5000
```

Once running, the status badge in the top header will switch from **ML API: OFFLINE** to **ML API: CONNECTED** and all slider adjustments will use the real Random Forest model.

### Option 2: Static File Server (No ML — local fallback mode)

```bash
# Python HTTP Server
python -m http.server 8080

# Or Node/npx
npx serve .
```

The app runs fully in offline mode using the JavaScript surrogate model.

---

## 🔌 Flask REST API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/api/health` | Server health, model loaded status, label source |
| `GET`  | `/api/auth/check-username` | Check username availability (unique constraint) |
| `POST` | `/api/auth/signup` | Register new user with first name, last name, unique username & password |
| `POST` | `/api/auth/login` | Authenticate existing user with username and password |
| `GET`  | `/api/auth/me` | Fetch currently logged-in user profile with session token |
| `POST` | `/api/auth/logout` | Invalidate session token |
| `POST` | `/api/predict` | Single-point real-time ML inference |
| `GET`  | `/api/predict/latest` | Score most recent day from weather CSV |
| `POST` | `/api/predict/batch` | Multi-station batch inference |
| `GET`  | `/api/stations` | All monitoring stations with live ML scores |
| `GET`  | `/api/model/info` | Model metadata, evaluation report, feature list |
| `GET`  | `/api/model/feature-importance` | All 27 feature importances ranked |
| `GET`  | `/api/field-reports` | List all submitted and preset field reports from SQLite |
| `POST` | `/api/field-reports` | Submit a new field report with multipart image upload (Auth required) |
| `GET`  | `/uploads/field_reports/<filename>` | Serve uploaded field photos |
| `POST` | `/api/alerts/broadcast` | Simulate multi-channel emergency alert dispatch |

### Sample: POST /api/predict

```bash
curl -X POST http://localhost:5000/api/predict \
  -H "Content-Type: application/json" \
  -d '{
    "rainfall_72h_mm": 280,
    "rainfall_intensity_mmhr": 48,
    "soil_moisture_pct": 82,
    "slope_angle_deg": 41,
    "historical_incidents_5y": 3,
    "elevation": 1400,
    "lat": 25.27,
    "lon": 91.73
  }'
```

Sample response:
```json
{
  "risk_level": "High",
  "risk_score": 0.71,
  "class_probabilities": { "Low": 0.12, "Medium": 0.17, "High": 0.71 },
  "model_trained_on": "real",
  "engine": "flask_random_forest_ml"
}
```

---

## 🧠 ML Model Details

- **Model**: RandomForestClassifier (300 trees, `max_depth=10`, class-balanced weights)
- **Training Data**: Two NER/Himalayan locations (Darjeeling–Kalimpong, Manipur), 2006–2026
- **Labels**: Real historical landslide records (253 events, 3-class: Low / Medium / High)
- **Features**: 27 engineered daily features — cumulative rainfall windows, soil moisture at depth, wind speed, soil temperature, elevation, monsoon flag, and more
- **Current Performance**: ~72.2% accuracy, macro F1: 0.362, weighted F1: 0.770
- **Label Source**: `"real"` (Ground-truth records from `data/landslide_records.csv`)

---

## 📄 License
This project is open-source under the MIT License.
