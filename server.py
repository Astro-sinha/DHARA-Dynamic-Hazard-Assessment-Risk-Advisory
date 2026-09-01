"""
server.py — DHARA Flask Backend
=================================
Serves the DHARA static web application AND exposes a REST API that connects
the Leaflet GIS frontend to the trained landslide_ml Random Forest model,
SQLite user authentication & sessions, and centralized persistent field reporting.

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
_UPLOADS_DIR   = os.path.join(_ROOT_DIR, "uploads", "field_reports")
_REPORTS_FILE  = os.path.join(_ROOT_DIR, "field_reports.json")
_DB_FILE       = os.path.join(_ROOT_DIR, "dhara_users.db")

# Ensure uploads directory exists
os.makedirs(_UPLOADS_DIR, exist_ok=True)

# Image upload constraints
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_IMAGE_SIZE_BYTES     = 10 * 1024 * 1024  # 10 MB per image

# Allow importing from landslide_ml/
sys.path.insert(0, _ML_DIR)

# ── Preset Field Reports (Default Ground/Seed Data) ────────────────────────────
PRESET_FIELD_REPORTS = [
    {
        "id": "fr-1",
        "user_id": None,
        "username": "isro_telemetry",
        "location": "Sohra Rd, Meghalaya",
        "lat": 25.28,
        "lon": 91.73,
        "risk_level": "CRITICAL",
        "notes": "Active slope movement observed. Water seeping through road crack.",
        "image_filename": "report1.jpg",
        "image_url": "assets/reports/report1.jpg",
        "timestamp": "12 min ago",
        "source": "preset_demo",
        "status": "Pending Verification",
        "created_at": (datetime.datetime.now() - datetime.timedelta(minutes=12)).isoformat(),
    },
    {
        "id": "fr-2",
        "user_id": None,
        "username": "ndrf_officer",
        "location": "NH-27, Dima Hasao",
        "lat": 25.18,
        "lon": 93.02,
        "risk_level": "HIGH",
        "notes": "Boulder debris on roadway. Emergency response team deployed with excavators.",
        "image_filename": "report2.jpg",
        "image_url": "assets/reports/report2.jpg",
        "timestamp": "48 min ago",
        "source": "preset_demo",
        "status": "Verified",
        "created_at": (datetime.datetime.now() - datetime.timedelta(minutes=48)).isoformat(),
    },
    {
        "id": "fr-3",
        "user_id": None,
        "username": "sdma_sikkim",
        "location": "Mangan, Sikkim",
        "lat": 27.50,
        "lon": 88.54,
        "risk_level": "MODERATE",
        "notes": "Coastal/cliff slope erosion observed near coastal access road.",
        "image_filename": "report3.jpg",
        "image_url": "assets/reports/report3.jpg",
        "timestamp": "2 hr ago",
        "source": "preset_demo",
        "status": "Verified",
        "created_at": (datetime.datetime.now() - datetime.timedelta(hours=2)).isoformat(),
    },
    {
        "id": "fr-4",
        "user_id": None,
        "username": "field_officer_nagaland",
        "location": "Kohima Bypass",
        "lat": 25.68,
        "lon": 94.11,
        "risk_level": "HIGH",
        "notes": "Massive mudslide accumulation across hillside village route.",
        "image_filename": "report4.jpg",
        "image_url": "assets/reports/report4.jpg",
        "timestamp": "3 hr ago",
        "source": "preset_demo",
        "status": "Pending Verification",
        "created_at": (datetime.datetime.now() - datetime.timedelta(hours=3)).isoformat(),
    },
    {
        "id": "fr-5",
        "user_id": None,
        "username": "pwd_mizoram",
        "location": "Aizawl-Lunglei Rd",
        "lat": 23.73,
        "lon": 92.72,
        "risk_level": "MODERATE",
        "notes": "Rockfall debris blocking highway lane. Net netting under strain.",
        "image_filename": "report5.jpg",
        "image_url": "assets/reports/report5.jpg",
        "timestamp": "5 hr ago",
        "source": "preset_demo",
        "status": "Verified",
        "created_at": (datetime.datetime.now() - datetime.timedelta(hours=5)).isoformat(),
    },
    {
        "id": "fr-6",
        "user_id": None,
        "username": "tripura_survey",
        "location": "Dhalai river bank",
        "lat": 23.83,
        "lon": 91.29,
        "risk_level": "LOW",
        "notes": "Severe rockfall and landslide debris on mountain roadway.",
        "image_filename": "report6.jpg",
        "image_url": "assets/reports/report6.jpg",
        "timestamp": "6 hr ago",
        "source": "preset_demo",
        "status": "Verified",
        "created_at": (datetime.datetime.now() - datetime.timedelta(hours=6)).isoformat(),
    },
]

def _hash_password(password: str) -> str:
    """Hash a password using SHA-256 with a salt."""
    salt = "dhara_salt_2026_"
    return hashlib.sha256((salt + password).encode("utf-8")).hexdigest()


# ── SQLite Database Setup ──────────────────────────────────────────────────────
def _init_db():
    """Create SQLite users, sessions, field reports, road incidents, SOS and emergency contacts tables."""
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
                    role TEXT DEFAULT 'tourist',
                    created_at TEXT NOT NULL,
                    last_login TEXT
                )
            """)

            # Ensure role column exists for existing DB
            cursor.execute("PRAGMA table_info(users)")
            user_cols = [c[1] for c in cursor.fetchall()]
            if "role" not in user_cols:
                cursor.execute("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'tourist'")
                conn.commit()

            # Ensure default admin account exists (@admin / admin123)
            admin_hash = _hash_password("admin123")
            now_str = datetime.datetime.now().isoformat()
            cursor.execute("SELECT id FROM users WHERE LOWER(username) = 'admin'")
            row = cursor.fetchone()
            if not row:
                cursor.execute("""
                    INSERT INTO users (first_name, last_name, username, password_hash, role, created_at, last_login)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, ("Admin", "Officer", "admin", admin_hash, "admin", now_str, now_str))
                logging.info("[AUTH] Default admin account created: @admin / admin123")
            else:
                cursor.execute("UPDATE users SET password_hash = ?, role = 'admin' WHERE LOWER(username) = 'admin'", (admin_hash,))
            conn.commit()

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    token TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                )
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS field_reports (
                    id TEXT PRIMARY KEY,
                    user_id INTEGER,
                    username TEXT,
                    location TEXT NOT NULL,
                    lat REAL,
                    lon REAL,
                    risk_level TEXT NOT NULL,
                    notes TEXT,
                    image_filename TEXT,
                    image_url TEXT,
                    timestamp TEXT NOT NULL,
                    source TEXT DEFAULT 'citizen_upload',
                    status TEXT DEFAULT 'Pending Verification',
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                )
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS field_report_images (
                    id TEXT PRIMARY KEY,
                    report_id TEXT NOT NULL,
                    filename TEXT NOT NULL,
                    image_url TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (report_id) REFERENCES field_reports(id) ON DELETE CASCADE
                )
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS route_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    from_location TEXT NOT NULL,
                    to_location TEXT NOT NULL,
                    travel_date TEXT NOT NULL,
                    overall_risk TEXT NOT NULL,
                    risk_probability REAL NOT NULL,
                    highest_risk_section TEXT,
                    route_status TEXT DEFAULT 'OPEN',
                    traffic_status TEXT DEFAULT 'LOW',
                    recommended_route TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                )
            """)

            # Ensure route_history columns exist for existing DB
            cursor.execute("PRAGMA table_info(route_history)")
            rh_cols = [c[1] for c in cursor.fetchall()]
            for new_col in [("route_status", "TEXT DEFAULT 'OPEN'"), ("traffic_status", "TEXT DEFAULT 'LOW'"), ("recommended_route", "TEXT")]:
                if new_col[0] not in rh_cols:
                    try:
                        cursor.execute(f"ALTER TABLE route_history ADD COLUMN {new_col[0]} {new_col[1]}")
                    except Exception:
                        pass

            # ── Road Incidents Table ──────────────────────────────────────────
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS road_incidents (
                    id TEXT PRIMARY KEY,
                    road_name TEXT NOT NULL,
                    location_name TEXT NOT NULL,
                    latitude REAL NOT NULL,
                    longitude REAL NOT NULL,
                    start_latitude REAL,
                    start_longitude REAL,
                    end_latitude REAL,
                    end_longitude REAL,
                    incident_type TEXT NOT NULL,
                    status TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    description TEXT,
                    reported_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    expires_at TEXT,
                    source TEXT DEFAULT 'Verified Highway Authority',
                    verified INTEGER DEFAULT 1,
                    created_by INTEGER,
                    FOREIGN KEY (created_by) REFERENCES users(id)
                )
            """)

            # ── Emergency Contacts Table ──────────────────────────────────────
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS emergency_contacts (
                    id TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    phone TEXT NOT NULL,
                    relationship TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                )
            """)

            # ── SOS Events Table ──────────────────────────────────────────────
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS sos_events (
                    id TEXT PRIMARY KEY,
                    user_id INTEGER,
                    latitude REAL,
                    longitude REAL,
                    location_name TEXT,
                    from_location TEXT,
                    to_location TEXT,
                    created_at TEXT NOT NULL,
                    status TEXT DEFAULT 'ACTIVE'
                )
            """)
            conn.commit()

            # Seed preset road incidents if none exist
            cursor.execute("SELECT COUNT(*) FROM road_incidents")
            inc_count = cursor.fetchone()[0]
            if inc_count == 0:
                now_iso = datetime.datetime.now().isoformat()
                seed_incidents = [
                    (
                        "inc-1", "NH-10", "Kurseong / Teesta Bazaar",
                        26.8800, 88.2800, 26.7271, 88.3953, 27.0410, 88.2663,
                        "Landslide", "BLOCKED", "HIGH",
                        "Massive rockfall and landslide debris blocking both lanes on NH-10. NHAI and BRO clearing underway.",
                        now_iso, now_iso, None, "Verified Highway Authority", 1, None
                    ),
                    (
                        "inc-2", "NH-7", "Chamoli - Joshimath Corridor",
                        30.4037, 79.3393, 30.0869, 78.2676, 30.5564, 79.5658,
                        "Landslide", "CAUTION", "MODERATE",
                        "Slope stabilization and boulder clearance in progress. Single-lane movement regulated by traffic police.",
                        now_iso, now_iso, None, "Uttarakhand SDMA & BRO", 1, None
                    ),
                    (
                        "inc-3", "NH-766", "Thamarassery Churam Pass, Wayanad",
                        11.4500, 75.9500, 11.2588, 75.7804, 11.5510, 76.1260,
                        "Landslide", "CAUTION", "MODERATE",
                        "Mud seepage near hairpin bend 6 after rainfall. Heavy vehicles restricted.",
                        now_iso, now_iso, None, "Kerala PWD & SDMA", 1, None
                    ),
                    (
                        "inc-4", "NH-6", "Nongpoh Valley, Meghalaya",
                        25.9038, 91.8810, 26.1445, 91.7362, 25.5788, 91.8933,
                        "Heavy Traffic", "OPEN", "LOW",
                        "Road fully open and clear. Normal four-lane highway traffic flow.",
                        now_iso, now_iso, None, "Meghalaya Highway Patrol", 1, None
                    ),
                    (
                        "inc-5", "NH-10 (North Sikkim)", "Mangan - Chungthang Stretch",
                        27.5029, 88.5350, 27.3389, 88.6065, 27.5029, 88.5350,
                        "Landslide", "BLOCKED", "CRITICAL",
                        "Severe mudslide and road subsidence near Chungthang. Route strictly blocked for tourist traffic.",
                        now_iso, now_iso, None, "BRO Project Swastik", 1, None
                    )
                ]
                cursor.executemany("""
                    INSERT INTO road_incidents (
                        id, road_name, location_name, latitude, longitude,
                        start_latitude, start_longitude, end_latitude, end_longitude,
                        incident_type, status, severity, description,
                        reported_at, updated_at, expires_at, source, verified, created_by
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, seed_incidents)
                conn.commit()
                logging.info(f"[DHARA] Seeded {len(seed_incidents)} verified road incidents into SQLite.")

            # Seed preset reports if not present
            cursor.execute("SELECT COUNT(*) FROM field_reports")
            count = cursor.fetchone()[0]
            if count == 0:
                for rep in PRESET_FIELD_REPORTS:
                    cursor.execute("""
                        INSERT OR IGNORE INTO field_reports (
                            id, user_id, username, location, lat, lon, risk_level, notes,
                            image_filename, image_url, timestamp, source, status, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        rep["id"], rep["user_id"], rep["username"], rep["location"],
                        rep["lat"], rep["lon"], rep["risk_level"], rep["notes"],
                        rep["image_filename"], rep["image_url"], rep["timestamp"],
                        rep["source"], rep["status"], rep["created_at"]
                    ))
                    cursor.execute("""
                        INSERT OR IGNORE INTO field_report_images (id, report_id, filename, image_url, created_at)
                        VALUES (?, ?, ?, ?, ?)
                    """, (f"img-{rep['id']}", rep["id"], rep["image_filename"], rep["image_url"], rep["created_at"]))
                conn.commit()
                logging.info(f"[DHARA] Seeded {len(PRESET_FIELD_REPORTS)} preset field reports into SQLite.")

            # Migrate existing field_reports.json if found
            if os.path.exists(_REPORTS_FILE):
                try:
                    with open(_REPORTS_FILE, "r", encoding="utf-8") as f:
                        old_reports = json.load(f)
                    if isinstance(old_reports, list):
                        for old in old_reports:
                            old_id = str(old.get("id") or uuid.uuid4().hex[:8])
                            cursor.execute("SELECT id FROM field_reports WHERE id = ?", (old_id,))
                            if not cursor.fetchone():
                                cursor.execute("""
                                    INSERT INTO field_reports (
                                        id, user_id, username, location, lat, lon, risk_level, notes,
                                        image_filename, image_url, timestamp, source, status, created_at
                                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                                """, (
                                    old_id, None, old.get("username", "citizen"),
                                    old.get("location", "Unknown"), old.get("lat"), old.get("lon"),
                                    old.get("risk_level", "MODERATE"), old.get("notes", ""),
                                    old.get("image_filename"), old.get("image_url") or old.get("imgSrc"),
                                    old.get("timestamp", datetime.datetime.now().isoformat()),
                                    old.get("source", "citizen_upload"), old.get("status", "Pending Verification"),
                                    old.get("created_at", datetime.datetime.now().isoformat())
                                ))
                        conn.commit()
                    # Backup old json
                    bak_file = _REPORTS_FILE + ".bak"
                    if not os.path.exists(bak_file):
                        os.rename(_REPORTS_FILE, bak_file)
                        logging.info(f"[DHARA] Migrated {_REPORTS_FILE} to SQLite and created backup {bak_file}")
                except Exception as ex:
                    logging.warning(f"[DHARA] Error migrating field_reports.json: {ex}")

            logging.info("[DHARA] Database initialized (dhara_users.db) with users, sessions, incidents, emergency contacts, & field_reports.")
    except Exception as e:
        logging.error(f"[DHARA] Database init error: {e}")

_init_db()

# In-memory active session tokens: token -> user dict
_sessions = {}

def _get_authenticated_user(req) -> dict | None:
    """Extract and validate bearer token from request. Returns user dict or None."""
    auth_header = req.headers.get("Authorization", "")
    token = None
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
    elif "token" in req.args:
        token = req.args.get("token")

    if not token:
        return None

    # Check fast in-memory cache first
    if token in _sessions:
        return _sessions[token]

    # Check persistent sessions table in SQLite
    try:
        with sqlite3.connect(_DB_FILE) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT u.id, u.first_name, u.last_name, u.username, u.role, u.created_at
                FROM sessions s
                JOIN users u ON s.user_id = u.id
                WHERE s.token = ?
            """, (token,))
            row = cursor.fetchone()
            if row:
                user_info = {
                    "id": row[0],
                    "first_name": row[1],
                    "last_name": row[2],
                    "username": row[3],
                    "role": row[4] or "tourist",
                    "created_at": row[5],
                }
                _sessions[token] = user_info
                return user_info
    except Exception as e:
        logging.error(f"[DHARA] Session lookup error: {e}")

    return None

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
CORS(app)  # Allow cross-origin requests

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)

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

# ── Weather Dataset Database & Station Spatial Index ──────────────────────────
_WEATHER_DB_FILE    = os.path.join(_ML_DIR, "data", "weather_records.db")
_WEATHER_EXCEL_FILE = os.path.join(_ML_DIR, "data", "india_weather_rainfall_data.xlsx")
_WEATHER_STATIONS   = []

def _init_weather_service():
    """Ensure weather_records.db exists and load station spatial metadata into memory."""
    global _WEATHER_STATIONS
    if not os.path.exists(_WEATHER_DB_FILE) and os.path.exists(_WEATHER_EXCEL_FILE):
        try:
            import pandas as pd
            logging.info("[DHARA] Converting Excel weather dataset to indexed SQLite database...")
            df = pd.read_excel(_WEATHER_EXCEL_FILE)
            df["date_str"] = pd.to_datetime(df["date_of_record"]).dt.strftime("%Y-%m-%d")
            with sqlite3.connect(_WEATHER_DB_FILE) as conn:
                df.to_sql("weather_records", conn, if_exists="replace", index=False)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_station_date ON weather_records(station_name, date_str)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_district_date ON weather_records(district, date_str)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_date ON weather_records(date_str)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_lat_lon ON weather_records(latitude, longitude)")
                conn.commit()
            logging.info(f"[DHARA] Weather database created with {len(df)} records.")
        except Exception as e:
            logging.error(f"[DHARA] Failed to create weather database from Excel: {e}")

    if os.path.exists(_WEATHER_DB_FILE):
        try:
            with sqlite3.connect(_WEATHER_DB_FILE) as conn:
                conn.row_factory = sqlite3.Row
                cur = conn.cursor()
                cur.execute("""
                    SELECT station_name, state, district, latitude, longitude, elevation,
                           MIN(date_str) as min_date, MAX(date_str) as max_date,
                           COUNT(*) as record_count
                    FROM weather_records
                    GROUP BY station_name, state, district, latitude, longitude, elevation
                """)
                rows = cur.fetchall()
                _WEATHER_STATIONS = [dict(r) for r in rows]
                logging.info(f"[DHARA] Loaded {len(_WEATHER_STATIONS)} weather stations into spatial index.")
        except Exception as e:
            logging.error(f"[DHARA] Error loading station metadata: {e}")

_init_weather_service()

import math

def _haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great-circle distance between two points on the Earth in kilometers."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2.0) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2.0) ** 2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c

CITY_ALIASES = {
    "guwahati": "gauhati",
    "aizawl": "aijal",
    "kolkata": "calcutta",
    "sohra": "cherrapunji",
    "dimapur": "manipur road",
    "bengaluru": "bangalore",
    "mumbai": "bombay",
    "chennai": "madras",
    "puducherry": "pondicherry",
    "varanasi": "benares",
}

def _find_matching_weather_station(lat: float = None, lon: float = None, name_hint: str = None) -> tuple[dict, float]:
    """
    Find matching weather station using priority:
    1. Exact station name or district name match (with common city aliases)
    2. Nearest available weather station using Haversine distance
    """
    if not _WEATHER_STATIONS:
        return {
            "station_name": "Regional AWS", "district": "NER", "state": "NER",
            "latitude": lat or 25.69, "longitude": lon or 94.11, "elevation": 1000
        }, 0.0

    if name_hint:
        q = name_hint.strip().lower()
        q_norm = CITY_ALIASES.get(q, q)
        # 1. Exact / substring match with alias
        for st in _WEATHER_STATIONS:
            s_name = st["station_name"].lower()
            if s_name == q or s_name == q_norm or q in s_name or q_norm in s_name:
                dist = _haversine_distance(lat, lon, st["latitude"], st["longitude"]) if (lat and lon) else 0.0
                return st, dist
        # 2. District match
        for st in _WEATHER_STATIONS:
            d_name = st["district"].lower()
            if d_name == q or d_name == q_norm or q in d_name or q_norm in d_name:
                dist = _haversine_distance(lat, lon, st["latitude"], st["longitude"]) if (lat and lon) else 0.0
                return st, dist

    if lat is not None and lon is not None:
        best_st = None
        min_dist = float("inf")
        for st in _WEATHER_STATIONS:
            dist = _haversine_distance(lat, lon, st["latitude"], st["longitude"])
            if dist < min_dist:
                min_dist = dist
                best_st = st
        if best_st:
            return best_st, min_dist

    return _WEATHER_STATIONS[0], 0.0

def _get_weather_and_prediction(lat: float, lon: float, date_str: str, location_hint: str = None) -> dict:
    """
    Look up weather observation or seasonal baseline for a coordinate and date,
    calculating exact antecedent rainfall windows, and scoring with trained Random Forest.
    """
    st_meta, dist_km = _find_matching_weather_station(lat, lon, location_hint)
    station_name = st_meta["station_name"]
    elevation = st_meta.get("elevation", 1000.0)

    try:
        dt = datetime.datetime.strptime(date_str, "%Y-%m-%d")
        month = dt.month
    except Exception:
        dt = datetime.datetime.now()
        month = dt.month
        date_str = dt.strftime("%Y-%m-%d")

    rec = None
    rolling_3d = 0.0
    rolling_7d = 0.0
    rolling_15d = 0.0
    rolling_30d = 0.0
    rainy_days_3d = 0
    rainy_days_7d = 0
    rainy_days_15d = 0
    rainy_days_30d = 0
    mode = "Historical Seasonal Risk Estimate"
    season = "Monsoon" if 6 <= month <= 9 else ("Winter" if month in [12, 1, 2] else ("Summer" if month in [3, 4, 5] else "Post-Monsoon"))

    if os.path.exists(_WEATHER_DB_FILE):
        try:
            with sqlite3.connect(_WEATHER_DB_FILE) as conn:
                conn.row_factory = sqlite3.Row
                cur = conn.cursor()
                # 1. Exact historical observation query
                cur.execute("""
                    SELECT * FROM weather_records 
                    WHERE station_name = ? AND date_str = ?
                """, (station_name, date_str))
                rec_row = cur.fetchone()

                if rec_row:
                    rec = dict(rec_row)
                    mode = "Observed Historical Weather Record"
                    season = rec.get("season") or season
                    # Query preceding 30 days of actual recorded rainfall for true rolling sums
                    cur.execute("""
                        SELECT date_str, rainfall FROM weather_records
                        WHERE station_name = ? AND date_str <= ?
                        ORDER BY date_str DESC
                        LIMIT 30
                    """, (station_name, date_str))
                    past_rows = cur.fetchall()
                    rain_list = [float(r["rainfall"]) if r["rainfall"] is not None and str(r["rainfall"]).strip() != "" else 0.0 for r in past_rows]

                    rolling_3d = sum(rain_list[:3])
                    rolling_7d = sum(rain_list[:7])
                    rolling_15d = sum(rain_list[:15])
                    rolling_30d = sum(rain_list[:30])
                    rainy_days_3d = sum(1 for r in rain_list[:3] if r > 0.1)
                    rainy_days_7d = sum(1 for r in rain_list[:7] if r > 0.1)
                    rainy_days_15d = sum(1 for r in rain_list[:15] if r > 0.1)
                    rainy_days_30d = sum(1 for r in rain_list[:30] if r > 0.1)
                else:
                    # 2. Climatological seasonal baseline for future / out-of-range dates
                    cur.execute("""
                        SELECT AVG(rainfall) as avg_rain, AVG(avg_temp) as avg_t, 
                               AVG(wind_speed) as avg_w, MAX(elevation) as elev,
                               AVG(min_temp) as avg_min_t, AVG(max_temp) as avg_max_t
                        FROM weather_records
                        WHERE station_name = ? AND strftime('%m', date_str) = ?
                    """, (station_name, f"{month:02d}"))
                    clim = cur.fetchone()
                    if clim and clim["avg_rain"] is not None:
                        c_rain = float(clim["avg_rain"] or 0.0)
                        c_temp = float(clim["avg_t"] or 20.0)
                        c_wind = float(clim["avg_w"] or 3.5)
                        rolling_3d = round(c_rain * 3.0, 2)
                        rolling_7d = round(c_rain * 7.0, 2)
                        rolling_15d = round(c_rain * 15.0, 2)
                        rolling_30d = round(c_rain * 30.0, 2)
                        rainy_days_3d = min(3, max(0, int(rolling_3d / 15.0)))
                        rainy_days_7d = min(7, max(0, int(rolling_7d / 15.0)))
                        rainy_days_15d = min(15, max(0, int(rolling_15d / 15.0)))
                        rainy_days_30d = min(30, max(0, int(rolling_30d / 15.0)))
                        rec = {
                            "rainfall": c_rain, "avg_temp": c_temp, "wind_speed": c_wind,
                            "elevation": clim["elev"] or elevation, "season": season, "month": dt.strftime("%B")
                        }
        except Exception as e:
            logging.error(f"[DHARA] Weather query error: {e}")

    rainfall_val = float(rec["rainfall"]) if rec and rec.get("rainfall") is not None and str(rec.get("rainfall")).strip() != "" else (15.0 if 6 <= month <= 9 else 1.0)
    avg_temp_val = float(rec["avg_temp"]) if rec and rec.get("avg_temp") is not None and str(rec.get("avg_temp")).strip() != "" else 20.0
    wind_speed_val = float(rec["wind_speed"]) if rec and rec.get("wind_speed") is not None and str(rec.get("wind_speed")).strip() != "" else 3.5
    elevation_val = float(rec["elevation"]) if rec and rec.get("elevation") is not None and str(rec.get("elevation")).strip() != "" else elevation

    pred_res = {}
    if _predictor is not None:
        try:
            pred_res = _predictor.predict_from_weather_observation(
                rainfall_mm=rainfall_val,
                avg_temp=avg_temp_val,
                wind_speed=wind_speed_val,
                elevation=elevation_val,
                lat=lat,
                lon=lon,
                month=month,
                rain_cum_3d=rolling_3d,
                rain_cum_7d=rolling_7d,
                rain_cum_15d=rolling_15d,
                rain_cum_30d=rolling_30d,
                rainy_days_3d=rainy_days_3d,
                rainy_days_7d=rainy_days_7d,
                rainy_days_15d=rainy_days_15d,
                rainy_days_30d=rainy_days_30d,
            )
        except Exception as ex:
            logging.error(f"[DHARA] ML prediction error: {ex}")
            pred_res = {"risk_level": "Low", "risk_score": 0.1, "class_probabilities": {"Low": 0.85, "Medium": 0.12, "High": 0.03}}
    else:
        pred_res = {"risk_level": "Low", "risk_score": 0.1, "class_probabilities": {"Low": 0.85, "Medium": 0.12, "High": 0.03}}

    raw_level = pred_res.get("risk_level", "Low")
    level_map = {"Low": "LOW", "Medium": "MODERATE", "High": "HIGH", "Critical": "CRITICAL"}
    risk_level_std = level_map.get(raw_level, raw_level.upper())
    if risk_level_std == "HIGH" and pred_res.get("risk_score", 0) > 0.85:
        risk_level_std = "CRITICAL"

    return {
        "station_name": station_name,
        "district": st_meta.get("district", "Unknown"),
        "state": st_meta.get("state", "India"),
        "station_lat": st_meta.get("latitude"),
        "station_lon": st_meta.get("longitude"),
        "station_distance_km": round(dist_km, 1),
        "elevation_m": round(elevation_val, 1),
        "date": date_str,
        "mode": mode,
        "season": season,
        "rainfall_mm": round(rainfall_val, 2),
        "rain_cum_3d_mm": round(rolling_3d, 2),
        "rain_cum_7d_mm": round(rolling_7d, 2),
        "rain_cum_15d_mm": round(rolling_15d, 2),
        "rain_cum_30d_mm": round(rolling_30d, 2),
        "avg_temp_c": round(avg_temp_val, 1),
        "wind_speed_kmh": round(wind_speed_val, 1),
        "risk_level": risk_level_std,
        "risk_score": pred_res.get("risk_score", 0.0),
        "class_probabilities": pred_res.get("class_probabilities", {}),
        "engine": "flask_random_forest_ml"
    }

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
# STATIC & UPLOADED FILE SERVING
# ════════════════════════════════════════════════════════════════════════════════

@app.route("/")
def serve_index():
    return send_from_directory(_STATIC_DIR, "index.html")


@app.route("/login")
def serve_login():
    return send_from_directory(_STATIC_DIR, "login.html")


@app.route("/uploads/field_reports/<path:filename>")
def serve_uploaded_field_report(filename):
    """Serve uploaded field photos securely."""
    clean_name = os.path.basename(filename)
    file_path = os.path.join(_UPLOADS_DIR, clean_name)
    if not os.path.isfile(file_path):
        abort(404)
    return send_from_directory(_UPLOADS_DIR, clean_name)


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
        token = secrets.token_hex(24)
        with sqlite3.connect(_DB_FILE) as conn:
            cursor = conn.cursor()
            # Enforce unique username (case-insensitive)
            cursor.execute("SELECT id FROM users WHERE LOWER(username) = LOWER(?)", (username,))
            if cursor.fetchone():
                return jsonify({"error": f"Username '@{username}' is already taken. Please choose another."}), 409

            cursor.execute("""
                INSERT INTO users (first_name, last_name, username, password_hash, role, created_at, last_login)
                VALUES (?, ?, ?, ?, 'tourist', ?, ?)
            """, (first_name, last_name, username, pwd_hash, now_str, now_str))
            user_id = cursor.lastrowid

            cursor.execute("""
                INSERT INTO sessions (token, user_id, created_at)
                VALUES (?, ?, ?)
            """, (token, user_id, now_str))
            conn.commit()

        user_info = {
            "id": user_id,
            "first_name": first_name,
            "last_name": last_name,
            "username": username,
            "role": "tourist",
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
                SELECT id, first_name, last_name, username, password_hash, role, created_at
                FROM users WHERE LOWER(username) = LOWER(?)
            """, (username,))
            row = cursor.fetchone()

            if not row or row[4] != pwd_hash:
                return jsonify({"error": "Invalid username or password."}), 401

            user_id, first_name, last_name, real_username, _, role_val, created_at = row

            token = secrets.token_hex(24)
            cursor.execute("UPDATE users SET last_login = ? WHERE id = ?", (now_str, user_id))
            cursor.execute("INSERT OR REPLACE INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)", (token, user_id, now_str))
            conn.commit()

        user_info = {
            "id": user_id,
            "first_name": first_name,
            "last_name": last_name,
            "username": real_username,
            "role": role_val or "tourist",
            "created_at": created_at,
        }
        _sessions[token] = user_info
        logging.info(f"[AUTH] User logged in: @{real_username} ({user_info['role']})")

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
    user = _get_authenticated_user(request)
    if not user:
        return jsonify({"error": "Unauthorized or session expired"}), 401
    return jsonify({"status": "ok", "user": user})


@app.route("/api/auth/logout", methods=["POST"])
def api_logout():
    """Invalidate session token."""
    auth_header = request.headers.get("Authorization", "")
    token = None
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
    elif "token" in request.args:
        token = request.args.get("token")

    if token:
        if token in _sessions:
            del _sessions[token]
        try:
            with sqlite3.connect(_DB_FILE) as conn:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM sessions WHERE token = ?", (token,))
                conn.commit()
        except Exception:
            pass

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
            "/api/route-risk",
            "/api/route-history",
            "/api/road-incidents",
            "/api/sos",
            "/api/sos/contacts",
            "/api/field-reports",
            "/uploads/field_reports/<filename>",
        ]
    })


@app.route("/api/predict", methods=["POST"])
def api_predict():
    """Real-time single-point inference from dashboard slider/station parameters."""
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
    """Score multiple grid cells / stations at once."""
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


# ════════════════════════════════════════════════════════════════════════════════
# ROAD INCIDENT DETECTION & ROUTE OPTIMIZATION HELPERS
# ════════════════════════════════════════════════════════════════════════════════

def _dist_to_segment(p_lat: float, p_lon: float, a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    """Calculate perpendicular distance in km from point P to line segment A->B."""
    d_ab = _haversine_distance(a_lat, a_lon, b_lat, b_lon)
    if d_ab == 0:
        return _haversine_distance(p_lat, p_lon, a_lat, a_lon)
    # Parameter t of projection
    ap_lat, ap_lon = p_lat - a_lat, p_lon - a_lon
    ab_lat, ab_lon = b_lat - a_lat, b_lon - a_lon
    ab_len_sq = ab_lat * ab_lat + ab_lon * ab_lon
    if ab_len_sq == 0:
        return _haversine_distance(p_lat, p_lon, a_lat, a_lon)
    t = max(0.0, min(1.0, (ap_lat * ab_lat + ap_lon * ab_lon) / ab_len_sq))
    proj_lat = a_lat + t * ab_lat
    proj_lon = a_lon + t * ab_lon
    return _haversine_distance(p_lat, p_lon, proj_lat, proj_lon)

def _dist_to_polyline(p_lat: float, p_lon: float, coords: list) -> float:
    """Calculate minimum distance in km from point P to any segment in a polyline."""
    if not coords:
        return float("inf")
    if len(coords) == 1:
        return _haversine_distance(p_lat, p_lon, coords[0][0], coords[0][1])
    min_d = float("inf")
    for i in range(len(coords) - 1):
        d = _dist_to_segment(p_lat, p_lon, coords[i][0], coords[i][1], coords[i+1][0], coords[i+1][1])
        if d < min_d:
            min_d = d
    return min_d

def _find_incidents_for_route(coords: list, corridor_km: float = 10.0) -> list:
    """Query active, unexpired road incidents intersecting the given route corridor."""
    incidents = []
    try:
        with sqlite3.connect(_DB_FILE) as conn:
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute("""
                SELECT * FROM road_incidents 
                WHERE (expires_at IS NULL OR expires_at > datetime('now'))
                ORDER BY datetime(reported_at) DESC
            """)
            rows = cur.fetchall()
            for r in rows:
                inc = dict(r)
                d = _dist_to_polyline(inc["latitude"], inc["longitude"], coords)
                if d <= corridor_km:
                    inc["corridor_distance_km"] = round(d, 2)
                    incidents.append(inc)
    except Exception as e:
        logging.error(f"[DHARA] Error querying road incidents for route: {e}")
    return incidents

def _estimate_traffic(from_loc: str, to_loc: str, distance_km: float) -> dict:
    """
    Pluggable traffic estimator (honest labeling: 'Estimated Traffic').
    Provides LOW, MODERATE, or HIGH estimated traffic status and delay minutes.
    """
    f_lower = from_loc.lower()
    t_lower = to_loc.lower()
    # Mountain corridors with heavy tourist influx or winding single lanes
    if any(k in f_lower or k in t_lower for k in ["darjeeling", "gangtok", "mangan", "joshimath", "wayanad", "sohra"]):
        traffic_status = "MODERATE"
        delay_min = int(max(10, distance_km * 0.25))
    elif any(k in f_lower or k in t_lower for k in ["guwahati", "siliguri", "rishikesh", "kozhikode"]):
        traffic_status = "LOW"
        delay_min = int(max(5, distance_km * 0.10))
    else:
        traffic_status = "LOW"
        delay_min = int(max(0, distance_km * 0.08))

    return {
        "traffic_status": traffic_status,
        "traffic_delay_min": delay_min,
        "source_label": "Demo/Estimated Traffic",
        "is_live": False
    }

def _score_route(risk_level: str, road_status: str, traffic_status: str, base_duration_min: int, traffic_delay_min: int) -> float:
    """
    Multi-criteria safety-dominant route scoring formula:
    - BLOCKED road receives catastrophic penalty (10000)
    - CRITICAL landslide risk receives penalty (600)
    - HIGH risk receives penalty (300)
    - MODERATE risk receives penalty (80)
    - CAUTION road status receives penalty (150)
    - Travel time penalty = (base_duration + traffic_delay) * 0.5
    Safety dominates route recommendation over small travel-time savings.
    """
    safety_penalty = 0.0
    if road_status == "BLOCKED":
        safety_penalty += 10000.0
    elif road_status == "CAUTION":
        safety_penalty += 150.0

    if risk_level == "CRITICAL":
        safety_penalty += 600.0
    elif risk_level == "HIGH":
        safety_penalty += 300.0
    elif risk_level == "MODERATE":
        safety_penalty += 80.0

    time_penalty = (base_duration_min + traffic_delay_min) * 0.5
    return round(safety_penalty + time_penalty, 2)

# Known regional candidate highway alternatives dictionary (real highway corridors)
KNOWN_HIGHWAY_ALTERNATIVES = {
    ("siliguri", "gangtok"): [
        {
            "route_id": "sil-gtok-nh10",
            "name": "NH-10 Himalayan Corridor (via Teesta Bazaar)",
            "via": "Sevoke → Teesta Bazaar → Rangpo → Singtam",
            "distance_km": 115,
            "duration_min": 210,
            "coords": [[26.7271, 88.3953], [26.8800, 88.3800], [27.0410, 88.2663], [27.1671, 88.3584], [27.3389, 88.6065]]
        },
        {
            "route_id": "sil-gtok-nh717a",
            "name": "NH-717A Scenic Bypass (via Lava & Reshi)",
            "via": "Damdim → Gorubathan → Lava → Reshi → Pedong → Pakyong",
            "distance_km": 138,
            "duration_min": 255,
            "coords": [[26.7271, 88.3953], [26.8700, 88.7000], [27.0800, 88.6600], [27.2000, 88.6200], [27.3389, 88.6065]]
        }
    ],
    ("siliguri", "darjeeling"): [
        {
            "route_id": "sil-darj-nh55",
            "name": "Hill Cart Road (NH-55 via Kurseong)",
            "via": "Sukna → Kurseong → Sonada → Ghoom",
            "distance_km": 74,
            "duration_min": 170,
            "coords": [[26.7271, 88.3953], [26.8800, 88.2800], [27.0000, 88.2600], [27.0410, 88.2663]]
        },
        {
            "route_id": "sil-darj-mirik",
            "name": "Mirik Lake Bypass (SH-12 / Pankhabari Rd)",
            "via": "Matigara → Mirik → Soureni → Pashupati → Ghoom",
            "distance_km": 88,
            "duration_min": 195,
            "coords": [[26.7271, 88.3953], [26.8600, 88.1800], [26.9800, 88.2200], [27.0410, 88.2663]]
        }
    ],
    ("guwahati", "shillong"): [
        {
            "route_id": "guw-shil-nh6",
            "name": "NH-6 Four-Lane Expressway",
            "via": "Khanapara → Byrnihat → Nongpoh → Umiam Lake",
            "distance_km": 100,
            "duration_min": 150,
            "coords": [[26.1445, 91.7362], [25.9038, 91.8810], [25.7500, 91.8900], [25.5788, 91.8933]]
        },
        {
            "route_id": "guw-shil-umroi",
            "name": "Old GS Corridor & Umroi Bypass",
            "via": "Dispur → Byrnihat → Bhoirymbong → Umroi → Mawlai",
            "distance_km": 118,
            "duration_min": 185,
            "coords": [[26.1445, 91.7362], [26.0200, 91.8500], [25.7000, 91.9500], [25.5788, 91.8933]]
        }
    ],
    ("rishikesh", "joshimath"): [
        {
            "route_id": "rsh-jsh-nh7",
            "name": "NH-7 Badrinath National Highway",
            "via": "Devprayag → Srinagar → Rudraprayag → Chamoli",
            "distance_km": 253,
            "duration_min": 450,
            "coords": [[30.0869, 78.2676], [30.1450, 78.5988], [30.4037, 79.3393], [30.5564, 79.5658]]
        },
        {
            "route_id": "rsh-jsh-tehri",
            "name": "Tehri Dam – Chamba Scenic Bypass",
            "via": "Chamba → Tehri → Ghansali → Tilwara → Rudraprayag → Chamoli",
            "distance_km": 280,
            "duration_min": 510,
            "coords": [[30.0869, 78.2676], [30.3800, 78.4800], [30.3500, 78.8500], [30.2800, 79.0000], [30.5564, 79.5658]]
        }
    ],
    ("kozhikode", "wayanad"): [
        {
            "route_id": "koz-way-nh766",
            "name": "NH-766 Thamarassery Churam Pass",
            "via": "Kunnamangalam → Thamarassery → Adivaram → Lakkidi → Kalpetta",
            "distance_km": 72,
            "duration_min": 135,
            "coords": [[11.2588, 75.7804], [11.4500, 75.9500], [11.5510, 76.1260]]
        },
        {
            "route_id": "koz-way-kuttiyadi",
            "name": "Kuttiyadi Ghat Scenic Route (SH-54)",
            "via": "Ulliyeri → Perambra → Kuttiyadi → Pakramthalam → Mananthavady",
            "distance_km": 94,
            "duration_min": 175,
            "coords": [[11.2588, 75.7804], [11.6600, 75.7500], [11.6800, 75.9200], [11.5510, 76.1260]]
        }
    ]
}

def _get_candidate_routes(from_loc: str, to_loc: str, base_coords: list) -> list:
    """Lookup real candidate highway alternative routes or generate sensible geometric paths."""
    f_q = from_loc.lower().split()[0].replace(",", "")
    t_q = to_loc.lower().split()[0].replace(",", "")

    # Check known highway alternative pairs (forward or reverse)
    for (k_f, k_t), cand_list in KNOWN_HIGHWAY_ALTERNATIVES.items():
        if (k_f in f_q and k_t in t_q) or (k_f in t_q and k_t in f_q):
            if k_f in t_q:
                # Reverse coordinates
                rev_list = []
                for c in cand_list:
                    rev_c = dict(c)
                    rev_c["coords"] = [list(reversed_p) for reversed_p in reversed(c["coords"])]
                    rev_list.append(rev_c)
                return rev_list
            return cand_list

    # Fallback generic generator: Route 1 (Primary) & Route 2 (Alternative via offset waypoint)
    st_from, _ = _find_matching_weather_station(name_hint=from_loc)
    st_to, _   = _find_matching_weather_station(name_hint=to_loc)
    lat1, lon1 = st_from.get("latitude", 26.1445), st_from.get("longitude", 91.7362)
    lat2, lon2 = st_to.get("latitude", 25.5788), st_to.get("longitude", 91.8933)
    dist_direct = round(_haversine_distance(lat1, lon1, lat2, lon2), 1)

    r1_coords = base_coords if (base_coords and len(base_coords) >= 2) else [
        [lat1 + (lat2 - lat1) * (i / 4.0), lon1 + (lon2 - lon1) * (i / 4.0)]
        for i in range(5)
    ]

    mid_lat = (lat1 + lat2) / 2.0 + 0.12
    mid_lon = (lon1 + lon2) / 2.0 + 0.15
    r2_coords = [
        [lat1, lon1],
        [(lat1 + mid_lat) / 2.0, (lon1 + mid_lon) / 2.0],
        [mid_lat, mid_lon],
        [(mid_lat + lat2) / 2.0, (mid_lon + lon2) / 2.0],
        [lat2, lon2]
    ]

    return [
        {
            "route_id": "rt-primary",
            "name": f"Direct Highway Corridor ({from_loc} → {to_loc})",
            "via": f"Direct Highway via Regional Access Corridors",
            "distance_km": max(15, int(dist_direct * 1.15)),
            "duration_min": max(20, int(dist_direct * 1.8)),
            "coords": r1_coords
        },
        {
            "route_id": "rt-alt-bypass",
            "name": f"Regional Secondary Bypass ({from_loc} → {to_loc})",
            "via": f"Secondary State Road & Foothill Bypass Corridor",
            "distance_km": max(20, int(dist_direct * 1.35)),
            "duration_min": max(30, int(dist_direct * 2.2)),
            "coords": r2_coords
        }
    ]


# ════════════════════════════════════════════════════════════════════════════════
# ROUTE HAZARD & WEATHER RISK API (TOURIST / TRAVELER INTELLIGENCE)
# ════════════════════════════════════════════════════════════════════════════════

@app.route("/api/route-risk", methods=["POST"])
def api_route_risk():
    """
    Calculate date-wise landslide risk along a travel route corridor using
    real weather dataset records, rolling antecedent precipitation, trained Random Forest ML model,
    AND integrates Road Status (OPEN/CAUTION/BLOCKED), Traffic Analysis, Alternative Routes,
    and Advance Incident Warnings.
    """
    if _predictor is None:
        return jsonify({"error": f"Model not loaded: {_model_error}"}), 503

    data = request.get_json(force=True, silent=True) or {}
    from_loc = str(data.get("from") or data.get("origin") or "Guwahati").strip()
    to_loc   = str(data.get("to") or data.get("destination") or "Shillong").strip()
    date_str = str(data.get("date") or datetime.datetime.now().strftime("%Y-%m-%d")).strip()
    today_str = datetime.date.today().strftime("%Y-%m-%d")
    if date_str < today_str:
        return jsonify({
            "success": False,
            "error": "Past dates cannot be predicted as they have already occurred. Please select today or a future date for route prediction."
        }), 400

    orig_coords = data.get("route_coordinates") or []
    user_lat = data.get("user_lat")
    user_lon = data.get("user_lon")

    # Retrieve candidate routes (Primary + Alternative)
    candidate_routes = _get_candidate_routes(from_loc, to_loc, orig_coords)

    evaluated_routes = []
    risk_rank = {"LOW": 1, "MODERATE": 2, "HIGH": 3, "CRITICAL": 4}

    for c_idx, candidate in enumerate(candidate_routes):
        r_coords = candidate["coords"]
        n_pts = len(r_coords)
        sampled_pts = r_coords if n_pts <= 8 else [r_coords[int(i * (n_pts - 1) / 7.0)] for i in range(8)]

        segments = []
        worst_level = "LOW"
        worst_score = 0.0
        worst_prob = 0.0
        worst_segment_name = f"{from_loc} – {to_loc}"
        primary_station = None

        for i, pt in enumerate(sampled_pts):
            lat_val = float(pt[0])
            lon_val = float(pt[1])
            seg_label = f"Segment {i+1}"
            if i == 0:
                seg_label = f"{from_loc} (Origin)"
            elif i == len(sampled_pts) - 1:
                seg_label = f"{to_loc} (Destination)"
            else:
                seg_label = f"Waypoint {i+1} ({lat_val:.2f}°N, {lon_val:.2f}°E)"

            hint = from_loc if i == 0 else (to_loc if i == len(sampled_pts) - 1 else None)
            seg_pred = _get_weather_and_prediction(lat_val, lon_val, date_str, location_hint=hint)
            seg_pred["segment_id"] = i + 1
            seg_pred["segment_name"] = seg_label
            seg_pred["latitude"] = lat_val
            seg_pred["longitude"] = lon_val
            segments.append(seg_pred)

            if primary_station is None:
                primary_station = seg_pred["station_name"]

            lvl = seg_pred["risk_level"]
            score = seg_pred.get("risk_score", 0.0)
            probs = seg_pred.get("class_probabilities", {})
            lvl_key = "High" if lvl in ["HIGH", "CRITICAL"] else ("Medium" if lvl == "MODERATE" else "Low")
            cur_prob = probs.get(lvl_key, probs.get(lvl, score))

            if (risk_rank.get(lvl, 1) > risk_rank.get(worst_level, 1)) or (risk_rank.get(lvl, 1) == risk_rank.get(worst_level, 1) and score > worst_score):
                worst_level = lvl
                worst_score = score
                worst_prob  = cur_prob
                worst_segment_name = seg_label

        # Route breakdown percentages
        counts = {"LOW": 0, "MODERATE": 0, "HIGH": 0, "CRITICAL": 0}
        for s in segments:
            lvl_s = s["risk_level"]
            counts[lvl_s] = counts.get(lvl_s, 0) + 1
        total_seg = len(segments)
        breakdown = {
            "LOW": round((counts["LOW"] / total_seg) * 100, 1),
            "MODERATE": round((counts["MODERATE"] / total_seg) * 100, 1),
            "HIGH": round((counts["HIGH"] / total_seg) * 100, 1),
            "CRITICAL": round((counts["CRITICAL"] / total_seg) * 100, 1),
        }

        # Road Incidents along this candidate corridor
        incidents = _find_incidents_for_route(r_coords, corridor_km=10.0)
        has_blocked = any(inc["status"] == "BLOCKED" for inc in incidents)
        has_caution = any(inc["status"] == "CAUTION" for inc in incidents)

        road_status = "BLOCKED" if has_blocked else ("CAUTION" if has_caution else "OPEN")

        # Traffic estimation for this candidate
        traffic_info = _estimate_traffic(from_loc, to_loc, candidate["distance_km"])

        # Multi-criteria scoring
        total_score = _score_route(
            worst_level, road_status, traffic_info["traffic_status"],
            candidate["duration_min"], traffic_info["traffic_delay_min"]
        )

        rep_seg = next((s for s in segments if s["segment_name"] == worst_segment_name), segments[len(segments)//2])

        evaluated_routes.append({
            "route_id": candidate["route_id"],
            "name": candidate["name"],
            "via": candidate["via"],
            "is_primary": (c_idx == 0),
            "distance_km": candidate["distance_km"],
            "base_duration_min": candidate["duration_min"],
            "total_duration_min": candidate["duration_min"] + traffic_info["traffic_delay_min"],
            "duration_formatted": f"{int((candidate['duration_min'] + traffic_info['traffic_delay_min']) // 60)}h {int((candidate['duration_min'] + traffic_info['traffic_delay_min']) % 60)}m",
            "overall_risk": worst_level,
            "risk_score": round(float(worst_score), 3),
            "risk_probability": round(float(worst_prob), 3),
            "highest_risk_section": worst_segment_name,
            "road_status": road_status,
            "traffic_status": traffic_info["traffic_status"],
            "traffic_delay_min": traffic_info["traffic_delay_min"],
            "traffic_source": traffic_info["source_label"],
            "safety_score": total_score,
            "incidents": incidents,
            "route_breakdown": breakdown,
            "weather_station": rep_seg["station_name"],
            "district": rep_seg["district"],
            "state": rep_seg["state"],
            "season": rep_seg["season"],
            "data_mode": rep_seg["mode"],
            "rainfall_mm": rep_seg["rainfall_mm"],
            "rain_cum_3d_mm": rep_seg["rain_cum_3d_mm"],
            "rain_cum_7d_mm": rep_seg["rain_cum_7d_mm"],
            "avg_temp_c": rep_seg["avg_temp_c"],
            "wind_speed_kmh": rep_seg["wind_speed_kmh"],
            "elevation_m": rep_seg["elevation_m"],
            "coordinates": candidate["coords"],
            "segments": segments
        })

    # Sort candidates by safety_score ascending (lowest penalty = safest/best)
    sorted_by_score = sorted(evaluated_routes, key=lambda r: r["safety_score"])
    best_route = sorted_by_score[0]
    primary_route = evaluated_routes[0]

    # Generate clear recommendation explanation
    is_orig_blocked = primary_route["road_status"] == "BLOCKED"
    is_orig_dangerous = primary_route["overall_risk"] in ["HIGH", "CRITICAL"]

    if is_orig_blocked:
        if best_route["route_id"] != primary_route["route_id"] and best_route["road_status"] != "BLOCKED":
            recommendation_verdict = "AVOID_ORIGINAL_USE_ALTERNATIVE"
            recommendation_text = f"🚨 ORIGINAL ROUTE NOT RECOMMENDED: The original route is currently BLOCKED due to road incidents. We recommend taking the safer alternative '{best_route['name']}' ({best_route['via']}) which is OPEN."
        else:
            recommendation_verdict = "AVOID_ALL_BLOCKED"
            recommendation_text = f"🚨 NO SAFE ALTERNATIVE ROUTE AVAILABLE: All known corridors to {to_loc} are currently blocked or high risk. Please consider delaying travel or choosing another destination."
    elif is_orig_dangerous and best_route["route_id"] != primary_route["route_id"] and best_route["overall_risk"] in ["LOW", "MODERATE"]:
        recommendation_verdict = "RECOMMEND_SAFER_ALTERNATIVE"
        recommendation_text = f"⚠️ SAFER ALTERNATIVE RECOMMENDED: The original route has {primary_route['overall_risk']} landslide hazard. '{best_route['name']}' has lower hazard ({best_route['overall_risk']}) and is currently OPEN."
    else:
        recommendation_verdict = "RECOMMEND_PRIMARY"
        recommendation_text = f"✅ ORIGINAL ROUTE RECOMMENDED: Route is {primary_route['road_status']} with {primary_route['overall_risk']} landslide risk. Follow standard safety precautions."

    # Advance warning calculation
    advance_warning = None
    all_incidents = primary_route["incidents"]
    if all_incidents:
        closest_inc = min(all_incidents, key=lambda x: x.get("corridor_distance_km", 999))
        dist_from_start = round(_haversine_distance(primary_route["coordinates"][0][0], primary_route["coordinates"][0][1], closest_inc["latitude"], closest_inc["longitude"]), 1)
        advance_warning = {
            "active": True,
            "distance_km": dist_from_start,
            "road": closest_inc["road_name"],
            "location": closest_inc["location_name"],
            "status": closest_inc["status"],
            "incident_type": closest_inc["incident_type"],
            "description": closest_inc["description"],
            "severity": closest_inc["severity"],
            "recommended_action": "Use recommended alternative route immediately." if closest_inc["status"] == "BLOCKED" else "Reduce speed and maintain extreme vigilance."
        }

    # Save to SQLite route_history table
    user = _get_authenticated_user(request)
    try:
        with sqlite3.connect(_DB_FILE) as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO route_history (
                    user_id, from_location, to_location, travel_date,
                    overall_risk, risk_probability, highest_risk_section,
                    route_status, traffic_status, recommended_route, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                user["id"] if user else None,
                from_loc, to_loc, date_str,
                primary_route["overall_risk"], float(primary_route["risk_probability"]),
                primary_route["highest_risk_section"],
                primary_route["road_status"],
                primary_route["traffic_status"],
                best_route["name"],
                datetime.datetime.now().isoformat()
            ))
            conn.commit()
    except Exception as e:
        logging.warning(f"[DHARA] Could not write to route_history: {e}")

    return jsonify({
        "success": True,
        "from": from_loc,
        "to": to_loc,
        "travel_date": date_str,
        # Primary route fields for direct backwards compatibility
        "overall_risk": primary_route["overall_risk"],
        "risk_probability": primary_route["risk_probability"],
        "risk_score": primary_route["risk_score"],
        "highest_risk_section": primary_route["highest_risk_section"],
        "weather_station": primary_route["weather_station"],
        "district": primary_route["district"],
        "state": primary_route["state"],
        "season": primary_route["season"],
        "data_mode": primary_route["data_mode"],
        "rainfall_mm": primary_route["rainfall_mm"],
        "rain_cum_3d_mm": primary_route["rain_cum_3d_mm"],
        "rain_cum_7d_mm": primary_route["rain_cum_7d_mm"],
        "avg_temp_c": primary_route["avg_temp_c"],
        "wind_speed_kmh": primary_route["wind_speed_kmh"],
        "elevation_m": primary_route["elevation_m"],
        "route_breakdown": primary_route["route_breakdown"],
        "segments": primary_route["segments"],
        # Optimization additions
        "road_status": primary_route["road_status"],
        "traffic_status": primary_route["traffic_status"],
        "traffic_delay_min": primary_route["traffic_delay_min"],
        "traffic_source": primary_route["traffic_source"],
        "active_incidents": primary_route["incidents"],
        "road_incidents": primary_route["incidents"],
        "advance_warning": advance_warning,
        "recommendation": recommendation_text,
        "recommendation_verdict": recommendation_verdict,
        "recommendation_text": recommendation_text,
        "recommended_route_id": best_route["route_id"],
        "recommended_route": best_route,
        "primary_route": primary_route,
        "candidate_routes": evaluated_routes,
        "alternative_routes": [r for r in evaluated_routes if not r["is_primary"]],
        "all_candidate_routes": evaluated_routes,
        "engine": "flask_random_forest_ml"
    })


@app.route("/api/route-history", methods=["GET"])
def api_route_history():
    """Return historical route searches for authenticated user or recent general queries."""
    user = _get_authenticated_user(request)
    try:
        with sqlite3.connect(_DB_FILE) as conn:
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            if user:
                cur.execute("""
                    SELECT * FROM route_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 20
                """, (user["id"],))
            else:
                cur.execute("""
                    SELECT * FROM route_history ORDER BY created_at DESC LIMIT 20
                """)
            rows = [dict(r) for r in cur.fetchall()]
            return jsonify({"count": len(rows), "history": rows})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ════════════════════════════════════════════════════════════════════════════════
# ROAD INCIDENTS API (ADMIN & PUBLIC QUERY)
# ════════════════════════════════════════════════════════════════════════════════

@app.route("/api/road-incidents", methods=["GET"])
def api_get_road_incidents():
    """Return verified road incidents. Admin can pass ?all=true to see unverified/expired ones."""
    show_all = request.args.get("all") == "true"
    try:
        with sqlite3.connect(_DB_FILE) as conn:
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            if show_all:
                cur.execute("SELECT * FROM road_incidents ORDER BY datetime(reported_at) DESC")
            else:
                cur.execute("""
                    SELECT * FROM road_incidents 
                    WHERE (expires_at IS NULL OR expires_at > datetime('now'))
                    ORDER BY datetime(reported_at) DESC
                """)
            rows = [dict(r) for r in cur.fetchall()]
            return jsonify({"count": len(rows), "incidents": rows})
    except Exception as e:
        logging.error(f"[DHARA] Error fetching road incidents: {e}")
        return jsonify({"error": "Failed to fetch road incidents"}), 500


@app.route("/api/road-incidents", methods=["POST"])
def api_create_road_incident():
    """
    Admin-only endpoint to create/publish a verified road incident.
    """
    user = _get_authenticated_user(request)
    if not user or user.get("role") != "admin":
        return jsonify({"error": "Unauthorized. Admin privileges required to manage road incidents."}), 403

    data = request.get_json(force=True, silent=True) or {}
    road_name     = str(data.get("road_name", "")).strip()
    location_name = str(data.get("location_name", "")).strip()
    incident_type = str(data.get("incident_type", "Landslide")).strip()
    status        = str(data.get("status", "BLOCKED")).strip().upper()
    severity      = str(data.get("severity", "HIGH")).strip().upper()
    description   = str(data.get("description", "")).strip()
    expires_at    = data.get("expires_at")
    source        = str(data.get("source", "Verified Highway Authority")).strip()

    if not road_name or not location_name:
        return jsonify({"error": "road_name and location_name are required."}), 400

    if status not in {"OPEN", "CAUTION", "BLOCKED"}:
        status = "BLOCKED"
    if severity not in {"LOW", "MODERATE", "HIGH", "CRITICAL"}:
        severity = "HIGH"

    lat = float(data.get("latitude") or 25.5788)
    lon = float(data.get("longitude") or 91.8933)
    start_lat = float(data["start_latitude"]) if data.get("start_latitude") is not None else None
    start_lon = float(data["start_longitude"]) if data.get("start_longitude") is not None else None
    end_lat   = float(data["end_latitude"]) if data.get("end_latitude") is not None else None
    end_lon   = float(data["end_longitude"]) if data.get("end_longitude") is not None else None

    inc_id = f"inc-{uuid.uuid4().hex[:8]}"
    now_iso = datetime.datetime.now().isoformat()

    try:
        with sqlite3.connect(_DB_FILE) as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO road_incidents (
                    id, road_name, location_name, latitude, longitude,
                    start_latitude, start_longitude, end_latitude, end_longitude,
                    incident_type, status, severity, description,
                    reported_at, updated_at, expires_at, source, verified, created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
            """, (
                inc_id, road_name, location_name, lat, lon,
                start_lat, start_lon, end_lat, end_lon,
                incident_type, status, severity, description,
                now_iso, now_iso, expires_at, source, user["id"]
            ))
            conn.commit()

        logging.info(f"[INCIDENT] Created incident {inc_id} on {road_name} ({location_name}) by @{user['username']}")
        return jsonify({"status": "created", "incident_id": inc_id}), 201
    except Exception as e:
        logging.error(f"[INCIDENT] Failed to save road incident: {e}")
        return jsonify({"error": "Failed to create road incident."}), 500


@app.route("/api/road-incidents/<incident_id>", methods=["PUT"])
def api_update_road_incident(incident_id):
    """Admin-only endpoint to update an existing road incident."""
    user = _get_authenticated_user(request)
    if not user or user.get("role") != "admin":
        return jsonify({"error": "Unauthorized. Admin privileges required."}), 403

    data = request.get_json(force=True, silent=True) or {}
    now_iso = datetime.datetime.now().isoformat()

    try:
        with sqlite3.connect(_DB_FILE) as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM road_incidents WHERE id = ?", (incident_id,))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Incident not found."}), 404

            updates = []
            params = []
            for field in ["road_name", "location_name", "incident_type", "status", "severity", "description", "expires_at", "source"]:
                if field in data:
                    val = data[field]
                    if field in ["status", "severity"] and isinstance(val, str):
                        val = val.upper()
                    updates.append(f"{field} = ?")
                    params.append(val)

            for num_field in ["latitude", "longitude", "start_latitude", "start_longitude", "end_latitude", "end_longitude"]:
                if num_field in data and data[num_field] is not None:
                    updates.append(f"{num_field} = ?")
                    params.append(float(data[num_field]))

            if updates:
                updates.append("updated_at = ?")
                params.append(now_iso)
                params.append(incident_id)
                cur.execute(f"UPDATE road_incidents SET {', '.join(updates)} WHERE id = ?", params)
                conn.commit()

        logging.info(f"[INCIDENT] Updated incident {incident_id} by @{user['username']}")
        return jsonify({"status": "updated", "incident_id": incident_id})
    except Exception as e:
        logging.error(f"[INCIDENT] Failed to update incident: {e}")
        return jsonify({"error": "Failed to update road incident."}), 500


@app.route("/api/road-incidents/<incident_id>", methods=["DELETE"])
def api_delete_road_incident(incident_id):
    """Admin-only endpoint to delete/archive an incident."""
    user = _get_authenticated_user(request)
    if not user or user.get("role") != "admin":
        return jsonify({"error": "Unauthorized. Admin privileges required."}), 403

    try:
        with sqlite3.connect(_DB_FILE) as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM road_incidents WHERE id = ?", (incident_id,))
            conn.commit()
        logging.info(f"[INCIDENT] Deleted incident {incident_id} by @{user['username']}")
        return jsonify({"status": "deleted", "incident_id": incident_id})
    except Exception as e:
        logging.error(f"[INCIDENT] Error deleting incident: {e}")
        return jsonify({"error": "Failed to delete incident."}), 500


# ════════════════════════════════════════════════════════════════════════════════
# SOS EMERGENCY ASSISTANCE & CONTACTS API
# ════════════════════════════════════════════════════════════════════════════════

@app.route("/api/sos", methods=["POST"])
def api_sos_trigger():
    """
    Record an SOS emergency event and return official emergency helplines,
    nearest district facilities, and user's saved emergency contacts.
    """
    user = _get_authenticated_user(request)
    data = request.get_json(force=True, silent=True) or {}
    lat_val   = data.get("latitude")
    lon_val   = data.get("longitude")
    loc_name  = data.get("location_name", "Current GPS Position")
    from_loc  = data.get("from_location")
    to_loc    = data.get("to_location")

    sos_id = f"sos-{uuid.uuid4().hex[:8]}"
    now_iso = datetime.datetime.now().isoformat()

    lat = float(lat_val) if lat_val is not None else None
    lon = float(lon_val) if lon_val is not None else None

    # Retrieve user's emergency contacts if logged in
    saved_contacts = []
    if user:
        try:
            with sqlite3.connect(_DB_FILE) as conn:
                conn.row_factory = sqlite3.Row
                cur = conn.cursor()
                cur.execute("SELECT id, name, phone, relationship FROM emergency_contacts WHERE user_id = ?", (user["id"],))
                saved_contacts = [dict(c) for c in cur.fetchall()]
        except Exception:
            pass

    # Record SOS Event
    try:
        with sqlite3.connect(_DB_FILE) as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO sos_events (id, user_id, latitude, longitude, location_name, from_location, to_location, created_at, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
            """, (sos_id, user["id"] if user else None, lat, lon, loc_name, from_loc, to_loc, now_iso))
            conn.commit()
    except Exception as e:
        logging.error(f"[SOS] Error recording SOS event: {e}")

    # Official Disaster Management & Emergency Helplines
    emergency_helplines = [
        {"name": "National Emergency All-in-One", "number": "112", "desc": "Police, Fire, Ambulance & SDRF dispatch"},
        {"name": "State Disaster Management (SDMA)", "number": "1070", "desc": "State Emergency Operations Center"},
        {"name": "District Disaster Control Room", "number": "1077", "desc": "District Magistrate Emergency Control"},
        {"name": "Ambulance & Emergency Medical Response", "number": "108", "desc": "Immediate critical medical evacuation"},
        {"name": "National Disaster Response Force (NDRF)", "number": "011-24363260", "desc": "Heavy landslide & collapsed road rescue"},
        {"name": "Police Helpline", "number": "100", "desc": "Direct police assistance & road escort"}
    ]

    return jsonify({
        "status": "DISPATCHED",
        "sos_id": sos_id,
        "timestamp": now_iso,
        "location": {
            "latitude": lat,
            "longitude": lon,
            "name": loc_name,
            "share_text": f"EMERGENCY SOS from DHARA System: I need urgent assistance near {loc_name} (GPS: {lat}, {lon})." if (lat and lon) else f"EMERGENCY SOS: I need urgent assistance near {loc_name}."
        },
        "helplines": emergency_helplines,
        "saved_contacts": saved_contacts,
        "safety_guidelines": [
            "Stay clear of active landslide slopes, crumbling road edges, and swollen mountain streams.",
            "If vehicle is immobilized, move to a stable elevated concrete structure or designated shelter.",
            "Keep mobile battery conserved and keep hazard lights flashing if safe."
        ]
    })


@app.route("/api/sos/contacts", methods=["GET"])
def api_get_emergency_contacts():
    """Retrieve saved emergency contacts for the authenticated tourist."""
    user = _get_authenticated_user(request)
    if not user:
        return jsonify({"error": "Authentication required."}), 401
    try:
        with sqlite3.connect(_DB_FILE) as conn:
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute("SELECT id, name, phone, relationship, created_at FROM emergency_contacts WHERE user_id = ? ORDER BY created_at ASC", (user["id"],))
            rows = [dict(r) for r in cur.fetchall()]
            return jsonify({"count": len(rows), "contacts": rows})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/sos/contacts", methods=["POST"])
def api_add_emergency_contact():
    """Add a new emergency contact for the authenticated tourist."""
    user = _get_authenticated_user(request)
    if not user:
        return jsonify({"error": "Authentication required."}), 401

    data = request.get_json(force=True, silent=True) or {}
    name  = str(data.get("name", "")).strip()
    phone = str(data.get("phone", "")).strip()
    rel   = str(data.get("relationship", "Family")).strip()

    if not name or not phone:
        return jsonify({"error": "Name and phone number are required."}), 400

    cid = f"ec-{uuid.uuid4().hex[:8]}"
    now_iso = datetime.datetime.now().isoformat()

    try:
        with sqlite3.connect(_DB_FILE) as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO emergency_contacts (id, user_id, name, phone, relationship, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (cid, user["id"], name, phone, rel, now_iso))
            conn.commit()
        return jsonify({"status": "saved", "contact": {"id": cid, "name": name, "phone": phone, "relationship": rel}}), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/sos/contacts/<contact_id>", methods=["DELETE"])
def api_delete_emergency_contact(contact_id):
    """Delete a saved emergency contact."""
    user = _get_authenticated_user(request)
    if not user:
        return jsonify({"error": "Authentication required."}), 401
    try:
        with sqlite3.connect(_DB_FILE) as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM emergency_contacts WHERE id = ? AND user_id = ?", (contact_id, user["id"]))
            conn.commit()
        return jsonify({"status": "deleted", "id": contact_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/route-history", methods=["GET"])
def api_get_route_history():
    """Return historical route evaluations."""
    user = _get_authenticated_user(request)
    try:
        with sqlite3.connect(_DB_FILE) as conn:
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            if user:
                cur.execute("""
                    SELECT * FROM route_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 20
                """, (user["id"],))
            else:
                cur.execute("""
                    SELECT * FROM route_history ORDER BY created_at DESC LIMIT 20
                """)
            rows = [dict(r) for r in cur.fetchall()]
            return jsonify({"count": len(rows), "history": rows})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ════════════════════════════════════════════════════════════════════════════════
# FIELD REPORTS API (CENTRALIZED PERSISTENT BACKEND)
# ════════════════════════════════════════════════════════════════════════════════

@app.route("/api/field-reports", methods=["GET"])
def api_get_field_reports():
    """
    Return all submitted and preset field reports from SQLite database.
    Order by created_at DESC.
    """
    try:
        with sqlite3.connect(_DB_FILE) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, user_id, username, location, lat, lon, risk_level, notes,
                       image_filename, image_url, timestamp, source, status, created_at
                FROM field_reports
                ORDER BY datetime(created_at) DESC, rowid DESC
            """)
            rows = cursor.fetchall()

            # Query all associated images
            cursor.execute("""
                SELECT report_id, filename, image_url
                FROM field_report_images
                ORDER BY created_at ASC
            """)
            img_rows = cursor.fetchall()
            images_map = {}
            for ir in img_rows:
                rid = ir["report_id"]
                if rid not in images_map:
                    images_map[rid] = []
                images_map[rid].append(ir["image_url"])

            reports = []
            for r in rows:
                rep = dict(r)
                rid = rep["id"]
                rep["images"] = images_map.get(rid, [rep["image_url"]] if rep.get("image_url") else [])
                # Provide backwards compatibility alias
                rep["imgSrc"] = rep.get("image_url")
                rep["riskLevel"] = rep.get("risk_level")
                rep["time"] = rep.get("timestamp")
                rep["pending"] = rep.get("status") == "Pending Verification"
                reports.append(rep)

            return jsonify({"count": len(reports), "reports": reports})
    except Exception as e:
        logging.error(f"[DHARA] Error fetching field reports: {e}")
        return jsonify({"error": "Failed to fetch field reports"}), 500


@app.route("/api/field-reports", methods=["POST"])
def api_post_field_report():
    """
    Submit a new citizen/officer field report with multipart/form-data.
    Requires valid authentication token.
    Saves image to /uploads/field_reports/ and metadata to dhara_users.db.
    """
    user = _get_authenticated_user(request)
    if not user:
        return jsonify({"error": "Authentication required. Please log in to submit a field report."}), 401

    # Extract form fields (supporting multipart form or JSON fallback)
    is_multipart = request.content_type and "multipart/form-data" in request.content_type
    if is_multipart or request.form:
        location   = (request.form.get("location") or "").strip() or "Unknown Location"
        risk_level = (request.form.get("risk_level") or "MODERATE").strip().upper()
        notes      = (request.form.get("notes") or "").strip()
        timestamp  = (request.form.get("timestamp") or "").strip() or datetime.datetime.now().isoformat()
        lat_val    = request.form.get("lat")
        lon_val    = request.form.get("lon")
    else:
        data = request.get_json(silent=True) or {}
        location   = str(data.get("location", "")).strip() or "Unknown Location"
        risk_level = str(data.get("risk_level", "MODERATE")).strip().upper()
        notes      = str(data.get("notes", "")).strip()
        timestamp  = str(data.get("timestamp", "")).strip() or datetime.datetime.now().isoformat()
        lat_val    = data.get("lat")
        lon_val    = data.get("lon")

    if risk_level not in {"LOW", "MODERATE", "HIGH", "CRITICAL"}:
        risk_level = "MODERATE"

    lat = None
    lon = None
    try:
        if lat_val is not None and str(lat_val).strip() != "":
            lat = float(lat_val)
        if lon_val is not None and str(lon_val).strip() != "":
            lon = float(lon_val)
    except ValueError:
        pass

    # Extract uploaded files
    uploaded_files = []
    if "images" in request.files:
        uploaded_files.extend(request.files.getlist("images"))
    elif "image" in request.files:
        uploaded_files.extend(request.files.getlist("image"))

    saved_images = []       # list of (filename, image_url)
    saved_filepaths = []

    try:
        for file in uploaded_files:
            if not file or not file.filename:
                continue
            orig_name = file.filename
            ext = os.path.splitext(orig_name)[1].lower()
            if not ext:
                ext = ".jpg"

            if ext not in ALLOWED_IMAGE_EXTENSIONS:
                for p in saved_filepaths:
                    if os.path.exists(p): os.remove(p)
                return jsonify({"error": f"Unsupported image type '{ext}'. Use JPG, PNG or WEBP."}), 400

            file.seek(0, os.SEEK_END)
            file_size = file.tell()
            file.seek(0)
            if file_size > MAX_IMAGE_SIZE_BYTES:
                for p in saved_filepaths:
                    if os.path.exists(p): os.remove(p)
                return jsonify({"error": "Image exceeds the maximum allowed size of 10 MB."}), 413

            unique_filename = f"{uuid.uuid4().hex[:12]}_{secrets.token_hex(4)}{ext}"
            save_path = os.path.join(_UPLOADS_DIR, unique_filename)
            file.save(save_path)
            saved_filepaths.append(save_path)
            img_url = f"/uploads/field_reports/{unique_filename}"
            saved_images.append((unique_filename, img_url))

        report_id = f"fr-{uuid.uuid4().hex[:8]}"
        now_iso = datetime.datetime.now().isoformat()
        primary_fn = saved_images[0][0] if saved_images else None
        primary_url = saved_images[0][1] if saved_images else None

        with sqlite3.connect(_DB_FILE) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO field_reports (
                    id, user_id, username, location, lat, lon, risk_level, notes,
                    image_filename, image_url, timestamp, source, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                report_id,
                user["id"],
                user["username"],
                location,
                lat,
                lon,
                risk_level,
                notes,
                primary_fn,
                primary_url,
                timestamp,
                "citizen_upload",
                "Pending Verification",
                now_iso
            ))

            for img_fn, img_url in saved_images:
                img_id = f"img-{uuid.uuid4().hex[:8]}"
                cursor.execute("""
                    INSERT INTO field_report_images (id, report_id, filename, image_url, created_at)
                    VALUES (?, ?, ?, ?, ?)
                """, (img_id, report_id, img_fn, img_url, now_iso))

            conn.commit()

        report_obj = {
            "id": report_id,
            "user_id": user["id"],
            "username": user["username"],
            "location": location,
            "lat": lat,
            "lon": lon,
            "risk_level": risk_level,
            "riskLevel": risk_level,
            "notes": notes,
            "image_filename": primary_fn,
            "image_url": primary_url,
            "imgSrc": primary_url,
            "images": [u for _, u in saved_images] if saved_images else ([] if not primary_url else [primary_url]),
            "timestamp": timestamp,
            "time": timestamp,
            "source": "citizen_upload",
            "status": "Pending Verification",
            "pending": True,
            "created_at": now_iso,
        }
        logging.info(f"[FIELD_REPORT] New report {report_id} saved by @{user['username']} for {location}")
        return jsonify({"status": "saved", "report": report_obj}), 201

    except Exception as e:
        logging.error(f"[FIELD_REPORT] Failed to save field report: {e}")
        for p in saved_filepaths:
            try:
                if os.path.exists(p): os.remove(p)
            except Exception:
                pass
        return jsonify({"error": "Failed to save field report."}), 500


@app.route("/api/alerts/broadcast", methods=["POST"])
def api_broadcast_alert():
    """Simulate broadcasting an emergency alert through all channels."""
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
    print("  Flask Backend + ML REST API + Centralized Field Reports")
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
