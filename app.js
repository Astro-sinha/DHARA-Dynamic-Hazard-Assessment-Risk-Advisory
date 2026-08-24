/**
 * DHARA — Landslide Early Warning System
 * Main Web Application Orchestrator
 */

document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) window.lucide.createIcons();

  let currentStation = PRESET_STATIONS[0];
  let routeLayerGroup = null;

  // ── MAP SETUP ──────────────────────────────────────────────────────────────
  const map = L.map("map", {
    center: [26.0, 92.8],
    zoom: 7.2,
    zoomControl: false
  });
  L.control.zoom({ position: "bottomright" }).addTo(map);

  const tileLayers = {
    satHybrid: L.layerGroup([
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 18 }),
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}", { maxZoom: 18 }),
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", { maxZoom: 18 })
    ]),
    sat: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 18 }),
    topo: L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { maxZoom: 17 }),
    dark: L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { maxZoom: 19 })
  };
  tileLayers.satHybrid.addTo(map);

  const layerBtns = {
    satHybrid: document.getElementById("layer-sat-hybrid"),
    sat: document.getElementById("layer-sat"),
    topo: document.getElementById("layer-topo"),
    dark: document.getElementById("layer-dark")
  };
  Object.keys(layerBtns).forEach(key => {
    layerBtns[key].addEventListener("click", () => {
      Object.keys(tileLayers).forEach(k => map.removeLayer(tileLayers[k]));
      tileLayers[key].addTo(map);
      Object.keys(layerBtns).forEach(k => layerBtns[k].classList.remove("active"));
      layerBtns[key].classList.add("active");
    });
  });

  // ── LIVE LAT/LON HUD ───────────────────────────────────────────────────────
  const hudLat = document.getElementById("hud-lat");
  const hudLon = document.getElementById("hud-lon");
  const hudZoom = document.getElementById("hud-zoom");
  map.on("mousemove", e => {
    const lat = e.latlng.lat.toFixed(4), lon = e.latlng.lng.toFixed(4);
    hudLat.innerText = `${Math.abs(lat)}° ${lat >= 0 ? "N" : "S"}`;
    hudLon.innerText = `${Math.abs(lon)}° ${lon >= 0 ? "E" : "W"}`;
  });
  map.on("zoomend", () => { hudZoom.innerText = `${map.getZoom().toFixed(1)}x`; });

  // ── LAYER GROUPS ───────────────────────────────────────────────────────────
  const markersGroup = L.layerGroup().addTo(map);
  const polygonsGroup = L.layerGroup().addTo(map);

  const RISK_COLORS = { LOW: "#10b981", MODERATE: "#f59e0b", HIGH: "#f97316", CRITICAL: "#ef4444" };

  // ── ROAD CORRIDOR VECTORS ─────────────────────────────────────────────────
  const ROAD_CORRIDORS = [
    { name: "NH-6 / NH-106 Transport Corridor", coords: [[26.1445, 91.7362], [25.9038, 91.8810], [25.5788, 91.8933], [25.2789, 91.7325]], color: "#facc15", weight: 3 },
    { name: "NH-10 Himalayan Corridor", coords: [[26.7271, 88.3953], [27.0410, 88.2663], [27.3389, 88.6065], [27.5029, 88.5350]], color: "#facc15", weight: 3 },
    { name: "SH-14 Suri-Bolpur-Katwa Corridor", coords: [[23.9080, 87.5270], [23.8440, 87.6690], [23.6700, 87.6800], [23.4980, 87.7500], [23.5300, 87.9000], [23.6400, 88.1300]], color: "#fbbf24", weight: 3 },
    { name: "NH-7 Garhwal Pilgrimage Corridor", coords: [[30.0869, 78.2676], [30.1450, 78.5988], [30.5564, 79.5658]], color: "#facc15", weight: 3 },
    { name: "NH-766 Wayanad Ghat Pass Corridor", coords: [[11.2588, 75.7804], [11.4500, 75.9500], [11.5510, 76.1260]], color: "#facc15", weight: 3 }
  ];

  function renderNERegionalDivisions() {
    markersGroup.clearLayers();
    polygonsGroup.clearLayers();
    ROAD_CORRIDORS.forEach(road => {
      const line = L.polyline(road.coords, { color: road.color, weight: road.weight, opacity: 0.9, lineCap: "round" });
      line.bindTooltip(`<b>${road.name}</b>`, { sticky: true });
      line.addTo(polygonsGroup);
    });
    PRESET_STATIONS.forEach(station => {
      const pred = predictCloudMLRisk(station);
      const riskClass = pred.risk_class;
      const colorHex = RISK_COLORS[riskClass];
      const colorClass = `bg-${riskClass.toLowerCase()}`;
      if (station.bounds) {
        const poly = L.rectangle(station.bounds, { color: colorHex, weight: 2, fillColor: colorHex, fillOpacity: 0.35, dashArray: "4, 4" });
        poly.bindTooltip(`<div style="font-family:Outfit;font-size:11px;"><strong>${station.subdivision}</strong><br/>
          ${station.district}<br/><b>${station.state}</b><br/>
          Risk: <span style="color:${colorHex};font-weight:700;">${riskClass}</span></div>`, { sticky: true });
        poly.on("click", () => selectStation(station));
        poly.addTo(polygonsGroup);
      }
      const customIcon = L.divIcon({
        className: "custom-leaflet-marker",
        html: `<div class="bhuvan-marker ${colorClass}">${station.cell_id.split("-")[2]}</div>`,
        iconSize: [26, 26], iconAnchor: [13, 13]
      });
      const marker = L.marker([station.lat, station.lon], { icon: customIcon });
      marker.bindPopup(`<div style="font-family:'Outfit',sans-serif;color:#111;padding:4px;min-width:200px;">
        <div style="font-weight:800;font-size:14px;color:#1e3a8a;">${station.cell_id}</div>
        <div style="font-size:12px;font-weight:600;color:#333;">${station.subdivision}</div>
        <div style="font-size:11px;color:#666;margin-bottom:6px;">${station.district}, ${station.state}</div>
        <div style="border-top:1px solid #eee;padding-top:4px;font-size:11px;color:#444;">
          <div>72h Rainfall: <strong>${station.rainfall_72h_mm}mm</strong></div>
          <div>Soil Saturation: <strong>${station.soil_moisture_pct}%</strong></div>
          <div>Slope: <strong>${station.slope_angle_deg}°</strong></div>
          <div style="margin-top:4px;">Risk: <strong style="color:${colorHex};">${riskClass}</strong></div>
        </div></div>`);
      marker.on("click", () => selectStation(station));
      marker.addTo(markersGroup);
    });
  }
  renderNERegionalDivisions();

  // ── STATION SELECTION ─────────────────────────────────────────────────────
  function selectStation(station) {
    currentStation = station;
    map.flyTo([station.lat, station.lon], 9, { duration: 1.5 });
    document.getElementById("slider-rain72").value = station.rainfall_72h_mm;
    document.getElementById("slider-intensity").value = station.rainfall_intensity_mmhr;
    document.getElementById("slider-moisture").value = station.soil_moisture_pct;
    document.getElementById("slider-slope").value = station.slope_angle_deg;
    document.getElementById("slider-history").value = station.historical_incidents_5y;
    const bhuvanSat = fetchBhuvanSatelliteData(station.lat, station.lon);
    if (bhuvanSat.status === "ok") {
      document.getElementById("val-ndvi-display").innerText = bhuvanSat.ndvi;
      document.getElementById("val-disp-display").innerText = `${bhuvanSat.slope_displacement_mm} mm`;
      document.getElementById("sat-status-tag").innerText = "ISRO LIVE";
      document.getElementById("sat-status-tag").style.color = "var(--risk-low)";
    }
    recalculateRisk();
  }

  function recalculateRisk() {
    const r72 = parseFloat(document.getElementById("slider-rain72").value);
    const intensity = parseFloat(document.getElementById("slider-intensity").value);
    const moisture = parseFloat(document.getElementById("slider-moisture").value);
    const slope = parseFloat(document.getElementById("slider-slope").value);
    const history = parseInt(document.getElementById("slider-history").value);
    document.getElementById("val-rain72").innerText = `${r72} mm`;
    document.getElementById("val-intensity").innerText = `${intensity} mm/h`;
    document.getElementById("val-moisture").innerText = `${moisture} %`;
    document.getElementById("val-slope").innerText = `${slope}°`;
    document.getElementById("val-history").innerText = `${history} events`;
    const activeReading = {
      cell_id: currentStation.cell_id, district: currentStation.district,
      rainfall_24h_mm: Math.round(r72 * 0.4), rainfall_72h_mm: r72,
      rainfall_intensity_mmhr: intensity, soil_moisture_pct: moisture, slope_angle_deg: slope,
      ndvi: currentStation.ndvi, distance_to_road_m: currentStation.distance_to_road_m,
      historical_incidents_5y: history, soil_type_erodibility: currentStation.soil_type_erodibility
    };
    const cloudPred = predictCloudMLRisk(activeReading);
    const edgePred = predictEdgeRuleBasedRisk(activeReading);
    document.getElementById("selected-cell-id").innerText = activeReading.cell_id;
    document.getElementById("selected-cell-district").innerText = activeReading.district;
    const badgeEl = document.getElementById("selected-risk-badge");
    badgeEl.innerText = cloudPred.risk_class;
    badgeEl.className = `risk-badge badge-${cloudPred.risk_class.toLowerCase()}`;
    const cloudResEl = document.getElementById("cloud-ml-res");
    cloudResEl.innerText = cloudPred.risk_class;
    cloudResEl.style.color = `var(--risk-${cloudPred.risk_class.toLowerCase()})`;
    document.getElementById("cloud-ml-conf").innerText = `${Math.round(cloudPred.confidence * 100)}%`;
    const edgeResEl = document.getElementById("edge-rule-res");
    edgeResEl.innerText = edgePred.risk_class;
    edgeResEl.style.color = `var(--risk-${edgePred.risk_class.toLowerCase()})`;
    document.getElementById("edge-rule-score").innerText = `${edgePred.score} / 12`;
    updateAlertMessage(cloudPred);
  }

  function updateAlertMessage(cloudPred) {
    const lang = document.getElementById("select-alert-lang").value;
    const alertData = buildAlert(cloudPred, lang);
    document.getElementById("alert-msg-text").innerText = alertData
      ? alertData.message
      : `Normal Conditions: Risk level in ${cloudPred.district} (${cloudPred.cell_id}) is currently ${cloudPred.risk_class}. No emergency broadcast triggered.`;
  }

  ["slider-rain72", "slider-intensity", "slider-moisture", "slider-slope", "slider-history"].forEach(id => {
    document.getElementById(id).addEventListener("input", recalculateRisk);
  });
  document.getElementById("select-alert-lang").addEventListener("change", recalculateRisk);

  // ── TABS ───────────────────────────────────────────────────────────────────
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(target).classList.add("active");
    });
  });

  // ── STATION LIST ───────────────────────────────────────────────────────────
  function renderStationsList() {
    const container = document.getElementById("station-list-container");
    container.innerHTML = "";
    PRESET_STATIONS.forEach(st => {
      const pred = predictCloudMLRisk(st);
      const div = document.createElement("div");
      div.className = "panel-card";
      div.style.cssText = "padding:10px 14px;margin:0;cursor:pointer;";
      div.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <div style="font-weight:700;font-size:13px;color:var(--primary-cyan);">${st.cell_id}</div>
          <div style="font-size:12px;font-weight:600;color:#fff;">${st.subdivision}</div>
          <div style="font-size:11px;color:var(--text-muted);">${st.district}, ${st.state}</div>
        </div>
        <span class="risk-badge badge-${pred.risk_class.toLowerCase()}">${pred.risk_class}</span>
      </div>`;
      div.addEventListener("click", () => {
        selectStation(st);
        document.querySelector('[data-tab="tab-predictor"]').click();
      });
      container.appendChild(div);
    });
  }
  renderStationsList();

  // ── OLD ROUTE MODAL ────────────────────────────────────────────────────────
  const modal = document.getElementById("route-modal");
  document.getElementById("btn-open-route-planner").addEventListener("click", () => {
    modal.classList.add("open");
    evaluateSelectedRoute();
  });
  document.getElementById("btn-close-modal").addEventListener("click", () => modal.classList.remove("open"));

  const ROUTE_DATA = {
    meg: { name: "Guwahati → Shillong → Cherrapunji (NH-6 / NH-106)", legs: [
      { segment_name: "Guwahati–Shillong Highway", prediction: predictCloudMLRisk(PRESET_STATIONS[5]), road_status: "clear" },
      { segment_name: "Shillong–Cherrapunji Stretch", prediction: predictCloudMLRisk(PRESET_STATIONS[0]), road_status: "partial" }
    ]},
    sik: { name: "Siliguri → Gangtok → North Sikkim (NH-10)", legs: [
      { segment_name: "Siliguri–Darjeeling Bypass", prediction: predictCloudMLRisk(PRESET_STATIONS[6]), road_status: "clear" },
      { segment_name: "Gangtok–Mangan Highway", prediction: predictCloudMLRisk(PRESET_STATIONS[2]), road_status: "blocked" }
    ]},
    utt: { name: "Rishikesh → Chamoli → Joshimath (NH-7)", legs: [
      { segment_name: "Rishikesh–Devprayag Stretch", prediction: predictCloudMLRisk(PRESET_STATIONS[4]), road_status: "clear" },
      { segment_name: "Joshimath Slope Corridor", prediction: predictCloudMLRisk(PRESET_STATIONS[3]), road_status: "blocked" }
    ]},
    ker: { name: "Kozhikode → Wayanad Ghat Pass (NH-766)", legs: [
      { segment_name: "Thamarassery Churam Pass", prediction: predictCloudMLRisk(PRESET_STATIONS[7]), road_status: "blocked" }
    ]}
  };

  function evaluateSelectedRoute() {
    const routeKey = document.getElementById("select-route-corridor").value;
    const routeInfo = ROUTE_DATA[routeKey];
    const assessment = assessRouteRisk(routeInfo.name, routeInfo.legs);
    document.getElementById("route-name-title").innerText = routeInfo.name;
    const badge = document.getElementById("route-verdict-badge");
    badge.innerText = assessment.verdict.label;
    badge.className = `risk-badge ${assessment.verdict.class}`;
    document.getElementById("route-advisory-desc").innerText = assessment.advisory_text;
    const legsContainer = document.getElementById("route-legs-container");
    legsContainer.innerHTML = "";
    assessment.legs.forEach(leg => {
      const legDiv = document.createElement("div");
      legDiv.style.cssText = "background:rgba(255,255,255,0.03);border:1px solid var(--border-color);padding:10px;border-radius:6px;font-size:12px;display:flex;justify-content:space-between;align-items:center;";
      legDiv.innerHTML = `<div>
        <strong style="color:#fff;">${leg.segment_name}</strong>
        <div style="font-size:11px;color:var(--text-muted);">Road Status: ${leg.road_status.toUpperCase()}</div>
      </div>
      <span class="risk-badge badge-${leg.prediction.risk_class.toLowerCase()}">${leg.prediction.risk_class}</span>`;
      legsContainer.appendChild(legDiv);
    });
  }
  document.getElementById("select-route-corridor").addEventListener("change", evaluateSelectedRoute);

  document.getElementById("btn-sim-alert").addEventListener("click", () => {
    const pred = predictCloudMLRisk(currentStation);
    const alertData = buildAlert(pred, document.getElementById("select-alert-lang").value) || {
      message: `TEST ALERT: Risk in ${currentStation.district} is ${pred.risk_class}. All systems operational.`
    };
    alert(`[ISRO BHUVAN EMERGENCY SMS BROADCAST]\n\n${alertData.message}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FROM → TO  JOURNEY INTELLIGENCE PLANNER
  // ═══════════════════════════════════════════════════════════════════════════

  // Full NE India location database for autocomplete
  const LOCATION_DATABASE = [
    // Meghalaya
    { name: "Shillong", state: "Meghalaya", lat: 25.5788, lon: 91.8933 },
    { name: "Cherrapunji (Sohra)", state: "Meghalaya", lat: 25.2789, lon: 91.7325 },
    { name: "Tura", state: "Meghalaya", lat: 25.5141, lon: 90.2032 },
    { name: "Nongpoh", state: "Meghalaya", lat: 25.9038, lon: 91.8810 },
    { name: "Jowai", state: "Meghalaya", lat: 25.4498, lon: 92.2069 },
    { name: "Guwahati", state: "Assam", lat: 26.1445, lon: 91.7362 },
    // Assam
    { name: "Haflong", state: "Assam", lat: 25.1764, lon: 93.0183 },
    { name: "Diphu", state: "Assam", lat: 25.8450, lon: 93.4350 },
    { name: "Silchar", state: "Assam", lat: 24.8333, lon: 92.7789 },
    { name: "Dibrugarh", state: "Assam", lat: 27.4728, lon: 94.9120 },
    { name: "Jorhat", state: "Assam", lat: 26.7465, lon: 94.2026 },
    // Sikkim
    { name: "Gangtok", state: "Sikkim", lat: 27.3389, lon: 88.6065 },
    { name: "Mangan (North Sikkim)", state: "Sikkim", lat: 27.5029, lon: 88.5350 },
    { name: "Namchi", state: "Sikkim", lat: 27.1667, lon: 88.3667 },
    { name: "Gyalshing", state: "Sikkim", lat: 27.2965, lon: 88.2622 },
    // Mizoram
    { name: "Aizawl", state: "Mizoram", lat: 23.7271, lon: 92.7176 },
    { name: "Lunglei", state: "Mizoram", lat: 22.8878, lon: 92.7366 },
    { name: "Champhai", state: "Mizoram", lat: 23.4681, lon: 93.3233 },
    // Arunachal Pradesh
    { name: "Tawang", state: "Arunachal Pradesh", lat: 27.5860, lon: 91.8594 },
    { name: "Dirang", state: "Arunachal Pradesh", lat: 27.3590, lon: 92.2350 },
    { name: "Itanagar", state: "Arunachal Pradesh", lat: 27.0844, lon: 93.6053 },
    { name: "Pasighat", state: "Arunachal Pradesh", lat: 28.0660, lon: 95.3256 },
    // Nagaland
    { name: "Kohima", state: "Nagaland", lat: 25.6751, lon: 94.1086 },
    { name: "Dimapur", state: "Nagaland", lat: 25.9045, lon: 93.7252 },
    { name: "Mokokchung", state: "Nagaland", lat: 26.3267, lon: 94.5139 },
    // Manipur
    { name: "Ukhrul", state: "Manipur", lat: 25.1120, lon: 94.3600 },
    { name: "Imphal", state: "Manipur", lat: 24.8170, lon: 93.9368 },
    { name: "Senapati", state: "Manipur", lat: 25.2642, lon: 93.9779 },
    // Tripura
    { name: "Agartala", state: "Tripura", lat: 23.8315, lon: 91.2868 },
    { name: "Ambassa", state: "Tripura", lat: 23.9200, lon: 91.8500 },
    // West Bengal (Himalayan)
    { name: "Darjeeling", state: "West Bengal", lat: 27.0410, lon: 88.2663 },
    { name: "Siliguri", state: "West Bengal", lat: 26.7271, lon: 88.3953 },
    { name: "Kalimpong", state: "West Bengal", lat: 27.0662, lon: 88.4685 },
    // Uttarakhand
    { name: "Joshimath", state: "Uttarakhand", lat: 30.5564, lon: 79.5658 },
    { name: "Rishikesh", state: "Uttarakhand", lat: 30.0869, lon: 78.2676 },
    { name: "Chamoli", state: "Uttarakhand", lat: 30.4037, lon: 79.3393 },
    { name: "Kedarnath", state: "Uttarakhand", lat: 30.7352, lon: 79.0669 },
    // Kerala
    { name: "Wayanad (Meppadi)", state: "Kerala", lat: 11.5510, lon: 76.1260 },
    { name: "Kozhikode", state: "Kerala", lat: 11.2588, lon: 75.7804 },
    // Himachal Pradesh
    { name: "Shimla", state: "Himachal Pradesh", lat: 31.1048, lon: 77.1734 },
    { name: "Manali", state: "Himachal Pradesh", lat: 32.2396, lon: 77.1887 }
  ];

  // Segment-level road intelligence (simulated real-world data)
  const SEGMENT_INTEL = [
    {
      from_keys: ["shillong", "nongpoh", "guwahati"],
      to_keys: ["shillong", "nongpoh", "guwahati"],
      name: "Guwahati–Shillong Corridor (NH-6)",
      coords: [[26.1445, 91.7362], [25.9038, 91.8810], [25.5788, 91.8933]],
      road_status: "clear", under_construction: false,
      traffic_level: "moderate", distance_km: 105, duration_min: 120,
      station_idx: 5
    },
    {
      from_keys: ["shillong", "cherrapunji", "sohra"],
      to_keys: ["shillong", "cherrapunji", "sohra"],
      name: "Shillong–Cherrapunji (NH-106)",
      coords: [[25.5788, 91.8933], [25.2789, 91.7325]],
      road_status: "partial", under_construction: false,
      traffic_level: "low", distance_km: 56, duration_min: 80,
      station_idx: 0
    },
    {
      from_keys: ["siliguri", "darjeeling", "kalimpong"],
      to_keys: ["siliguri", "darjeeling", "gangtok", "kalimpong"],
      name: "Siliguri–Darjeeling Corridor (NH-55)",
      coords: [[26.7271, 88.3953], [27.0410, 88.2663]],
      road_status: "clear", under_construction: false,
      traffic_level: "high", distance_km: 74, duration_min: 180,
      station_idx: 6
    },
    {
      from_keys: ["gangtok", "mangan", "north sikkim"],
      to_keys: ["gangtok", "mangan", "north sikkim"],
      name: "Gangtok–North Sikkim (NH-10)",
      coords: [[27.3389, 88.6065], [27.5029, 88.5350]],
      road_status: "blocked", under_construction: true,
      traffic_level: "low", distance_km: 64, duration_min: 200,
      station_idx: 2
    },
    {
      from_keys: ["rishikesh", "joshimath", "chamoli", "kedarnath"],
      to_keys: ["rishikesh", "joshimath", "chamoli", "kedarnath"],
      name: "Rishikesh–Joshimath Corridor (NH-7)",
      coords: [[30.0869, 78.2676], [30.4037, 79.3393], [30.5564, 79.5658]],
      road_status: "blocked", under_construction: false,
      traffic_level: "low", distance_km: 253, duration_min: 480,
      station_idx: 3
    },
    {
      from_keys: ["kozhikode", "wayanad", "meppadi"],
      to_keys: ["kozhikode", "wayanad", "meppadi"],
      name: "Kozhikode–Wayanad Ghat (NH-766)",
      coords: [[11.2588, 75.7804], [11.5510, 76.1260]],
      road_status: "blocked", under_construction: false,
      traffic_level: "low", distance_km: 70, duration_min: 150,
      station_idx: 7
    },
    {
      from_keys: ["haflong", "diphu", "dima hasao", "karbi"],
      to_keys: ["haflong", "diphu", "dima hasao", "karbi", "guwahati", "silchar"],
      name: "Haflong–Diphu Hill Corridor (NH-27)",
      coords: [[25.1764, 93.0183], [25.8450, 93.4350]],
      road_status: "partial", under_construction: true,
      traffic_level: "low", distance_km: 120, duration_min: 180,
      station_idx: 8
    },
    {
      from_keys: ["kohima", "imphal", "ukhrul"],
      to_keys: ["kohima", "imphal", "ukhrul", "senapati"],
      name: "Kohima–Imphal Corridor (NH-2)",
      coords: [[25.6751, 94.1086], [25.1120, 94.3600], [24.8170, 93.9368]],
      road_status: "partial", under_construction: false,
      traffic_level: "moderate", distance_km: 140, duration_min: 200,
      station_idx: 10
    },
    {
      from_keys: ["aizawl", "lunglei"],
      to_keys: ["aizawl", "lunglei", "champhai"],
      name: "Aizawl–Lunglei Highway (NH-54)",
      coords: [[23.7271, 92.7176], [22.8878, 92.7366]],
      road_status: "clear", under_construction: false,
      traffic_level: "low", distance_km: 170, duration_min: 240,
      station_idx: 4
    },
    {
      from_keys: ["tawang", "dirang", "bomdila"],
      to_keys: ["tawang", "dirang", "bomdila", "arunachal"],
      name: "Tawang–Dirang Sela Pass Corridor",
      coords: [[27.5860, 91.8594], [27.3590, 92.2350]],
      road_status: "partial", under_construction: false,
      traffic_level: "low", distance_km: 80, duration_min: 180,
      station_idx: 9
    }
  ];

  // ── AUTOCOMPLETE LOGIC ────────────────────────────────────────────────────
  function setupAutocomplete(inputId, dropdownId, onSelect) {
    const input = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);
    input.addEventListener("input", () => {
      const q = input.value.toLowerCase().trim();
      dropdown.innerHTML = "";
      if (q.length < 2) { dropdown.style.display = "none"; return; }
      const matches = LOCATION_DATABASE.filter(loc =>
        loc.name.toLowerCase().includes(q) || loc.state.toLowerCase().includes(q)
      ).slice(0, 8);
      if (!matches.length) { dropdown.style.display = "none"; return; }
      matches.forEach(loc => {
        const item = document.createElement("div");
        item.className = "autocomplete-item";
        item.innerHTML = `<span class="ac-name">${loc.name}</span><span class="ac-state">${loc.state}</span>`;
        item.addEventListener("click", () => {
          input.value = loc.name;
          dropdown.style.display = "none";
          onSelect(loc);
        });
        dropdown.appendChild(item);
      });
      dropdown.style.display = "block";
    });
    document.addEventListener("click", e => {
      if (!input.contains(e.target) && !dropdown.contains(e.target)) dropdown.style.display = "none";
    });
  }

  let fromLocation = null, toLocation = null;
  setupAutocomplete("journey-from", "from-dropdown", loc => { fromLocation = loc; });
  setupAutocomplete("journey-to", "to-dropdown", loc => { toLocation = loc; });

  // ── JOURNEY ROUTE FINDER ──────────────────────────────────────────────────
  function findRelevantSegments(from, to) {
    const fromKey = from.name.toLowerCase();
    const toKey = to.name.toLowerCase();
    return SEGMENT_INTEL.filter(seg =>
      seg.from_keys.some(k => fromKey.includes(k) || k.includes(fromKey)) ||
      seg.to_keys.some(k => toKey.includes(k) || k.includes(toKey)) ||
      seg.from_keys.some(k => toKey.includes(k)) ||
      seg.to_keys.some(k => fromKey.includes(k))
    );
  }

  function getTrafficColor(level) {
    return { low: "#10b981", moderate: "#f59e0b", high: "#ef4444", severe: "#7c3aed" }[level] || "#9ca3af";
  }
  function getTrafficLabel(level) {
    return { low: "🟢 Light Traffic", moderate: "🟡 Moderate Traffic", high: "🔴 Heavy Traffic", severe: "🟣 Severe Congestion" }[level] || "⚪ Unknown";
  }
  function getRoadStatusIcon(status) {
    return { clear: "✅ Road Open", partial: "⚠️ Partial Restriction", blocked: "🚫 Road Blocked" }[status] || "❓";
  }
  function getRoadStatusColor(status) {
    return { clear: "var(--risk-low)", partial: "var(--risk-moderate)", blocked: "var(--risk-critical)" }[status] || "#9ca3af";
  }

  function buildRouteOnMap(segments, fromLoc, toLoc) {
    if (routeLayerGroup) map.removeLayer(routeLayerGroup);
    routeLayerGroup = L.layerGroup().addTo(map);

    // Animate route line for each segment
    segments.forEach(seg => {
      const pred = predictCloudMLRisk(PRESET_STATIONS[seg.station_idx]);
      const riskColor = RISK_COLORS[pred.risk_class];
      const roadColor = seg.road_status === "blocked" ? "#ef4444" : seg.road_status === "partial" ? "#f59e0b" : riskColor;
      L.polyline(seg.coords, { color: roadColor, weight: 6, opacity: 0.9, dashArray: seg.road_status === "blocked" ? "8,6" : null })
        .addTo(routeLayerGroup);
    });

    // FROM marker (green)
    L.marker([fromLoc.lat, fromLoc.lon], {
      icon: L.divIcon({ className: "", html: `<div class="journey-pin pin-from">A</div>`, iconSize: [32, 32], iconAnchor: [16, 16] })
    }).addTo(routeLayerGroup);

    // TO marker (red)
    L.marker([toLoc.lat, toLoc.lon], {
      icon: L.divIcon({ className: "", html: `<div class="journey-pin pin-to">B</div>`, iconSize: [32, 32], iconAnchor: [16, 16] })
    }).addTo(routeLayerGroup);

    // Fit map to show entire route
    const allCoords = segments.flatMap(s => s.coords).concat([[fromLoc.lat, fromLoc.lon], [toLoc.lat, toLoc.lon]]);
    map.fitBounds(allCoords, { padding: [60, 60] });
  }

  function evaluateJourney() {
    if (!fromLocation || !toLocation) {
      showJourneyError("Please select both a FROM and TO location.");
      return;
    }
    if (fromLocation.name === toLocation.name) {
      showJourneyError("Origin and destination cannot be the same.");
      return;
    }

    const segments = findRelevantSegments(fromLocation, toLocation);
    const resultsPanel = document.getElementById("journey-results-panel");

    // If no matching segments, generate synthetic route analysis from the nearest station
    const activeSegments = segments.length > 0 ? segments : [{
      name: `${fromLocation.name} → ${toLocation.name} Route`,
      coords: [[fromLocation.lat, fromLocation.lon], [toLocation.lat, toLocation.lon]],
      road_status: "clear", under_construction: false,
      traffic_level: "moderate", distance_km: Math.round(haversineKm(fromLocation, toLocation)),
      duration_min: Math.round(haversineKm(fromLocation, toLocation) * 1.5),
      station_idx: 0
    }];

    // Build route on map
    buildRouteOnMap(activeSegments, fromLocation, toLocation);

    // Compute overall risk across all segments
    const segmentResults = activeSegments.map(seg => {
      const st = PRESET_STATIONS[seg.station_idx];
      const pred = predictCloudMLRisk(st);
      return { seg, pred, st };
    });
    const worstRisk = segmentResults.reduce((worst, cur) => {
      const w = { LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 };
      return w[cur.pred.risk_class] > w[worst.pred.risk_class] ? cur : worst;
    }, segmentResults[0]);

    const hasBlocked = activeSegments.some(s => s.road_status === "blocked");
    const hasConstruction = activeSegments.some(s => s.under_construction);
    const totalDist = activeSegments.reduce((s, seg) => s + (seg.distance_km || 0), 0);
    const totalTime = activeSegments.reduce((s, seg) => s + (seg.duration_min || 0), 0);
    const overallRisk = worstRisk.pred.risk_class;

    const VERDICT_LABELS = {
      LOW: { text: "✅ SAFE TO TRAVEL", color: "var(--risk-low)" },
      MODERATE: { text: "⚠️ TRAVEL WITH CAUTION", color: "var(--risk-moderate)" },
      HIGH: { text: "🔶 AVOID UNLESS NECESSARY", color: "var(--risk-high)" },
      CRITICAL: { text: "🚫 AVOID — HIGH DANGER", color: "var(--risk-critical)" }
    };
    const verdict = VERDICT_LABELS[overallRisk];

    // Render results
    resultsPanel.style.display = "block";
    document.getElementById("journey-verdict-text").innerText = verdict.text;
    document.getElementById("journey-verdict-text").style.color = verdict.color;
    document.getElementById("journey-from-label").innerText = fromLocation.name;
    document.getElementById("journey-to-label").innerText = toLocation.name;
    document.getElementById("journey-dist").innerText = totalDist > 0 ? `~${totalDist} km` : "N/A";
    document.getElementById("journey-time").innerText = totalDist > 0 ? `~${Math.round(totalTime / 60)}h ${totalTime % 60}m` : "N/A";

    // Summary flags
    const flagsEl = document.getElementById("journey-flags");
    flagsEl.innerHTML = "";
    const flags = [];
    if (hasBlocked) flags.push({ icon: "🚫", label: "Road Blocked Segment", color: "#ef4444" });
    if (hasConstruction) flags.push({ icon: "🚧", label: "Under Construction", color: "#f59e0b" });
    if (overallRisk === "CRITICAL" || overallRisk === "HIGH") flags.push({ icon: "⛰️", label: "Landslide Risk Zone", color: "#f97316" });
    const anyLandslide = segmentResults.some(r => r.st.historical_incidents_5y >= 2);
    if (anyLandslide) flags.push({ icon: "📍", label: "Past Landslide Reported", color: "#ef4444" });
    flags.forEach(f => {
      const span = document.createElement("div");
      span.className = "journey-flag";
      span.style.borderColor = f.color;
      span.innerHTML = `${f.icon} ${f.label}`;
      flagsEl.appendChild(span);
    });

    // Per-segment breakdown
    const segsEl = document.getElementById("journey-segments");
    segsEl.innerHTML = "";
    segmentResults.forEach(({ seg, pred, st }) => {
      const segDiv = document.createElement("div");
      segDiv.className = "journey-segment-card";
      segDiv.innerHTML = `
        <div class="jsc-name">${seg.name}</div>
        <div class="jsc-grid">
          <div class="jsc-item"><span class="jsc-label">Risk Level</span>
            <span class="risk-badge badge-${pred.risk_class.toLowerCase()}">${pred.risk_class}</span></div>
          <div class="jsc-item"><span class="jsc-label">Road Status</span>
            <span style="color:${getRoadStatusColor(seg.road_status)};font-weight:600;">${getRoadStatusIcon(seg.road_status)}</span></div>
          <div class="jsc-item"><span class="jsc-label">Traffic</span>
            <span style="color:${getTrafficColor(seg.traffic_level)};font-weight:600;">${getTrafficLabel(seg.traffic_level)}</span></div>
          <div class="jsc-item"><span class="jsc-label">Construction</span>
            <span>${seg.under_construction ? "🚧 Yes" : "✅ None"}</span></div>
          <div class="jsc-item"><span class="jsc-label">Distance</span>
            <span>${seg.distance_km || "?"} km</span></div>
          <div class="jsc-item"><span class="jsc-label">Est. Time</span>
            <span>${seg.duration_min ? Math.round(seg.duration_min / 60) + "h " + seg.duration_min % 60 + "m" : "?"}</span></div>
          <div class="jsc-item" style="grid-column:span 2;"><span class="jsc-label">Landslide Incidents (5yr)</span>
            <span style="color:${st.historical_incidents_5y >= 2 ? "var(--risk-critical)" : "var(--risk-low)"};">
              ${st.historical_incidents_5y === 0 ? "✅ None reported" : "⚠️ " + st.historical_incidents_5y + " incident(s)"}</span></div>
          <div class="jsc-item" style="grid-column:span 2;"><span class="jsc-label">Soil Saturation / Slope</span>
            <span>${st.soil_moisture_pct}% saturation · ${st.slope_angle_deg}° slope</span></div>
        </div>`;
      segsEl.appendChild(segDiv);
    });

    // Safest route advisory text
    document.getElementById("journey-advisory").innerText = generateJourneyAdvisory(overallRisk, fromLocation, toLocation, hasBlocked, hasConstruction);
  }

  function haversineKm(a, b) {
    const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lon - a.lon) * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function generateJourneyAdvisory(riskClass, from, to, hasBlocked, hasConstruction) {
    let base = `Journey Analysis: ${from.name} → ${to.name}. `;
    if (riskClass === "CRITICAL") return base + "⛔ This route passes through critical landslide zones. Do NOT travel without consulting local disaster management authorities. Explore alternate routes.";
    if (riskClass === "HIGH") {
      let msg = base + "🔶 High landslide risk detected on one or more segments.";
      if (hasBlocked) msg += " A road section is currently blocked — expect significant delays or impassable stretches.";
      return msg + " Travel only if absolutely necessary and monitor ISRO Bhuvan satellite alerts.";
    }
    if (riskClass === "MODERATE") {
      let msg = base + "⚠️ Moderate risk — road is passable but conditions may change quickly.";
      if (hasConstruction) msg += " Active road construction in one or more sections.";
      return msg + " Check weather and sensor alerts before departure.";
    }
    return base + "✅ Route is currently safe with low landslide hazard. Standard road safety guidelines apply. Recheck alerts if heavy rainfall is forecast.";
  }

  function showJourneyError(msg) {
    const panel = document.getElementById("journey-results-panel");
    panel.style.display = "block";
    panel.innerHTML = `<div style="color:var(--risk-high);padding:12px;text-align:center;font-weight:600;">${msg}</div>`;
  }

  function clearJourney() {
    fromLocation = null; toLocation = null;
    document.getElementById("journey-from").value = "";
    document.getElementById("journey-to").value = "";
    document.getElementById("journey-results-panel").style.display = "none";
    if (routeLayerGroup) { map.removeLayer(routeLayerGroup); routeLayerGroup = null; }
  }

  document.getElementById("btn-find-route").addEventListener("click", evaluateJourney);
  document.getElementById("btn-clear-route").addEventListener("click", clearJourney);

  // Swap From ↔ To
  document.getElementById("btn-swap-journey").addEventListener("click", () => {
    const tmp = fromLocation;
    fromLocation = toLocation;
    toLocation = tmp;
    document.getElementById("journey-from").value = fromLocation ? fromLocation.name : "";
    document.getElementById("journey-to").value = toLocation ? toLocation.name : "";
  });

  // ── CHARTS ─────────────────────────────────────────────────────────────────
  const ctx1 = document.getElementById("chart-feature-importance").getContext("2d");
  new Chart(ctx1, {
    type: "bar",
    data: { labels: ["72h Rain", "Intensity", "Soil Moisture", "Slope Angle", "NDVI", "History"],
      datasets: [{ label: "Importance Weight", data: [0.35, 0.22, 0.18, 0.12, 0.08, 0.05], backgroundColor: "#00e5ff" }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { ticks: { color: "#9ca3af", font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: "#9ca3af", font: { size: 10 } }, grid: { color: "rgba(255,255,255,0.05)" } } } }
  });

  const ctx2 = document.getElementById("chart-rainfall-moisture").getContext("2d");
  new Chart(ctx2, {
    type: "line",
    data: { labels: ["0mm", "50mm", "100mm", "180mm", "250mm", "350mm"],
      datasets: [{ label: "Soil Saturation %", data: [20, 45, 60, 78, 88, 96],
        borderColor: "#f59e0b", backgroundColor: "rgba(245,158,11,0.1)", fill: true, tension: 0.3 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { ticks: { color: "#9ca3af", font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: "#9ca3af", font: { size: 10 } }, grid: { color: "rgba(255,255,255,0.05)" } } } }
  });

  selectStation(PRESET_STATIONS[0]);

  // ═══════════════════════════════════════════════════════════════════════════
  // FIELD REPORTING — REAL-TIME PHOTO UPLOAD MODULE
  // ═══════════════════════════════════════════════════════════════════════════

  // Photo markers layer on map
  const photoMarkersGroup = L.layerGroup().addTo(map);

  // Gradient palettes for demo cards (used as placeholder backgrounds)
  const CARD_GRADIENTS = [
    "linear-gradient(135deg, #c0392b, #8e44ad)",
    "linear-gradient(135deg, #1a6b6b, #0d9488)",
    "linear-gradient(135deg, #1e3a5f, #2563eb)",
    "linear-gradient(135deg, #7c5a00, #d97706)",
    "linear-gradient(135deg, #1a6b6b, #059669)",
    "linear-gradient(135deg, #1e3a5f, #0891b2)"
  ];

  // Seed demo field reports with user-provided images
  const fieldReports = [
    { id: "fr-1", location: "Sohra Rd, Meghalaya", riskLevel: "CRITICAL", notes: "Active slope movement observed. Water seeping through road crack.", time: "12 min ago", imgSrc: "assets/reports/report1.jpg", lat: 25.28, lon: 91.73, pending: true },
    { id: "fr-2", location: "NH-27, Dima Hasao", riskLevel: "HIGH", notes: "Boulder debris on roadway. Emergency response team deployed with excavators.", time: "48 min ago", imgSrc: "assets/reports/report2.jpg", lat: 25.18, lon: 93.02, pending: false },
    { id: "fr-3", location: "Mangan, Sikkim", riskLevel: "MODERATE", notes: "Coastal/cliff slope erosion observed near coastal access road.", time: "2 hr ago", imgSrc: "assets/reports/report3.jpg", lat: 27.50, lon: 88.54, pending: false },
    { id: "fr-4", location: "Kohima Bypass", riskLevel: "HIGH", notes: "Massive mudslide accumulation across hillside village route.", time: "3 hr ago", imgSrc: "assets/reports/report4.jpg", lat: 25.68, lon: 94.11, pending: true },
    { id: "fr-5", location: "Aizawl-Lunglei Rd", riskLevel: "MODERATE", notes: "Rockfall debris blocking highway lane. Net netting under strain.", time: "5 hr ago", imgSrc: "assets/reports/report5.jpg", lat: 23.73, lon: 92.72, pending: false },
    { id: "fr-6", location: "Dhalai river bank", riskLevel: "LOW", notes: "Severe rockfall and landslide debris on mountain roadway.", time: "6 hr ago", imgSrc: "assets/reports/report6.jpg", lat: 23.83, lon: 91.29, pending: false }
  ];

  const RISK_BADGE_STYLES = {
    LOW: "background:rgba(16,185,129,0.85);color:#fff;",
    MODERATE: "background:rgba(245,158,11,0.85);color:#000;",
    HIGH: "background:rgba(249,115,22,0.85);color:#fff;",
    CRITICAL: "background:rgba(239,68,68,0.9);color:#fff;"
  };

  function getTimeAgo(ms) {
    const secs = Math.floor((Date.now() - ms) / 1000);
    if (secs < 60) return `${secs} sec ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins} min ago`;
    return `${Math.floor(mins / 60)} hr ago`;
  }

  function renderFieldReportsGallery() {
    const gallery = document.getElementById("field-reports-gallery");
    const countBadge = document.getElementById("report-count-badge");
    gallery.innerHTML = "";
    countBadge.textContent = `${fieldReports.length} REPORTS`;

    fieldReports.forEach(report => {
      const card = document.createElement("div");
      card.className = "field-report-card";
      card.id = `card-${report.id}`;

      const imgHTML = report.imgSrc
        ? `<img class="field-report-img" src="${report.imgSrc}" alt="${report.location}">`
        : `<div class="field-report-img-placeholder" style="background:${report.gradient};">
             <span style="font-size:22px;">📷</span>
             <span>${report.location.split(",")[0]}</span>
           </div>`;

      const pendingDot = report.pending
        ? `<div class="field-report-pending-dot" title="Pending verification"></div>` : "";

      card.innerHTML = `
        ${imgHTML}
        ${pendingDot}
        <div class="field-report-badge" style="${RISK_BADGE_STYLES[report.riskLevel]}">${report.riskLevel}</div>
        <div class="field-report-meta">
          <div class="field-report-location">${report.location}</div>
          <div class="field-report-time">${report.time}</div>
        </div>`;

      card.addEventListener("click", () => openLightbox(report));
      gallery.appendChild(card);
    });
  }

  // Place demo markers on map
  function renderPhotoMarkersOnMap() {
    photoMarkersGroup.clearLayers();
    fieldReports.forEach(r => {
      if (r.lat && r.lon) {
        const icon = L.divIcon({
          className: "",
          html: `<div class="photo-map-marker" title="${r.location}">📷</div>`,
          iconSize: [28, 28], iconAnchor: [14, 14]
        });
        const marker = L.marker([r.lat, r.lon], { icon });
        marker.bindPopup(`<div style="font-family:'Outfit';font-size:12px;min-width:160px;">
          <div style="font-weight:800;color:#1e3a8a;margin-bottom:4px;">📷 Field Report</div>
          <div style="font-weight:600;">${r.location}</div>
          <div style="color:#666;font-size:11px;">${r.time}</div>
          <div style="margin-top:4px;font-size:11px;color:${r.riskLevel==="CRITICAL"?"#dc2626":r.riskLevel==="HIGH"?"#ea580c":r.riskLevel==="MODERATE"?"#d97706":"#059669"};font-weight:700;">${r.riskLevel} RISK</div>
        </div>`);
        marker.addTo(photoMarkersGroup);
      }
    });
  }

  renderFieldReportsGallery();
  renderPhotoMarkersOnMap();

  // ── LIGHTBOX ─────────────────────────────────────────────────────────────
  const lightboxModal = document.getElementById("photo-lightbox-modal");
  document.getElementById("btn-close-lightbox").addEventListener("click", () => lightboxModal.classList.remove("open"));
  lightboxModal.addEventListener("click", e => { if (e.target === lightboxModal) lightboxModal.classList.remove("open"); });

  function openLightbox(report) {
    document.getElementById("lightbox-img").src = report.imgSrc || "";
    document.getElementById("lightbox-img").style.display = report.imgSrc ? "block" : "none";
    document.getElementById("lightbox-meta").innerHTML = `
      <div style="background:rgba(255,255,255,0.04);border:1px solid var(--border-color);border-radius:6px;padding:8px;">
        📍 Location<br><strong style="color:#fff;">${report.location}</strong>
      </div>
      <div style="background:rgba(255,255,255,0.04);border:1px solid var(--border-color);border-radius:6px;padding:8px;">
        ⚠️ Risk Level<br><strong style="${RISK_BADGE_STYLES[report.riskLevel].replace('background:','color:').split(';')[0]}">${report.riskLevel}</strong>
      </div>
      <div style="background:rgba(255,255,255,0.04);border:1px solid var(--border-color);border-radius:6px;padding:8px;">
        ⏱️ Reported<br><strong style="color:#fff;">${report.time}</strong>
      </div>
      <div style="background:rgba(255,255,255,0.04);border:1px solid var(--border-color);border-radius:6px;padding:8px;">
        🔖 Status<br><strong style="color:${report.pending?"var(--accent-gold)":"var(--risk-low)"};">${report.pending?"Pending Verification":"Verified"}</strong>
      </div>`;
    document.getElementById("lightbox-notes").innerHTML = report.notes
      ? `<strong style="color:var(--text-muted);font-size:11px;">FIELD NOTES</strong><br>${report.notes}` : "";
    lightboxModal.classList.add("open");
  }

  // ── DRAG & DROP UPLOAD ZONE ───────────────────────────────────────────────
  let stagedFiles = []; // Array of { file, dataUrl }

  const dropzone = document.getElementById("photo-dropzone");
  const fileInput = document.getElementById("photo-file-input");
  const cameraInput = document.getElementById("photo-camera-input");
  const metaForm = document.getElementById("photo-meta-form");
  const stagingDiv = document.getElementById("photo-preview-staging");
  const previewGrid = document.getElementById("photo-preview-grid");

  dropzone.addEventListener("dragover", e => { e.preventDefault(); dropzone.classList.add("drag-over"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag-over"));
  dropzone.addEventListener("drop", e => {
    e.preventDefault();
    dropzone.classList.remove("drag-over");
    handleFiles([...e.dataTransfer.files]);
  });
  dropzone.addEventListener("click", e => {
    if (!e.target.closest(".upload-btn-label") && !e.target.closest(".upload-btn-camera")) {
      fileInput.click();
    }
  });

  fileInput.addEventListener("change", () => handleFiles([...fileInput.files]));
  cameraInput.addEventListener("change", () => handleFiles([...cameraInput.files]));
  document.getElementById("btn-camera-capture").addEventListener("click", e => {
    e.stopPropagation();
    cameraInput.click();
  });

  function handleFiles(files) {
    const imageFiles = files.filter(f => f.type.startsWith("image/"));
    if (!imageFiles.length) return;
    imageFiles.forEach(file => {
      const reader = new FileReader();
      reader.onload = e => {
        stagedFiles.push({ file, dataUrl: e.target.result });
        renderStagingPreviews();
      };
      reader.readAsDataURL(file);
    });
    metaForm.style.display = "block";
    stagingDiv.style.display = "block";
  }

  function renderStagingPreviews() {
    previewGrid.innerHTML = "";
    stagedFiles.forEach((item, idx) => {
      const thumb = document.createElement("div");
      thumb.className = "photo-preview-thumb";
      thumb.innerHTML = `<img src="${item.dataUrl}" alt="Preview">
        <button class="photo-preview-remove" data-idx="${idx}" title="Remove">✕</button>`;
      previewGrid.appendChild(thumb);
    });
    previewGrid.querySelectorAll(".photo-preview-remove").forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation();
        stagedFiles.splice(parseInt(btn.dataset.idx), 1);
        if (stagedFiles.length === 0) {
          metaForm.style.display = "none";
          stagingDiv.style.display = "none";
        }
        renderStagingPreviews();
      });
    });
  }

  // ── SUBMIT FIELD REPORT ───────────────────────────────────────────────────
  document.getElementById("btn-submit-photo").addEventListener("click", () => {
    if (!stagedFiles.length) return;
    const location = document.getElementById("photo-location").value.trim() || "Unknown Location";
    const riskLevel = document.getElementById("photo-risk-level").value;
    const notes = document.getElementById("photo-notes").value.trim();

    // Pick location coords from nearest matching station
    const matchedStation = PRESET_STATIONS.find(st =>
      location.toLowerCase().includes(st.state.toLowerCase()) ||
      location.toLowerCase().includes(st.district.toLowerCase().split(" ")[0])
    ) || PRESET_STATIONS[Math.floor(Math.random() * PRESET_STATIONS.length)];

    // Add a report for the first uploaded image
    const newReport = {
      id: `fr-user-${Date.now()}`,
      location,
      riskLevel,
      notes,
      time: "just now",
      imgSrc: stagedFiles[0].dataUrl,
      gradient: CARD_GRADIENTS[0],
      lat: matchedStation.lat + (Math.random() - 0.5) * 0.05,
      lon: matchedStation.lon + (Math.random() - 0.5) * 0.05,
      pending: true
    };
    fieldReports.unshift(newReport);

    // Reset form
    stagedFiles = [];
    previewGrid.innerHTML = "";
    metaForm.style.display = "none";
    stagingDiv.style.display = "none";
    document.getElementById("photo-location").value = "";
    document.getElementById("photo-notes").value = "";
    document.getElementById("photo-risk-level").value = "MODERATE";
    fileInput.value = "";
    cameraInput.value = "";

    // Refresh gallery and map markers
    renderFieldReportsGallery();
    renderPhotoMarkersOnMap();

    // Fly to new marker
    map.flyTo([newReport.lat, newReport.lon], 10, { duration: 1.2 });

    // Show toast
    showToast(`✅ Field report submitted from ${location}`);
  });

  document.getElementById("btn-cancel-photo").addEventListener("click", () => {
    stagedFiles = [];
    previewGrid.innerHTML = "";
    metaForm.style.display = "none";
    stagingDiv.style.display = "none";
    fileInput.value = "";
    cameraInput.value = "";
  });

  // ── TOAST ──────────────────────────────────────────────────────────────────
  function showToast(msg) {
    let toast = document.getElementById("upload-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "upload-toast";
      toast.className = "upload-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 3200);
  }

});
