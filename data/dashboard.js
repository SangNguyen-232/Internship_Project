(function () {
  "use strict";

  var MAX_POINTS = 60;
  var DEFAULT_LAT = 10.880018;
  var DEFAULT_LNG = 106.806336;

  var state = {
    pumpState: "OFF",
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
  var fallbackChart = false;
  var fallbackData = { labels: [], temp: [], humi: [], soil: [] };
  var fallbackCanvas = null, fallbackCtx = null;

  var chartIntervalMs = 5000;
  var lastChartPushTime = 0;

  function initChartIntervalControl() {
    var tag = document.querySelector(".chart-card .refresh-tag");
    if (!tag) return;

    var select = document.createElement("select");
    select.id = "chartIntervalSelect";
    select.style.marginLeft = "4px";
    select.style.background = "var(--card-soft)";
    select.style.color = "var(--text-muted)";
    select.style.border = "1px solid var(--border)";
    select.style.borderRadius = "6px";
    select.style.fontSize = "12px";
    select.style.padding = "1px 4px";

    [["5000", "5s"], ["15000", "15s"]].forEach(function (opt) {
      var o = document.createElement("option");
      o.value = opt[0];
      o.textContent = opt[1];
      select.appendChild(o);
    });
    select.value = String(chartIntervalMs);

    select.addEventListener("change", function () {
      chartIntervalMs = parseInt(select.value, 10) || 5000;
    });

    tag.textContent = "Refresh:";
    tag.appendChild(select);
  }

  function nowLabel() {
    var now = new Date();
    var pad = function (n) { return n < 10 ? "0" + n : "" + n; };
    return pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds());
  }

  function initChart() {
    if (typeof Chart === 'undefined') {
      console.warn("Không tải được Chart.js (Chế độ offline) -> dùng canvas thuần");
      initFallbackChart();
      return;
    }

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

  // ---------- Fallback: canvas thuần (chỉ dùng khi không tải được Chart.js, vd: AP Mode) ----------
  function initFallbackChart() {
    fallbackChart = true;
    fallbackCanvas = document.getElementById("sensorChart");
    fallbackCtx = fallbackCanvas.getContext("2d");
    resizeFallbackCanvas();
    window.addEventListener("resize", resizeFallbackCanvas);
  }

  function resizeFallbackCanvas() {
    if (!fallbackCanvas) return;
    var rect = fallbackCanvas.parentElement.getBoundingClientRect();
    fallbackCanvas.width = rect.width;
    fallbackCanvas.height = rect.height;
    drawFallbackChart();
  }

  function drawFallbackChart() {
    if (!fallbackCtx) return;
    var w = fallbackCanvas.width, h = fallbackCanvas.height;
    if (!w || !h) return;
    var n = fallbackData.labels.length;
    var padLeft = 34, padRight = 10, padTop = 10, padBottom = 20;
    var plotW = w - padLeft - padRight;
    var plotH = h - padTop - padBottom;

    fallbackCtx.clearRect(0, 0, w, h);
    fallbackCtx.font = "10px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

    // ----- Lưới ngang + nhãn trục Y (0/25/50/75/100), giống scales.y của Chart.js -----
    var yTicks = [0, 25, 50, 75, 100];
    fallbackCtx.textAlign = "right";
    fallbackCtx.textBaseline = "middle";
    yTicks.forEach(function (g) {
      var y = padTop + plotH - (g / 100) * plotH;
      fallbackCtx.strokeStyle = "rgba(255,255,255,0.05)"; 
      fallbackCtx.lineWidth = 1;
      fallbackCtx.beginPath();
      fallbackCtx.moveTo(padLeft, y);
      fallbackCtx.lineTo(padLeft + plotW, y);
      fallbackCtx.stroke();

      fallbackCtx.fillStyle = "#828ba3"; 
      fallbackCtx.fillText(String(g), padLeft - 6, y);
    });

    function xAt(i) {
      return padLeft + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    }

    // ----- Mốc thời gian trên trục X: lấy từ fallbackData.labels (đã ghi sẵn ở pushChartPoint) -----
    if (n > 0) {
      fallbackCtx.textAlign = "center";
      fallbackCtx.textBaseline = "top";
      fallbackCtx.fillStyle = "#828ba3";
      var maxLabels = 6; 
      var step = Math.max(1, Math.ceil(n / maxLabels));
      for (var i = 0; i < n; i += step) {
        fallbackCtx.fillText(fallbackData.labels[i], xAt(i), padTop + plotH + 6);
      }
      if ((n - 1) % step !== 0) {
        fallbackCtx.fillText(fallbackData.labels[n - 1], xAt(n - 1), padTop + plotH + 6); // luôn hiện mốc mới nhất
      }
    }

    // ----- Vẽ từng series: đường cong mượt (mô phỏng tension: 0.35) + điểm đánh dấu (giống pointRadius: 3) -----
    function drawSeries(values, color) {
      if (values.length === 0) return;
      var pts = values.map(function (v, i) {
        return {
          x: xAt(i),
          y: padTop + plotH - (Math.max(0, Math.min(100, v)) / 100) * plotH,
        };
      });

      if (pts.length >= 2) {
        fallbackCtx.strokeStyle = color;
        fallbackCtx.lineWidth = 2;
        fallbackCtx.lineJoin = "round";
        fallbackCtx.lineCap = "round";
        fallbackCtx.beginPath();
        fallbackCtx.moveTo(pts[0].x, pts[0].y);

        if (pts.length === 2) {
          fallbackCtx.lineTo(pts[1].x, pts[1].y);
        } else {
          for (var i = 0; i < pts.length - 1; i++) {
            var p0 = pts[i - 1] || pts[i];
            var p1 = pts[i];
            var p2 = pts[i + 1];
            var p3 = pts[i + 2] || p2;

            var cp1x = p1.x + (p2.x - p0.x) / 6;
            var cp1y = p1.y + (p2.y - p0.y) / 6;
            var cp2x = p2.x - (p3.x - p1.x) / 6;
            var cp2y = p2.y - (p3.y - p1.y) / 6;

            fallbackCtx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
          }
        }

        fallbackCtx.stroke();
      }

      fallbackCtx.fillStyle = color;
      pts.forEach(function (p) {
        fallbackCtx.beginPath();
        fallbackCtx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        fallbackCtx.fill();
      });
    }

    drawSeries(fallbackData.temp, "#f5a524"); // var(--c-temp)
    drawSeries(fallbackData.humi, "#4aa3ff"); // var(--c-humi)
    drawSeries(fallbackData.soil, "#2ecc71"); // var(--c-soil)
  }

  function pushChartPoint(temp, humi, soil) {
    if (fallbackChart) {
      fallbackData.labels.push(nowLabel());
      fallbackData.temp.push(temp);
      fallbackData.humi.push(humi);
      fallbackData.soil.push(soil);
      if (fallbackData.labels.length > MAX_POINTS) {
        fallbackData.labels.shift();
        fallbackData.temp.shift();
        fallbackData.humi.shift();
        fallbackData.soil.shift();
      }
      drawFallbackChart();
      return;
    }
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
  var hasLiveGeoFix = false;

  function initMap() {
    if (typeof L === 'undefined') {
      console.warn("Không tải được Leaflet (Chế độ offline)");
      return;
    }

    map = L.map("map", { zoomControl: true, attributionControl: true }).setView([state.lat, state.lng], 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    marker = L.marker([state.lat, state.lng]).addTo(map);

    locateUser();
  }

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

      if (haveHumi) {
        els.humi.textContent = (data.humidity >= 99.95)
          ? "100%"
          : data.humidity.toFixed(1) + "%";
      }

      if (haveSoil) {
        var soilVal = Math.round(data.soil_moisture);
        var soilStr = (soilVal < 10 ? "0" + soilVal : "" + soilVal);
        els.soil.textContent = soilStr + "%";
      }

      if (haveTemp || haveHumi || haveSoil) {
        var nowTs = Date.now();
        if (nowTs - lastChartPushTime >= chartIntervalMs) {
          lastChartPushTime = nowTs;
          pushChartPoint(
            haveTemp ? data.temperature : (chart && chart.data.datasets[0].data.slice(-1)[0] || 0),
            haveHumi ? data.humidity : (chart && chart.data.datasets[1].data.slice(-1)[0] || 0),
            haveSoil ? data.soil_moisture : (chart && chart.data.datasets[2].data.slice(-1)[0] || 0)
          );
        }
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

        var apOverlay = document.getElementById("apModeOverlay");
        if (apOverlay) {
          if (s.is_ap_mode) {
            apOverlay.style.display = "flex";
          } else {
            apOverlay.style.display = "none";
          }
        }
      })
      .catch(function () {
        els.coreiotDot.className = "dot offline";
      });
  }

  // ---------- Toggle buttons ----------

  // 1. Xử lý sự kiện nút bấm PUMP (Bật / Tắt bơm thủ công)
  els.pumpToggleBtn.addEventListener("click", function () {
    var nextState = state.pumpState === "ON" ? "OFF" : "ON";

    fetch("/toggle-pump?state=" + nextState)
      .then(function (r) { return r.text(); })
      .then(function (txt) {
        var resState = txt.trim().toUpperCase();
        var finalState = (resState === "ON" || resState === "OFF") ? resState : nextState;

        setPumpBadge(finalState === "ON");
        setModeBadge("MANUAL"); 
      })
      .catch(function (err) {
        console.warn("Lỗi kết nối HTTP, tự động cập nhật trạng thái trên giao diện: ", err);
        setPumpBadge(nextState === "ON");
        setModeBadge("MANUAL");
      });
  });

  // 2. Xử lý sự kiện nút bấm MODE (Chuyển đổi MANUAL <-> AUTO)
  els.modeToggleBtn.addEventListener("click", function () {
    var nextMode = state.pumpMode === "MANUAL" ? "AUTO" : "MANUAL";

    fetch("/set-mode?mode=" + nextMode)
      .then(function (r) { return r.text(); })
      .then(function (txt) {
        var resMode = txt.trim().toUpperCase();
        var finalMode = (resMode === "MANUAL" || resMode === "AUTO") ? resMode : nextMode;

        setModeBadge(finalMode);
      })
      .catch(function (err) {
        console.warn("Lỗi kết nối HTTP khi thay đổi chế độ: ", err);
        setModeBadge(nextMode); 
      });
  });

  // ---------- Settings modal (WiFi config) ----------
  var settingsNavBtn = document.getElementById("settingsNavBtn");
  var settingsModal = document.getElementById("settingsModal");
  var settingsCloseBtn = document.getElementById("settingsCloseBtn");
  var wifiSettingsForm = document.getElementById("wifiSettingsForm");
  var wifiSettingsMsg = document.getElementById("wifiSettingsMsg");

  function openSettingsModal(e) {
    if (e) e.preventDefault();
    if (settingsModal) settingsModal.style.display = "flex";
  }

  function closeSettingsModal() {
    if (settingsModal) settingsModal.style.display = "none";
  }

  if (settingsNavBtn) settingsNavBtn.addEventListener("click", openSettingsModal);
  if (settingsCloseBtn) settingsCloseBtn.addEventListener("click", closeSettingsModal);

  if (wifiSettingsForm) {
    wifiSettingsForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var ssid = document.getElementById("wifiSsid").value;
      var pass = document.getElementById("wifiPass").value;

      // Định dạng payload đúng theo handleWebSocketMessage() trong task_handler.cpp
      var payload = {
        page: "setting",
        value: {
          ssid: ssid,
          password: pass,
          token: "",
          server: "",
          port: ""
        }
      };

      if (activeWs && activeWs.readyState === WebSocket.OPEN) {
        activeWs.send(JSON.stringify(payload));
        wifiSettingsMsg.textContent = "Đã gửi cấu hình. Thiết bị sẽ khởi động lại...";
      } else {
        wifiSettingsMsg.textContent = "Chưa kết nối WebSocket, vui lòng thử lại.";
      }
    });
  }

  // ---------- Boot ----------
  document.addEventListener("DOMContentLoaded", function () {
    initChart();
    initChartIntervalControl();
    initMap();
    connectWS();
    pollStatus();
    setInterval(pollStatus, 5000);
  });
})();