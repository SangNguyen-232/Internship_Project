(function () {
  "use strict";

  var STALE_DIFF_MS = 10 * 1000; 
  var COUNTDOWN_SECONDS = 5;      

  var countdownStart = {};
  var currentDevices = [];
  var selectedDeviceIds = [];
  var latestTimestampUp = null;

  function detailUrl(device) {
    return "http://" + device.device_id + "/";
  }

  // ─── Helpers ───────────────────────────────────────────────

  function fmtValue(v) {
    return (v !== null && v !== undefined && v !== "") ? v : "—";
  }

  function displayName(deviceId) {
    return deviceId || "Unknown";
  }

  function fmtTimestamp(tsStr) {
    if (!tsStr) return "—";
    var d = new Date(tsStr);
    var pad = function (n) { return n < 10 ? "0" + n : "" + n; };
    return pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear() +
      " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }

  function formatOfflineTime(seconds) {
    seconds = Math.max(0, Math.floor(seconds));

    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = seconds % 60;

    var parts = [];

    if (h > 0) {
      parts.push(h + "h");
    }

    if (m > 0) {
      parts.push(m + "m");
    }

    if (s > 0) {
      parts.push(s + "s");
    }

    if (parts.length === 0) {
      return "0s";
    }

    return parts.join("");
  }

  function getTimestampMs(device) {
    if (!device || !device.timestamp_up) return null;
    var ts = new Date(device.timestamp_up).getTime();
    return isNaN(ts) ? null : ts;
  }

  // ─── Stale detection sau mỗi fetch ─────────────────────────

  function updateStaleState(device) {
    var id = device.device_id;

    if (!device.timestamp_up) return;

    var ts = getTimestampMs(device);
    if (ts === null) return;

    var age = Date.now() - ts; 

    if (age >= STALE_DIFF_MS) {
      if (!countdownStart[id]) {
        countdownStart[id] = ts + STALE_DIFF_MS;
      }
    } else {
      delete countdownStart[id];
    }
  }

  function getCountdownState(deviceId) {
    var start = countdownStart[deviceId];
    if (!start) return null;

    var elapsed = Math.floor((Date.now() - start) / 1000);
    var remaining = COUNTDOWN_SECONDS - elapsed;

    if (remaining > 0) {
      return { isOnline: true, text: remaining + "s", label: "Đếm ngược: " };
    } else {
      var offlineElapsed = elapsed - COUNTDOWN_SECONDS;

      var roundedOfflineSeconds = Math.floor(offlineElapsed / 30) * 30;

      return {
        isOnline: false,
        text: formatOfflineTime(roundedOfflineSeconds),
        label: "Đã Offline: "
      };
    }
  }

  function isDeviceOnline(device) {
    var state = getCountdownState(device.device_id);
    return (state === null || state.isOnline);
  }

  // ─── Render Action Bar (JS inject) ───────────────────

  function renderActionBar() {
    var actionBar = document.getElementById("customActionBar");
    
    if (!actionBar) {
      actionBar = document.createElement("div");
      actionBar.id = "customActionBar";
      actionBar.className = "action-bar";
      
      var grid = document.getElementById("deviceGrid");
      if (grid && grid.parentNode) {
        grid.parentNode.insertBefore(actionBar, grid);
      }
    }

    if (currentDevices.length === 0) {
      actionBar.style.display = "none";
      return;
    }

    actionBar.style.display = "flex";
    var isAllSelected = currentDevices.length > 0 && selectedDeviceIds.length === currentDevices.length;

    actionBar.innerHTML = 
      '<div class="action-bar-left">' +
        '<button class="btn-action btn-select-all" id="btnSelectAll">' +
          (isAllSelected ? "🗹 Bỏ chọn tất cả" : "☐ Chọn tất cả") +
        '</button>' +
      '</div>' +
      '<div class="action-bar-right" style="display: ' + (selectedDeviceIds.length > 0 ? 'flex' : 'none') + ';">' +
        '<span class="selected-count">Đã chọn <strong>' + selectedDeviceIds.length + '</strong> thiết bị</span>' +
        '<button class="btn-action btn-delete-bulk" id="btnDeleteBulk">🗑️ Xóa đã chọn</button>' +
      '</div>';

    document.getElementById("btnSelectAll").addEventListener("click", function () {
      if (isAllSelected) {
        selectedDeviceIds = [];
      } else {
        selectedDeviceIds = currentDevices.map(function (d) { return d.device_id; });
      }
      renderGrid(currentDevices);
      renderActionBar();
    });

    if (selectedDeviceIds.length > 0) {
      document.getElementById("btnDeleteBulk").addEventListener("click", function () {
        if (!confirm("Xóa toàn bộ dữ liệu của " + selectedDeviceIds.length + " thiết bị đã chọn?")) return;

        var deletePromises = selectedDeviceIds.map(function (id) {
          return fetch("/admin/api/devices/" + encodeURIComponent(id), { method: "DELETE" })
            .then(function (r) {
              if (!r.ok) throw new Error("Thất bại tại ID: " + id);
              return id;
            });
        });

        Promise.all(deletePromises)
          .then(function (deletedIds) {
            currentDevices = currentDevices.filter(function (d) {
              return !deletedIds.includes(d.device_id);
            });
            deletedIds.forEach(function (id) {
              delete countdownStart[id];
            });
            selectedDeviceIds = []; 
            
            renderGrid(currentDevices);
            updateSummary(currentDevices);
            renderActionBar();
          })
          .catch(function (err) {
            alert("Có lỗi xảy ra trong quá trình xóa: " + err.message);
            fetchDevices(); 
          });
      });
    }
  }

  // ─── Render Card ───────────────────────────────────────────

  function renderCard(device) {
    var state = getCountdownState(device.device_id);
    var cardOnline = (state === null || state.isOnline);
    var cardStatusClass = cardOnline ? "online" : "offline";
    var cardStatusLabel = cardOnline ? "Online" : "Offline";

    var isStable = (state === null);
    var displayStyle = isStable ? "none" : "";
    var countdownDisplay = isStable ? "" : state.text;
    var countdownPrefix = isStable ? "" : state.label;

    var url = detailUrl(device);
    var isSelected = selectedDeviceIds.includes(device.device_id);

    var card = document.createElement("div");
    card.className = "device-card" + (isSelected ? " selected" : "");
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("data-device-id", device.device_id);
    card.title = "Chọn/Bỏ chọn " + device.device_id;

    card.innerHTML =
      '<div class="select-checkbox-indicator">' + (isSelected ? '✓' : '') + '</div>' +
      '<div class="device-card-header">' +
        '<div>' +
          '<div class="device-name">' + displayName(device.device_id) + '</div>' +
        '</div>' +
        '<span class="status-pill ' + cardStatusClass + ' js-status-pill">' +
          '<span class="status-dot"></span><span class="js-status-label">' + cardStatusLabel + '</span>' +
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
        '<span class="last-seen js-last-seen" style="display: ' + displayStyle + ';">' +
          '<span class="js-countdown-label">' + countdownPrefix + '</span>' +
          '<span class="js-countdown">' + countdownDisplay + '</span>' +
        '</span>' +
      '</div>' +

      '<div class="card-arrow" title="Xem chi tiết thiết bị này">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
             'stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M5 12h14M13 6l6 6-6 6"/>' +
        '</svg>' +
      '</div>';

    card.addEventListener("click", function(e) {
      if (isSelected) {
        selectedDeviceIds = selectedDeviceIds.filter(function(id) { return id !== device.device_id; });
      } else {
        selectedDeviceIds.push(device.device_id);
      }
      renderGrid(currentDevices);
      renderActionBar();
    });

    var arrowBtn = card.querySelector(".card-arrow");
    if (arrowBtn) {
      arrowBtn.addEventListener("click", function(e) {
        e.stopPropagation(); 
        window.location.href = url;
      });
    }

    card.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        card.click();
      }
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
    var total = devices.length;
    var online = devices.filter(isDeviceOnline).length;
    var offline = total - online;

    document.getElementById("sumTotal").textContent = total;
    document.getElementById("sumOnline").textContent = online;
    document.getElementById("sumOffline").textContent = offline;
  }

  // ─── Countdown ticker ──────────────────────────────────────

  function tickCountdowns() {
    var cards = document.querySelectorAll(".device-card[data-device-id]");

    cards.forEach(function (card) {
      var id = card.getAttribute("data-device-id");
      var state = getCountdownState(id);

      var lastSeenEl = card.querySelector(".js-last-seen");
      var countdownEl = card.querySelector(".js-countdown");
      var labelPrefixEl = card.querySelector(".js-countdown-label");
      var pillEl = card.querySelector(".js-status-pill");
      var labelEl = card.querySelector(".js-status-label");

      if (lastSeenEl && countdownEl && labelPrefixEl) {
        if (state === null) {
          lastSeenEl.style.display = "none"; 
        } else {
          lastSeenEl.style.display = "";     
          countdownEl.textContent = state.text;
          labelPrefixEl.textContent = state.label;
        }
      }

      if (pillEl && labelEl) {
        var cardOnline = (state === null || state.isOnline);
        pillEl.className = "status-pill " + (cardOnline ? "online" : "offline") + " js-status-pill";
        labelEl.textContent = cardOnline ? "Online" : "Offline";
      }
    });

    updateSummary(currentDevices);
  }

  // ─── Fetch ─────────────────────────────────────────────────

  function refreshLastRefreshText() {
    var el = document.getElementById("lastRefresh");
    var pad = function (n) { return n < 10 ? "0" + n : "" + n; };

    if (latestTimestampUp) {
      var d = new Date(latestTimestampUp);
      el.textContent =
        "Cập nhật lúc " +
        pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear() +
        " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
    } else {
      el.textContent = "Chưa có dữ liệu";
    }
  }

  function fetchDevices() {
    fetch("/admin/api/devices")
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        currentDevices = data || [];

        var currentIds = currentDevices.map(function(d) { return d.device_id; });
        selectedDeviceIds = selectedDeviceIds.filter(function(id) { return currentIds.includes(id); });

        currentDevices.forEach(function (device) {
          updateStaleState(device);
        });

        var newest = null;
        currentDevices.forEach(function (device) {
          var t = getTimestampMs(device);
          if (t !== null && (!newest || t > newest)) {
            newest = t;
          }
        });
        latestTimestampUp = newest;

        renderGrid(currentDevices);
        updateSummary(currentDevices);
        renderActionBar();
        refreshLastRefreshText();
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

  function tickClock() {
    var now = new Date();
    var pad = function (n) { return n < 10 ? "0" + n : "" + n; };
    document.getElementById("sumTime").textContent =
      pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds());
  }

  tickClock();
  setInterval(tickClock, 1000);
  setInterval(tickCountdowns, 1000);

  fetchDevices();
  setInterval(fetchDevices, 5000);

})();