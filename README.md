# DHARA-Dynamic-Hazard-Assessment-Risk-Advisory

### AI-Based Early Warning & Landslide Risk Monitoring System for the North Eastern Region

DHARA is an AI-powered disaster-risk monitoring and early warning platform designed for the North Eastern Region (NER) of India.

The system combines rainfall, terrain, soil moisture, historical landslide information, geospatial data and field observations to estimate landslide risk at vulnerable locations and convert that risk into actionable information for authorities, field teams, local communities and travelers.

Instead of only displaying weather or historical hazard information, DHARA aims to answer three practical questions:

> **Where is the risk? Why is the risk increasing? What action should be taken?**

---

## Features

### AI-Based Landslide Risk Prediction

- Multi-factor landslide risk assessment using:
  - 24-hour rainfall
  - 72-hour antecedent rainfall
  - Rainfall intensity
  - Soil moisture
  - Terrain slope
  - Vegetation / NDVI
  - Historical landslide activity
  - Soil characteristics
  - Road proximity for impact assessment
- Produces four risk levels:
  - `LOW`
  - `MODERATE`
  - `HIGH`
  - `CRITICAL`
- Provides a risk probability and supporting risk factors.
- Designed to support periodic prediction updates during active rainfall events.

### GIS-Based Risk Monitoring

- Interactive map-based visualization of the North Eastern Region.
- Risk zones displayed geographically.
- District and monitoring-zone level risk information.
- Visual risk heatmap for vulnerable regions.
- Road and infrastructure impact visualization.
- Field-observed incidents can be displayed separately from model-predicted risk.

### Explainable Risk

DHARA does not only display a risk label.

For every significant prediction, the system can show the factors contributing to the risk, such as:

- High accumulated rainfall
- Increasing soil moisture
- Steep terrain
- Previous landslide activity
- Other environmental indicators

This allows authorities to understand **why a location has been classified as high risk**.

### Weather-Linked Risk Forecast

- Uses current and forecast rainfall information.
- Tracks changing hazard conditions.
- Displays expected risk trends over the coming hours/days.
- Helps identify locations where risk may increase before an incident occurs.

### Alert & Notification Engine

- Generates alerts when risk crosses configured thresholds.
- Supports severity-based escalation.
- Example:
  - `HIGH` → SMS / app / dashboard notification
  - `CRITICAL` → SMS / app / dashboard / IVR
- Supports multilingual alert templates.
- Keeps alert generation separate from the ML model so thresholds and message templates can be changed independently.

### Tourist Route Risk Advisory

Travelers can check the risk associated with a route before travelling.

Example:

```text
Guwahati
    ↓
Shillong
    ↓
Cherrapunji