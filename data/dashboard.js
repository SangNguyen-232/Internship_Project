(function () {
  "use strict";

  var MAX_POINTS = 8;
  var DEFAULT_LAT = 10.880018;
  var DEFAULT_LNG = 106.806336;

  var state = {
    pumpState: "ON",
    pumpMode: "AUTO", // AUTO | MANUAL (mirrors pump_mode / pump_controller from firmware)
    lat: DEFAULT_LAT,
    lng: DEFAULT_LNG,
  };

  // ---------- DOM refs ----------
  var els = {
    temp: document.getElementById("statTemp"),
    humi: document.getElementById("statHumi"),
    soil: document.getElementById("statSoil"),
    time: document.getElementById("statTime"),
    score: document.getElementById("statScore"),
    message: document.getElementById("statMessage"),
    coreiotDot: document.getElementById("coreiotDot"),
    pumpBadge: document.getElementById("pumpBadge"),
    modeBadge: document.getElementById("modeBadge"),
    pumpToggleBtn: document.getElementById("pumpToggleBtn"),
    modeToggleBtn: document.getElementById("modeToggleBtn"),
  };

  // ---------- Clock (client-side, always available even without NTP) ----------
  function tickClock() {
    var now = new Date();
    var pad = function (n) { return n < 10 ? "0" + n : "" + n; };
    els.time.textContent = pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds());
  }
  tickClock();
  setInterval(tickClock, 1000);

  // ---------- Sensor chart ----------
  var chart = null;
  function nowLabel() {
    var now = new Date();
    var pad = function (n) { return n < 10 ? "0" + n : "" + n; };
    return pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds());
  }

  function initChart() {
    var ctx = document.getElementById("sensorChart").getContext("2d");
    chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          { label: "Temperature (°C)", data: [], borderColor: "#f5a524", backgroundColor: "transparent", tension: 0.35, pointRadius: 3, borderWidth: 2 },
          { label: "Humidity (%)", data: [], borderColor: "#4aa3ff", backgroundColor: "transparent", tension: 0.35, pointRadius: 3, borderWidth: 2 },
          { label: "Soil Moisture (%)", data: [], borderColor: "#2ecc71", backgroundColor: "transparent", tension: 0.35, pointRadius: 3, borderWidth: 2 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#828ba3", font: { size: 10 } }, grid: { color: "rgba(255,255,255,0.05)" } },
          y: { min: 0, max: 100, ticks: { color: "#828ba3", font: { size: 10 } }, grid: { color: "rgba(255,255,255,0.05)" } },
        },
      },
    });
  }

  function pushChartPoint(temp, humi, soil) {
    if (!chart) return;
    var labels = chart.data.labels;
    var d = chart.data.datasets;
    labels.push(nowLabel());
    d[0].data.push(temp);
    d[1].data.push(humi);
    d[2].data.push(soil);
    if (labels.length > MAX_POINTS) {
      labels.shift();
      d[0].data.shift();
      d[1].data.shift();
      d[2].data.shift();
    }
    chart.update();
  }

  // ---------- Map ----------
  var map = null;
  var marker = null;
  var geoWatchId = null;
  var hasLiveGeoFix = false; // true once we've gotten a real GPS/browser location

  function initMap() {
    map = L.map("map", { zoomControl: true, attributionControl: true }).setView([state.lat, state.lng], 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    marker = L.marker([state.lat, state.lng]).addTo(map);

    locateUser();
  }

  // Ask the browser for the device's actual current location and recenter the map on it.
  function locateUser() {
    if (!navigator.geolocation) {
      console.warn("Geolocation is not supported by this browser; using default coordinates.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      function (pos) {
        hasLiveGeoFix = true;
        updateMap(pos.coords.latitude, pos.coords.longitude);
        if (map) map.setView([pos.coords.latitude, pos.coords.longitude], 16);
      },
      function (err) {
        console.warn("Geolocation error (" + err.code + "): " + err.message);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );

    // Keep tracking so the marker follows the real position while the dashboard is open.
    geoWatchId = navigator.geolocation.watchPosition(
      function (pos) {
        hasLiveGeoFix = true;
        updateMap(pos.coords.latitude, pos.coords.longitude);
      },
      function (err) {
        console.warn("Geolocation watch error (" + err.code + "): " + err.message);
      },
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
  }

  function updateMap(lat, lng) {
    state.lat = lat;
    state.lng = lng;
    if (marker) marker.setLatLng([lat, lng]);
  }

  // ---------- Badges ----------
  function setPumpBadge(on) {
    state.pumpState = on ? "ON" : "OFF";
    els.pumpBadge.textContent = state.pumpState;
    els.pumpBadge.className = "badge-pump " + (on ? "on" : "off");
  }

  function setModeBadge(mode) {
    state.pumpMode = mode;
    els.modeBadge.textContent = mode;
    els.modeBadge.className = "badge-mode " + (mode === "MANUAL" ? "manual" : "auto");
  }

  function setScoreMessage(score, message) {
    els.score.textContent = (typeof score === "number") ? score.toFixed(4) : "--";
    els.message.textContent = message || "--";
    var cls = "stat-sub";
    if (message === "Critical!") cls += " critical";
    else if (message === "Warning!") cls += " warning";
    else cls += " normal";
    els.message.className = cls;
  }

  // ---------- WebSocket ----------
  var activeWs = null;

  function connectWS() {
    var url = "ws://" + window.location.host + "/ws";
    var ws = new WebSocket(url);
    activeWs = ws;

    ws.onmessage = function (evt) {
      var data;
      try {
        data = JSON.parse(evt.data);
      } catch (e) {
        return;
      }

      var haveTemp = typeof data.temperature === "number";
      var haveHumi = typeof data.humidity === "number";
      var haveSoil = typeof data.soil_moisture === "number";

      if (haveTemp) els.temp.textContent = data.temperature.toFixed(1) + "\u00B0C";
      if (haveHumi) els.humi.textContent = data.humidity.toFixed(2) + "%";
      if (haveSoil) els.soil.textContent = data.soil_moisture.toFixed(0) + "%";

      if (haveTemp || haveHumi || haveSoil) {
        pushChartPoint(
          haveTemp ? data.temperature : (chart.data.datasets[0].data.slice(-1)[0] || 0),
          haveHumi ? data.humidity : (chart.data.datasets[1].data.slice(-1)[0] || 0),
          haveSoil ? data.soil_moisture : (chart.data.datasets[2].data.slice(-1)[0] || 0)
        );
      }

      if (typeof data.pump_state === "string") {
        setPumpBadge(data.pump_state.toUpperCase() === "ON");
      }
      if (typeof data.pump_mode === "string") {
        setModeBadge(data.pump_mode.toUpperCase());
      } else if (typeof data.pump_controller === "string" &&
                 (data.pump_controller === "MANUAL" || data.pump_controller === "AUTO")) {
        setModeBadge(data.pump_controller);
      }

      if (typeof data.ml_score === "number" || typeof data.ml_message === "string") {
        setScoreMessage(data.ml_score, data.ml_message);
      }

      if (typeof data.lat === "number" && typeof data.long === "number") {
        updateMap(data.lat, data.long);
      }
    };

    ws.onclose = function () {
      setTimeout(connectWS, 2000);
    };
    ws.onerror = function () {
      ws.close();
    };
  }

  // ---------- Status pill (CoreIoT / MQTT) ----------
  function pollStatus() {
    fetch("/api/status")
      .then(function (r) { return r.json(); })
      .then(function (s) {
        els.coreiotDot.className = "dot " + (s.mqtt_connected ? "online" : "offline");
      })
      .catch(function () {
        els.coreiotDot.className = "dot offline";
      });
  }

  // ---------- Toggle buttons ----------
  els.pumpToggleBtn.addEventListener("click", function () {
    fetch("/toggle-pump")
      .then(function (r) { return r.text(); })
      .then(function (txt) {
        setPumpBadge(txt.trim().toUpperCase() === "ON");
        setModeBadge("MANUAL"); // /toggle-pump always forces MANUAL on the firmware side
      });
  });

  els.modeToggleBtn.addEventListener("click", function () {
    var nextMode = state.pumpMode === "MANUAL" ? "AUTO" : "MANUAL";
    var msg = JSON.stringify({ page: "pump", action: "set_mode", value: { mode: nextMode } });
    if (activeWs && activeWs.readyState === WebSocket.OPEN) {
      activeWs.send(msg);
      setModeBadge(nextMode);
    }
  });

  // ---------- Boot ----------
  document.addEventListener("DOMContentLoaded", function () {
    initChart();
    initMap();
    connectWS();
    pollStatus();
    setInterval(pollStatus, 5000);
  });
})();