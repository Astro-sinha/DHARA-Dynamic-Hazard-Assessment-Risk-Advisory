/**
 * auth.js — DHARA Authentication Client
 * =======================================
 * Manages login state, session token, and user info.
 * Must be loaded BEFORE app.js on index.html.
 *
 * Exposed on window.Auth:
 *   Auth.isLoggedIn()    → bool
 *   Auth.getToken()      → string | null
 *   Auth.getUser()       → { username, first_name, last_name } | null
 *   Auth.logout()        → redirects to /login
 *   Auth.guardPage()     → redirects to /login if not authenticated
 */

(function () {
  "use strict";

  const TOKEN_KEY = "dhara_auth_token";
  const USER_KEY  = "dhara_auth_user";

  /* ── Token & User Storage ──────────────────────────────────────────────── */

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function getUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function saveSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function isLoggedIn() {
    return !!getToken() && !!getUser();
  }

  /* ── Page Guard ────────────────────────────────────────────────────────── */

  /**
   * Call this at the top of index.html.
   * If user is not logged in, redirect to /login immediately.
   * If user is logged in, inject the user chip into the header.
   */
  async function guardPage() {
    if (!isLoggedIn()) {
      window.location.href = "/login";
      return;
    }

    // Validate token with server (async, best-effort)
    const token = getToken();
    try {
      const res = await fetch("/api/auth/me", {
        headers: { "Authorization": "Bearer " + token }
      });
      if (!res.ok) {
        // Token expired or invalid
        clearSession();
        window.location.href = "/login";
        return;
      }
      const data = await res.json();
      // Refresh stored user data
      saveSession(token, data.user);
      _injectUserChip(data.user);
    } catch (_) {
      // Network error — allow access with cached user data (offline tolerance)
      const user = getUser();
      if (user) _injectUserChip(user);
    }
  }

  /* ── Logout ────────────────────────────────────────────────────────────── */

  async function logout() {
    const token = getToken();
    // Tell server to invalidate session (best-effort)
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Authorization": "Bearer " + token }
      });
    } catch (_) {}
    clearSession();
    window.location.href = "/login";
  }

  /* ── Header User Chip ──────────────────────────────────────────────────── */

  function _injectUserChip(user) {
    // Wait for DOM if needed
    const _inject = () => {
      const headerStatus = document.querySelector(".header-status");
      if (!headerStatus) return;

      // Avoid duplicates
      if (document.getElementById("user-profile-chip")) return;

      const initials = ((user.first_name || "?")[0] + (user.last_name || "?")[0]).toUpperCase();
      const fullName = `${user.first_name} ${user.last_name}`;

      const chip = document.createElement("div");
      chip.id = "user-profile-chip";
      chip.className = "user-profile-chip";
      chip.innerHTML = `
        <div class="user-avatar" title="${fullName}">${initials}</div>
        <div class="user-chip-info">
          <div class="user-chip-name">Hi, ${user.first_name}!</div>
          <div class="user-chip-username">@${user.username}</div>
        </div>
        <button class="user-logout-btn" id="btn-auth-logout" title="Logout">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </button>
      `;

      // Insert before the first button in header-status
      const firstBtn = headerStatus.querySelector("button") || headerStatus.querySelector(".flask-status-badge");
      if (firstBtn) {
        headerStatus.insertBefore(chip, firstBtn);
      } else {
        headerStatus.appendChild(chip);
      }

      document.getElementById("btn-auth-logout").addEventListener("click", logout);
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", _inject);
    } else {
      _inject();
    }
  }

  /* ── Public API ────────────────────────────────────────────────────────── */

  window.Auth = {
    isLoggedIn,
    getToken,
    getUser,
    saveSession,
    clearSession,
    logout,
    guardPage,
  };

})();
