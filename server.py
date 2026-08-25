"""
server.py — DHARA Flask Backend
=================================
Serves the DHARA static web application AND exposes a REST API that connects
the Leaflet GIS frontend to the trained landslide_ml Random Forest model.

Run:
    python server.py               # → http://localhost:5000
    python server.py --port 8080   # → http://localhost:8080

Environment variables:
    PORT     Override the listen port (default: 5000)
    DEBUG    Set to '1' to enable Flask debug mode
"""

import argparse
import datetime
import hashlib
import json
import logging
import os
import secrets
import sqlite3
import sys
import traceback
import uuid

from flask import Flask, jsonify, request, send_from_directory, abort
from flask_cors import CORS

# ── Path Setup ─────────────────────────────────────────────────────────────────
_ROOT_DIR      = os.path.dirname(os.path.abspath(__file__))
_ML_DIR        = os.path.join(_ROOT_DIR, "landslide_ml")
_STATIC_DIR    = _ROOT_DIR        # index.html lives in the project root
_REPORTS_FILE  = os.path.join(_ROOT_DIR, "field_reports.json")
_DB_FILE       = os.path.join(_ROOT_DIR, "dhara_users.db")

# Allow importing from landslide_ml/
sys.path.insert(0, _ML_DIR)

# ── SQLite Database Setup ──────────────────────────────────────────────────────
def _init_db():
    """Create SQLite users table if it does not already exist."""
    try:
        with sqlite3.connect(_DB_FILE) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    first_name TEXT NOT NULL,
                    last_name TEXT NOT NULL,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    last_login TEXT
                )
            """)
            conn.commit()
            logging.info("[DHARA] Users database initialized (dhara_users.db).")
    except Exception as e:
        logging.error(f"[DHARA] Database init error: {e}")

_init_db()

def _hash_password(password: str) -> str:
    """Hash a password using SHA-256 with a salt."""
    salt = "dhara_salt_2026_"
    return hashlib.sha256((salt + password).encode("utf-8")).hexdigest()

# In-memory active session tokens: token -> user dict
_sessions = {}

# ── Model Bootstrap ────────────────────────────────────────────────────────────
_predictor   = None
_model_error = None

try:
    from predict_risk import LandslideRiskPredictor
    _predictor = LandslideRiskPredictor()
    logging.info("[DHARA] LandslideRiskPredictor loaded successfully.")
except Exception as _e:
    _model_error = str(_e)
    logging.error(f"[DHARA] Failed to load model: {_model_error}")

# ── Flask App ──────────────────────────────────────────────────────────────────
app = Flask(__name__, static_folder=_STATIC_DIR, static_url_path="")
CORS(app)  # Allow cross-origin requests (e.g. when running on a separate port)

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)

# ── In-Memory Field Reports Store ──────────────────────────────────────────────
def _load_field_reports() -> list:
    """Load persisted field reports from JSON file, or return empty list."""
    if os.path.exists(_REPORTS_FILE):
        try:
            with open(_REPORTS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return []


def _save_field_reports(reports: list):
    """Persist field reports to JSON file."""
    try:
        with open(_REPORTS_FILE, "w", encoding="utf-8") as f:
            json.dump(reports, f, indent=2)
    except Exception as e:
        logging.warning(f"Could not persist field reports: {e}")


_field_reports: list = _load_field_reports()

# ── Preset Monitoring Stations (mirrored from risk_engine.js) ──────────────────
PRESET_STATIONS = [
    {
        "cell_id": "NER-MEG-EKH-01", "district": "East Khasi Hills (Sohra / Cherrapunji Sub-division)",
        "subdivision": "Sohra Civil Sub-Division", "state": "Meghalaya",
        "lat": 25.2789, "lon": 91.7325, "elevation": 1400,
        "rainfall_72h_mm": 310, "rainfall_intensity_mmhr": 54,
        "soil_moisture_pct": 88, "slope_angle_deg": 42, "historical_incidents_5y": 4,
    },
    {
        "cell_id": "NER-MEG-EKH-02", "district": "East Khasi Hills (Shillong Urban Sub-division)",
        "subdivision": "Shillong Sadar Sub-Division", "state": "Meghalaya",
        "lat": 25.5788, "lon": 91.8933, "elevation": 1500,
        "rainfall_72h_mm": 140, "rainfall_intensity_mmhr": 20,
        "soil_moisture_pct": 62, "slope_angle_deg": 28, "historical_incidents_5y": 1,
    },
    {
        "cell_id": "NER-MEG-RIB-03", "district": "Ri-Bhoi District (Nongpoh Sub-division)",
        "subdivision": "Nongpoh Circle", "state": "Meghalaya",
        "lat": 25.9038, "lon": 91.8810, "elevation": 900,
        "rainfall_72h_mm": 95, "rainfall_intensity_mmhr": 14,
        "soil_moisture_pct": 50, "slope_angle_deg": 22, "historical_incidents_5y": 0,
    },
    {
        "cell_id": "NER-MEG-WGH-04", "district": "West Garo Hills (Tura Peak Sub-division)",
        "subdivision": "Tura Sadar Sub-Division", "state": "Meghalaya",
        "lat": 25.5141, "lon": 90.2032, "elevation": 450,
        "rainfall_72h_mm": 210, "rainfall_intensity_mmhr": 36,
        "soil_moisture_pct": 74, "slope_angle_deg": 35, "historical_incidents_5y": 2,
    },
    {
        "cell_id": "NER-MZ-AIZ-01", "district": "Aizawl District (Laipuitlang Ridge)",
        "subdivision": "Aizawl North Sub-Division", "state": "Mizoram",
        "lat": 23.7271, "lon": 92.7176, "elevation": 1130,
        "rainfall_72h_mm": 190, "rainfall_intensity_mmhr": 28,
        "soil_moisture_pct": 72, "slope_angle_deg": 38, "historical_incidents_5y": 3,
    },
    {
        "cell_id": "NER-MZ-LUN-02", "district": "Lunglei District (Hrangchalkawn Pass)",
        "subdivision": "Lunglei Sadar Sub-Division", "state": "Mizoram",
        "lat": 22.8878, "lon": 92.7366, "elevation": 790,
        "rainfall_72h_mm": 75, "rainfall_intensity_mmhr": 10,
        "soil_moisture_pct": 45, "slope_angle_deg": 20, "historical_incidents_5y": 0,
    },
    {
        "cell_id": "NER-SIK-NTH-01", "district": "North Sikkim (Mangan - Chungthang Valley)",
        "subdivision": "Chungthang Sub-Division", "state": "Sikkim",
        "lat": 27.5029, "lon": 88.5350, "elevation": 1638,
        "rainfall_72h_mm": 290, "rainfall_intensity_mmhr": 46,
        "soil_moisture_pct": 85, "slope_angle_deg": 45, "historical_incidents_5y": 5,
    },
    {
        "cell_id": "NER-SIK-STH-02", "district": "South Sikkim (Namchi - Ravangla Escarpment)",
        "subdivision": "Namchi Sadar Sub-Division", "state": "Sikkim",
        "lat": 27.1671, "lon": 88.3584, "elevation": 1400,
        "rainfall_72h_mm": 160, "rainfall_intensity_mmhr": 24,
        "soil_moisture_pct": 65, "slope_angle_deg": 32, "historical_incidents_5y": 2,
    },
    {
        "cell_id": "NER-ASM-KAM-01", "district": "Kamrup Metro (Guwahati North Hills)",
        "subdivision": "North Guwahati Circle", "state": "Assam",
        "lat": 26.1445, "lon": 91.7362, "elevation": 250,
        "rainfall_72h_mm": 85, "rainfall_intensity_mmhr": 22,
        "soil_moisture_pct": 60, "slope_angle_deg": 18, "historical_incidents_5y": 1,
    },
    {
        "cell_id": "NER-ARP-PAS-01", "district": "Papum Pare (Itanagar Ghat Zone)",
        "subdivision": "Itanagar Sub-Division", "state": "Arunachal Pradesh",
        "lat": 27.0889, "lon": 93.6053, "elevation": 380,
        "rainfall_72h_mm": 175, "rainfall_intensity_mmhr": 30,
        "soil_moisture_pct": 70, "slope_angle_deg": 36, "historical_incidents_5y": 3,
    },
    {
        "cell_id": "NER-UTK-CHA-01", "district": "Chamoli (Joshimath-Malari Corridor)",
        "subdivision": "Joshimath Sub-Division", "state": "Uttarakhand",
        "lat": 30.5564, "lon": 79.5658, "elevation": 1890,
        "rainfall_72h_mm": 220, "rainfall_intensity_mmhr": 38,
        "soil_moisture_pct": 78, "slope_angle_deg": 44, "historical_incidents_5y": 6,
    },
    {
        "cell_id": "NER-KER-WAY-01", "district": "Wayanad (Kalpetta - Vythiri Ghat Pass)",
        "subdivision": "Vythiri Sub-Division", "state": "Kerala",
        "lat": 11.5510, "lon": 76.1260, "elevation": 850,
        "rainfall_72h_mm": 300, "rainfall_intensity_mmhr": 52,
        "soil_moisture_pct": 90, "slope_angle_deg": 40, "historical_incidents_5y": 4,
    },
]


def _predict_for_station(station: dict) -> dict:
    """Run ML inference for a station dict, returning enriched station data."""
    try:
        result = _predictor.predict_from_dashboard_params(
            rainfall_72h_mm=station.get("rainfall_72h_mm", 0),
            rainfall_intensity_mmhr=station.get("rainfall_intensity_mmhr", 0),
            soil_moisture_pct=station.get("soil_moisture_pct", 50),
            slope_angle_deg=station.get("slope_angle_deg", 20),
            historical_incidents_5y=station.get("historical_incidents_5y", 0),
            elevation=station.get("elevation", 1000),
            lat=station.get("lat", 25.69),
            lon=station.get("lon", 94.11),
        )
        return {**station, **result, "engine": "flask_random_forest_ml"}
    except Exception as e:
        return {**station, "error": str(e), "engine": "error"}


# ════════════════════════════════════════════════════════════════════════════════
# STATIC FILE SERVING
# ════════════════════════════════════════════════════════════════════════════════

@app.route("/")
def serve_index():
    return send_from_directory(_STATIC_DIR, "index.html")


@app.route("/login")
def serve_login():
    return send_from_directory(_STATIC_DIR, "login.html")


@app.route("/<path:filename>")
def serve_static(filename):
    try:
        return send_from_directory(_STATIC_DIR, filename)
    except Exception:
        abort(404)


# ════════════════════════════════════════════════════════════════════════════════
# AUTHENTICATION API ROUTES
# ════════════════════════════════════════════════════════════════════════════════

@app.route("/api/auth/check-username", methods=["GET"])
def api_check_username():
    """Check if a username is available (unique)."""
    username = request.args.get("username", "").strip()
    if not username:
        return jsonify({"available": False, "error": "Username required"}), 400
    try:
        with sqlite3.connect(_DB_FILE) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id FROM users WHERE LOWER(username) = LOWER(?)", (username,))
            row = cursor.fetchone()
            return jsonify({"available": row is None, "username": username})
    except Exception as e:
        return jsonify({"available": False, "error": str(e)}), 500


@app.route("/api/auth/signup", methods=["POST"])
def api_signup():
    """
    Register a new user with First Name, Last Name, unique Username, and Password.
    Saves to SQLite database and returns an auth session token.
    """
    data = request.get_json(silent=True) or {}
    first_name = str(data.get("first_name", "")).strip()
    last_name  = str(data.get("last_name", "")).strip()
    username   = str(data.get("username", "")).strip()
    password   = str(data.get("password", "")).strip()

    if not first_name or not last_name or not username or not password:
        return jsonify({"error": "First name, last name, username, and password are all required."}), 400

    if len(username) < 3 or len(username) > 30:
        return jsonify({"error": "Username must be between 3 and 30 characters."}), 400

    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters long."}), 400

    pwd_hash = _hash_password(password)
    now_str = datetime.datetime.now().isoformat()

    try:
        with sqlite3.connect(_DB_FILE) as conn:
            cursor = conn.cursor()
            # Enforce unique username (case-insensitive)
            cursor.execute("SELECT id FROM users WHERE LOWER(username) = LOWER(?)", (username,))
            if cursor.fetchone():
                return jsonify({"error": f"Username '@{username}' is already taken. Please choose another."}), 409

            cursor.execute("""
                INSERT INTO users (first_name, last_name, username, password_hash, created_at, last_login)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (first_name, last_name, username, pwd_hash, now_str, now_str))
            conn.commit()
            user_id = cursor.lastrowid

        token = secrets.token_hex(24)
        user_info = {
            "id": user_id,
            "first_name": first_name,
            "last_name": last_name,
            "username": username,
            "created_at": now_str,
        }
        _sessions[token] = user_info
        logging.info(f"[AUTH] New user registered: @{username} ({first_name} {last_name})")

        return jsonify({
            "status": "ok",
            "message": "Account created successfully.",
            "token": token,
            "user": user_info
        }), 201

    except sqlite3.IntegrityError:
        return jsonify({"error": f"Username '@{username}' is already taken."}), 409
    except Exception as e:
        logging.error(f"[AUTH] Signup error: {e}")
        return jsonify({"error": "Server error during registration."}), 500


@app.route("/api/auth/login", methods=["POST"])
def api_login():
    """
    Authenticate an existing user with Username and Password.
    Returns an auth session token and user info.
    """
    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", "")).strip()

    if not username or not password:
        return jsonify({"error": "Username and password are required."}), 400

    pwd_hash = _hash_password(password)
    now_str = datetime.datetime.now().isoformat()

    try:
        with sqlite3.connect(_DB_FILE) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, first_name, last_name, username, password_hash, created_at
                FROM users WHERE LOWER(username) = LOWER(?)
            """, (username,))
            row = cursor.fetchone()

            if not row or row[4] != pwd_hash:
                return jsonify({"error": "Invalid username or password."}), 401

            user_id, first_name, last_name, real_username, _, created_at = row

            cursor.execute("UPDATE users SET last_login = ? WHERE id = ?", (now_str, user_id))
            conn.commit()

        token = secrets.token_hex(24)
        user_info = {
            "id": user_id,
            "first_name": first_name,
            "last_name": last_name,
            "username": real_username,
            "created_at": created_at,
        }
        _sessions[token] = user_info
        logging.info(f"[AUTH] User logged in: @{real_username}")

        return jsonify({
            "status": "ok",
            "message": "Login successful.",
            "token": token,
            "user": user_info
        })

    except Exception as e:
        logging.error(f"[AUTH] Login error: {e}")
        return jsonify({"error": "Server error during login."}), 500


@app.route("/api/auth/me", methods=["GET"])
def api_auth_me():
    """Return currently authenticated user information."""
    auth_header = request.headers.get("Authorization", "")
    token = None
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
    elif "token" in request.args:
        token = request.args.get("token")

    if not token or token not in _sessions:
        return jsonify({"error": "Unauthorized or session expired"}), 401

    return jsonify({"status": "ok", "user": _sessions[token]})


@app.route("/api/auth/logout", methods=["POST"])
def api_logout():
    """Invalidate session token."""
    auth_header = request.headers.get("Authorization", "")
    token = None
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
    if token and token in _sessions:
        del _sessions[token]
    return jsonify({"status": "ok", "message": "Logged out successfully."})


# ════════════════════════════════════════════════════════════════════════════════
# CORE ML & TELEMETRY API ROUTES
# ════════════════════════════════════════════════════════════════════════════════

@app.route("/api/health", methods=["GET"])
def api_health():
    """Health check — confirms Flask is running and model is loaded."""
    return jsonify({
        "status":           "ok",
        "model_loaded":     _predictor is not None,
        "model_error":      _model_error,
        "label_source":     _predictor.label_source if _predictor else None,
        "timestamp":        datetime.datetime.now().isoformat(),
        "endpoints": [
            "/api/health",
            "/api/auth/check-username",
            "/api/auth/signup",
            "/api/auth/login",
            "/api/auth/me",
            "/api/auth/logout",
            "/api/predict",
            "/api/predict/latest",
            "/api/predict/batch",
            "/api/stations",
            "/api/model/info",
            "/api/model/feature-importance",
            "/api/field-reports",
        ]
    })


@app.route("/api/predict", methods=["POST"])
def api_predict():
    """
    Real-time single-point inference from dashboard slider/station parameters.

    POST body (JSON):
    {
        "rainfall_72h_mm": 280,
        "rainfall_intensity_mmhr": 48,
        "soil_moisture_pct": 82,
        "slope_angle_deg": 41,
        "historical_incidents_5y": 3,
        "elevation": 1200,         // optional
        "lat": 25.27,              // optional
        "lon": 91.73,              // optional
        "month": 8,                // optional (default = current month)
        "cell_id": "NER-MEG-014",  // optional — for labelling only
        "district": "East Khasi Hills"  // optional
    }

    Response:
    {
        "risk_level": "High",
        "risk_score": 0.71,
        "class_probabilities": {"Low": 0.12, "Medium": 0.17, "High": 0.71},
        "model_trained_on": "real",
        "features_used": { ... },
        "cell_id": "NER-MEG-014",
        "district": "East Khasi Hills",
        "engine": "flask_random_forest_ml"
    }
    """
    if _predictor is None:
        return jsonify({"error": f"Model not loaded: {_model_error}"}), 503

    data = request.get_json(force=True, silent=True) or {}

    try:
        result = _predictor.predict_from_dashboard_params(
            rainfall_72h_mm        = float(data.get("rainfall_72h_mm", 0)),
            rainfall_intensity_mmhr= float(data.get("rainfall_intensity_mmhr", 0)),
            soil_moisture_pct      = float(data.get("soil_moisture_pct", 50)),
            slope_angle_deg        = float(data.get("slope_angle_deg", 20)),
            historical_incidents_5y= int(data.get("historical_incidents_5y", 0)),
            elevation              = float(data.get("elevation", 1000)),
            lat                    = float(data.get("lat", 25.69)),
            lon                    = float(data.get("lon", 94.11)),
            month                  = data.get("month"),
        )
        result["cell_id"]  = data.get("cell_id",  "custom")
        result["district"] = data.get("district", "Unknown")
        result["engine"]   = "flask_random_forest_ml"
        return jsonify(result)

    except Exception as e:
        logging.error(traceback.format_exc())
        return jsonify({"error": str(e)}), 500


@app.route("/api/predict/latest", methods=["GET"])
def api_predict_latest():
    """Score the most recent day from the default weather CSV dataset."""
    if _predictor is None:
        return jsonify({"error": f"Model not loaded: {_model_error}"}), 503
    try:
        result = _predictor.predict_latest()
        result["engine"] = "flask_random_forest_ml"
        return jsonify(result)
    except Exception as e:
        logging.error(traceback.format_exc())
        return jsonify({"error": str(e)}), 500


@app.route("/api/predict/batch", methods=["POST"])
def api_predict_batch():
    """
    Score multiple grid cells / stations at once.

    POST body (JSON):
    {
        "stations": [
            { "cell_id": "NER-MEG-EKH-01", "rainfall_72h_mm": 310, ... },
            ...
        ]
    }
    """
    if _predictor is None:
        return jsonify({"error": f"Model not loaded: {_model_error}"}), 503

    data = request.get_json(force=True, silent=True) or {}
    stations = data.get("stations", [])
    if not stations:
        return jsonify({"error": "No stations provided in 'stations' key."}), 400

    results = []
    for st in stations:
        try:
            result = _predictor.predict_from_dashboard_params(
                rainfall_72h_mm        = float(st.get("rainfall_72h_mm", 0)),
                rainfall_intensity_mmhr= float(st.get("rainfall_intensity_mmhr", 0)),
                soil_moisture_pct      = float(st.get("soil_moisture_pct", 50)),
                slope_angle_deg        = float(st.get("slope_angle_deg", 20)),
                historical_incidents_5y= int(st.get("historical_incidents_5y", 0)),
                elevation              = float(st.get("elevation", 1000)),
                lat                    = float(st.get("lat", 25.69)),
                lon                    = float(st.get("lon", 94.11)),
            )
            result["cell_id"]  = st.get("cell_id",  "unknown")
            result["district"] = st.get("district", "Unknown")
            result["engine"]   = "flask_random_forest_ml"
        except Exception as e:
            result = {"cell_id": st.get("cell_id", "?"), "error": str(e)}
        results.append(result)

    return jsonify({"count": len(results), "results": results})


@app.route("/api/stations", methods=["GET"])
def api_stations():
    """Return all preset monitoring stations with live ML risk scores."""
    if _predictor is None:
        return jsonify({"error": f"Model not loaded: {_model_error}"}), 503
    enriched = [_predict_for_station(st) for st in PRESET_STATIONS]
    return jsonify({"count": len(enriched), "stations": enriched})


@app.route("/api/model/info", methods=["GET"])
def api_model_info():
    """Return model metadata, training info, label classes and accuracy."""
    if _predictor is None:
        return jsonify({"error": f"Model not loaded: {_model_error}"}), 503

    # Try to read evaluation report
    report_path = os.path.join(_ML_DIR, "outputs", "evaluation_report.txt")
    evaluation_report = None
    if os.path.exists(report_path):
        with open(report_path, "r", encoding="utf-8") as f:
            evaluation_report = f.read()

    rf = _predictor.model
    return jsonify({
        "model_type":        type(rf).__name__,
        "label_source":      _predictor.label_source,
        "risk_classes":      _predictor.risk_labels,
        "location_encoding": _predictor.location_encoding,
        "n_features":        len(_predictor.feature_columns),
        "feature_columns":   _predictor.feature_columns,
        "n_estimators":      getattr(rf, "n_estimators", "?"),
        "max_depth":         getattr(rf, "max_depth", "?"),
        "evaluation_report": evaluation_report,
    })


@app.route("/api/model/feature-importance", methods=["GET"])
def api_feature_importance():
    """Return all 27 feature importances, sorted by importance descending."""
    if _predictor is None:
        return jsonify({"error": f"Model not loaded: {_model_error}"}), 503
    importances = _predictor.get_feature_importances()
    return jsonify({
        "count":   len(importances),
        "features": importances
    })


@app.route("/api/field-reports", methods=["GET"])
def api_get_field_reports():
    """Return all submitted field reports."""
    return jsonify({"count": len(_field_reports), "reports": _field_reports})


@app.route("/api/field-reports", methods=["POST"])
def api_post_field_report():
    """
    Submit a new citizen/officer field report.

    POST body (JSON):
    {
        "location": "Sohra Rd, Meghalaya",
        "lat": 25.27,
        "lon": 91.73,
        "risk_level": "HIGH",
        "notes": "Large crack visible on slope",
        "timestamp": "2026-08-25T10:30:00"
    }
    """
    data = request.get_json(force=True, silent=True) or {}
    report = {
        "id":         str(uuid.uuid4())[:8],
        "location":   data.get("location", "Unknown"),
        "lat":        data.get("lat"),
        "lon":        data.get("lon"),
        "risk_level": data.get("risk_level", "MODERATE"),
        "notes":      data.get("notes", ""),
        "timestamp":  data.get("timestamp", datetime.datetime.now().isoformat()),
        "source":     "citizen_upload",
    }
    _field_reports.append(report)
    _save_field_reports(_field_reports)
    return jsonify({"status": "saved", "report": report}), 201


@app.route("/api/alerts/broadcast", methods=["POST"])
def api_broadcast_alert():
    """
    Simulate broadcasting an emergency alert through all channels.

    POST body (JSON):
    {
        "cell_id": "NER-MEG-EKH-01",
        "district": "East Khasi Hills",
        "risk_level": "CRITICAL",
        "message": "URGENT: Evacuate...",
        "channels": ["sms", "app_push", "ivr"],
        "lang": "en"
    }
    """
    data = request.get_json(force=True, silent=True) or {}
    alert_log = {
        "broadcast_id": str(uuid.uuid4())[:8],
        "timestamp":    datetime.datetime.now().isoformat(),
        "cell_id":      data.get("cell_id", "unknown"),
        "district":     data.get("district", "Unknown"),
        "risk_level":   data.get("risk_level", "HIGH"),
        "message":      data.get("message", ""),
        "channels":     data.get("channels", ["sms"]),
        "lang":         data.get("lang", "en"),
        "status":       "dispatched",
    }
    logging.info(f"[ALERT] Broadcast dispatched: {alert_log['broadcast_id']} → {alert_log['district']}")
    return jsonify(alert_log)


# ════════════════════════════════════════════════════════════════════════════════
# ERROR HANDLERS
# ════════════════════════════════════════════════════════════════════════════════

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(500)
def server_error(e):
    return jsonify({"error": "Internal server error"}), 500


# ════════════════════════════════════════════════════════════════════════════════
# ENTRYPOINT
# ════════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DHARA Flask Backend")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", 5000)))
    parser.add_argument("--debug", action="store_true", default=os.environ.get("DEBUG") == "1")
    args = parser.parse_args()

    print("=" * 60)
    print("  DHARA -- AI/ML Landslide Early Warning System")
    print("  Flask Backend + ML REST API")
    print("=" * 60)
    if _predictor:
        print(f"  [OK] ML Model loaded  ({_predictor.label_source.upper()} ground-truth labels)")
        print(f"  [OK] {len(_predictor.feature_columns)} features | {len(_predictor.risk_labels)} risk classes")
    else:
        print(f"  [ERROR] ML Model failed to load: {_model_error}")
    print(f"  [>] Serving on http://localhost:{args.port}")
    print(f"  [>] API root: http://localhost:{args.port}/api/health")
    print("=" * 60)


    app.run(host="0.0.0.0", port=args.port, debug=args.debug)
