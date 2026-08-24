# DHARA — AI/ML Landslide Early Warning & Risk Prediction System

**DHARA** (Landslide Early Warning System) is an interactive, ISRO Bhuvan Geo-Portal inspired web platform and predictive ML analytics engine designed for real-time landslide risk assessment, transport corridor advisories, and multi-lingual emergency alert routing.

![ISRO Bhuvan Aesthetic](https://img.shields.io/badge/GIS-ISRO%20Bhuvan%20Telemetry-00e5ff?style=for-the-badge)
![ML Engine](https://img.shields.io/badge/ML%20Engine-Random%20Forest%20%2B%20Edge%20Rule%20Fallback-10b981?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)

---

## 🌟 Key Features

1. **ISRO Bhuvan GIS Map Viewer**:
   - High-resolution Bhuvan Satellite Imagery + Hybrid Road Networks.
   - Survey of India Topographic DEM and Dark Vector layers.
   - Live Latitude, Longitude, and Zoom Level cursor tracking (`DOP: 03-12-2026 | Lat: 25.2789° N | Lon: 91.7325° E`).

2. **North-East & Himalayan Sub-district Divisions**:
   - High-resolution monitoring station grid cells across all 8 North-Eastern states (*Meghalaya, Mizoram, Sikkim, Assam, Arunachal Pradesh, Nagaland, Manipur, Tripura*) and Himalayan belts.
   - Color-coded micro-grid polygons (`LOW`, `MODERATE`, `HIGH`, `CRITICAL`).

3. **Dual-Engine AI Risk Prediction**:
   - **Cloud ML Random Forest Model**: Outputs 4-level risk probability & confidence score.
   - **Edge Gateway Scorer**: Offline rule-based scorer for low-power edge devices when internet connection is lost.

4. **Tourist & Transport Route Advisory Planner**:
   - Trip-level risk evaluator for National Highway corridors (*Guwahati–Shillong–Cherrapunji*, *Siliguri–Gangtok*, *Rishikesh–Joshimath*, *Kozhikode–Wayanad*).

5. **Multilingual Emergency Alerts**:
   - Generates SMS, App Push, and IVR alerts in **English**, **Assamese (অসমীয়া)**, and **Hindi (हिन्दी)**.

---

## 📁 Repository Structure

```
DHARA/
├── index.html        # Main Bhuvan-inspired GIS application view
├── styles.css        # Glassmorphic dark design system & GIS map styling
├── app.js            # Leaflet map orchestrator & dynamic HUD coordinate tracker
├── risk_engine.js    # JS port of AI Risk Prediction Engine & sub-division datasets
├── risk_engine.py    # Python Random Forest & Edge Scorer prototype
└── README.md         # Project documentation
```

---

## 🚀 How to Run Locally

### Option 1: Python HTTP Server
```bash
python -m http.server 8080
# Open http://localhost:8080 in your browser
```

### Option 2: Node / Serve
```bash
npx serve .
```

---

## 📄 License
This project is open-source under the MIT License.
