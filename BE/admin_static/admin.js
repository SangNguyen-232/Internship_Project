(function () {
  "use strict";

  // Thiết bị được coi là online nếu timestamp_up trong vòng ONLINE_THRESHOLD_MS
  var ONLINE_THRESHOLD_MS = 2 * 60 * 1000; // 2 phút

  // URL của dashboard chi tiết ESP32 (dashboard.html serve bởi chính ESP32)
  // device.device_id được dùng như hostname hoặc IP tuỳ cấu hình hệ thống
  // Nếu dự án dùng STA_IP lưu trong info.dat thì có thể map device_id → IP.
  // Hiện tại: mở http://<device_id>/ (device_id = IP hoặc hostname)
  function detailUrl(device) {
    return "http://" + device.device_id + "/";
  }

  // ─── Helpers ───────────────────────────────────────────────

  function isOnline(device) {
    if (!device.timestamp_up) return false;
    var ts = new Date(device.timestamp_up).getTime();
    return (Date.now() - ts) < ONLINE_THRESHOLD_MS;
  }

  function fmtValue(v) {
    return (v !== null && v !== undefined && v !== "") ? v : "—";
  }

  function relativeTime(tsStr) {
    if (!tsStr) return "Không rõ";
    var diff = Math.floor((Date.now() - new Date(tsStr).getTime()) / 1000);
    if (diff < 60)  return diff + "s trước";
    if (diff < 3600) return Math.floor(diff / 60) + "m trước";
    if (diff < 86400) return Math.floor(diff / 3600) + "h trước";
    return Math.floor(diff / 86400) + "d trước";
  }

  function pumpChipClass(state) {
    return (state || "").toUpperCase() === "ON" ? "chip chip-pump-on" : "chip chip-pump-off";
  }

  function modeChipClass(mode) {
    return (mode || "").toUpperCase() === "MANUAL" ? "chip chip-manual" : "chip chip-auto";
  }

  function messageChipClass(msg) {
    if (!msg) return "chip chip-normal";
    var m = msg.toLowerCase();
    if (m.includes("critical")) return "chip chip-critical";
    if (m.includes("warning"))  return "chip chip-warning";
    return "chip chip-normal";
  }

  // Tên hiển thị: lấy phần đầu device_id, viết hoa
  function displayName(deviceId) {
    return deviceId || "Unknown";
  }

  // ─── Render ────────────────────────────────────────────────

  function renderCard(device) {
    var online = isOnline(device);
    var statusClass = online ? "online" : "offline";
    var statusLabel = online ? "Online" : "Offline";

    var url = detailUrl(device);

    var card = document.createElement("div");
    card.className = "device-card";
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.title = "Xem chi tiết " + device.device_id;

    card.innerHTML =
      '<div class="device-card-header">' +
        '<div>' +
          '<div class="device-name">' + displayName(device.device_id) + '</div>' +
          '<div class="device-id-label">ID: ' + device.device_id + '</div>' +
        '</div>' +
        '<span class="status-pill ' + statusClass + '">' +
          '<span class="status-dot"></span>' + statusLabel +
        '</span>' +
      '</div>' +

      '<div class="sensor-row">' +
        '<div class="sensor-item">' +
          '<span class="sensor-label">Nhiệt độ</span>' +
          '<span class="sensor-value val-temp">' + fmtValue(device.temperature) + '</span>' +
        '</div>' +
        '<div class="sensor-item">' +
          '<span class="sensor-label">Độ ẩm KK</span>' +
          '<span class="sensor-value val-humi">' + fmtValue(device.humidity) + '</span>' +
        '</div>' +
        '<div class="sensor-item">' +
          '<span class="sensor-label">Độ ẩm đất</span>' +
          '<span class="sensor-value val-soil">' + fmtValue(device.soil_moisture) + '</span>' +
        '</div>' +
      '</div>' +

      '<div class="card-footer">' +
        '<div class="meta-chips">' +
          '<span class="' + pumpChipClass(device.PUMP_state) + '">PUMP ' + fmtValue(device.PUMP_state) + '</span>' +
          '<span class="' + modeChipClass(device.MODE_state) + '">' + fmtValue(device.MODE_state) + '</span>' +
          (device.Message
            ? '<span class="' + messageChipClass(device.Message) + '">' + device.Message + '</span>'
            : '') +
        '</div>' +
        '<span class="last-seen">' + relativeTime(device.timestamp_up) + '</span>' +
      '</div>' +

      '<div class="card-arrow">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
             'stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M5 12h14M13 6l6 6-6 6"/>' +
        '</svg>' +
      '</div>';

    // Click / Enter → mở dashboard chi tiết
    function openDetail() {
      window.open(url, "_blank");
    }
    card.addEventListener("click", openDetail);
    card.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(); }
    });

    return card;
  }

  function renderGrid(devices) {
    var grid = document.getElementById("deviceGrid");
    grid.innerHTML = "";

    if (!devices || devices.length === 0) {
      grid.innerHTML =
        '<div class="state-box">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
               'stroke-linecap="round" stroke-linejoin="round">' +
            '<rect x="2" y="3" width="20" height="14" rx="2"/>' +
            '<path d="M8 21h8M12 17v4"/>' +
          '</svg>' +
          '<span>Chưa có thiết bị nào gửi dữ liệu.</span>' +
        '</div>';
      return;
    }

    devices.forEach(function (device) {
      grid.appendChild(renderCard(device));
    });
  }

  function updateSummary(devices) {
    var total   = devices.length;
    var online  = devices.filter(isOnline).length;
    var offline = total - online;

    document.getElementById("sumTotal").textContent   = total;
    document.getElementById("sumOnline").textContent  = online;
    document.getElementById("sumOffline").textContent = offline;
  }

  // ─── Fetch ─────────────────────────────────────────────────

  function fetchDevices() {
    fetch("/admin/api/devices")
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        renderGrid(data);
        updateSummary(data);

        var now = new Date();
        var pad = function (n) { return n < 10 ? "0" + n : "" + n; };
        document.getElementById("lastRefresh").textContent =
          "Cập nhật lúc " + pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds());
      })
      .catch(function (err) {
        document.getElementById("deviceGrid").innerHTML =
          '<div class="state-box">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
                 'stroke-linecap="round" stroke-linejoin="round">' +
              '<circle cx="12" cy="12" r="10"/>' +
              '<line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>' +
            '</svg>' +
            '<span>Lỗi kết nối: ' + err.message + '</span>' +
          '</div>';
        document.getElementById("lastRefresh").textContent = "Lỗi kết nối";
      });
  }

  // ─── Boot ──────────────────────────────────────────────────

  document.getElementById("btnRefresh").addEventListener("click", fetchDevices);

  // Đồng hồ client-side (giống dashboard.html)
  function tickClock() {
    var now = new Date();
    var pad = function (n) { return n < 10 ? "0" + n : "" + n; };
    document.getElementById("sumTime").textContent =
      pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds());
  }
  tickClock();
  setInterval(tickClock, 1000);

  // Tự động làm mới mỗi 15 giây
  fetchDevices();
  setInterval(fetchDevices, 15000);

})();