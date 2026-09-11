/**
 * flask_client.js — DHARA Flask ML API Client
 * =============================================
 * Communicates with the Flask backend REST API.
 * If Flask is unreachable, all calls return null so app.js
 * can fall back to the local risk_engine.js computation.
 *
 * Exported globals used by app.js:
 *   window.FlaskML.isConnected  → bool
 *   window.FlaskML.predict(params) → Promise<result|null>
 *   window.FlaskML.getStations()   → Promise<stations[]|null>
 *   window.FlaskML.getModelInfo()  → Promise<info|null>
 *   window.FlaskML.getFeatureImportances() → Promise<features[]|null>
 *   window.FlaskML.broadcastAlert(data)    → Promise<log|null>
 */

(function () {
  "use strict";

  /* ── Configuration ──────────────────────────────────────────────────────── */
  let _activeBaseUrl = "";        // auto-detected backend URL
  const CANDIDATE_URLS = ["", "http://127.0.0.1:5000", "http://localhost:5000", "http://localhost:8080"];
  const TIMEOUT_MS = 6000;        // give up after 6 s

  /* ── State ──────────────────────────────────────────────────────────────── */
  let _connected = false;

  /* ── Helpers ────────────────────────────────────────────────────────────── */

  function _setStatus(connected, text) {
    _connected = connected;
    const badge = document.getElementById("flask-status-badge");
    const dot   = document.getElementById("flask-status-dot");
    const label = document.getElementById("flask-status-label");
    if (!badge) return;
    badge.classList.remove("connected", "error");
    badge.classList.add(connected ? "connected" : "error");
    if (label) label.textContent = text;
  }

  async function _fetchWithTimeout(url, options = {}, ms = TIMEOUT_MS) {
    const baseUrl = _activeBaseUrl || "";
    const fullUrl = url.startsWith("http") ? url : (baseUrl + url);
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), ms);
    try {
      const res = await fetch(fullUrl, { ...options, signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  }

  async function _getJSON(url) {
    const res = await _fetchWithTimeout(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function _postJSON(url, body) {
    const res = await _fetchWithTimeout(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });
    if (!res.ok) {
      let errData = null;
      try { errData = await res.json(); } catch (_) {}
      if (errData && errData.error) {
        throw new Error(errData.error);
      }
      throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
  }

  /* ── Health Check ───────────────────────────────────────────────────────── */

  async function _checkHealth() {
    for (const base of CANDIDATE_URLS) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(base + "/api/health", { signal: controller.signal });
        clearTimeout(timer);
        if (res.ok) {
          const data = await res.json();
          if (data && data.model_loaded) {
            _activeBaseUrl = base;
            _setStatus(true, "ML API: CONNECTED");
            _updateFlaskModelTab(null);
            console.info("[FlaskML] Connected to backend at:", base || "same-origin");
            return true;
          }
        }
      } catch (_) {}
    }
    _setStatus(false, "ML API: OFFLINE");
    return false;
  }

  /* ── Prediction ─────────────────────────────────────────────────────────── */

  /**
   * Send slider/station params to the backend for live ML inference.
   * Returns the parsed result object or null on failure.
   *
   * @param {Object} params - Keys matching /api/predict POST body
   * @returns {Promise<Object|null>}
   */
  async function predict(params) {
    if (!_connected && !(await _checkHealth())) return null;
    try {
      return await _postJSON("/api/predict", params);
    } catch (e) {
      console.warn("[FlaskML] predict() failed:", e.message);
      _setStatus(false, "ML API: ERROR");
      _connected = false;
      return null;
    }
  }

  /**
   * Send route parameters (from, to, date, route_coordinates) to Flask backend
   * for date-wise weather lookup + ML landslide risk analysis.
   *
   * @param {Object} params - { from, to, date, route_coordinates, from_lat, from_lon, to_lat, to_lon }
   * @returns {Promise<Object|null>}
   */
  async function predictRouteRisk(params) {
    if (!_connected) {
      await _checkHealth();
    }
    try {
      return await _postJSON("/api/route-risk", params);
    } catch (e) {
      console.warn("[FlaskML] predictRouteRisk() failed:", e.message);
      // Try candidate URLs once if failed
      for (const base of CANDIDATE_URLS) {
        if (base === _activeBaseUrl) continue;
        try {
          const res = await fetch(base + "/api/route-risk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
          });
          if (res.ok) {
            _activeBaseUrl = base;
            _connected = true;
            _setStatus(true, "ML API: CONNECTED");
            return await res.json();
          }
        } catch (_) {}
      }
      const isNetworkError = (
        e.name === "AbortError" ||
        e.message.includes("aborted") ||
        e.message.includes("Failed to fetch") ||
        e.message.includes("NetworkError") ||
        e.message.startsWith("HTTP 5")
      );
      if (isNetworkError) return null;
      return { success: false, error: e.message };
    }
  }

  async function getRouteHistory() {
    if (!_connected) return null;
    try {
      const data = await _getJSON("/api/route-history");
      return data.history || null;
    } catch (e) {
      console.warn("[FlaskML] getRouteHistory() failed:", e.message);
      return null;
    }
  }

  /* ── Station Telemetry ──────────────────────────────────────────────────── */

  async function getStations() {
    if (!_connected) return null;
    try {
      const data = await _getJSON("/api/stations");
      return data.stations || null;
    } catch (e) {
      console.warn("[FlaskML] getStations() failed:", e.message);
      return null;
    }
  }

  /* ── Model Info ─────────────────────────────────────────────────────────── */

  async function getModelInfo() {
    if (!_connected) return null;
    try {
      return await _getJSON("/api/model/info");
    } catch (e) {
      console.warn("[FlaskML] getModelInfo() failed:", e.message);
      return null;
    }
  }

  async function getFeatureImportances() {
    if (!_connected) return null;
    try {
      const data = await _getJSON("/api/model/feature-importance");
      return data.features || null;
    } catch (e) {
      console.warn("[FlaskML] getFeatureImportances() failed:", e.message);
      return null;
    }
  }

  /* ── Alert Broadcasting ─────────────────────────────────────────────────── */

  async function broadcastAlert(alertData) {
    if (!_connected) return null;
    try {
      return await _postJSON("/api/alerts/broadcast", alertData);
    } catch (e) {
      console.warn("[FlaskML] broadcastAlert() failed:", e.message);
      return null;
    }
  }

  /* ── Flask ML Model Tab Updater ─────────────────────────────────────────── */

  async function _updateFlaskModelTab() {
    try {
      const [info, importances] = await Promise.all([
        _getJSON("/api/model/info"),
        _getJSON("/api/model/feature-importance"),
      ]);

      // Status block
      const statusText = document.getElementById("flask-ml-status-text");
      const modelType  = document.getElementById("flask-ml-model-type");
      const labelSrc   = document.getElementById("flask-ml-label-source");
      const features   = document.getElementById("flask-ml-features");
      const classes    = document.getElementById("flask-ml-classes");
      const evalReport = document.getElementById("flask-eval-report");

      if (statusText) {
        statusText.textContent = "CONNECTED — Model Loaded";
        statusText.style.color = "#10b981";
      }
      if (modelType)  modelType.textContent  = info.model_type || "RandomForestClassifier";
      if (labelSrc) {
        const src = info.label_source || "unknown";
        labelSrc.textContent = src.toUpperCase() + (src === "real" ? " (Ground-Truth Records ✅)" : " (Proxy Heuristic ⚠️)");
      }
      if (features) features.textContent = `${info.n_features || 27} engineered features`;
      if (classes) {
        const labels = info.risk_classes ? Object.values(info.risk_classes) : ["Low", "Medium", "High"];
        classes.textContent = labels.join(" / ");
      }
      if (evalReport && info.evaluation_report) {
        evalReport.textContent = info.evaluation_report;
      }

      // Feature importance list (Top 10)
      const listEl = document.getElementById("flask-feature-list");
      if (listEl && importances.features && importances.features.length) {
        const top10 = importances.features.slice(0, 10);
        const maxImp = top10[0].importance;
        listEl.innerHTML = top10.map((f, i) => {
          const pct  = ((f.importance / maxImp) * 100).toFixed(1);
          const rank = ["🥇","🥈","🥉"][i] || `#${i + 1}`;
          return `
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-size:12px;width:20px;text-align:center;">${rank}</span>
              <div style="flex:1;">
                <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px;">
                  <span style="color:#e2e8f0;font-weight:600;">${f.feature.replace(/_/g,' ')}</span>
                  <span style="color:var(--primary-cyan);">${(f.importance*100).toFixed(2)}%</span>
                </div>
                <div style="height:5px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;">
                  <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#00e5ff,#2563eb);border-radius:3px;transition:width 0.6s ease;"></div>
                </div>
              </div>
            </div>`;
        }).join("");
      }

      // Mark the analytics feature-importance source
      const src = document.getElementById("feature-importance-source");
      if (src) src.textContent = "Flask ML API";

    } catch (e) {
      console.warn("[FlaskML] _updateFlaskModelTab() failed:", e.message);
    }
  }

  /* ── Probability Bar Renderer ────────────────────────────────────────────── */

  /**
   * Render a segmented probability bar in #ml-prob-bar.
   * @param {Object} classProbs - e.g. {Low: 0.12, Medium: 0.17, High: 0.71}
   */
  function renderProbBar(classProbs) {
    const container = document.getElementById("ml-prob-bar-container");
    const barEl     = document.getElementById("ml-prob-bar");
    const legendEl  = document.getElementById("ml-prob-legend");
    if (!container || !barEl || !legendEl) return;

    container.style.display = "block";

    const COLORS = { Low: "#10b981", Medium: "#f59e0b", High: "#f97316", Critical: "#ef4444" };
    const entries = Object.entries(classProbs);

    barEl.innerHTML = entries.map(([cls, prob]) => `
      <div class="prob-bar-seg"
           style="flex:${(prob * 100).toFixed(1)};background:${COLORS[cls] || "#9ca3af"};"
           title="${cls}: ${(prob * 100).toFixed(1)}%">
      </div>`).join("");

    legendEl.innerHTML = entries.map(([cls, prob]) => `
      <span style="color:${COLORS[cls] || "#9ca3af"};">${cls} ${(prob*100).toFixed(0)}%</span>`).join("");
  }

  /* ── Update UI from Flask ML Prediction ─────────────────────────────────── */

  /**
   * Called by app.js after receiving a Flask prediction response.
   * Updates all Flask-specific UI elements (engine source label, prob bar, etc.)
   */
  function applyPredictionToUI(result) {
    if (!result) return;

    // Engine source label under Flask RF box
    const sourceEl = document.getElementById("flask-engine-source");
    if (sourceEl) {
      const src = result.model_trained_on || "?";
      sourceEl.textContent = src === "real"
        ? "Real Ground-Truth Data ✅"
        : "Proxy Heuristic Labels ⚠️";
      sourceEl.style.color = src === "real" ? "#10b981" : "#f59e0b";
    }

    // Probability bar
    if (result.class_probabilities) {
      renderProbBar(result.class_probabilities);
    }
  }

  /* ── Dynamic Feature Importance Chart Update ────────────────────────────── */

  /**
   * Called by app.js after Chart.js analytics chart is initialised.
   * Overwrites the static chart data with live Flask importances.
   * @param {Chart} chartInstance - The Chart.js chart instance
   */
  async function updateFeatureImportanceChart(chartInstance) {
    if (!_connected || !chartInstance) return;
    try {
      const data = await _getJSON("/api/model/feature-importance");
      if (!data.features || !data.features.length) return;
      // Top 15 features (chart is horizontal bar)
      const top15 = data.features.slice(0, 15).reverse();   // Chart.js renders bottom-to-top
      chartInstance.data.labels   = top15.map(f => f.feature.replace(/_/g, " "));
      chartInstance.data.datasets[0].data = top15.map(f => parseFloat((f.importance * 100).toFixed(2)));
      chartInstance.update("active");
      const src = document.getElementById("feature-importance-source");
      if (src) src.textContent = "Flask ML API ✅";
    } catch (e) {
      console.warn("[FlaskML] updateFeatureImportanceChart() failed:", e.message);
    }
  }

  /* ── Field Reporting API ────────────────────────────────────────────────── */

  async function getFieldReports() {
    try {
      const data = await _getJSON("/api/field-reports");
      return data.reports || [];
    } catch (e) {
      console.warn("[FlaskML] getFieldReports() failed:", e.message);
      return null;
    }
  }

  async function submitFieldReport(formData, token) {
    const headers = {};
    if (token) {
      headers["Authorization"] = "Bearer " + token;
    }
    const res = await _fetchWithTimeout("/api/field-reports", {
      method: "POST",
      headers,
      body: formData,
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error || `Upload failed (HTTP ${res.status})`);
    }
    return json;
  }

  /* ── Road Incidents API ─────────────────────────────────────────────────── */

  async function getRoadIncidents(all = false) {
    try {
      const data = await _getJSON(`/api/road-incidents${all ? "?all=true" : ""}`);
      return data.incidents || [];
    } catch (e) {
      console.warn("[FlaskML] getRoadIncidents() failed:", e.message);
      return [];
    }
  }

  async function createRoadIncident(incidentData, token) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = "Bearer " + token;
    const res = await _fetchWithTimeout("/api/road-incidents", {
      method: "POST",
      headers,
      body: JSON.stringify(incidentData)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `Failed to create incident (${res.status})`);
    return json;
  }

  async function updateRoadIncident(incidentId, incidentData, token) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = "Bearer " + token;
    const res = await _fetchWithTimeout(`/api/road-incidents/${incidentId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(incidentData)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `Failed to update incident (${res.status})`);
    return json;
  }

  async function deleteRoadIncident(incidentId, token) {
    const headers = {};
    if (token) headers["Authorization"] = "Bearer " + token;
    const res = await _fetchWithTimeout(`/api/road-incidents/${incidentId}`, {
      method: "DELETE",
      headers
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `Failed to delete incident (${res.status})`);
    return json;
  }

  /* ── SOS & Emergency Contacts API ────────────────────────────────────────── */

  async function triggerSOS(sosData, token) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = "Bearer " + token;
    const res = await _fetchWithTimeout("/api/sos", {
      method: "POST",
      headers,
      body: JSON.stringify(sosData)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `SOS dispatch failed (${res.status})`);
    return json;
  }

  async function getEmergencyContacts(token) {
    if (!token) return [];
    try {
      const res = await _fetchWithTimeout("/api/sos/contacts", {
        headers: { "Authorization": "Bearer " + token }
      });
      const data = await res.json();
      return data.contacts || [];
    } catch (e) {
      console.warn("[FlaskML] getEmergencyContacts() failed:", e.message);
      return [];
    }
  }

  async function addEmergencyContact(contactData, token) {
    const res = await _fetchWithTimeout("/api/sos/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify(contactData)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `Failed to add contact (${res.status})`);
    return json;
  }

  async function deleteEmergencyContact(contactId, token) {
    const res = await _fetchWithTimeout(`/api/sos/contacts/${contactId}`, {
      method: "DELETE",
      headers: { "Authorization": "Bearer " + token }
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `Failed to delete contact (${res.status})`);
    return json;
  }

  /* ── Bootstrap ──────────────────────────────────────────────────────────── */

  async function _init() {
    await _checkHealth();
  }

  // Wait for DOM ready before touching DOM elements
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _init);
  } else {
    _init();
  }

  /* ── Public API ─────────────────────────────────────────────────────────── */

  window.FlaskML = {
    get isConnected() { return _connected; },
    predict,
    predictRouteRisk,
    getRouteHistory,
    getStations,
    getModelInfo,
    getFeatureImportances,
    broadcastAlert,
    getFieldReports,
    submitFieldReport,
    getRoadIncidents,
    createRoadIncident,
    updateRoadIncident,
    deleteRoadIncident,
    triggerSOS,
    getEmergencyContacts,
    addEmergencyContact,
    deleteEmergencyContact,
    applyPredictionToUI,
    updateFeatureImportanceChart,
    renderProbBar,
  };

})();

