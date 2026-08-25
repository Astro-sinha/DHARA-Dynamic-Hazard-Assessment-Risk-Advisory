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
    const r72       = parseFloat(document.getElementById("slider-rain72").value);
    const intensity = parseFloat(document.getElementById("slider-intensity").value);
    const moisture  = parseFloat(document.getElementById("slider-moisture").value);
    const slope     = parseFloat(document.getElementById("slider-slope").value);
    const history   = parseInt(document.getElementById("slider-history").value);

    document.getElementById("val-rain72").innerText    = `${r72} mm`;
    document.getElementById("val-intensity").innerText = `${intensity} mm/h`;
    document.getElementById("val-moisture").innerText  = `${moisture} %`;
    document.getElementById("val-slope").innerText     = `${slope}°`;
    document.getElementById("val-history").innerText   = `${history} events`;

    const activeReading = {
      cell_id: currentStation.cell_id, district: currentStation.district,
      rainfall_24h_mm: Math.round(r72 * 0.4), rainfall_72h_mm: r72,
      rainfall_intensity_mmhr: intensity, soil_moisture_pct: moisture, slope_angle_deg: slope,
      ndvi: currentStation.ndvi, distance_to_road_m: currentStation.distance_to_road_m,
      historical_incidents_5y: history, soil_type_erodibility: currentStation.soil_type_erodibility
    };

    // ── Edge rule-based fallback (always computed instantly) ────────────────
    const edgePred = predictEdgeRuleBasedRisk(activeReading);
    const edgeResEl = document.getElementById("edge-rule-res");
    edgeResEl.innerText = edgePred.risk_class;
    edgeResEl.style.color = `var(--risk-${edgePred.risk_class.toLowerCase()})`;
    document.getElementById("edge-rule-score").innerText = `${edgePred.score} / 12`;

    // ── Try Flask ML first; fall back to local surrogate ───────────────────
    const flaskParams = {
      rainfall_72h_mm:         r72,
      rainfall_intensity_mmhr: intensity,
      soil_moisture_pct:       moisture,
      slope_angle_deg:         slope,
      historical_incidents_5y: history,
      elevation:               currentStation.elevation || 1000,
      lat:                     currentStation.lat,
      lon:                     currentStation.lon,
      cell_id:                 currentStation.cell_id,
      district:                currentStation.district,
    };

    if (window.FlaskML && window.FlaskML.isConnected) {
      window.FlaskML.predict(flaskParams).then(flaskResult => {
        if (flaskResult) {
          // Map Flask risk_level (Low/Medium/High) → UI risk class (LOW/MODERATE/HIGH/CRITICAL)
          const levelMap = { "Low": "LOW", "Medium": "MODERATE", "High": "HIGH", "Critical": "CRITICAL" };
          const riskClass = levelMap[flaskResult.risk_level] || flaskResult.risk_level.toUpperCase();
          const confidence = Math.max(...Object.values(flaskResult.class_probabilities || {}));

          document.getElementById("selected-cell-id").innerText = activeReading.cell_id;
          document.getElementById("selected-cell-district").innerText = activeReading.district;
          const badgeEl = document.getElementById("selected-risk-badge");
          badgeEl.innerText   = riskClass;
          badgeEl.className   = `risk-badge badge-${riskClass.toLowerCase()}`;
          const cloudResEl = document.getElementById("cloud-ml-res");
          cloudResEl.innerText    = riskClass;
          cloudResEl.style.color  = `var(--risk-${riskClass.toLowerCase()})`;
          document.getElementById("cloud-ml-conf").innerText = `${Math.round(confidence * 100)}%`;

          // Extra Flask UI updates (source label, probability bar)
          window.FlaskML.applyPredictionToUI(flaskResult);

          // Alert message using Flask prediction
          updateAlertMessage({ risk_class: riskClass, cell_id: activeReading.cell_id, district: activeReading.district });
        } else {
          _applyLocalPrediction(activeReading);
        }
      }).catch(() => _applyLocalPrediction(activeReading));
    } else {
      _applyLocalPrediction(activeReading);
    }
  }

  /** Fallback: use local risk_engine.js predictCloudMLRisk surrogate */
  function _applyLocalPrediction(activeReading) {
    const cloudPred = predictCloudMLRisk(activeReading);
    document.getElementById("selected-cell-id").innerText = activeReading.cell_id;
    document.getElementById("selected-cell-district").innerText = activeReading.district;
    const badgeEl = document.getElementById("selected-risk-badge");
    badgeEl.innerText = cloudPred.risk_class;
    badgeEl.className = `risk-badge badge-${cloudPred.risk_class.toLowerCase()}`;
    const cloudResEl = document.getElementById("cloud-ml-res");
    cloudResEl.innerText = cloudPred.risk_class;
    cloudResEl.style.color = `var(--risk-${cloudPred.risk_class.toLowerCase()})`;
    document.getElementById("cloud-ml-conf").innerText = `${Math.round(cloudPred.confidence * 100)}%`;
    const sourceEl = document.getElementById("flask-engine-source");
    if (sourceEl) { sourceEl.textContent = "Local Fallback (Offline)"; sourceEl.style.color = "#f59e0b"; }
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
  function renderStationsList(mlStations) {
    const container = document.getElementById("station-list-container");
    container.innerHTML = "";

    // If Flask provided enriched stations, use those; otherwise local
    const stationData = mlStations || PRESET_STATIONS;
    const levelMap = { "Low": "LOW", "Medium": "MODERATE", "High": "HIGH", "Critical": "CRITICAL" };

    stationData.forEach(st => {
      // Determine the risk class — could be from Flask (risk_level) or local model
      let riskClass, riskSource;
      if (st.risk_level) {
        riskClass  = levelMap[st.risk_level] || st.risk_level.toUpperCase();
        riskSource = "Flask ML";
      } else {
        const pred = predictCloudMLRisk(st);
        riskClass  = pred.risk_class;
        riskSource = "Local";
      }

      const div = document.createElement("div");
      div.className = "panel-card";
      div.style.cssText = "padding:10px 14px;margin:0;cursor:pointer;";
      div.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <div style="font-weight:700;font-size:13px;color:var(--primary-cyan);">${st.cell_id}</div>
          <div style="font-size:12px;font-weight:600;color:#fff;">${st.subdivision || st.district}</div>
          <div style="font-size:11px;color:var(--text-muted);">${st.district}, ${st.state}</div>
          <div style="font-size:10px;color:var(--text-dim);margin-top:2px;">${riskSource} Inference</div>
        </div>
        <span class="risk-badge badge-${riskClass.toLowerCase()}">${riskClass}</span>
      </div>`;
      div.addEventListener("click", () => {
        selectStation(st);
        document.querySelector('[data-tab="tab-predictor"]').click();
      });
      container.appendChild(div);
    });
  }

  // Initial local render; Flask-enriched render fires when Flask connects
  renderStationsList(null);

  // If Flask is available after initial load, re-render with live ML scores
  setTimeout(async () => {
    if (window.FlaskML && window.FlaskML.isConnected) {
      const stations = await window.FlaskML.getStations();
      if (stations) renderStationsList(stations);
    }
  }, 1500);

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

  // ── STATE DISASTER MANAGEMENT AUTHORITY (SDMA) DIRECTORY ─────────────────
  const STATE_SDMA_PORTALS = [
    { state: "Assam", title: "Assam State Disaster Management Authority (ASDMA)", url: "https://asdma.assam.gov.in/" },
    { state: "Sikkim", title: "Gangtok Municipal Corp / Sikkim SDMA", url: "https://gmc.sikkim.gov.in/" },
    { state: "Meghalaya", title: "Meghalaya State Disaster Management Authority", url: "https://msdma.gov.in/" },
    { state: "Uttarakhand", title: "Uttarakhand State Disaster Management Authority (USDMA)", url: "https://usdma.uk.gov.in/" },
    { state: "Kerala", title: "Kerala State Disaster Management Authority (KSDMA)", url: "https://ksdma.kerala.gov.in/" },
    { state: "Himachal Pradesh", title: "Himachal Pradesh SDMA Portal", url: "https://hpsdma.nic.in/" },
    { state: "Mizoram", title: "Mizoram Disaster Management & Rehabilitation", url: "https://dmr.mizoram.gov.in/" },
    { state: "Arunachal Pradesh", title: "Arunachal Pradesh Disaster Management Dept", url: "https://arunachalpradesh.gov.in/" },
    { state: "Nagaland", title: "Nagaland State Disaster Management Authority (NSDMA)", url: "https://nsdma.nagaland.gov.in/" },
    { state: "Manipur", title: "Manipur Relief & Disaster Management Department", url: "https://manipur.gov.in/" },
    { state: "West Bengal", title: "West Bengal Disaster Management & Civil Defence", url: "https://wbdmd.gov.in/" },
    { state: "Tripura", title: "Tripura State Disaster Management Authority", url: "https://tripura.gov.in/" }
  ];

  const smsModal = document.getElementById("sms-broadcast-modal");
  const btnCloseSmsModal = document.getElementById("btn-close-sms-modal");

  function renderStatePortalGrid() {
    const grid = document.getElementById("state-portal-grid");
    grid.innerHTML = "";
    STATE_SDMA_PORTALS.forEach(portal => {
      const card = document.createElement("a");
      card.className = "state-portal-card";
      card.href = portal.url;
      card.target = "_blank";
      card.rel = "noopener noreferrer";
      card.innerHTML = `
        <div>
          <div class="state-name">🏛️ ${portal.state}</div>
          <div class="portal-sub">${portal.title}</div>
        </div>
        <i data-lucide="external-link" class="external-icon" style="width:16px;height:16px;"></i>
      `;
      grid.appendChild(card);
    });
    if (window.lucide) window.lucide.createIcons();
  }
  renderStatePortalGrid();

  document.getElementById("btn-sim-alert").addEventListener("click", () => {
    const pred = predictCloudMLRisk(currentStation);
    const alertData = buildAlert(pred, document.getElementById("select-alert-lang").value) || {
      message: `ALERT: Risk level in ${currentStation.district} (${currentStation.cell_id}) is currently ${pred.risk_class}. Standard safety precautions apply.`
    };
    document.getElementById("modal-sms-preview-text").innerText = alertData.message;
    smsModal.classList.add("open");
  });

  btnCloseSmsModal.addEventListener("click", () => smsModal.classList.remove("open"));
  smsModal.addEventListener("click", e => { if (e.target === smsModal) smsModal.classList.remove("open"); });

  document.getElementById("btn-trigger-broadcast-toast").addEventListener("click", () => {
    smsModal.classList.remove("open");
    showToast("📡 Emergency SMS broadcast dispatched to all registered state cell towers.");
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

  // ── DYNAMIC GEONAMES / NOMINATIM GEOCODING (ALL CITIES, TOWNS, VILLAGES IN INDIA) ──
  let debounceTimers = {};

  function setupAutocomplete(inputId, dropdownId, onSelect) {
    const input = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);

    input.addEventListener("input", () => {
      const q = input.value.trim();
      if (debounceTimers[inputId]) clearTimeout(debounceTimers[inputId]);

      if (q.length < 2) {
        dropdown.style.display = "none";
        dropdown.innerHTML = "";
        return;
      }

      // First search local preset database immediately for instant response
      const localMatches = LOCATION_DATABASE.filter(loc =>
        loc.name.toLowerCase().includes(q.toLowerCase()) || loc.state.toLowerCase().includes(q.toLowerCase())
      ).slice(0, 5);

      renderDropdownItems(localMatches, dropdown, input, onSelect, "preset");

      // Debounce Nominatim API call (300ms) to fetch ANY village/city/landmark in India
      debounceTimers[inputId] = setTimeout(() => {
        fetch(`https://nominatim.openstreetmap.org/search?format=json&countrycodes=in&q=${encodeURIComponent(q)}&limit=8&addressdetails=1`)
          .then(res => res.json())
          .then(data => {
            if (!data || !data.length) return;
            const apiResults = data.map(item => {
              const addr = item.address || {};
              const placeName = addr.village || addr.suburb || addr.town || addr.city || addr.county || item.display_name.split(",")[0];
              const stateName = addr.state || addr.state_district || "India";
              const detailLabel = item.display_name;
              return {
                name: placeName,
                displayName: detailLabel,
                state: stateName,
                lat: parseFloat(item.lat),
                lon: parseFloat(item.lon),
                type: item.type || "location"
              };
            });
            renderDropdownItems(apiResults, dropdown, input, onSelect, "api");
          })
          .catch(() => {
            // Silently fall back to preset database if offline
          });
      }, 300);
    });

    document.addEventListener("click", e => {
      if (!input.contains(e.target) && !dropdown.contains(e.target)) dropdown.style.display = "none";
    });
  }

  function renderDropdownItems(items, dropdown, input, onSelect, source) {
    if (!items || !items.length) {
      if (source === "preset" && !dropdown.children.length) dropdown.style.display = "none";
      return;
    }
    dropdown.innerHTML = "";
    items.forEach(loc => {
      const item = document.createElement("div");
      item.className = "autocomplete-item";
      const displayName = loc.displayName || `${loc.name}, ${loc.state}`;
      item.innerHTML = `
        <div>
          <span class="ac-name">📍 ${loc.name}</span>
          <div style="font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px;">${displayName}</div>
        </div>
        <span class="ac-state" style="font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(0,229,255,0.1);color:var(--primary-cyan);">${loc.state}</span>
      `;
      item.addEventListener("click", () => {
        input.value = loc.name;
        dropdown.style.display = "none";
        onSelect(loc);
      });
      dropdown.appendChild(item);
    });
    dropdown.style.display = "block";
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

    // If no matching predefined corridors, generate intelligent route analysis based on nearest telemetry station
    const nearestSt = findNearestStation((fromLocation.lat + toLocation.lat) / 2, (fromLocation.lon + toLocation.lon) / 2);
    const activeSegments = segments.length > 0 ? segments : [{
      name: `${fromLocation.name} → ${toLocation.name} Highway Segment`,
      coords: [[fromLocation.lat, fromLocation.lon], [toLocation.lat, toLocation.lon]],
      road_status: nearestSt.rainfall_72h_mm > 250 ? "blocked" : nearestSt.rainfall_72h_mm > 150 ? "partial" : "clear",
      under_construction: false,
      traffic_level: "moderate",
      distance_km: Math.max(5, Math.round(haversineKm(fromLocation, toLocation))),
      duration_min: Math.max(10, Math.round(haversineKm(fromLocation, toLocation) * 1.6)),
      station_idx: nearestSt.idx
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

  function findNearestStation(lat, lon) {
    let minDistance = Infinity;
    let closestIndex = 0;
    PRESET_STATIONS.forEach((st, idx) => {
      const dist = haversineKm({ lat, lon }, { lat: st.lat, lon: st.lon });
      if (dist < minDistance) {
        minDistance = dist;
        closestIndex = idx;
      }
    });
    return { ...PRESET_STATIONS[closestIndex], idx: closestIndex };
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
    
    // Clear out form inputs initially
    document.getElementById("photo-lat").value = "";
    document.getElementById("photo-lon").value = "";
    document.getElementById("photo-date").value = "";

    imageFiles.forEach(file => {
      // 1. Read EXIF Data asynchronously
      if (window.exifr) {
        exifr.parse(file).then(exifData => {
          if (exifData) {
            if (exifData.latitude && exifData.longitude) {
              document.getElementById("photo-lat").value = exifData.latitude.toFixed(6);
              document.getElementById("photo-lon").value = exifData.longitude.toFixed(6);
            }
            if (exifData.DateTimeOriginal) {
              document.getElementById("photo-date").value = new Date(exifData.DateTimeOriginal).toLocaleString();
            } else if (file.lastModified) {
              document.getElementById("photo-date").value = new Date(file.lastModified).toLocaleString();
            }
          }
        }).catch(err => console.log("EXIF parsing error:", err));
      }

      // 2. Read Image for preview
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

  // ── GEOTAG WATERMARK GENERATOR ────────────────────────────────────────────
  function generateGeotagWatermark(dataUrl, locationStr, lat, lon, dateStr) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        canvas.width = img.width;
        canvas.height = img.height;
        
        // Draw original image
        ctx.drawImage(img, 0, 0);

        // Watermark dimensions
        const barHeight = Math.max(120, img.height * 0.2); // Responsive bar height
        const fontSize = Math.max(16, Math.floor(img.width * 0.035));
        const padding = fontSize * 1.2;

        // Draw translucent dark bar at the bottom
        ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
        ctx.fillRect(0, img.height - barHeight, img.width, barHeight);

        // Text setup
        ctx.fillStyle = "#ffffff";
        ctx.font = `bold ${fontSize + 4}px Inter, sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        
        let currentY = img.height - barHeight + padding;
        
        // 1. Location
        ctx.fillText(`📍 ${locationStr}`, padding, currentY);
        currentY += fontSize + 12;

        // 2. Lat / Lon
        ctx.font = `${fontSize}px Inter, sans-serif`;
        ctx.fillStyle = "#cbd5e1";
        const latLonStr = `Lat ${lat.toFixed(6)}°  |  Long ${lon.toFixed(6)}°`;
        ctx.fillText(latLonStr, padding, currentY);
        currentY += fontSize + 10;

        // 3. Date / Time
        ctx.fillText(`🕒 ${dateStr}`, padding, currentY);

        // 4. Logo / Branding (Bottom Right)
        ctx.textAlign = "right";
        ctx.fillStyle = "#00e5ff"; // Primary cyan
        ctx.font = `bold ${fontSize + 2}px Outfit, sans-serif`;
        ctx.fillText("ISRO BHUVAN DHARA", img.width - padding, img.height - barHeight + padding);
        
        resolve(canvas.toDataURL("image/jpeg", 0.9));
      };
      img.onerror = () => resolve(dataUrl); // Fallback to original if error
      img.src = dataUrl;
    });
  }

  // ── SUBMIT FIELD REPORT ───────────────────────────────────────────────────
  document.getElementById("btn-submit-photo").addEventListener("click", async () => {
    if (!stagedFiles.length) return;
    const location = document.getElementById("photo-location").value.trim() || "Unknown Location";
    const riskLevel = document.getElementById("photo-risk-level").value;
    const notes = document.getElementById("photo-notes").value.trim();
    
    // Read from lat/lon/date inputs (these might be auto-filled by EXIF or manually typed)
    let latVal = parseFloat(document.getElementById("photo-lat").value);
    let lonVal = parseFloat(document.getElementById("photo-lon").value);
    const dateVal = document.getElementById("photo-date").value.trim() || "just now";

    // If lat/lon are missing, fallback to picking coords from nearest matching station
    if (isNaN(latVal) || isNaN(lonVal)) {
      const matchedStation = PRESET_STATIONS.find(st =>
        location.toLowerCase().includes(st.state.toLowerCase()) ||
        location.toLowerCase().includes(st.district.toLowerCase().split(" ")[0])
      ) || PRESET_STATIONS[Math.floor(Math.random() * PRESET_STATIONS.length)];
      
      latVal = matchedStation.lat + (Math.random() - 0.5) * 0.05;
      lonVal = matchedStation.lon + (Math.random() - 0.5) * 0.05;
    }

    // Generate watermarked image
    const watermarkedDataUrl = await generateGeotagWatermark(
      stagedFiles[0].dataUrl, 
      location, 
      latVal, 
      lonVal, 
      dateVal
    );

    // Add a report for the first uploaded image
    const newReport = {
      id: `fr-user-${Date.now()}`,
      location,
      riskLevel,
      notes,
      time: dateVal,
      imgSrc: watermarkedDataUrl,
      gradient: CARD_GRADIENTS[0],
      lat: latVal,
      lon: lonVal,
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
    document.getElementById("photo-lat").value = "";
    document.getElementById("photo-lon").value = "";
    document.getElementById("photo-date").value = "";
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

  // ── ANALYTICS CHARTS ───────────────────────────────────────────────────────

  // Static feature labels and importances (local fallback from model evaluation)
  const LOCAL_FEATURE_IMPORTANCES = [
    { feature: "rain_cum_15d",                   importance: 0.1512 },
    { feature: "rain_cum_30d",                   importance: 0.1384 },
    { feature: "rain_cum_7d",                    importance: 0.1191 },
    { feature: "soil_moisture_28_100cm_mean",     importance: 0.0984 },
    { feature: "rain_cum_3d",                    importance: 0.0843 },
    { feature: "rain_mm_sum",                    importance: 0.0712 },
    { feature: "soil_moisture_100_255cm_mean",    importance: 0.0621 },
    { feature: "rainy_days_30d",                 importance: 0.0522 },
    { feature: "rainy_days_15d",                 importance: 0.0481 },
    { feature: "rain_intensity_ratio",            importance: 0.0401 },
    { feature: "rain_mm_max_hourly",             importance: 0.0342 },
    { feature: "wind_rain_interaction",           importance: 0.0281 },
    { feature: "month",                          importance: 0.0241 },
    { feature: "is_monsoon",                     importance: 0.0192 },
    { feature: "elevation",                      importance: 0.0171 },
  ].reverse();  // Chart.js renders bottom-to-top for horizontal bar

  const featureCtx = document.getElementById("chart-feature-importance");
  if (featureCtx) {
    const featureChart = new Chart(featureCtx, {
      type: "bar",
      data: {
        labels:   LOCAL_FEATURE_IMPORTANCES.map(f => f.feature.replace(/_/g, " ")),
        datasets: [{
          label:           "Feature Importance (%)",
          data:            LOCAL_FEATURE_IMPORTANCES.map(f => parseFloat((f.importance * 100).toFixed(2))),
          backgroundColor: LOCAL_FEATURE_IMPORTANCES.map((_, i) =>
            `hsla(${195 + i * 4}, 90%, 55%, 0.82)`
          ),
          borderRadius: 4,
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.parsed.x.toFixed(2)}%`
            }
          }
        },
        scales: {
          x: {
            ticks: { color: "#9ca3af", font: { family: "Outfit" } },
            grid:  { color: "rgba(255,255,255,0.06)" },
            title: { display: true, text: "Importance (%)", color: "#9ca3af" }
          },
          y: {
            ticks: { color: "#e2e8f0", font: { size: 11, family: "Outfit" } },
            grid:  { color: "rgba(255,255,255,0.04)" }
          }
        }
      }
    });

    // Set source to local initially
    const srcEl = document.getElementById("feature-importance-source");
    if (srcEl) srcEl.textContent = "Local Static (Offline)";

    // Attempt to upgrade chart with live Flask data (after a short delay for Flask init)
    setTimeout(async () => {
      if (window.FlaskML && window.FlaskML.isConnected) {
        await window.FlaskML.updateFeatureImportanceChart(featureChart);
      }
    }, 2000);
  }

  // ── Soil Moisture vs Rainfall Hazard Scatter ────────────────────────────────
  const scatterCtx = document.getElementById("chart-rainfall-moisture");
  if (scatterCtx) {
    // Generate scatter data from preset stations using local surrogate model
    const scatterData = PRESET_STATIONS.map(st => {
      const pred = predictCloudMLRisk(st);
      const RISK_COLORS_HEX = { LOW: "#10b981", MODERATE: "#f59e0b", HIGH: "#f97316", CRITICAL: "#ef4444" };
      return {
        x: st.rainfall_72h_mm,
        y: st.soil_moisture_pct,
        riskClass: pred.risk_class,
        label: st.cell_id,
        color: RISK_COLORS_HEX[pred.risk_class] || "#9ca3af",
      };
    });
    new Chart(scatterCtx, {
      type: "scatter",
      data: {
        datasets: [{
          label: "Monitoring Stations",
          data:  scatterData.map(d => ({ x: d.x, y: d.y, label: d.label })),
          backgroundColor: scatterData.map(d => d.color + "cc"),
          borderColor:     scatterData.map(d => d.color),
          pointRadius: 7,
          pointHoverRadius: 10,
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => `${scatterData[ctx.dataIndex]?.label || ""} — Rain: ${ctx.parsed.x}mm, Moisture: ${ctx.parsed.y}%`
            }
          }
        },
        scales: {
          x: {
            title: { display: true, text: "72h Antecedent Rainfall (mm)", color: "#9ca3af" },
            ticks: { color: "#9ca3af" },
            grid:  { color: "rgba(255,255,255,0.06)" }
          },
          y: {
            title: { display: true, text: "Soil Moisture (%)", color: "#9ca3af" },
            ticks: { color: "#9ca3af" },
            grid:  { color: "rgba(255,255,255,0.06)" }
          }
        }
      }
    });
  }

  // ── Initial risk calculation ───────────────────────────────────────────────
  recalculateRisk();

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
