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
    // Road corridor vectors are only drawn when the user submits a route query.
    // Do NOT pre-draw them here to avoid showing "random routes" on startup.

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
    if (!station) return;
    currentStation = station;
    if (map && station.lat && station.lon) {
      map.flyTo([station.lat, station.lon], 9, { duration: 1.5 });
    }
    const sRain = document.getElementById("slider-rain72");
    if (sRain && station.rainfall_72h_mm !== undefined) sRain.value = station.rainfall_72h_mm;
    const sInt = document.getElementById("slider-intensity");
    if (sInt && station.rainfall_intensity_mmhr !== undefined) sInt.value = station.rainfall_intensity_mmhr;
    const sMoist = document.getElementById("slider-moisture");
    if (sMoist && station.soil_moisture_pct !== undefined) sMoist.value = station.soil_moisture_pct;
    const sSlope = document.getElementById("slider-slope");
    if (sSlope && station.slope_angle_deg !== undefined) sSlope.value = station.slope_angle_deg;
    const sHist = document.getElementById("slider-history");
    if (sHist && station.historical_incidents_5y !== undefined) sHist.value = station.historical_incidents_5y;

    if (typeof fetchBhuvanSatelliteData === "function") {
      const bhuvanSat = fetchBhuvanSatelliteData(station.lat, station.lon);
      if (bhuvanSat && bhuvanSat.status === "ok") {
        const ndviEl = document.getElementById("val-ndvi-display");
        if (ndviEl) ndviEl.innerText = bhuvanSat.ndvi;
        const dispEl = document.getElementById("val-disp-display");
        if (dispEl) dispEl.innerText = `${bhuvanSat.slope_displacement_mm} mm`;
        const tagEl = document.getElementById("sat-status-tag");
        if (tagEl) {
          tagEl.innerText = "ISRO LIVE";
          tagEl.style.color = "var(--risk-low)";
        }
      }
    }
    recalculateRisk();
  }

  function recalculateRisk() {
    if (!currentStation) return;
    const sRain  = document.getElementById("slider-rain72");
    const sInt   = document.getElementById("slider-intensity");
    const sMoist = document.getElementById("slider-moisture");
    const sSlope = document.getElementById("slider-slope");
    const sHist  = document.getElementById("slider-history");

    const r72       = sRain ? parseFloat(sRain.value) : (currentStation.rainfall_72h_mm || 120);
    const intensity = sInt ? parseFloat(sInt.value) : (currentStation.rainfall_intensity_mmhr || 25);
    const moisture  = sMoist ? parseFloat(sMoist.value) : (currentStation.soil_moisture_pct || 65);
    const slope     = sSlope ? parseFloat(sSlope.value) : (currentStation.slope_angle_deg || 30);
    const history   = sHist ? parseInt(sHist.value) : (currentStation.historical_incidents_5y || 1);

    const vRain = document.getElementById("val-rain72");
    if (vRain) vRain.innerText = `${r72} mm`;
    const vInt = document.getElementById("val-intensity");
    if (vInt) vInt.innerText = `${intensity} mm/h`;
    const vMoist = document.getElementById("val-moisture");
    if (vMoist) vMoist.innerText = `${moisture} %`;
    const vSlope = document.getElementById("val-slope");
    if (vSlope) vSlope.innerText = `${slope}°`;
    const vHist = document.getElementById("val-history");
    if (vHist) vHist.innerText = `${history} events`;

    const activeReading = {
      cell_id: currentStation.cell_id, district: currentStation.district,
      rainfall_24h_mm: Math.round(r72 * 0.4), rainfall_72h_mm: r72,
      rainfall_intensity_mmhr: intensity, soil_moisture_pct: moisture, slope_angle_deg: slope,
      ndvi: currentStation.ndvi || 0.3, distance_to_road_m: currentStation.distance_to_road_m || 20,
      historical_incidents_5y: history, soil_type_erodibility: currentStation.soil_type_erodibility || 0.5
    };

    // ── Edge rule-based fallback (always computed instantly) ────────────────
    if (typeof predictEdgeRuleBasedRisk === "function") {
      const edgePred = predictEdgeRuleBasedRisk(activeReading);
      const edgeResEl = document.getElementById("edge-rule-res");
      if (edgeResEl) {
        edgeResEl.innerText = edgePred.risk_class;
        edgeResEl.style.color = `var(--risk-${edgePred.risk_class.toLowerCase()})`;
      }
      const edgeScoreEl = document.getElementById("edge-rule-score");
      if (edgeScoreEl) edgeScoreEl.innerText = `${edgePred.score} / 12`;
    }

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

          const cellIdEl = document.getElementById("selected-cell-id");
          if (cellIdEl) cellIdEl.innerText = activeReading.cell_id;
          const distEl = document.getElementById("selected-cell-district");
          if (distEl) distEl.innerText = activeReading.district;
          const badgeEl = document.getElementById("selected-risk-badge");
          if (badgeEl) {
            badgeEl.innerText   = riskClass;
            badgeEl.className   = `risk-badge badge-${riskClass.toLowerCase()}`;
          }
          const cloudResEl = document.getElementById("cloud-ml-res");
          if (cloudResEl) {
            cloudResEl.innerText    = riskClass;
            cloudResEl.style.color  = `var(--risk-${riskClass.toLowerCase()})`;
          }
          const confEl = document.getElementById("cloud-ml-conf");
          if (confEl) confEl.innerText = `${Math.round(confidence * 100)}%`;

          // Extra Flask UI updates (source label, probability bar)
          if (window.FlaskML.applyPredictionToUI) {
            window.FlaskML.applyPredictionToUI(flaskResult);
          }

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
    if (typeof predictCloudMLRisk !== "function") return;
    const cloudPred = predictCloudMLRisk(activeReading);
    const cellIdEl = document.getElementById("selected-cell-id");
    if (cellIdEl) cellIdEl.innerText = activeReading.cell_id;
    const distEl = document.getElementById("selected-cell-district");
    if (distEl) distEl.innerText = activeReading.district;
    const badgeEl = document.getElementById("selected-risk-badge");
    if (badgeEl) {
      badgeEl.innerText = cloudPred.risk_class;
      badgeEl.className = `risk-badge badge-${cloudPred.risk_class.toLowerCase()}`;
    }
    const cloudResEl = document.getElementById("cloud-ml-res");
    if (cloudResEl) {
      cloudResEl.innerText = cloudPred.risk_class;
      cloudResEl.style.color = `var(--risk-${cloudPred.risk_class.toLowerCase()})`;
    }
    const confEl = document.getElementById("cloud-ml-conf");
    if (confEl) confEl.innerText = `${Math.round(cloudPred.confidence * 100)}%`;
    const sourceEl = document.getElementById("flask-engine-source");
    if (sourceEl) { sourceEl.textContent = "Local Fallback (Offline)"; sourceEl.style.color = "#f59e0b"; }
    updateAlertMessage(cloudPred);
  }

  function updateAlertMessage(cloudPred) {
    const langSelect = document.getElementById("select-alert-lang");
    const activeLangBtn = document.querySelector(".lang-btn.active");
    const lang = (langSelect && langSelect.value) || (activeLangBtn && activeLangBtn.dataset.lang) || localStorage.getItem("dhara_lang") || "en";
    const alertData = typeof buildAlert === "function" ? buildAlert(cloudPred, lang) : null;
    const alertMsgEl = document.getElementById("alert-msg-text");
    if (alertMsgEl) {
      alertMsgEl.innerText = alertData
        ? alertData.message
        : `Normal Conditions: Risk level in ${cloudPred.district} (${cloudPred.cell_id}) is currently ${cloudPred.risk_class}. No emergency broadcast triggered.`;
    }
  }

  ["slider-rain72", "slider-intensity", "slider-moisture", "slider-slope", "slider-history"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", recalculateRisk);
  });
  const alertLangEl = document.getElementById("select-alert-lang");
  if (alertLangEl) alertLangEl.addEventListener("change", recalculateRisk);

  // ── TABS NAVIGATION ────────────────────────────────────────────────────────
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const target = btn.getAttribute("data-tab");
      if (!target) return;
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
      const targetContent = document.getElementById(target);
      if (targetContent) {
        targetContent.classList.add("active");
      }
      if (target === "tab-fieldreports" && typeof loadFieldReports === "function") {
        loadFieldReports();
      }
      if (target === "tab-admin" && typeof loadAdminIncidents === "function") {
        loadAdminIncidents();
      }
      if (window.lucide) window.lucide.createIcons();
    });
  });

  // ── STATION LIST ───────────────────────────────────────────────────────────
  // Track active journey route stations for Stations tab filtering
  let activeRouteStations = null; // null = show all, array = show only these
  let activeRouteFrom = null;
  let activeRouteTo = null;

  function renderStationsList(mlStations) {
    const container = document.getElementById("station-list-container");
    container.innerHTML = "";

    const levelMap = { "Low": "LOW", "Medium": "MODERATE", "High": "HIGH", "Critical": "CRITICAL" };

    // If an active journey exists, show route-filtered stations with route context
    if (activeRouteStations && activeRouteStations.length > 0 && activeRouteFrom && activeRouteTo) {
      // Route header
      const header = document.createElement("div");
      header.style.cssText = "padding:10px 14px;margin-bottom:4px;border-radius:8px;background:linear-gradient(135deg,rgba(0,229,255,0.12),rgba(16,185,129,0.08));border:1px solid rgba(0,229,255,0.25);";
      header.innerHTML = `<div style="font-size:11px;color:var(--primary-cyan);font-weight:700;margin-bottom:4px;">🛤️ ROUTE STATIONS</div>
        <div style="font-size:13px;font-weight:700;color:#fff;">${activeRouteFrom.name} → ${activeRouteTo.name}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${activeRouteStations.length} monitoring station(s) along this corridor</div>
        <div style="font-size:10px;color:var(--text-dim);margin-top:4px;">Click a station to view full route connection on map</div>`;
      container.appendChild(header);

      activeRouteStations.forEach((entry, idx) => {
        const st = entry.station;
        let riskClass, riskSource;
        if (st.risk_level) {
          riskClass  = levelMap[st.risk_level] || st.risk_level.toUpperCase();
          riskSource = "Flask ML";
        } else {
          const pred = predictCloudMLRisk(st);
          riskClass  = pred.risk_class;
          riskSource = "Local";
        }

        const riskColorMap = { LOW: "var(--risk-low)", MODERATE: "var(--risk-moderate)", HIGH: "var(--risk-high)", CRITICAL: "var(--risk-critical)" };
        const riskColor = riskColorMap[riskClass] || "#9ca3af";
        const distLabel = entry.distFromOrigin < 1 ? "< 1 km" : `~${Math.round(entry.distFromOrigin)} km`;

        const div = document.createElement("div");
        div.className = "panel-card";
        div.style.cssText = `padding:10px 14px;margin:0;cursor:pointer;border-left:3px solid ${riskColor};transition:all 0.2s ease;`;
        div.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
              <span style="background:rgba(0,229,255,0.15);color:var(--primary-cyan);font-size:10px;font-weight:700;padding:1px 6px;border-radius:10px;">${idx + 1}</span>
              <span style="font-weight:700;font-size:13px;color:var(--primary-cyan);">${st.cell_id}</span>
            </div>
            <div style="font-size:12px;font-weight:600;color:#fff;">${st.subdivision || st.district}</div>
            <div style="font-size:11px;color:var(--text-muted);">${st.district}, ${st.state}</div>
            <div style="display:flex;gap:10px;margin-top:4px;">
              <span style="font-size:10px;color:var(--text-dim);">📍 ${distLabel} from ${activeRouteFrom.name}</span>
              <span style="font-size:10px;color:var(--text-dim);">${riskSource} Inference</span>
            </div>
          </div>
          <span class="risk-badge badge-${riskClass.toLowerCase()}">${riskClass}</span>
        </div>`;

        div.addEventListener("mouseenter", () => { div.style.background = "rgba(0,229,255,0.06)"; });
        div.addEventListener("mouseleave", () => { div.style.background = ""; });

        div.addEventListener("click", () => {
          selectStation(st);
          // Draw the full connected route from A → through all route stations → B
          drawFullConnectedRoute(activeRouteStations, activeRouteFrom, activeRouteTo, idx);
        });
        container.appendChild(div);
      });

      return;
    }

    // Default mode: show all stations
    const stationData = mlStations || PRESET_STATIONS;

    stationData.forEach(st => {
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
      });
      container.appendChild(div);
    });
  }

  /**
   * Draw the full connected route polyline from A → all intermediate stations → B
   * with risk-colored segments between each waypoint.
   */
  function drawFullConnectedRoute(routeStations, fromLoc, toLoc, highlightIdx) {
    if (routeLayerGroup) map.removeLayer(routeLayerGroup);
    routeLayerGroup = L.layerGroup().addTo(map);

    // Build ordered waypoints: FROM → sorted route stations → TO
    const waypoints = [
      { lat: fromLoc.lat, lon: fromLoc.lon, label: "A", isEndpoint: true },
      ...routeStations.map((entry, i) => ({
        lat: entry.station.lat, lon: entry.station.lon,
        station: entry.station, label: `${i + 1}`, isEndpoint: false, idx: i
      })),
      { lat: toLoc.lat, lon: toLoc.lon, label: "B", isEndpoint: true }
    ];

    // Draw polyline segments between each consecutive waypoint, colored by risk
    for (let i = 0; i < waypoints.length - 1; i++) {
      const wp1 = waypoints[i], wp2 = waypoints[i + 1];
      // Use the risk of the next station for segment coloring
      let segColor = "#00e5ff";
      let dashArray = null;
      if (wp2.station) {
        const pred = predictCloudMLRisk(wp2.station);
        segColor = RISK_COLORS[pred.risk_class] || "#00e5ff";
      } else if (wp1.station) {
        const pred = predictCloudMLRisk(wp1.station);
        segColor = RISK_COLORS[pred.risk_class] || "#00e5ff";
      }
      L.polyline([[wp1.lat, wp1.lon], [wp2.lat, wp2.lon]], {
        color: segColor, weight: 5, opacity: 0.85, dashArray: dashArray, lineCap: "round"
      }).addTo(routeLayerGroup);
    }

    // FROM marker (green)
    L.marker([fromLoc.lat, fromLoc.lon], {
      icon: L.divIcon({ className: "", html: `<div class="journey-pin pin-from">A</div>`, iconSize: [32, 32], iconAnchor: [16, 16] })
    }).addTo(routeLayerGroup);

    // TO marker (red)
    L.marker([toLoc.lat, toLoc.lon], {
      icon: L.divIcon({ className: "", html: `<div class="journey-pin pin-to">B</div>`, iconSize: [32, 32], iconAnchor: [16, 16] })
    }).addTo(routeLayerGroup);

    // Intermediate station markers with number labels
    routeStations.forEach((entry, i) => {
      const st = entry.station;
      const pred = predictCloudMLRisk(st);
      const riskColor = RISK_COLORS[pred.risk_class] || "#00e5ff";
      const isHighlighted = i === highlightIdx;
      const size = isHighlighted ? 28 : 22;
      const border = isHighlighted ? "3px solid #fff" : "2px solid rgba(255,255,255,0.6)";
      L.marker([st.lat, st.lon], {
        icon: L.divIcon({
          className: "",
          html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${riskColor};border:${border};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;font-family:Outfit,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,0.4);${isHighlighted ? 'transform:scale(1.15);' : ''}">${i + 1}</div>`,
          iconSize: [size, size], iconAnchor: [size/2, size/2]
        })
      }).bindTooltip(`<div style="font-family:Outfit;font-size:11px;"><strong>${st.subdivision || st.district}</strong><br/>${st.state}<br/>Risk: <span style="color:${riskColor};font-weight:700;">${pred.risk_class}</span></div>`, { sticky: true })
        .addTo(routeLayerGroup);
    });

    // Fit map to show entire route
    const allCoords = waypoints.map(wp => [wp.lat, wp.lon]);
    map.fitBounds(allCoords, { padding: [60, 60] });
  }

  /**
   * Find all PRESET_STATIONS near the route corridor between from and to,
   * sorted by distance from origin along the path.
   */
  function findRouteStations(fromLoc, toLoc) {
    const corridorWidthKm = 150; // Include stations within 150km of the route line
    const routeStations = [];

    PRESET_STATIONS.forEach((st, idx) => {
      // Distance from the station to the route line (approximated as distance to closest point on the from→to line)
      const distToLine = pointToLineDistKm(
        { lat: st.lat, lon: st.lon },
        { lat: fromLoc.lat, lon: fromLoc.lon },
        { lat: toLoc.lat, lon: toLoc.lon }
      );
      const distFromOrigin = haversineKm({ lat: fromLoc.lat, lon: fromLoc.lon }, { lat: st.lat, lon: st.lon });
      const distFromDest = haversineKm({ lat: toLoc.lat, lon: toLoc.lon }, { lat: st.lat, lon: st.lon });
      const routeLength = haversineKm({ lat: fromLoc.lat, lon: fromLoc.lon }, { lat: toLoc.lat, lon: toLoc.lon });

      // Only include if station is within corridor AND not way beyond the endpoints
      if (distToLine < corridorWidthKm && (distFromOrigin < routeLength * 1.3) && (distFromDest < routeLength * 1.3)) {
        routeStations.push({
          station: st,
          stationIdx: idx,
          distFromOrigin: distFromOrigin,
          distToLine: distToLine
        });
      }
    });

    // Sort by distance from origin (so they appear in travel order)
    routeStations.sort((a, b) => a.distFromOrigin - b.distFromOrigin);
    return routeStations;
  }

  /**
   * Approximate perpendicular distance (km) from point P to the line segment A→B
   */
  function pointToLineDistKm(p, a, b) {
    const ap = { lat: p.lat - a.lat, lon: p.lon - a.lon };
    const ab = { lat: b.lat - a.lat, lon: b.lon - a.lon };
    const abLenSq = ab.lat * ab.lat + ab.lon * ab.lon;
    if (abLenSq === 0) return haversineKm(p, a);
    let t = (ap.lat * ab.lat + ap.lon * ab.lon) / abLenSq;
    t = Math.max(0, Math.min(1, t));
    const closest = { lat: a.lat + t * ab.lat, lon: a.lon + t * ab.lon };
    return haversineKm(p, closest);
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
    const langSelect = document.getElementById("select-alert-lang");
    const activeLangBtn = document.querySelector(".lang-btn.active");
    const lang = (langSelect && langSelect.value) || (activeLangBtn && activeLangBtn.dataset.lang) || localStorage.getItem("dhara_lang") || "en";
    const alertData = typeof buildAlert === "function" ? buildAlert(pred, lang) : null;
    const alertMsg = alertData ? alertData.message : `ALERT: Risk level in ${currentStation.district} (${currentStation.cell_id}) is currently ${pred.risk_class}. Standard safety precautions apply.`;
    const previewEl = document.getElementById("modal-sms-preview-text");
    if (previewEl) previewEl.innerText = alertMsg;
    if (smsModal) smsModal.classList.add("open");
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

  function setupAutocomplete(inputId, dropdownId, onSelect, onReset) {
    const input = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);

    input.addEventListener("input", () => {
      const q = input.value.trim();
      if (debounceTimers[inputId]) clearTimeout(debounceTimers[inputId]);

      // Reset stored location whenever the user edits the field
      if (onReset) onReset();

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

    // Auto-select the first dropdown item when the user leaves the field
    // without having clicked a suggestion (only if text hasn't already resolved)
    input.addEventListener("blur", () => {
      setTimeout(() => {
        const firstItem = dropdown.querySelector(".autocomplete-item");
        if (firstItem && dropdown.style.display !== "none") {
          firstItem.click();
        }
        dropdown.style.display = "none";
      }, 180);
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
  setupAutocomplete("journey-from", "from-dropdown", loc => { fromLocation = loc; }, () => { fromLocation = null; });
  setupAutocomplete("journey-to", "to-dropdown", loc => { toLocation = loc; }, () => { toLocation = null; });

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

  function resolveLocation(locOrText) {
    if (locOrText && typeof locOrText === "object" && locOrText.name) return locOrText;
    if (!locOrText || typeof locOrText !== "string") return null;
    const q = locOrText.trim().toLowerCase();
    if (!q) return null;
    const foundLocal = LOCATION_DATABASE.find(l =>
      l.name.toLowerCase() === q || l.name.toLowerCase().includes(q) || q.includes(l.name.toLowerCase())
    );
    if (foundLocal) return foundLocal;
    const foundStation = PRESET_STATIONS.find(s =>
      s.district.toLowerCase().includes(q) || s.subdivision.toLowerCase().includes(q) || s.state.toLowerCase().includes(q)
    );
    if (foundStation) {
      return {
        name: foundStation.subdivision || foundStation.district,
        state: foundStation.state,
        lat: foundStation.lat,
        lon: foundStation.lon
      };
    }
    return null;
  }

  function getLocalDateString(d = new Date()) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  // ── JOURNEY ROUTE RISK ENGINE (ML + WEATHER DATASET) ─────────────────────
  async function evaluateJourney() {
    const fromInputVal = document.getElementById("journey-from")?.value.trim() || "";
    const toInputVal = document.getElementById("journey-to")?.value.trim() || "";
    const dateInputVal = document.getElementById("journey-date")?.value.trim() || "";

    // Always re-sync stored location with the current input text.
    // This handles: (a) stale location from a previous selection,
    // (b) user typed without clicking a dropdown suggestion.
    if (fromInputVal) {
      const resolved = resolveLocation(fromInputVal);
      if (resolved) fromLocation = resolved;
    }
    if (toInputVal) {
      const resolved = resolveLocation(toInputVal);
      if (resolved) toLocation = resolved;
    }

    if (!fromLocation || !toLocation) {
      showJourneyError("Please enter a valid FROM and TO location. Select a suggestion from the dropdown or type a well-known city name.");
      return;
    }
    if (fromLocation.name.toLowerCase() === toLocation.name.toLowerCase()) {
      showJourneyError("Origin and destination cannot be the same.");
      return;
    }

    const todayStr = getLocalDateString();
    const travelDate = dateInputVal || todayStr;

    if (travelDate < todayStr) {
      showJourneyError("Past dates cannot be predicted because they have already occurred. Please select today or a future date for route prediction.");
      const dateEl = document.getElementById("journey-date");
      if (dateEl) {
        dateEl.min = todayStr;
        dateEl.value = todayStr;
      }
      showToast("⚠️ Past dates cannot be predicted. Date reset to today.");
      return;
    }

    const loadingEl = document.getElementById("journey-loading");
    const resultsPanel = document.getElementById("journey-results-panel");
    if (loadingEl) loadingEl.style.display = "block";
    if (resultsPanel) resultsPanel.style.display = "none";

    const segments = findRelevantSegments(fromLocation, toLocation);
    let routeCoords = [];
    if (segments.length > 0) {
      routeCoords = segments.flatMap(s => s.coords);
    } else {
      routeCoords = [
        [fromLocation.lat, fromLocation.lon],
        [(fromLocation.lat + toLocation.lat)/2, (fromLocation.lon + toLocation.lon)/2],
        [toLocation.lat, toLocation.lon]
      ];
    }

    // Try Flask ML Date-Wise Route Risk API first
    if (window.FlaskML && window.FlaskML.isConnected) {
      try {
        const mlRes = await window.FlaskML.predictRouteRisk({
          from: fromLocation.name,
          to: toLocation.name,
          date: travelDate,
          route_coordinates: routeCoords
        });
        if (mlRes && mlRes.success) {
          if (loadingEl) loadingEl.style.display = "none";
          renderMLRouteRiskResponse(mlRes, fromLocation, toLocation, travelDate);
          return;
        } else if (mlRes && mlRes.error) {
          if (loadingEl) loadingEl.style.display = "none";
          showJourneyError(`⚠️ ${mlRes.error}`);
          return;
        }
      } catch (err) {
        console.warn("[FlaskML] Route risk API error:", err);
      }
    }

    // Fallback to local evaluation if Flask ML is offline
    if (loadingEl) loadingEl.style.display = "none";
    evaluateLocalJourney(segments, fromLocation, toLocation, travelDate);
  }

  function renderMLRouteRiskResponse(mlRes, fromLoc, toLoc, travelDate) {
    if (routeLayerGroup) map.removeLayer(routeLayerGroup);
    routeLayerGroup = L.layerGroup().addTo(map);

    const segments = mlRes.segments || [];
    const waypoints = segments.map(s => ({ lat: s.latitude, lon: s.longitude, data: s }));
    const isBlocked = mlRes.road_status === "BLOCKED";

    // 1. Draw polyline segments for the primary route
    for (let i = 0; i < waypoints.length - 1; i++) {
      const p1 = waypoints[i], p2 = waypoints[i + 1];
      const riskClass = p2.data.risk_level || p1.data.risk_level || "LOW";
      const segColor = isBlocked ? "#ef4444" : (RISK_COLORS[riskClass] || "#10b981");
      L.polyline([[p1.lat, p1.lon], [p2.lat, p2.lon]], {
        color: segColor,
        weight: 6,
        opacity: 0.95,
        dashArray: isBlocked ? "8, 8" : null,
        lineCap: "round"
      }).addTo(routeLayerGroup);
    }

    // 1b. If an alternative route is recommended and has coordinates, draw it in bright teal
    if (mlRes.recommended_route && mlRes.recommended_route.coordinates && mlRes.recommended_route.id !== mlRes.primary_route_id) {
      const altCoords = mlRes.recommended_route.coordinates;
      const altLine = L.polyline(altCoords, {
        color: "#06b6d4",
        weight: 6,
        opacity: 0.95,
        lineCap: "round"
      }).addTo(routeLayerGroup);
      altLine.bindPopup(`
        <div style="font-family:'Outfit',sans-serif;padding:6px;min-width:200px;">
          <div style="font-weight:800;font-size:13px;color:#0891b2;">🔄 RECOMMENDED ALTERNATIVE</div>
          <div style="font-size:12px;font-weight:700;color:#111;margin:2px 0;">${mlRes.recommended_route.name}</div>
          <div style="font-size:11px;color:#444;">Via: <strong>${mlRes.recommended_route.via}</strong></div>
          <div style="font-size:11px;color:#10b981;font-weight:700;margin-top:2px;">Clear of confirmed landslides</div>
        </div>
      `);
    }

    // 1c. Draw Road Incidents & Blockages along corridor
    (mlRes.road_incidents || []).forEach(inc => {
      const incColor = inc.status === "BLOCKED" ? "#ef4444" : inc.status === "CAUTION" ? "#f59e0b" : "#10b981";
      const incIcon = inc.status === "BLOCKED" ? "🚧" : "⚠️";
      const incMarker = L.marker([inc.latitude, inc.longitude], {
        icon: L.divIcon({
          className: "",
          html: `<div style="width:30px;height:30px;border-radius:50%;background:${incColor};border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 3px 10px rgba(0,0,0,0.6);">${incIcon}</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        })
      });
      incMarker.bindPopup(`
        <div style="font-family:'Outfit',sans-serif;padding:4px;min-width:220px;color:#111;">
          <div style="font-weight:800;font-size:13px;color:#991b1b;">${incIcon} ${inc.incident_type.toUpperCase()}: ${inc.road_name}</div>
          <div style="font-size:11px;font-weight:700;color:${incColor};margin:2px 0 4px 0;">ROAD STATUS: ${inc.status} · Severity: ${inc.severity}</div>
          <div style="font-size:11px;color:#333;line-height:1.4;margin-bottom:4px;">📍 <strong>${inc.location_name}</strong></div>
          <div style="font-size:11px;color:#555;line-height:1.4;background:#fef2f2;border-left:3px solid #ef4444;padding:4px 6px;border-radius:2px;">${inc.description || 'Road blockage / hazard reported'}</div>
          <div style="font-size:10px;color:#666;margin-top:4px;">Source: ${inc.authority_source || 'Verified Highway Authority'}</div>
        </div>
      `);
      incMarker.addTo(routeLayerGroup);
    });

    // 2. FROM marker (green)
    L.marker([fromLoc.lat, fromLoc.lon], {
      icon: L.divIcon({ className: "", html: `<div class="journey-pin pin-from">A</div>`, iconSize: [32, 32], iconAnchor: [16, 16] })
    }).addTo(routeLayerGroup);

    // 3. TO marker (red)
    L.marker([toLoc.lat, toLoc.lon], {
      icon: L.divIcon({ className: "", html: `<div class="journey-pin pin-to">B</div>`, iconSize: [32, 32], iconAnchor: [16, 16] })
    }).addTo(routeLayerGroup);

    // 4. Sampled weather station waypoint markers along the route
    waypoints.forEach((wp, idx) => {
      const s = wp.data;
      const riskClass = s.risk_level || "LOW";
      const riskColor = RISK_COLORS[riskClass] || "#10b981";
      const probs = s.class_probabilities || {};
      const probStr = probs.High ? `High: ${(probs.High*100).toFixed(0)}%, Med: ${(probs.Medium*100).toFixed(0)}%, Low: ${(probs.Low*100).toFixed(0)}%` : `Score: ${(s.risk_score*100).toFixed(0)}%`;

      const marker = L.marker([wp.lat, wp.lon], {
        icon: L.divIcon({
          className: "",
          html: `<div style="width:24px;height:24px;border-radius:50%;background:${riskColor};border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;font-family:Outfit,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,0.5);">${idx + 1}</div>`,
          iconSize: [24, 24], iconAnchor: [12, 12]
        })
      });

      marker.bindPopup(`
        <div style="font-family:'Outfit',sans-serif;color:#111;padding:4px;min-width:210px;">
          <div style="font-weight:800;font-size:13px;color:#1e3a8a;">${s.segment_name}</div>
          <div style="font-size:12px;font-weight:700;color:${riskColor};margin:2px 0 6px 0;">
            Estimated Landslide Risk: ${riskClass}
          </div>
          <div style="border-top:1px solid #eee;padding-top:4px;font-size:11px;color:#444;line-height:1.5;">
            <div>📍 Weather Station: <strong>${s.station_name}</strong> (${s.district})</div>
            <div>🌧️ Rainfall: <strong>${s.rainfall_mm} mm</strong> (3-Day: <strong>${s.rain_cum_3d_mm} mm</strong>)</div>
            <div>🌡️ Avg Temp: <strong>${s.avg_temp_c} °C</strong> · Elev: <strong>${s.elevation_m} m</strong></div>
            <div>📊 Probabilities: <span style="color:#2563eb;">${probStr}</span></div>
            <div style="font-size:10px;color:#666;margin-top:2px;">Mode: <em>${s.mode}</em></div>
          </div>
        </div>
      `);
      marker.addTo(routeLayerGroup);
    });

    // Fit map bounds
    const allCoords = waypoints.map(wp => [wp.lat, wp.lon]).concat([[fromLoc.lat, fromLoc.lon], [toLoc.lat, toLoc.lon]]);
    map.fitBounds(allCoords, { padding: [60, 60] });

    // 5. Populate Results Panel UI
    const resultsPanel = document.getElementById("journey-results-panel");
    if (resultsPanel) resultsPanel.style.display = "block";

    // 5a. Advance Warning Banner
    const advCard = document.getElementById("journey-advance-warning-card");
    if (advCard) {
      if (mlRes.advance_warning) {
        advCard.style.display = "flex";
        const advTitle = document.getElementById("adv-warn-title");
        if (advTitle) advTitle.innerText = `${mlRes.advance_warning.type ? mlRes.advance_warning.type.toUpperCase() : 'HAZARD'} AHEAD ON ROUTE`;
        const advDesc = document.getElementById("adv-warn-desc");
        if (advDesc) advDesc.innerText = mlRes.advance_warning.message || "";
        const advAction = document.getElementById("adv-warn-action");
        if (advAction) advAction.innerText = mlRes.advance_warning.action || "";
      } else {
        advCard.style.display = "none";
      }
    }

    const fromLabelEl = document.getElementById("journey-from-label");
    if (fromLabelEl) fromLabelEl.innerText = fromLoc.name;
    const toLabelEl = document.getElementById("journey-to-label");
    if (toLabelEl) toLabelEl.innerText = toLoc.name;

    const dateLabelEl = document.getElementById("journey-date-label");
    if (dateLabelEl) {
      try {
        const dObj = new Date(travelDate);
        dateLabelEl.innerText = dObj.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
      } catch (e) {
        dateLabelEl.innerText = travelDate;
      }
    }

    const seasonLabelEl = document.getElementById("journey-season-label");
    if (seasonLabelEl) seasonLabelEl.innerText = mlRes.season || "Monsoon";

    // 5b. Road Status & Estimated Traffic Badges
    const roadStatusBadge = document.getElementById("journey-road-status-badge");
    if (roadStatusBadge) {
      const st = mlRes.road_status || "OPEN";
      roadStatusBadge.innerText = st === "BLOCKED" ? "🔴 BLOCKED" : st === "CAUTION" ? "🟡 CAUTION" : "🟢 OPEN";
      roadStatusBadge.className = `metric-val ${st === "BLOCKED" ? "status-blocked" : st === "CAUTION" ? "status-caution" : "status-open"}`;
    }
    const roadIncCountEl = document.getElementById("journey-road-incidents-count");
    if (roadIncCountEl) {
      const count = (mlRes.road_incidents || []).length;
      roadIncCountEl.innerText = count > 0 ? `${count} incident${count > 1 ? 's' : ''} on corridor` : "Corridor clear · No blockages";
    }

    const trafficStatusBadge = document.getElementById("journey-traffic-status-badge");
    if (trafficStatusBadge) {
      const tr = mlRes.traffic_status || "LOW";
      trafficStatusBadge.innerText = tr === "HIGH" ? "🔴 HEAVY" : tr === "MODERATE" ? "🟡 MODERATE" : "🟢 LIGHT";
      trafficStatusBadge.className = `metric-val ${tr === "HIGH" ? "traffic-high" : tr === "MODERATE" ? "traffic-moderate" : "traffic-low"}`;
    }
    const trafficDelayEl = document.getElementById("journey-traffic-delay");
    if (trafficDelayEl) {
      const delay = mlRes.traffic_delay_min || 0;
      trafficDelayEl.innerText = `+${delay} min delay · Demo/Estimated`;
    }

    const dataModeBadge = document.getElementById("journey-data-mode-badge");
    if (dataModeBadge) {
      dataModeBadge.innerText = mlRes.data_mode === "Observed Historical Weather Record"
        ? "✅ HISTORICAL WEATHER RECORD"
        : "📅 HISTORICAL SEASONAL ESTIMATE";
      dataModeBadge.style.background = mlRes.data_mode === "Observed Historical Weather Record"
        ? "rgba(16,185,129,0.15)"
        : "rgba(0,229,255,0.15)";
      dataModeBadge.style.color = mlRes.data_mode === "Observed Historical Weather Record"
        ? "var(--risk-low)"
        : "var(--primary-cyan)";
    }

    // Overall Risk Verdict & Horizontal Probability Bar
    const overallRisk = mlRes.overall_risk || "MODERATE";
    const probPct = parseFloat((mlRes.risk_probability * 100).toFixed(1));
    const verdictEl = document.getElementById("journey-verdict-badge");
    if (verdictEl) {
      verdictEl.innerText = overallRisk;
      verdictEl.style.color = RISK_COLORS[overallRisk] || "var(--risk-moderate)";
    }

    const probValEl = document.getElementById("journey-prob-val");
    if (probValEl) {
      probValEl.innerText = `${probPct}%`;
      probValEl.style.color = RISK_COLORS[overallRisk] || "var(--primary-cyan)";
    }

    // Animate horizontal probability bar
    const probBarFill = document.getElementById("journey-prob-bar-fill");
    if (probBarFill) {
      probBarFill.style.width = `${Math.min(100, Math.max(3, probPct))}%`;
      if (overallRisk === "LOW") {
        probBarFill.style.background = "linear-gradient(90deg, #10b981, #34d399)";
      } else if (overallRisk === "MODERATE") {
        probBarFill.style.background = "linear-gradient(90deg, #10b981, #f59e0b)";
      } else if (overallRisk === "HIGH") {
        probBarFill.style.background = "linear-gradient(90deg, #f59e0b, #f97316)";
      } else {
        probBarFill.style.background = "linear-gradient(90deg, #f97316, #ef4444)";
      }
    }

    // 5c. Route Recommendation Card
    const recCard = document.getElementById("journey-recommendation-card");
    const recText = document.getElementById("journey-recommendation-text");
    if (recCard && recText) {
      recText.innerText = mlRes.recommendation || "Route evaluated.";
      if (mlRes.road_status === "BLOCKED" || (mlRes.recommended_route && mlRes.recommended_route.id !== mlRes.primary_route_id)) {
        recCard.style.borderColor = "#ef4444";
        recCard.style.background = "rgba(239, 68, 68, 0.1)";
        const recTitle = document.getElementById("rec-card-title");
        if (recTitle) recTitle.innerHTML = `<i data-lucide="shield-alert" style="color:#ef4444;"></i> <span style="color:#ef4444;font-weight:800;">RECOMMENDED ALTERNATIVE AVAILABLE</span>`;
      } else {
        recCard.style.borderColor = "#10b981";
        recCard.style.background = "rgba(16, 185, 129, 0.1)";
        const recTitle = document.getElementById("rec-card-title");
        if (recTitle) recTitle.innerHTML = `<i data-lucide="shield-check" style="color:#10b981;"></i> <span style="color:#10b981;font-weight:800;">ORIGINAL ROUTE RECOMMENDED</span>`;
      }
    }

    // 5d. Candidate Alternatives Comparison List
    const altCard = document.getElementById("journey-alternatives-card");
    const altList = document.getElementById("journey-alternatives-list");
    if (altCard && altList) {
      const candidates = mlRes.candidate_routes || [];
      if (candidates.length > 1) {
        altCard.style.display = "block";
        altList.innerHTML = "";
        candidates.forEach(cand => {
          const isRec = mlRes.recommended_route && mlRes.recommended_route.id === cand.id;
          const isOrig = cand.is_original;
          const isBlockedRoute = cand.road_status === "BLOCKED";
          const candDiv = document.createElement("div");
          candDiv.className = `route-alt-card ${isRec ? 'active-selected' : ''}`;

          const riskColor = RISK_COLORS[cand.overall_risk] || "#10b981";
          const statusColor = cand.road_status === "BLOCKED" ? "#ef4444" : cand.road_status === "CAUTION" ? "#f59e0b" : "#10b981";

          candDiv.innerHTML = `
            <div class="route-alt-header">
              <div class="route-alt-name">
                ${isRec ? '⭐ ' : ''}${cand.name}
                ${isOrig ? '<span style="font-size:10px;color:var(--text-muted);font-weight:400;margin-left:4px;">(Primary)</span>' : ''}
              </div>
              ${isRec ? '<span class="route-alt-badge" style="background:rgba(0,229,255,0.2);color:var(--primary-cyan);border:1px solid var(--primary-cyan);">RECOMMENDED</span>' : ''}
            </div>
            <div class="route-alt-via">Via ${cand.via} · ${cand.distance_km} km · ~${cand.est_time_min} mins (${(cand.est_time_min/60).toFixed(1)} hrs)</div>
            <div class="route-alt-metrics">
              <span class="route-alt-badge" style="background:${riskColor}22;color:${riskColor};border:1px solid ${riskColor}55;">Landslide: ${cand.overall_risk}</span>
              <span class="route-alt-badge" style="background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor}55;">Road: ${cand.road_status}</span>
              <span class="route-alt-badge" style="background:rgba(255,255,255,0.06);color:#e2e8f0;">Traffic Delay: +${cand.traffic_delay_min}m</span>
            </div>
          `;

          candDiv.addEventListener("click", () => {
            document.querySelectorAll(".route-alt-card").forEach(el => el.classList.remove("active-selected"));
            candDiv.classList.add("active-selected");
            if (cand.coordinates && cand.coordinates.length > 0) {
              const poly = L.polyline(cand.coordinates);
              map.fitBounds(poly.getBounds(), { padding: [50, 50] });
            }
          });

          altList.appendChild(candDiv);
        });
      } else {
        altCard.style.display = "none";
      }
    }

    // Station & weather parameters
    const worstSecEl = document.getElementById("journey-worst-section");
    if (worstSecEl) worstSecEl.innerText = mlRes.highest_risk_section || "Corridor Segment";

    const stNameEl = document.getElementById("journey-station-name");
    if (stNameEl) stNameEl.innerText = `${mlRes.weather_station} (${mlRes.district}, ${mlRes.state})`;

    const rainValEl = document.getElementById("journey-rain-val");
    if (rainValEl) rainValEl.innerText = `${mlRes.rainfall_mm} mm`;

    const rain3dValEl = document.getElementById("journey-rain3d-val");
    if (rain3dValEl) rain3dValEl.innerText = `${mlRes.rain_cum_3d_mm} mm`;

    const tempValEl = document.getElementById("journey-temp-val");
    if (tempValEl) tempValEl.innerText = `${mlRes.avg_temp_c} °C`;

    const elevValEl = document.getElementById("journey-elev-val");
    if (elevValEl) elevValEl.innerText = `${mlRes.elevation_m} m`;

    // Breakdown bar
    const breakdown = mlRes.route_breakdown || { LOW: 60, MODERATE: 40, HIGH: 0, CRITICAL: 0 };
    const barEl = document.getElementById("journey-breakdown-bar");
    const legendEl = document.getElementById("journey-breakdown-legend");
    if (barEl && legendEl) {
      barEl.innerHTML = `
        <div style="flex:${breakdown.LOW || 0};background:var(--risk-low);" title="Low: ${breakdown.LOW}%"></div>
        <div style="flex:${breakdown.MODERATE || 0};background:var(--risk-moderate);" title="Moderate: ${breakdown.MODERATE}%"></div>
        <div style="flex:${breakdown.HIGH || 0};background:var(--risk-high);" title="High: ${breakdown.HIGH}%"></div>
        <div style="flex:${breakdown.CRITICAL || 0};background:var(--risk-critical);" title="Critical: ${breakdown.CRITICAL}%"></div>
      `;
      legendEl.innerHTML = `
        <span style="color:var(--risk-low);">🟢 LOW ${breakdown.LOW || 0}%</span>
        <span style="color:var(--risk-moderate);">🟡 MODERATE ${breakdown.MODERATE || 0}%</span>
        <span style="color:var(--risk-high);">🟠 HIGH ${breakdown.HIGH || 0}%</span>
        ${breakdown.CRITICAL ? `<span style="color:var(--risk-critical);">🔴 CRITICAL ${breakdown.CRITICAL}%</span>` : ''}
      `;
    }

    // Segment Details Cards
    const segsEl = document.getElementById("journey-segments");
    if (segsEl) {
      segsEl.innerHTML = "";
      segments.forEach(s => {
        const segDiv = document.createElement("div");
        segDiv.className = "journey-segment-card";
        const riskClass = s.risk_level || "LOW";
        const color = RISK_COLORS[riskClass] || "#10b981";
        const probs = s.class_probabilities || {};
        const highestProb = Math.max(...Object.values(probs || { 0: 0.85 }));
        const segProbPct = (highestProb * 100).toFixed(1);

        segDiv.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <strong style="color:#fff;font-size:12px;">${s.segment_name}</strong>
            <span class="risk-badge badge-${riskClass.toLowerCase()}">${riskClass}</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px;color:var(--text-muted);margin-bottom:6px;">
            <div>📍 Station: <strong style="color:#e2e8f0;">${s.station_name}</strong></div>
            <div>🌧️ Rain: <strong style="color:#e2e8f0;">${s.rainfall_mm} mm</strong></div>
            <div>🌡️ Temp: <strong style="color:#e2e8f0;">${s.avg_temp_c} °C</strong></div>
            <div>📊 Probability: <strong style="color:${color};">${segProbPct}%</strong></div>
          </div>
          <div style="height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;">
            <div style="width:${segProbPct}%;height:100%;background:${color};border-radius:3px;"></div>
          </div>
        `;
        segsEl.appendChild(segDiv);
      });
    }

    // Advisory Text
    const advisoryEl = document.getElementById("journey-advisory");
    if (advisoryEl) {
      advisoryEl.innerText = generateJourneyAdvisory(overallRisk, fromLoc, toLoc, false, isBlocked);
    }

    // Update stations list with corridor stations
    const routeStations = findRouteStations(fromLoc, toLoc);
    activeRouteStations = routeStations;
    activeRouteFrom = fromLoc;
    activeRouteTo = toLoc;
    renderStationsList(null);

    if (window.lucide) window.lucide.createIcons();
  }

  function evaluateLocalJourney(segments, fromLoc, toLoc, travelDate) {
    const nearestSt = findNearestStation((fromLoc.lat + toLoc.lat) / 2, (fromLoc.lon + toLoc.lon) / 2);
    const activeSegments = segments.length > 0 ? segments : [{
      name: `${fromLoc.name} → ${toLoc.name} Highway Segment`,
      coords: [[fromLoc.lat, fromLoc.lon], [toLoc.lat, toLoc.lon]],
      road_status: nearestSt.rainfall_72h_mm > 250 ? "blocked" : nearestSt.rainfall_72h_mm > 150 ? "partial" : "clear",
      under_construction: false,
      traffic_level: "moderate",
      distance_km: Math.max(5, Math.round(haversineKm(fromLoc, toLoc))),
      duration_min: Math.max(10, Math.round(haversineKm(fromLoc, toLoc) * 1.6)),
      station_idx: nearestSt.idx
    }];

    buildRouteOnMap(activeSegments, fromLoc, toLoc);

    const segmentResults = activeSegments.map(seg => {
      const st = PRESET_STATIONS[seg.station_idx] || PRESET_STATIONS[0];
      const pred = predictCloudMLRisk(st);
      return { seg, pred, st };
    });
    const worstRisk = segmentResults.reduce((worst, cur) => {
      const w = { LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 };
      return w[cur.pred.risk_class] > w[worst.pred.risk_class] ? cur : worst;
    }, segmentResults[0]);

    const resultsPanel = document.getElementById("journey-results-panel");
    if (resultsPanel) resultsPanel.style.display = "block";

    const overallRisk = worstRisk.pred.risk_class;
    const probPct = Math.round(worstRisk.pred.confidence * 100);

    const verdictEl = document.getElementById("journey-verdict-badge");
    if (verdictEl) {
      verdictEl.innerText = overallRisk;
      verdictEl.style.color = RISK_COLORS[overallRisk] || "var(--risk-moderate)";
    }

    const probValEl = document.getElementById("journey-prob-val");
    if (probValEl) probValEl.innerText = `${probPct}%`;

    const probBarFill = document.getElementById("journey-prob-bar-fill");
    if (probBarFill) {
      probBarFill.style.width = `${probPct}%`;
      probBarFill.style.background = RISK_COLORS[overallRisk] || "var(--primary-cyan)";
    }

    const fromLabelEl = document.getElementById("journey-from-label");
    if (fromLabelEl) fromLabelEl.innerText = fromLoc.name;
    const toLabelEl = document.getElementById("journey-to-label");
    if (toLabelEl) toLabelEl.innerText = toLoc.name;

    const dateLabelEl = document.getElementById("journey-date-label");
    if (dateLabelEl) dateLabelEl.innerText = travelDate;

    const worstSecEl = document.getElementById("journey-worst-section");
    if (worstSecEl) worstSecEl.innerText = worstRisk.seg.name;

    const stNameEl = document.getElementById("journey-station-name");
    if (stNameEl) stNameEl.innerText = worstRisk.st ? `${worstRisk.st.subdivision || worstRisk.st.district} (${worstRisk.st.state})` : "Regional Station";

    const rainValEl = document.getElementById("journey-rain-val");
    if (rainValEl) rainValEl.innerText = worstRisk.st ? `${worstRisk.st.rainfall_72h_mm} mm (72h)` : "N/A";

    const advisoryEl = document.getElementById("journey-advisory");
    if (advisoryEl) advisoryEl.innerText = generateJourneyAdvisory(overallRisk, fromLoc, toLoc, false, false);

    const segsEl = document.getElementById("journey-segments");
    if (segsEl) {
      segsEl.innerHTML = "";
      segmentResults.forEach(({ seg, pred, st }) => {
        const segDiv = document.createElement("div");
        segDiv.className = "journey-segment-card";
        segDiv.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <strong style="color:#fff;font-size:12px;">${seg.name}</strong>
            <span class="risk-badge badge-${pred.risk_class.toLowerCase()}">${pred.risk_class}</span>
          </div>
          <div style="font-size:11px;color:var(--text-muted);">
            Corridor Risk: ${pred.risk_class} (${Math.round(pred.confidence*100)}%)
          </div>`;
        segsEl.appendChild(segDiv);
      });
    }

    const routeStations = findRouteStations(fromLoc, toLoc);
    activeRouteStations = routeStations;
    activeRouteFrom = fromLoc;
    activeRouteTo = toLoc;
    renderStationsList(null);
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
    if (panel) {
      panel.style.display = "block";
      panel.innerHTML = `<div style="color:var(--risk-high);padding:12px;text-align:center;font-weight:600;">${msg}</div>`;
    }
  }

  function clearJourney() {
    fromLocation = null; toLocation = null;
    const fromIn = document.getElementById("journey-from");
    if (fromIn) fromIn.value = "";
    const toIn = document.getElementById("journey-to");
    if (toIn) toIn.value = "";
    const dateIn = document.getElementById("journey-date");
    if (dateIn) {
      const todayStr = getLocalDateString();
      dateIn.min = todayStr;
      dateIn.value = todayStr;
    }
    const panel = document.getElementById("journey-results-panel");
    if (panel) panel.style.display = "none";
    if (routeLayerGroup) { map.removeLayer(routeLayerGroup); routeLayerGroup = null; }

    // Reset Stations tab back to showing all stations
    activeRouteStations = null;
    activeRouteFrom = null;
    activeRouteTo = null;
    renderStationsList(null);
  }

  const btnFindRoute = document.getElementById("btn-find-route");
  if (btnFindRoute) btnFindRoute.addEventListener("click", evaluateJourney);
  const btnClearRoute = document.getElementById("btn-clear-route");
  if (btnClearRoute) btnClearRoute.addEventListener("click", clearJourney);

  // Swap From ↔ To
  const btnSwap = document.getElementById("btn-swap-journey");
  if (btnSwap) {
    btnSwap.addEventListener("click", () => {
      const fromIn = document.getElementById("journey-from");
      const toIn = document.getElementById("journey-to");
      const tmpLoc = fromLocation;
      const tmpVal = fromIn ? fromIn.value : "";

      fromLocation = toLocation;
      toLocation = tmpLoc;

      if (fromIn && toIn) {
        fromIn.value = toIn.value;
        toIn.value = tmpVal;
      }
    });
  }

  // Allow pressing Enter in Journey Inputs to find route
  ["journey-from", "journey-to"].forEach(id => {
    const inp = document.getElementById(id);
    if (inp) {
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          evaluateJourney();
        }
      });
    }
  });

  selectStation(PRESET_STATIONS[0]);

  // ═══════════════════════════════════════════════════════════════════════════
  // FIELD REPORTING — CENTRALIZED PERSISTENT BACKEND MODULE
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

  // Local fallback preset field reports (used only if server is offline)
  const PRESET_FALLBACK_REPORTS = [
    { id: "fr-1", username: "isro_telemetry", location: "Sohra Rd, Meghalaya", risk_level: "CRITICAL", notes: "Active slope movement observed. Water seeping through road crack.", timestamp: "12 min ago", image_url: "assets/reports/report1.jpg", lat: 25.28, lon: 91.73, status: "Pending Verification" },
    { id: "fr-2", username: "ndrf_officer", location: "NH-27, Dima Hasao", risk_level: "HIGH", notes: "Boulder debris on roadway. Emergency response team deployed with excavators.", timestamp: "48 min ago", image_url: "assets/reports/report2.jpg", lat: 25.18, lon: 93.02, status: "Verified" },
    { id: "fr-3", username: "sdma_sikkim", location: "Mangan, Sikkim", risk_level: "MODERATE", notes: "Coastal/cliff slope erosion observed near coastal access road.", timestamp: "2 hr ago", image_url: "assets/reports/report3.jpg", lat: 27.50, lon: 88.54, status: "Verified" },
    { id: "fr-4", username: "field_officer_nagaland", location: "Kohima Bypass", risk_level: "HIGH", notes: "Massive mudslide accumulation across hillside village route.", timestamp: "3 hr ago", image_url: "assets/reports/report4.jpg", lat: 25.68, lon: 94.11, status: "Pending Verification" },
    { id: "fr-5", username: "pwd_mizoram", location: "Aizawl-Lunglei Rd", risk_level: "MODERATE", notes: "Rockfall debris blocking highway lane. Net netting under strain.", timestamp: "5 hr ago", image_url: "assets/reports/report5.jpg", lat: 23.73, lon: 92.72, status: "Verified" },
    { id: "fr-6", username: "tripura_survey", location: "Dhalai river bank", risk_level: "LOW", notes: "Severe rockfall and landslide debris on mountain roadway.", timestamp: "6 hr ago", image_url: "assets/reports/report6.jpg", lat: 23.83, lon: 91.29, status: "Verified" }
  ];

  let fieldReports = [...PRESET_FALLBACK_REPORTS];

  const RISK_BADGE_STYLES = {
    LOW: "background:rgba(16,185,129,0.85);color:#fff;",
    MODERATE: "background:rgba(245,158,11,0.85);color:#000;",
    HIGH: "background:rgba(249,115,22,0.85);color:#fff;",
    CRITICAL: "background:rgba(239,68,68,0.9);color:#fff;"
  };

  function getTimeAgo(ms) {
    if (!ms || isNaN(ms)) return "just now";
    const secs = Math.floor((Date.now() - ms) / 1000);
    if (secs < 60) return `${Math.max(1, secs)} sec ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hr ago`;
    return `${Math.floor(hrs / 24)} d ago`;
  }

  function formatReportTime(report) {
    if (report.time && report.time.includes("ago")) return report.time;
    if (report.timestamp && report.timestamp.includes("ago")) return report.timestamp;
    const dateStr = report.created_at || report.timestamp;
    if (dateStr) {
      const parsed = Date.parse(dateStr);
      if (!isNaN(parsed)) return getTimeAgo(parsed);
      return dateStr;
    }
    return "Recently";
  }

  function getReportImageSrc(report) {
    return report.image_url || report.imgSrc || (report.images && report.images[0]) || "";
  }

  function renderFieldReportsGallery() {
    const gallery = document.getElementById("field-reports-gallery");
    const countBadge = document.getElementById("report-count-badge");
    if (!gallery) return;

    gallery.innerHTML = "";
    if (countBadge) {
      countBadge.textContent = `${fieldReports.length} REPORT${fieldReports.length === 1 ? "" : "S"}`;
    }

    fieldReports.forEach((report, idx) => {
      const card = document.createElement("div");
      card.className = "field-report-card";
      card.id = `card-${report.id || idx}`;

      const imgSrc = getReportImageSrc(report);
      const riskLevel = (report.risk_level || report.riskLevel || "MODERATE").toUpperCase();
      const isPending = report.status === "Pending Verification" || report.pending;
      const formattedTime = formatReportTime(report);
      const username = report.username ? `@${report.username}` : "@citizen";

      const imgHTML = imgSrc
        ? `<img class="field-report-img" src="${imgSrc}" alt="${report.location || 'Field Report'}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
           <div class="field-report-img-placeholder" style="display:none;background:${CARD_GRADIENTS[idx % CARD_GRADIENTS.length]};">
             <span style="font-size:22px;">📷</span>
             <span>${(report.location || "Report").split(",")[0]}</span>
           </div>`
        : `<div class="field-report-img-placeholder" style="background:${CARD_GRADIENTS[idx % CARD_GRADIENTS.length]};">
             <span style="font-size:22px;">📷</span>
             <span>${(report.location || "Report").split(",")[0]}</span>
           </div>`;

      const pendingDot = isPending
        ? `<div class="field-report-pending-dot" title="Pending verification"></div>` : "";

      const badgeStyle = RISK_BADGE_STYLES[riskLevel] || RISK_BADGE_STYLES.MODERATE;

      card.innerHTML = `
        ${imgHTML}
        ${pendingDot}
        <div class="field-report-badge" style="${badgeStyle}">${riskLevel}</div>
        <div class="field-report-meta">
          <div class="field-report-location" title="${report.location}">${report.location || "Unknown Location"}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px;">
            <div class="field-report-time">${formattedTime}</div>
            <div style="font-size:10px;color:var(--primary-cyan);font-weight:600;opacity:0.9;">${username}</div>
          </div>
        </div>`;

      card.addEventListener("click", () => openLightbox(report));
      gallery.appendChild(card);
    });
  }

  // Place markers on map
  function renderPhotoMarkersOnMap() {
    photoMarkersGroup.clearLayers();
    fieldReports.forEach(r => {
      const lat = parseFloat(r.lat);
      const lon = parseFloat(r.lon);
      if (!isNaN(lat) && !isNaN(lon)) {
        const icon = L.divIcon({
          className: "",
          html: `<div class="photo-map-marker" title="${r.location}">📷</div>`,
          iconSize: [28, 28], iconAnchor: [14, 14]
        });
        const marker = L.marker([lat, lon], { icon });
        const riskLevel = (r.risk_level || r.riskLevel || "MODERATE").toUpperCase();
        const color = riskLevel === "CRITICAL" ? "#dc2626" : riskLevel === "HIGH" ? "#ea580c" : riskLevel === "MODERATE" ? "#d97706" : "#059669";
        const username = r.username ? `@${r.username}` : "@citizen";
        const timeStr = formatReportTime(r);

        marker.bindPopup(`
          <div style="font-family:'Outfit',sans-serif;font-size:12px;min-width:180px;padding:2px;">
            <div style="font-weight:800;color:#00e5ff;margin-bottom:4px;display:flex;align-items:center;gap:4px;">
              📷 Field Report
            </div>
            <div style="font-weight:700;color:#fff;font-size:13px;margin-bottom:2px;">${r.location}</div>
            <div style="color:#94a3b8;font-size:11px;margin-bottom:4px;">Reported by <strong style="color:#38bdf8;">${username}</strong> · ${timeStr}</div>
            <div style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:800;background:${color}22;color:${color};border:1px solid ${color}44;">
              ${riskLevel} RISK
            </div>
          </div>
        `);
        marker.addTo(photoMarkersGroup);
      }
    });
  }

  // ── LOAD FIELD REPORTS FROM BACKEND ───────────────────────────────────────
  async function loadFieldReports() {
    try {
      let reports = null;
      if (window.FlaskML && typeof window.FlaskML.getFieldReports === "function") {
        reports = await window.FlaskML.getFieldReports();
      } else {
        const res = await fetch("/api/field-reports");
        if (res.ok) {
          const data = await res.json();
          reports = data.reports;
        }
      }
      if (reports && Array.isArray(reports)) {
        fieldReports = reports;
        renderFieldReportsGallery();
        renderPhotoMarkersOnMap();
      }
    } catch (e) {
      console.warn("[DHARA] Error loading field reports from backend:", e);
      renderFieldReportsGallery();
      renderPhotoMarkersOnMap();
    }
  }

  // Initial load
  loadFieldReports();

  // ── LIGHTBOX ─────────────────────────────────────────────────────────────
  const lightboxModal = document.getElementById("photo-lightbox-modal");
  const btnCloseLightbox = document.getElementById("btn-close-lightbox");
  if (btnCloseLightbox) {
    btnCloseLightbox.addEventListener("click", () => lightboxModal.classList.remove("open"));
  }
  if (lightboxModal) {
    lightboxModal.addEventListener("click", e => { if (e.target === lightboxModal) lightboxModal.classList.remove("open"); });
  }

  function openLightbox(report) {
    const mainImg = document.getElementById("lightbox-img");
    const metaContainer = document.getElementById("lightbox-meta");
    const notesContainer = document.getElementById("lightbox-notes");

    const imgSrc = getReportImageSrc(report);
    const riskLevel = (report.risk_level || report.riskLevel || "MODERATE").toUpperCase();
    const isPending = report.status === "Pending Verification" || report.pending;
    const timeStr = formatReportTime(report);
    const username = report.username ? `@${report.username}` : "@citizen";
    const lat = report.lat ? parseFloat(report.lat) : null;
    const lon = report.lon ? parseFloat(report.lon) : null;

    if (mainImg) {
      mainImg.src = imgSrc || "";
      mainImg.style.display = imgSrc ? "block" : "none";
    }

    if (metaContainer) {
      metaContainer.innerHTML = `
        <div style="background:rgba(255,255,255,0.04);border:1px solid var(--border-color);border-radius:6px;padding:8px;">
          📍 Location<br><strong style="color:#fff;">${report.location || "Unknown"}</strong>
        </div>
        <div style="background:rgba(255,255,255,0.04);border:1px solid var(--border-color);border-radius:6px;padding:8px;">
          ⚠️ Risk Level<br><strong style="${(RISK_BADGE_STYLES[riskLevel] || RISK_BADGE_STYLES.MODERATE).replace('background:','color:').split(';')[0]}">${riskLevel}</strong>
        </div>
        <div style="background:rgba(255,255,255,0.04);border:1px solid var(--border-color);border-radius:6px;padding:8px;">
          ⏱️ Reported<br><strong style="color:#fff;">${timeStr}</strong>
        </div>
        <div style="background:rgba(255,255,255,0.04);border:1px solid var(--border-color);border-radius:6px;padding:8px;">
          👤 Submitted by<br><strong style="color:var(--primary-cyan);">${username}</strong>
        </div>
        <div style="background:rgba(255,255,255,0.04);border:1px solid var(--border-color);border-radius:6px;padding:8px;">
          🔖 Status<br><strong style="color:${isPending ? "var(--accent-gold)" : "var(--risk-low)"};">${isPending ? "Pending Verification" : "Verified"}</strong>
        </div>
        <div style="background:rgba(255,255,255,0.04);border:1px solid var(--border-color);border-radius:6px;padding:8px;">
          🌐 Coordinates<br><strong style="color:#cbd5e1;font-size:11px;">${lat && lon ? `Lat ${lat.toFixed(4)}°, Lon ${lon.toFixed(4)}°` : "Estimated"}</strong>
        </div>
      `;
    }

    if (notesContainer) {
      notesContainer.innerHTML = report.notes
        ? `<strong style="color:var(--text-muted);font-size:11px;letter-spacing:0.5px;">FIELD OBSERVATION NOTES</strong><div style="color:#e2e8f0;margin-top:4px;line-height:1.6;font-size:13px;">${report.notes}</div>` : `<span style="color:var(--text-muted);font-style:italic;">No additional observation notes recorded.</span>`;
    }

    if (lightboxModal) {
      lightboxModal.classList.add("open");
    }
  }

  // ── DRAG & DROP UPLOAD ZONE ───────────────────────────────────────────────
  let stagedFiles = []; // Array of { file, dataUrl }

  const dropzone = document.getElementById("photo-dropzone");
  const fileInput = document.getElementById("photo-file-input");
  const cameraInput = document.getElementById("photo-camera-input");
  const metaForm = document.getElementById("photo-meta-form");
  const stagingDiv = document.getElementById("photo-preview-staging");
  const previewGrid = document.getElementById("photo-preview-grid");

  if (dropzone) {
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
  }

  if (fileInput) {
    fileInput.addEventListener("change", () => handleFiles([...fileInput.files]));
  }
  if (cameraInput) {
    cameraInput.addEventListener("change", () => handleFiles([...cameraInput.files]));
  }
  const btnCameraCapture = document.getElementById("btn-camera-capture");
  if (btnCameraCapture) {
    btnCameraCapture.addEventListener("click", e => {
      e.stopPropagation();
      cameraInput.click();
    });
  }

  function handleFiles(files) {
    const imageFiles = files.filter(f => f.type.startsWith("image/") || /\.(jpg|jpeg|png|webp)$/i.test(f.name));
    if (!imageFiles.length) {
      showToast("⚠️ Please select a valid JPG, PNG, or WEBP image file.");
      return;
    }
    
    // Auto-fill current timestamp
    const photoDateInput = document.getElementById("photo-date");
    if (photoDateInput && !photoDateInput.value) {
      photoDateInput.value = new Date().toLocaleString();
    }

    imageFiles.forEach(file => {
      // 1. Read EXIF Data asynchronously
      if (window.exifr) {
        exifr.parse(file).then(exifData => {
          if (exifData) {
            if (exifData.latitude && exifData.longitude) {
              const photoLat = document.getElementById("photo-lat");
              const photoLon = document.getElementById("photo-lon");
              if (photoLat) photoLat.value = exifData.latitude.toFixed(6);
              if (photoLon) photoLon.value = exifData.longitude.toFixed(6);
            }
            if (exifData.DateTimeOriginal && photoDateInput) {
              photoDateInput.value = new Date(exifData.DateTimeOriginal).toLocaleString();
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

    if (metaForm) metaForm.style.display = "block";
    if (stagingDiv) stagingDiv.style.display = "block";
  }

  function renderStagingPreviews() {
    if (!previewGrid) return;
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
          if (metaForm) metaForm.style.display = "none";
          if (stagingDiv) stagingDiv.style.display = "none";
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
        const latLonStr = `Lat ${typeof lat === 'number' ? lat.toFixed(6) : lat}°  |  Long ${typeof lon === 'number' ? lon.toFixed(6) : lon}°`;
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

  function dataUrlToBlob(dataUrl) {
    try {
      const parts = dataUrl.split(";base64,");
      const contentType = parts[0].split(":")[1] || "image/jpeg";
      const raw = window.atob(parts[1]);
      const rawLength = raw.length;
      const uInt8Array = new Uint8Array(rawLength);
      for (let i = 0; i < rawLength; ++i) {
        uInt8Array[i] = raw.charCodeAt(i);
      }
      return new Blob([uInt8Array], { type: contentType });
    } catch (_) {
      return null;
    }
  }

  // ── SUBMIT FIELD REPORT TO CENTRALIZED FLASK BACKEND ──────────────────────
  const btnSubmitPhoto = document.getElementById("btn-submit-photo");
  if (btnSubmitPhoto) {
    btnSubmitPhoto.addEventListener("click", async () => {
      if (!stagedFiles.length) {
        showToast("⚠️ Please select or capture a photo first.");
        return;
      }

      // Check authentication
      if (window.Auth && !window.Auth.isLoggedIn()) {
        showToast("⚠️ You must be logged in to submit a field report.");
        return;
      }
      const token = window.Auth ? window.Auth.getToken() : null;

      const locationInput = document.getElementById("photo-location");
      const location = locationInput ? (locationInput.value.trim() || "Unknown Location") : "Unknown Location";
      const riskLevel = document.getElementById("photo-risk-level") ? document.getElementById("photo-risk-level").value : "MODERATE";
      const notes = document.getElementById("photo-notes") ? document.getElementById("photo-notes").value.trim() : "";
      
      let latVal = parseFloat(document.getElementById("photo-lat")?.value);
      let lonVal = parseFloat(document.getElementById("photo-lon")?.value);
      const dateVal = document.getElementById("photo-date")?.value.trim() || new Date().toISOString();

      // Fallback coordinates if EXIF/manual is missing
      if (isNaN(latVal) || isNaN(lonVal)) {
        const matchedStation = PRESET_STATIONS.find(st =>
          location.toLowerCase().includes(st.state.toLowerCase()) ||
          location.toLowerCase().includes(st.district.toLowerCase().split(" ")[0])
        ) || PRESET_STATIONS[Math.floor(Math.random() * PRESET_STATIONS.length)];
        
        latVal = matchedStation.lat + (Math.random() - 0.5) * 0.05;
        lonVal = matchedStation.lon + (Math.random() - 0.5) * 0.05;
      }

      // Visual feedback: Disable button & show spinner
      const origBtnHTML = btnSubmitPhoto.innerHTML;
      btnSubmitPhoto.disabled = true;
      btnSubmitPhoto.innerHTML = `<span style="display:flex;align-items:center;gap:6px;justify-content:center;">
        <span style="display:inline-block;width:14px;height:14px;border:2px solid #fff;border-top-color:transparent;border-radius:50%;animation:pendingPulse 0.8s linear infinite;"></span>
        Uploading to Backend...
      </span>`;

      try {
        const formData = new FormData();
        formData.append("location", location);
        formData.append("lat", latVal);
        formData.append("lon", lonVal);
        formData.append("risk_level", riskLevel);
        formData.append("notes", notes);
        formData.append("timestamp", dateVal);

        // Process staged images with geotag watermark
        for (let i = 0; i < stagedFiles.length; i++) {
          const item = stagedFiles[i];
          let fileToUpload = item.file;
          try {
            const watermarkedDataUrl = await generateGeotagWatermark(
              item.dataUrl,
              location,
              latVal,
              lonVal,
              dateVal
            );
            const blob = dataUrlToBlob(watermarkedDataUrl);
            if (blob) {
              const filename = item.file.name ? `geotagged_${item.file.name}` : `report_photo_${i + 1}.jpg`;
              fileToUpload = new File([blob], filename, { type: blob.type });
            }
          } catch (wmErr) {
            console.warn("[DHARA] Watermark generation fallback to raw file:", wmErr);
          }
          formData.append("images", fileToUpload);
        }

        // Send to Flask backend
        let result = null;
        if (window.FlaskML && typeof window.FlaskML.submitFieldReport === "function") {
          result = await window.FlaskML.submitFieldReport(formData, token);
        } else {
          const res = await fetch("/api/field-reports", {
            method: "POST",
            headers: token ? { "Authorization": "Bearer " + token } : {},
            body: formData,
          });
          result = await res.json();
          if (!res.ok) {
            throw new Error(result.error || `Upload failed (HTTP ${res.status})`);
          }
        }

        // Reset form on success
        stagedFiles = [];
        if (previewGrid) previewGrid.innerHTML = "";
        if (metaForm) metaForm.style.display = "none";
        if (stagingDiv) stagingDiv.style.display = "none";
        if (locationInput) locationInput.value = "";
        if (document.getElementById("photo-notes")) document.getElementById("photo-notes").value = "";
        if (document.getElementById("photo-lat")) document.getElementById("photo-lat").value = "";
        if (document.getElementById("photo-lon")) document.getElementById("photo-lon").value = "";
        if (document.getElementById("photo-date")) document.getElementById("photo-date").value = "";
        if (document.getElementById("photo-risk-level")) document.getElementById("photo-risk-level").value = "MODERATE";
        if (fileInput) fileInput.value = "";
        if (cameraInput) cameraInput.value = "";

        // Reload centralized reports from backend
        await loadFieldReports();

        // Fly to marker on map
        if (map && !isNaN(latVal) && !isNaN(lonVal)) {
          map.flyTo([latVal, lonVal], 10, { duration: 1.2 });
        }

        showToast(`✅ Field report persisted from ${location}`);

      } catch (err) {
        console.error("[DHARA] Field report submission error:", err);
        showToast(`❌ ${err.message || "Failed to submit field report"}`);
      } finally {
        btnSubmitPhoto.disabled = false;
        btnSubmitPhoto.innerHTML = origBtnHTML;
        if (window.lucide) window.lucide.createIcons();
      }
    });
  }

  const btnCancelPhoto = document.getElementById("btn-cancel-photo");
  if (btnCancelPhoto) {
    btnCancelPhoto.addEventListener("click", () => {
      stagedFiles = [];
      if (previewGrid) previewGrid.innerHTML = "";
      if (metaForm) metaForm.style.display = "none";
      if (stagingDiv) stagingDiv.style.display = "none";
      if (fileInput) fileInput.value = "";
      if (cameraInput) cameraInput.value = "";
    });
  }

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

  // ── ALERT CENTER (ADVANCED ROAD BLOCKAGE & HAZARDS) ───────────────────────
  async function loadAlertCenter() {
    try {
      const incidents = await window.FlaskML.getRoadIncidents(false);
      const alertBadge = document.getElementById("header-alert-badge");
      if (alertBadge) {
        alertBadge.innerText = incidents.length;
        alertBadge.style.display = incidents.length > 0 ? "inline-block" : "none";
      }

      const alertListEl = document.getElementById("alert-center-list");
      if (alertListEl) {
        if (incidents.length === 0) {
          alertListEl.innerHTML = `
            <div style="text-align:center;padding:30px;color:var(--text-muted);">
              <div style="font-size:32px;margin-bottom:8px;">🟢</div>
              <div style="font-weight:700;font-size:14px;color:#fff;">All Major Corridors Clear</div>
              <div style="font-size:12px;">No active road blockages or high-risk incidents reported.</div>
            </div>
          `;
          return;
        }

        alertListEl.innerHTML = "";
        incidents.forEach(inc => {
          const isBlocked = inc.status === "BLOCKED";
          const alertColor = isBlocked ? "#ef4444" : inc.status === "CAUTION" ? "#f59e0b" : "#10b981";
          const card = document.createElement("div");
          card.className = "panel-card";
          card.style.borderColor = alertColor + "55";
          card.style.background = isBlocked ? "rgba(239,68,68,0.08)" : "rgba(245,158,11,0.08)";
          card.style.margin = "0";

          card.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
              <div>
                <span style="font-weight:800;font-size:13px;color:#fff;">${inc.road_name} — ${inc.location_name}</span>
                <div style="font-size:11px;color:var(--text-muted);">${inc.incident_type} · ${inc.authority_source || 'Verified Authority'}</div>
              </div>
              <span class="route-alt-badge" style="background:${alertColor}22;color:${alertColor};border:1px solid ${alertColor};font-weight:800;">
                ${inc.status} (${inc.severity})
              </span>
            </div>
            <div style="font-size:12px;color:#e2e8f0;line-height:1.4;margin-bottom:8px;">
              ${inc.description || 'Active incident on highway.'}
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--text-muted);">
              <span>Reported: ${new Date(inc.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
              <button class="btn-xs-action btn-inspect-alert-map" data-lat="${inc.latitude}" data-lon="${inc.longitude}" data-title="${inc.road_name}: ${inc.location_name}">
                <i data-lucide="map-pin" style="width:12px;height:12px;"></i> View on GIS Map
              </button>
            </div>
          `;
          alertListEl.appendChild(card);
        });

        // Attach zoom listeners
        alertListEl.querySelectorAll(".btn-inspect-alert-map").forEach(btn => {
          btn.addEventListener("click", (e) => {
            const lat = parseFloat(btn.getAttribute("data-lat"));
            const lon = parseFloat(btn.getAttribute("data-lon"));
            if (!isNaN(lat) && !isNaN(lon) && map) {
              const modal = document.getElementById("alert-center-modal");
              if (modal) modal.classList.remove("open");
              map.flyTo([lat, lon], 12, { duration: 1.2 });
            }
          });
        });

        if (window.lucide) window.lucide.createIcons();
      }
    } catch (e) {
      console.warn("[DHARA] loadAlertCenter() error:", e);
    }
  }

  const btnOpenAlertCenter = document.getElementById("btn-open-alert-center");
  const modalAlertCenter = document.getElementById("alert-center-modal");
  const btnCloseAlertCenter = document.getElementById("btn-close-alert-center");

  if (btnOpenAlertCenter && modalAlertCenter) {
    btnOpenAlertCenter.addEventListener("click", () => {
      loadAlertCenter();
      modalAlertCenter.classList.add("open");
      if (window.lucide) window.lucide.createIcons();
    });
  }
  if (btnCloseAlertCenter && modalAlertCenter) {
    btnCloseAlertCenter.addEventListener("click", () => {
      modalAlertCenter.classList.remove("open");
    });
  }

  // ── TWO-STEP SOS EMERGENCY SYSTEM ──────────────────────────────────────────
  let lastCapturedSOSCoords = null;

  function openSOSModal() {
    const sosModal = document.getElementById("sos-modal");
    if (!sosModal) return;
    const confirmStep = document.getElementById("sos-step-confirm");
    const activeStep = document.getElementById("sos-step-active");
    if (confirmStep) confirmStep.style.display = "block";
    if (activeStep) activeStep.style.display = "none";
    sosModal.classList.add("open");
    if (window.lucide) window.lucide.createIcons();
  }

  const btnHeaderSOS = document.getElementById("btn-open-sos");
  const btnFloatingSOS = document.getElementById("btn-floating-sos");
  const btnCloseSOS = document.getElementById("btn-close-sos");
  const btnCancelSOSConfirm = document.getElementById("btn-cancel-sos-confirm");
  const btnProceedSOSConfirm = document.getElementById("btn-proceed-sos-confirm");

  if (btnHeaderSOS) btnHeaderSOS.addEventListener("click", openSOSModal);
  if (btnFloatingSOS) btnFloatingSOS.addEventListener("click", openSOSModal);
  if (btnCloseSOS) btnCloseSOS.addEventListener("click", () => document.getElementById("sos-modal")?.classList.remove("open"));
  if (btnCancelSOSConfirm) btnCancelSOSConfirm.addEventListener("click", () => document.getElementById("sos-modal")?.classList.remove("open"));

  async function loadSOSContacts() {
    const listEl = document.getElementById("sos-saved-contacts-list");
    const mgrListEl = document.getElementById("contacts-manager-list");
    const token = window.Auth ? window.Auth.getToken() : null;

    let contacts = [];
    if (token && window.FlaskML) {
      contacts = await window.FlaskML.getEmergencyContacts(token);
    }

    if (listEl) {
      if (contacts.length === 0) {
        listEl.innerHTML = `<div style="font-size:11px;color:var(--text-muted);padding:4px;">No contacts saved yet. Add your family or tour guide for 1-click calls.</div>`;
      } else {
        listEl.innerHTML = "";
        contacts.forEach(c => {
          const cEl = document.createElement("div");
          cEl.style.cssText = "display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,0.04);border:1px solid var(--border-color);border-radius:4px;padding:6px 10px;";
          cEl.innerHTML = `
            <div>
              <strong style="color:#fff;font-size:12px;">${c.name}</strong>
              <span style="font-size:10px;color:var(--primary-cyan);margin-left:4px;">(${c.relationship})</span>
              <div style="font-size:11px;color:var(--text-muted);">${c.phone}</div>
            </div>
            <a href="tel:${c.phone}" class="btn-xs-action" style="background:#10b981;color:#fff;border:none;text-decoration:none;">
              📞 Call
            </a>
          `;
          listEl.appendChild(cEl);
        });
      }
    }

    if (mgrListEl) {
      if (contacts.length === 0) {
        mgrListEl.innerHTML = `<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:12px;">No emergency contacts saved.</div>`;
      } else {
        mgrListEl.innerHTML = "";
        contacts.forEach(c => {
          const div = document.createElement("div");
          div.style.cssText = "display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,0.03);border:1px solid var(--border-color);border-radius:6px;padding:8px 12px;";
          div.innerHTML = `
            <div>
              <strong style="color:#fff;font-size:13px;">${c.name}</strong>
              <span style="font-size:11px;color:var(--primary-cyan);margin-left:4px;">(${c.relationship})</span>
              <div style="font-size:12px;color:var(--text-muted);">${c.phone}</div>
            </div>
            <button class="btn-xs btn-delete-contact" data-id="${c.id}" style="color:#ef4444;border-color:rgba(239,68,68,0.3);">
              Delete
            </button>
          `;
          mgrListEl.appendChild(div);
        });

        mgrListEl.querySelectorAll(".btn-delete-contact").forEach(btn => {
          btn.addEventListener("click", async () => {
            const id = btn.getAttribute("data-id");
            if (id && token && window.FlaskML) {
              try {
                await window.FlaskML.deleteEmergencyContact(id, token);
                showToast("Contact removed");
                loadSOSContacts();
              } catch (e) {
                showToast("Failed to delete contact: " + e.message);
              }
            }
          });
        });
      }
    }
  }

  if (btnProceedSOSConfirm) {
    btnProceedSOSConfirm.addEventListener("click", async () => {
      const confirmStep = document.getElementById("sos-step-confirm");
      const activeStep = document.getElementById("sos-step-active");
      if (confirmStep) confirmStep.style.display = "none";
      if (activeStep) activeStep.style.display = "block";

      const timeEl = document.getElementById("sos-active-time");
      if (timeEl) timeEl.innerText = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

      const locTextEl = document.getElementById("sos-location-text");
      if (locTextEl) locTextEl.innerHTML = "📍 Location: <em>Acquiring precise GPS coordinates...</em>";

      // Geolocation capture
      const captureAndDispatch = async (lat, lon, accuracy) => {
        lastCapturedSOSCoords = { lat, lon };
        if (locTextEl) {
          locTextEl.innerHTML = `📍 GPS Location: <strong>${lat.toFixed(5)}° N, ${lon.toFixed(5)}° E</strong> ${accuracy ? `(±${Math.round(accuracy)}m)` : ''}`;
        }

        // Draw emergency beacon on map
        if (map) {
          L.circle([lat, lon], { radius: accuracy || 100, color: "#ef4444", fillColor: "#ef4444", fillOpacity: 0.3 }).addTo(map);
          L.marker([lat, lon], {
            icon: L.divIcon({
              className: "",
              html: `<div style="width:36px;height:36px;border-radius:50%;background:#ef4444;border:3px solid #fff;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 0 20px #ef4444;">🆘</div>`,
              iconSize: [36, 36],
              iconAnchor: [18, 18]
            })
          }).addTo(map).bindPopup("<b>🆘 YOUR LIVE SOS LOCATION</b>").openPopup();
        }

        // Dispatch to backend API
        const token = window.Auth ? window.Auth.getToken() : null;
        if (window.FlaskML && typeof window.FlaskML.triggerSOS === "function") {
          try {
            await window.FlaskML.triggerSOS({
              latitude: lat,
              longitude: lon,
              emergency_type: "LANDSLIDE_SOS",
              location_name: `Lat ${lat.toFixed(4)}, Lon ${lon.toFixed(4)}`,
              notes: "Automated emergency dispatch requested via DHARA Portal"
            }, token);
            showToast("🚨 SOS Emergency logged and broadcasted to SDMA");
          } catch (e) {
            console.warn("[DHARA] SOS trigger error:", e);
          }
        }
      };

      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          pos => captureAndDispatch(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
          err => {
            console.warn("[DHARA] GPS geolocation error:", err.message);
            // Fallback to map center
            const center = map ? map.getCenter() : { lat: 25.5788, lng: 91.8933 };
            captureAndDispatch(center.lat, center.lng, 500);
          },
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
        );
      } else {
        const center = map ? map.getCenter() : { lat: 25.5788, lng: 91.8933 };
        captureAndDispatch(center.lat, center.lng, 500);
      }

      await loadSOSContacts();
      if (window.lucide) window.lucide.createIcons();
    });
  }

  // Copy SOS for SMS
  const btnCopySOSSMS = document.getElementById("btn-copy-sos-sms");
  if (btnCopySOSSMS) {
    btnCopySOSSMS.addEventListener("click", () => {
      const lat = lastCapturedSOSCoords?.lat || (map ? map.getCenter().lat : 25.5788);
      const lon = lastCapturedSOSCoords?.lon || (map ? map.getCenter().lng : 91.8933);
      const msg = `EMERGENCY SOS: I need immediate assistance near https://maps.google.com/?q=${lat},${lon} (Lat: ${lat.toFixed(5)}, Lon: ${lon.toFixed(5)}). Please notify NDRF/112. Sent via DHARA Safety.`;
      navigator.clipboard.writeText(msg).then(() => {
        showToast("📋 SOS Emergency SMS copied to clipboard!");
      }).catch(() => {
        showToast("Location: " + lat.toFixed(5) + ", " + lon.toFixed(5));
      });
    });
  }

  // Share SOS Location
  const btnShareSOSLoc = document.getElementById("btn-share-sos-loc");
  if (btnShareSOSLoc) {
    btnShareSOSLoc.addEventListener("click", () => {
      const lat = lastCapturedSOSCoords?.lat || (map ? map.getCenter().lat : 25.5788);
      const lon = lastCapturedSOSCoords?.lon || (map ? map.getCenter().lng : 91.8933);
      const url = `https://maps.google.com/?q=${lat},${lon}`;
      if (navigator.share) {
        navigator.share({
          title: "DHARA Emergency SOS Location",
          text: "EMERGENCY SOS: Immediate assistance required at this location:",
          url: url
        }).catch(() => {});
      } else {
        navigator.clipboard.writeText(url).then(() => showToast("Google Maps link copied to clipboard!"));
      }
    });
  }

  // Emergency Contacts Modal Handlers
  const btnOpenContacts = document.getElementById("btn-open-contacts");
  const modalContacts = document.getElementById("emergency-contacts-modal");
  const btnCloseContactsModal = document.getElementById("btn-close-contacts-modal");
  const btnSOSAddContactShortcut = document.getElementById("btn-sos-add-contact-shortcut");

  if (btnOpenContacts && modalContacts) {
    btnOpenContacts.addEventListener("click", () => {
      loadSOSContacts();
      modalContacts.classList.add("open");
      if (window.lucide) window.lucide.createIcons();
    });
  }
  if (btnSOSAddContactShortcut && modalContacts) {
    btnSOSAddContactShortcut.addEventListener("click", () => {
      loadSOSContacts();
      modalContacts.classList.add("open");
      if (window.lucide) window.lucide.createIcons();
    });
  }
  if (btnCloseContactsModal && modalContacts) {
    btnCloseContactsModal.addEventListener("click", () => modalContacts.classList.remove("open"));
  }

  const formAddContact = document.getElementById("form-add-contact");
  if (formAddContact) {
    formAddContact.addEventListener("submit", async (e) => {
      e.preventDefault();
      const token = window.Auth ? window.Auth.getToken() : null;
      if (!token) {
        showToast("Please log in to save emergency contacts");
        return;
      }
      const name = document.getElementById("contact-name")?.value.trim();
      const phone = document.getElementById("contact-phone")?.value.trim();
      const relationship = document.getElementById("contact-rel")?.value || "Family";

      if (!name || !phone) return;

      try {
        await window.FlaskML.addEmergencyContact({ name, phone, relationship }, token);
        showToast(`✅ Contact "${name}" added`);
        formAddContact.reset();
        await loadSOSContacts();
      } catch (err) {
        showToast(`❌ ${err.message}`);
      }
    });
  }

  // ── ADMIN INCIDENT MANAGEMENT ─────────────────────────────────────────────
  async function loadAdminIncidents() {
    const listEl = document.getElementById("admin-incidents-list");
    if (!listEl) return;

    try {
      const incidents = await window.FlaskML.getRoadIncidents(true);
      if (incidents.length === 0) {
        listEl.innerHTML = `<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:14px;">No road incidents recorded.</div>`;
        return;
      }

      listEl.innerHTML = "";
      incidents.forEach(inc => {
        const isBlocked = inc.status === "BLOCKED";
        const isOpen = inc.status === "OPEN";
        const statusColor = isBlocked ? "#ef4444" : inc.status === "CAUTION" ? "#f59e0b" : "#10b981";

        const div = document.createElement("div");
        div.className = "panel-card";
        div.style.margin = "0";
        div.style.padding = "10px";
        div.style.borderColor = statusColor + "44";

        div.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;">
            <div>
              <strong style="color:#fff;font-size:13px;">${inc.road_name}: ${inc.location_name}</strong>
              <div style="font-size:11px;color:var(--text-muted);">${inc.incident_type} · Severity: ${inc.severity}</div>
            </div>
            <span class="route-alt-badge" style="background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor};">
              ${inc.status}
            </span>
          </div>
          <div style="font-size:11px;color:#cbd5e1;margin-bottom:8px;">${inc.description || 'No description provided.'}</div>
          <div style="display:flex;gap:6px;justify-content:flex-end;">
            ${isBlocked ? `
              <button class="btn-xs btn-toggle-inc-status" data-id="${inc.id}" data-status="OPEN" style="color:#10b981;border-color:rgba(16,185,129,0.4);">
                Mark Open
              </button>
            ` : `
              <button class="btn-xs btn-toggle-inc-status" data-id="${inc.id}" data-status="BLOCKED" style="color:#ef4444;border-color:rgba(239,68,68,0.4);">
                Mark Blocked
              </button>
            `}
            <button class="btn-xs btn-delete-inc" data-id="${inc.id}" style="color:#ef4444;">
              Delete
            </button>
          </div>
        `;
        listEl.appendChild(div);
      });

      // Attach status toggles
      const token = window.Auth ? window.Auth.getToken() : null;
      listEl.querySelectorAll(".btn-toggle-inc-status").forEach(btn => {
        btn.addEventListener("click", async () => {
          const id = btn.getAttribute("data-id");
          const nextStatus = btn.getAttribute("data-status");
          if (id && token) {
            try {
              await window.FlaskML.updateRoadIncident(id, { status: nextStatus }, token);
              showToast(`Status updated to ${nextStatus}`);
              await loadAdminIncidents();
              await loadAlertCenter();
            } catch (err) {
              showToast("Error updating status: " + err.message);
            }
          }
        });
      });

      // Attach deletes
      listEl.querySelectorAll(".btn-delete-inc").forEach(btn => {
        btn.addEventListener("click", async () => {
          const id = btn.getAttribute("data-id");
          if (id && token && confirm("Are you sure you want to delete this incident?")) {
            try {
              await window.FlaskML.deleteRoadIncident(id, token);
              showToast("Incident removed");
              await loadAdminIncidents();
              await loadAlertCenter();
            } catch (err) {
              showToast("Error deleting incident: " + err.message);
            }
          }
        });
      });

    } catch (e) {
      console.warn("[DHARA] loadAdminIncidents() error:", e);
    }
  }

  const btnRefreshAdminIncidents = document.getElementById("btn-refresh-admin-incidents");
  if (btnRefreshAdminIncidents) {
    btnRefreshAdminIncidents.addEventListener("click", loadAdminIncidents);
  }

  const formAdminIncident = document.getElementById("form-admin-incident");
  if (formAdminIncident) {
    formAdminIncident.addEventListener("submit", async (e) => {
      e.preventDefault();
      const token = window.Auth ? window.Auth.getToken() : null;
      if (!token) {
        showToast("Admin authorization required");
        return;
      }

      const id = document.getElementById("admin-inc-id")?.value;
      const road_name = document.getElementById("admin-inc-road")?.value.trim();
      const location_name = document.getElementById("admin-inc-location")?.value.trim();
      const latitude = parseFloat(document.getElementById("admin-inc-lat")?.value);
      const longitude = parseFloat(document.getElementById("admin-inc-lon")?.value);
      const incident_type = document.getElementById("admin-inc-type")?.value;
      const status = document.getElementById("admin-inc-status")?.value;
      const severity = document.getElementById("admin-inc-severity")?.value;
      const authority_source = document.getElementById("admin-inc-source")?.value.trim();
      const description = document.getElementById("admin-inc-desc")?.value.trim();

      const incidentData = {
        road_name, location_name, latitude, longitude,
        incident_type, status, severity, authority_source, description
      };

      try {
        if (id) {
          await window.FlaskML.updateRoadIncident(id, incidentData, token);
          showToast("Incident updated successfully");
        } else {
          await window.FlaskML.createRoadIncident(incidentData, token);
          showToast("New incident published & corridor alerts active");
        }
        formAdminIncident.reset();
        document.getElementById("admin-inc-id").value = "";
        await loadAdminIncidents();
        await loadAlertCenter();
      } catch (err) {
        showToast(`❌ ${err.message}`);
      }
    });
  }

  // Load initial alerts & incidents
  loadAlertCenter();
  if (window.Auth && (window.Auth.getUser()?.role === "admin" || window.Auth.getUser()?.username === "admin")) {
    const adminTabBtn = document.getElementById("tab-btn-admin");
    if (adminTabBtn) adminTabBtn.style.display = "flex";
    loadAdminIncidents();
  }

  // ── Initial risk calculation & journey date setup ─────────────────────────
  const journeyDateInput = document.getElementById("journey-date");
  if (journeyDateInput) {
    const todayStr = getLocalDateString();
    journeyDateInput.min = todayStr;
    if (!journeyDateInput.value || journeyDateInput.value < todayStr) {
      journeyDateInput.value = todayStr;
    }

    journeyDateInput.addEventListener("change", function () {
      const curToday = getLocalDateString();
      journeyDateInput.min = curToday;
      if (this.value && this.value < curToday) {
        this.value = curToday;
        showToast("⚠️ Past dates cannot be predicted. Date reset to today.");
      }
    });
  }
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
