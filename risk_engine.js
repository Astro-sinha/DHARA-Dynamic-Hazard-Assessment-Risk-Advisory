/**
 * DHARA — Landslide Early Warning System
 * JS Port of AI Risk Prediction Engine (risk_engine.py)
 */

const FEATURE_COLUMNS = [
  "rainfall_24h_mm",
  "rainfall_72h_mm",
  "rainfall_intensity_mmhr",
  "soil_moisture_pct",
  "slope_angle_deg",
  "ndvi",
  "distance_to_road_m",
  "historical_incidents_5y",
  "soil_type_erodibility"
];

const RISK_LEVELS = ["LOW", "MODERATE", "HIGH", "CRITICAL"];

// Comprehensive Monitoring Grid Cells and Sub-district Divisions across North-East India (NER)
const PRESET_STATIONS = [
  // MEGHALAYA DIVISION & SUBDIVISIONS
  {
    cell_id: "NER-MEG-EKH-01",
    district: "East Khasi Hills (Sohra / Cherrapunji Sub-division)",
    subdivision: "Sohra Civil Sub-Division",
    state: "Meghalaya",
    lat: 25.2789,
    lon: 91.7325,
    rainfall_24h_mm: 120,
    rainfall_72h_mm: 310,
    rainfall_intensity_mmhr: 54,
    soil_moisture_pct: 88,
    slope_angle_deg: 42,
    ndvi: 0.10,
    distance_to_road_m: 30,
    historical_incidents_5y: 4,
    soil_type_erodibility: 0.75,
    bounds: [[25.25, 91.70], [25.31, 91.76]]
  },
  {
    cell_id: "NER-MEG-EKH-02",
    district: "East Khasi Hills (Shillong Urban Sub-division)",
    subdivision: "Shillong Sadar Sub-Division",
    state: "Meghalaya",
    lat: 25.5788,
    lon: 91.8933,
    rainfall_24h_mm: 55,
    rainfall_72h_mm: 140,
    rainfall_intensity_mmhr: 20,
    soil_moisture_pct: 62,
    slope_angle_deg: 28,
    ndvi: 0.38,
    distance_to_road_m: 15,
    historical_incidents_5y: 1,
    soil_type_erodibility: 0.45,
    bounds: [[25.55, 91.86], [25.60, 91.92]]
  },
  {
    cell_id: "NER-MEG-RIB-03",
    district: "Ri-Bhoi District (Nongpoh Sub-division)",
    subdivision: "Nongpoh Circle",
    state: "Meghalaya",
    lat: 25.9038,
    lon: 91.8810,
    rainfall_24h_mm: 40,
    rainfall_72h_mm: 95,
    rainfall_intensity_mmhr: 14,
    soil_moisture_pct: 50,
    slope_angle_deg: 22,
    ndvi: 0.52,
    distance_to_road_m: 50,
    historical_incidents_5y: 0,
    soil_type_erodibility: 0.35,
    bounds: [[25.87, 91.85], [25.93, 91.91]]
  },
  {
    cell_id: "NER-MEG-WGH-04",
    district: "West Garo Hills (Tura Peak Sub-division)",
    subdivision: "Tura Sadar Sub-Division",
    state: "Meghalaya",
    lat: 25.5141,
    lon: 90.2032,
    rainfall_24h_mm: 85,
    rainfall_72h_mm: 210,
    rainfall_intensity_mmhr: 36,
    soil_moisture_pct: 74,
    slope_angle_deg: 35,
    ndvi: 0.28,
    distance_to_road_m: 60,
    historical_incidents_5y: 2,
    soil_type_erodibility: 0.60,
    bounds: [[25.48, 90.17], [25.54, 90.23]]
  },

  // MIZORAM DIVISION & SUBDIVISIONS
  {
    cell_id: "NER-MZ-AIZ-01",
    district: "Aizawl District (Laipuitlang Ridge)",
    subdivision: "Aizawl North Sub-Division",
    state: "Mizoram",
    lat: 23.7271,
    lon: 92.7176,
    rainfall_24h_mm: 75,
    rainfall_72h_mm: 190,
    rainfall_intensity_mmhr: 28,
    soil_moisture_pct: 72,
    slope_angle_deg: 38,
    ndvi: 0.22,
    distance_to_road_m: 20,
    historical_incidents_5y: 3,
    soil_type_erodibility: 0.70,
    bounds: [[23.70, 92.69], [23.75, 92.74]]
  },
  {
    cell_id: "NER-MZ-LUN-02",
    district: "Lunglei District (Hrangchalkawn Pass)",
    subdivision: "Lunglei Sadar Sub-Division",
    state: "Mizoram",
    lat: 22.8878,
    lon: 92.7366,
    rainfall_24h_mm: 30,
    rainfall_72h_mm: 75,
    rainfall_intensity_mmhr: 10,
    soil_moisture_pct: 45,
    slope_angle_deg: 20,
    ndvi: 0.58,
    distance_to_road_m: 120,
    historical_incidents_5y: 0,
    soil_type_erodibility: 0.30,
    bounds: [[22.86, 92.71], [22.91, 92.76]]
  },

  // SIKKIM DIVISION & SUBDIVISIONS
  {
    cell_id: "NER-SIK-NTH-01",
    district: "North Sikkim (Mangan - Chungthang Valley)",
    subdivision: "Chungthang Sub-Division",
    state: "Sikkim",
    lat: 27.5029,
    lon: 88.5350,
    rainfall_24h_mm: 105,
    rainfall_72h_mm: 290,
    rainfall_intensity_mmhr: 46,
    soil_moisture_pct: 85,
    slope_angle_deg: 45,
    ndvi: 0.12,
    distance_to_road_m: 40,
    historical_incidents_5y: 5,
    soil_type_erodibility: 0.80,
    bounds: [[27.47, 88.50], [27.53, 88.56]]
  },
  {
    cell_id: "NER-SIK-EST-02",
    district: "East Sikkim (Gangtok Ridge / NH-10)",
    subdivision: "Gangtok Sub-Division",
    state: "Sikkim",
    lat: 27.3389,
    lon: 88.6065,
    rainfall_24h_mm: 60,
    rainfall_72h_mm: 165,
    rainfall_intensity_mmhr: 24,
    soil_moisture_pct: 68,
    slope_angle_deg: 34,
    ndvi: 0.35,
    distance_to_road_m: 25,
    historical_incidents_5y: 2,
    soil_type_erodibility: 0.55,
    bounds: [[27.31, 88.58], [27.36, 88.63]]
  },

  // ASSAM DIVISION & SUBDIVISIONS
  {
    cell_id: "NER-ASS-DMH-01",
    district: "Dima Hasao (Haflong Hill Sub-division)",
    subdivision: "Haflong Civil Sub-Division",
    state: "Assam",
    lat: 25.1764,
    lon: 93.0183,
    rainfall_24h_mm: 90,
    rainfall_72h_mm: 240,
    rainfall_intensity_mmhr: 40,
    soil_moisture_pct: 79,
    slope_angle_deg: 36,
    ndvi: 0.20,
    distance_to_road_m: 35,
    historical_incidents_5y: 3,
    soil_type_erodibility: 0.68,
    bounds: [[25.14, 92.99], [25.20, 93.04]]
  },
  {
    cell_id: "NER-ASS-KRA-02",
    district: "Karbi Anglong (Diphu Hill Circle)",
    subdivision: "Diphu Sub-Division",
    state: "Assam",
    lat: 25.8450,
    lon: 93.4350,
    rainfall_24h_mm: 45,
    rainfall_72h_mm: 110,
    rainfall_intensity_mmhr: 16,
    soil_moisture_pct: 54,
    slope_angle_deg: 24,
    ndvi: 0.48,
    distance_to_road_m: 90,
    historical_incidents_5y: 1,
    soil_type_erodibility: 0.40,
    bounds: [[25.82, 93.41], [25.87, 93.46]]
  },

  // ARUNACHAL PRADESH DIVISION & SUBDIVISIONS
  {
    cell_id: "NER-ARP-TAW-01",
    district: "Tawang District (Sela Pass Sub-division)",
    subdivision: "Jang Sub-Division",
    state: "Arunachal Pradesh",
    lat: 27.5860,
    lon: 91.8594,
    rainfall_24h_mm: 115,
    rainfall_72h_mm: 320,
    rainfall_intensity_mmhr: 50,
    soil_moisture_pct: 86,
    slope_angle_deg: 48,
    ndvi: 0.09,
    distance_to_road_m: 15,
    historical_incidents_5y: 4,
    soil_type_erodibility: 0.82,
    bounds: [[27.55, 91.83], [27.61, 91.88]]
  },
  {
    cell_id: "NER-ARP-WKM-02",
    district: "West Kameng (Dirang Valley Sub-division)",
    subdivision: "Dirang Circle",
    state: "Arunachal Pradesh",
    lat: 27.3590,
    lon: 92.2350,
    rainfall_24h_mm: 50,
    rainfall_72h_mm: 130,
    rainfall_intensity_mmhr: 18,
    soil_moisture_pct: 58,
    slope_angle_deg: 30,
    ndvi: 0.40,
    distance_to_road_m: 70,
    historical_incidents_5y: 1,
    soil_type_erodibility: 0.48,
    bounds: [[27.33, 92.21], [27.38, 92.26]]
  },

  // NAGALAND DIVISION & SUBDIVISIONS
  {
    cell_id: "NER-NAG-KOH-01",
    district: "Kohima District (Dzükou Valley Ridge)",
    subdivision: "Kohima Sadar Sub-Division",
    state: "Nagaland",
    lat: 25.6751,
    lon: 94.1086,
    rainfall_24h_mm: 80,
    rainfall_72h_mm: 215,
    rainfall_intensity_mmhr: 34,
    soil_moisture_pct: 75,
    slope_angle_deg: 37,
    ndvi: 0.25,
    distance_to_road_m: 45,
    historical_incidents_5y: 2,
    soil_type_erodibility: 0.62,
    bounds: [[25.65, 94.08], [25.70, 94.13]]
  },

  // MANIPUR DIVISION & SUBDIVISIONS
  {
    cell_id: "NER-MAN-UKH-01",
    district: "Ukhrul District (Shirui Peak Sub-division)",
    subdivision: "Ukhrul Central Sub-Division",
    state: "Manipur",
    lat: 25.1120,
    lon: 94.3600,
    rainfall_24h_mm: 70,
    rainfall_72h_mm: 185,
    rainfall_intensity_mmhr: 26,
    soil_moisture_pct: 69,
    slope_angle_deg: 33,
    ndvi: 0.31,
    distance_to_road_m: 60,
    historical_incidents_5y: 2,
    soil_type_erodibility: 0.56,
    bounds: [[25.08, 94.33], [25.14, 94.39]]
  },

  // TRIPURA DIVISION & SUBDIVISIONS
  {
    cell_id: "NER-TRP-DHL-01",
    district: "Dhalai District (Longtharai Valley Sub-division)",
    subdivision: "Ambassa Sub-Division",
    state: "Tripura",
    lat: 23.9200,
    lon: 91.8500,
    rainfall_24h_mm: 35,
    rainfall_72h_mm: 85,
    rainfall_intensity_mmhr: 12,
    soil_moisture_pct: 48,
    slope_angle_deg: 18,
    ndvi: 0.55,
    distance_to_road_m: 110,
    historical_incidents_5y: 0,
    soil_type_erodibility: 0.32,
    bounds: [[23.89, 91.82], [23.95, 91.88]]
  }
];


/**
 * Physically-motivated latent hazard scorer from risk_engine.py
 */
function calculateGroundTruthHazardScore(data) {
  const rainTrigger = 0.55 * (data.rainfall_72h_mm / 400) + 0.45 * (data.rainfall_intensity_mmhr / 60);
  const saturation = data.soil_moisture_pct / 100;
  const slopeFactor = Math.min(data.slope_angle_deg / 45, 1.3);
  const vegFactor = 1 - Math.max(data.ndvi, 0);
  const erodibility = data.soil_type_erodibility;
  const historyBoost = Math.min(data.historical_incidents_5y * 0.06, 0.3);

  const rawScore = 0.35 * rainTrigger +
                   0.20 * saturation +
                   0.20 * slopeFactor +
                   0.10 * vegFactor +
                   0.10 * erodibility +
                   historyBoost;

  return Math.min(Math.max(rawScore, 0), 1.5);
}

/**
 * Cloud Random Forest ML Predictor (Surrogate calculation for client-side demo)
 */
function predictCloudMLRisk(reading) {
  const hazard = calculateGroundTruthHazardScore(reading);

  let riskClass = "LOW";
  let baseProba = { LOW: 0.1, MODERATE: 0.1, HIGH: 0.1, CRITICAL: 0.1 };

  if (hazard < 0.35) {
    riskClass = "LOW";
    baseProba = { LOW: 0.82, MODERATE: 0.14, HIGH: 0.03, CRITICAL: 0.01 };
  } else if (hazard < 0.60) {
    riskClass = "MODERATE";
    baseProba = { LOW: 0.12, MODERATE: 0.73, HIGH: 0.12, CRITICAL: 0.03 };
  } else if (hazard < 0.85) {
    riskClass = "HIGH";
    baseProba = { LOW: 0.02, MODERATE: 0.11, HIGH: 0.76, CRITICAL: 0.11 };
  } else {
    riskClass = "CRITICAL";
    baseProba = { LOW: 0.01, MODERATE: 0.04, HIGH: 0.15, CRITICAL: 0.80 };
  }

  const confidence = baseProba[riskClass];

  return {
    cell_id: reading.cell_id,
    district: reading.district,
    risk_class: riskClass,
    hazard_score: parseFloat(hazard.toFixed(3)),
    confidence: confidence,
    class_probabilities: baseProba,
    engine: "cloud_ml_random_forest"
  };
}

/**
 * Lightweight Edge Gateway Scorer (Offline fallback rule-based)
 */
function predictEdgeRuleBasedRisk(reading) {
  let score = 0;

  if (reading.rainfall_72h_mm > 250) score += 3;
  else if (reading.rainfall_72h_mm > 150) score += 2;
  else if (reading.rainfall_72h_mm > 80) score += 1;

  if (reading.rainfall_intensity_mmhr > 40) score += 3;
  else if (reading.rainfall_intensity_mmhr > 20) score += 1;

  if (reading.soil_moisture_pct > 75) score += 2;
  else if (reading.soil_moisture_pct > 55) score += 1;

  if (reading.slope_angle_deg > 35) score += 2;
  else if (reading.slope_angle_deg > 20) score += 1;

  if (reading.historical_incidents_5y >= 2) score += 1;

  let riskClass = "LOW";
  if (score >= 8) riskClass = "CRITICAL";
  else if (score >= 5) riskClass = "HIGH";
  else if (score >= 3) riskClass = "MODERATE";

  return {
    cell_id: reading.cell_id,
    district: reading.district,
    risk_class: riskClass,
    score: score,
    engine: "edge_rule_based_offline"
  };
}

/**
 * ISRO Bhuvan Satellite Data Simulator
 */
function fetchBhuvanSatelliteData(lat, lon, hasApiKey = true) {
  if (!hasApiKey) {
    return {
      status: "no_api_key",
      message: "No BHUVAN_API_KEY set — using offline DEM fallback"
    };
  }

  // Simulate Bhuvan Geo-Portal terrain telemetry call
  const simulatedNDVI = parseFloat((0.15 + (Math.sin(lat * lon) + 1) * 0.25).toFixed(2));
  const simulatedDisplacement = parseFloat((1.2 + Math.cos(lat) * 2.5).toFixed(1));

  return {
    status: "ok",
    provider: "ISRO Bhuvan NRSC API v2",
    lat: lat,
    lon: lon,
    ndvi: simulatedNDVI,
    slope_displacement_mm: simulatedDisplacement,
    timestamp: new Date().toISOString()
  };
}

/**
 * Multilingual Alert Generator
 */
const ALERT_TEMPLATES = {
  en: {
    HIGH: "ALERT: High landslide risk near {district} ({cell_id}). Avoid travel on flagged roads. Follow local authority instructions.",
    CRITICAL: "URGENT: CRITICAL landslide risk in {district} ({cell_id}). Evacuate low-lying/slope-adjacent areas immediately if instructed."
  },
  as: {
    HIGH: "সতৰ্কবাণী: {district} ({cell_id}) ত ভূমিস্খলনৰ উচ্চ আশংকা। চিহ্নিত পথত যাত্ৰা নকৰিব।",
    CRITICAL: "জৰুৰী: {district} ({cell_id}) ত অতি উচ্চ আশংকা। প্ৰশাসনৰ নিৰ্দেশ অনুসৰি তৎক্ষণাৎ স্থান ত্যাগ কৰক।"
  },
  hi: {
    HIGH: "चेतावनी: {district} ({cell_id}) के पास भूस्खलन का उच्च जोखिम। चिन्हित मार्गों पर यात्रा से बचें।",
    CRITICAL: "आपातकालीन: {district} ({cell_id}) में अत्यंत गंभीर भूस्खलन जोखिम। स्थानीय प्रशासन के निर्देश पर तुरंत सुरक्षित स्थान पर जाएं।"
  }
};

function buildAlert(prediction, lang = "en") {
  const riskClass = prediction.risk_class;
  if (riskClass !== "HIGH" && riskClass !== "CRITICAL") return null;

  const templates = ALERT_TEMPLATES[lang] || ALERT_TEMPLATES.en;
  const tpl = templates[riskClass] || ALERT_TEMPLATES.en[riskClass];

  const message = tpl
    .replace("{district}", prediction.district)
    .replace("{cell_id}", prediction.cell_id);

  return {
    cell_id: prediction.cell_id,
    district: prediction.district,
    severity: riskClass,
    channels: ["sms", "app_push", "district_dashboard"].concat(riskClass === "CRITICAL" ? ["ivr_voice_call"] : []),
    lang: lang,
    message: message,
    timestamp: new Date().toLocaleTimeString()
  };
}

/**
 * Trip Route Risk Advisory Aggregator
 */
const RISK_WEIGHT = { LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 };

const TRIP_VERDICT = {
  LOW: { label: "SAFE TO TRAVEL", class: "badge-low" },
  MODERATE: { label: "TRAVEL WITH CAUTION", class: "badge-moderate" },
  HIGH: { label: "AVOID UNLESS NECESSARY", class: "badge-high" },
  CRITICAL: { label: "AVOID ROUTE IMMEDIATELY", class: "badge-critical" }
};

function assessRouteRisk(routeName, legs) {
  let maxWeight = -1;
  let worstLeg = legs[0];

  legs.forEach(leg => {
    const w = RISK_WEIGHT[leg.prediction.risk_class];
    if (w > maxWeight) {
      maxWeight = w;
      worstLeg = leg;
    }
  });

  const tripRisk = worstLeg.prediction.risk_class;

  return {
    route: routeName,
    trip_risk: tripRisk,
    verdict: TRIP_VERDICT[tripRisk],
    worst_segment: worstLeg.segment_name,
    legs: legs,
    has_blocked_road: legs.some(l => l.road_status === "blocked"),
    advisory_text: generateAdvisoryText(routeName, tripRisk, worstLeg)
  };
}

function generateAdvisoryText(routeName, tripRisk, worstLeg) {
  if (tripRisk === "CRITICAL") {
    return `Critical Warning: Avoid travel on ${routeName}. Severe slope instability detected around ${worstLeg.segment_name}. Route may experience debris flows.`;
  }
  if (tripRisk === "HIGH") {
    return `High Alert: High landslide hazard on ${routeName} near ${worstLeg.segment_name}. Drive with extreme caution or postpone travel.`;
  }
  if (tripRisk === "MODERATE") {
    return `Advisory: Moderate risk on ${routeName} near ${worstLeg.segment_name}. Check latest weather updates before departing.`;
  }
  return `${routeName} currently shows LOW landslide risk. Standard road safety precautions apply.`;
}
