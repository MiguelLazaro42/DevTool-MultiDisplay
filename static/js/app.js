(function () {
  "use strict";

  // ---------- Datos ----------
  var CATALOG = JSON.parse(document.getElementById("devices-data").textContent);
  var DEFAULTS = JSON.parse(document.getElementById("defaults-data").textContent);
  var BY_ID = {};
  CATALOG.forEach(function (d) { BY_ID[d.id] = d; });

  var I18N = window.RV_I18N;
  var t = I18N.t;

  // Medidas del acomodo (optimizadas para mayor aprovechamiento del espacio)
  var PAD_X = 16, PAD_TOP = 16, PAD_BOTTOM = 22;
  var GAP_X = 20, GAP_Y = 16;
  var BEZEL = 8;           // marco compacto (4 px por lado)
  var CAPTION = 28;        // etiqueta compacta
  var RADIUS = { phone: 44, tablet: 18, desktop: 6 };

  // Zoom propio del visor (no el de Chrome). Pasos como los de Chrome.
  var ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
  var ZOOM_MIN = 0.1, ZOOM_MAX = 2;
  var IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  var MOD = IS_MAC ? "⌘" : "Ctrl";

  var STORE_URL = "rv.url", STORE_DEVICES = "rv.devices", STORE_ZOOM = "rv.zoom", STORE_SYNC = "rv.sync";

  // Estado
  var state = {
    active: [],        // ids de dispositivos en la mesa, en orden
    url: "",           // URL escrita en Buscar
    frameUrls: {},     // URL actual de cada pantalla (si el usuario navegó dentro)
    zoomMode: "fill",  // "fill" (aprovechar ventana), "fit" (ajustar todo) o un número fijo
    stackMode: "auto", // "auto" (vertical si H > W, si no óptimo) o "stack" (forzar 1 por fila)
    scale: 1,          // zoom que se está mostrando ahora
    inspector: false,  // modo selector de elementos
    sync: true         // sincronizar scroll, clics y escritura entre pantallas
  };
  var els = {};        // id -> { root, screen, iframe, placeholder }

  // ---------- Elementos ----------
  var matEl = document.querySelector(".mat");
  var stage = document.getElementById("stage");
  var rack = document.getElementById("rack");
  var matEmpty = document.getElementById("mat-empty");
  var zoomLabel = document.getElementById("zoom-label");
  var zoomInBtn = document.getElementById("zoom-in");
  var zoomOutBtn = document.getElementById("zoom-out");
  var zoomFitBtn = document.getElementById("zoom-fit");
  var zoomFillBtn = document.getElementById("zoom-fill");
  var stackBtn = document.getElementById("stack-btn");
  var form = document.getElementById("search-form");
  var input = document.getElementById("url-input");
  var refreshBtn = document.getElementById("refresh-btn");
  var addBtn = document.getElementById("add-btn");
  var menu = document.getElementById("device-menu");
  var toastEl = document.getElementById("toast");
  var syncBtn = document.getElementById("sync-btn");

  // Elementos del Inspector Flotante (estilo IDE)
  var inspectBtn = document.getElementById("inspect-btn");
  var inspectBanner = document.getElementById("inspect-banner");
  var inspectFloat = document.getElementById("inspect-float");
  var inspectCopiedPill = document.getElementById("inspect-copied-pill");
  var inspectBadge = document.getElementById("inspect-badge");
  var inspectDim = document.getElementById("inspect-dim");
  var inspectDevice = document.getElementById("inspect-device");
  var inspectLink = document.getElementById("inspect-link");
  var inspectSelector = document.getElementById("inspect-selector");
  var inspectStyles = document.getElementById("inspect-styles");
  var inspectStylesRow = document.getElementById("inspect-styles-row");
  var inspectCode = document.getElementById("inspect-code");
  var inspectClose = document.getElementById("inspect-close");
  var copiedPillTimer = null;

  // Elementos del Panel de Tráfico HTTP, Consola, Auditoría, Flujo y Storage
  var trafficBtn = document.getElementById("traffic-btn");
  var trafficCountEl = document.getElementById("traffic-count");
  var consoleBtn = document.getElementById("console-btn");
  var consoleCountEl = document.getElementById("console-count");
  var auditBtn = document.getElementById("audit-btn");
  var auditCountEl = document.getElementById("audit-count");
  var flowBtn = document.getElementById("flow-btn");
  var flowCountEl = document.getElementById("flow-count");
  var aiReportBtn = document.getElementById("ai-report-btn");
  var snapshotBtn = document.getElementById("snapshot-btn");
  var panelAiReportBtn = document.getElementById("panel-ai-report-btn");
  var panelSnapshotBtn = document.getElementById("panel-snapshot-btn");

  var trafficPanel = document.getElementById("traffic-panel");
  var trafficDot = document.getElementById("traffic-dot");
  var panelModeTraffic = document.getElementById("panel-mode-traffic");
  var panelModeConsole = document.getElementById("panel-mode-console");
  var panelModeAudit = document.getElementById("panel-mode-audit");
  var panelModeFlow = document.getElementById("panel-mode-flow");
  var panelModeStorage = document.getElementById("panel-mode-storage");

  var trafficSearch = document.getElementById("traffic-search");
  var trafficMethodPills = document.getElementById("traffic-method-pills");
  var consoleLevelPills = document.getElementById("console-level-pills");
  var trafficDeviceFilter = document.getElementById("traffic-device-filter");
  var trafficPauseBtn = document.getElementById("traffic-pause-btn");
  var trafficClearBtn = document.getElementById("traffic-clear-btn");
  var trafficPopoutBtn = document.getElementById("traffic-popout-btn");
  var trafficRulerPopout = document.getElementById("traffic-ruler-popout");
  var trafficCloseBtn = document.getElementById("traffic-close-btn");
  var trafficSplitView = document.getElementById("traffic-split-view");
  var trafficTbody = document.getElementById("traffic-tbody");
  var trafficEmpty = document.getElementById("traffic-empty");
  var trafficRawCode = document.getElementById("traffic-raw-code");
  var trafficCopyReq = document.getElementById("traffic-copy-req");
  var trafficCopyRes = document.getElementById("traffic-copy-res");
  var trafficCopyCurl = document.getElementById("traffic-copy-curl");
  var trafficTabs = Array.prototype.slice.call(document.querySelectorAll("#traffic-split-view .traffic-tab"));

  var consoleSplitView = document.getElementById("console-split-view");
  var consoleTbody = document.getElementById("console-tbody");
  var consoleEmpty = document.getElementById("console-empty");
  var consoleRawCode = document.getElementById("console-raw-code");
  var consoleCopyBtn = document.getElementById("console-copy-btn");

  // Auditoría Visual
  var auditSplitView = document.getElementById("audit-split-view");
  var auditTbody = document.getElementById("audit-tbody");
  var auditEmpty = document.getElementById("audit-empty");
  var auditRawCode = document.getElementById("audit-raw-code");
  var auditScanBtn = document.getElementById("audit-scan-btn");
  var auditHighlightBtn = document.getElementById("audit-highlight-btn");
  var auditCopyOneBtn = document.getElementById("audit-copy-one-btn");
  var auditCopyAllBtn = document.getElementById("audit-copy-all-btn");

  // Flujo de Usuario / Pasos
  var flowSplitView = document.getElementById("flow-split-view");
  var flowTbody = document.getElementById("flow-tbody");
  var flowEmpty = document.getElementById("flow-empty");
  var flowRawCode = document.getElementById("flow-raw-code");
  var flowTabMd = document.getElementById("flow-tab-md");
  var flowTabPw = document.getElementById("flow-tab-pw");
  var flowRecordToggle = document.getElementById("flow-record-toggle");
  var flowCopyBtn = document.getElementById("flow-copy-btn");

  // Storage / Cookies / JWT
  var storageSplitView = document.getElementById("storage-split-view");
  var storageTbody = document.getElementById("storage-tbody");
  var storageEmpty = document.getElementById("storage-empty");
  var storageRawCode = document.getElementById("storage-raw-code");
  var storageRefreshBtn = document.getElementById("storage-refresh-btn");
  var storageCopyOneBtn = document.getElementById("storage-copy-one-btn");
  var storageCopyAllBtn = document.getElementById("storage-copy-all-btn");

  // Modal de Reporte IA
  var aiReportModal = document.getElementById("ai-report-modal");
  var aiReportTextarea = document.getElementById("ai-report-textarea");
  var aiModalToggles = document.getElementById("ai-modal-toggles");
  var aiModalClose = document.getElementById("ai-modal-close");
  var aiModalCopyBtn = document.getElementById("ai-modal-copy-btn");
  var aiModalSnapshotBtn = document.getElementById("ai-modal-snapshot-btn");

  var trafficState = {
    open: false,
    panelMode: "traffic",
    paused: false,
    lastSeq: 0,
    items: [],
    selectedId: null,
    userPinned: false,
    activeTab: "request",
    methodFilter: "all",
    deviceFilter: "all",
    searchQuery: ""
  };

  var consoleState = {
    lastSeq: 0,
    items: [],
    selectedId: null,
    userPinned: false,
    levelFilter: "all"
  };

  var auditState = {
    items: [],
    selectedIdx: -1,
    highlightOnScreens: false
  };

  var flowState = {
    lastSeq: 0,
    items: [],
    selectedId: null,
    recording: true,
    format: "markdown" // "markdown" | "playwright"
  };

  var storageState = {
    serverCookies: [],
    byDevice: {},
    rows: [],
    selectedIdx: -1
  };

  var lastInspectedElement = null;
  var pendingDomSnapshots = {};

  // Canal de sincronización entre múltiples pestañas / monitores (BroadcastChannel)
  var TAB_ID = "tab_" + Math.random().toString(36).slice(2, 9);
  var SESSION_DEVICES = "rv.tab.devices";
  var syncChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("rv_multidisplay_sync") : null;

  function postCrossTab(msg) {
    if (!syncChannel) return;
    try {
      msg.tabId = TAB_ID;
      syncChannel.postMessage(msg);
    } catch (_e) {}
  }

  // ---------- Utilidades ----------
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_e) {}
  }
  function load(key) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (_e) { return null; }
  }
  function storeTabDevices(list) {
    try { sessionStorage.setItem(SESSION_DEVICES, JSON.stringify(list)); } catch (_e) {}
  }
  function loadTabDevices() {
    try { var v = sessionStorage.getItem(SESSION_DEVICES); return v ? JSON.parse(v) : null; } catch (_e) { return null; }
  }

  var toastTimer;
  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("is-visible"); }, 2600);
  }

  function normalizeUrl(raw) {
    var v = raw.trim();
    if (!v) return "";
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) {
      var local = /^(localhost|127\.|0\.0\.0\.0|192\.168\.|10\.|\[::1\])/i.test(v);
      v = (local ? "http://" : "https://") + v;
    }
    try {
      var u = new URL(v);
      if (u.protocol !== "http:" && u.protocol !== "https:") return "";
      return u.href;
    } catch (_e) { return ""; }
  }

  function proxyUrl(url, deviceId, bust) {
    var q = "/proxy?frame=" + encodeURIComponent(deviceId) +
      "&device=" + encodeURIComponent(deviceId) +
      "&lang=" + encodeURIComponent(I18N.getLang()) +
      "&url=" + encodeURIComponent(url);
    return bust ? q + "&_t=" + Date.now() : q;
  }

  function formatDpr(dpr) {
    return (Math.round(dpr * 100) / 100) + "x";
  }

  var svgNS = "http://www.w3.org/2000/svg";
  function icon(pathD, cls) {
    var s = document.createElementNS(svgNS, "svg");
    s.setAttribute("viewBox", "0 0 20 20");
    s.setAttribute("aria-hidden", "true");
    if (cls) s.setAttribute("class", cls);
    pathD.forEach(function (d) {
      var p = document.createElementNS(svgNS, "path");
      p.setAttribute("d", d);
      s.appendChild(p);
    });
    return s;
  }

  // ---------- Pantallas ----------
  var FALLBACK_COLORS = ["#0284C7", "#2563EB", "#0891B2", "#16A34A", "#D97706", "#0D9488", "#059669", "#EA580C", "#65A30D", "#DC2626"];
  function deviceColor(id) {
    var d = BY_ID[id];
    if (d && d.color) return d.color;
    var h = 0;
    var s = String(id || "");
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return FALLBACK_COLORS[h % FALLBACK_COLORS.length];
  }

  function createDevice(id) {
    var d = BY_ID[id];
    var color = deviceColor(id);
    var root = document.createElement("figure");
    root.className = "device is-entering";
    root.dataset.kind = d.kind;
    root.style.setProperty("--dev-color", color);

    var body = document.createElement("div");
    body.className = "device-body";

    var screen = document.createElement("div");
    screen.className = "device-screen";

    var placeholder = document.createElement("div");
    placeholder.className = "device-placeholder";

    var iframe = document.createElement("iframe");
    iframe.width = d.width;
    iframe.height = d.height;
    iframe.style.width = d.width + "px";
    iframe.style.height = d.height + "px";
    // Sin allow-top-navigation: la página no puede sacar al usuario del visor.
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-modals");
    iframe.hidden = true;
    iframe.addEventListener("load", function () {
      root.classList.remove("is-loading");
      hookFrameZoom(iframe);
      fetchTraffic();
      try {
        iframe.contentWindow.postMessage({ type: "rv:set_sync", active: state.sync }, location.origin);
        if (state.inspector) {
          iframe.contentWindow.postMessage({ type: "rv:set_inspector", active: true }, location.origin);
        }
        if (auditState.highlightOnScreens) {
          iframe.contentWindow.postMessage({ type: "rv:set_audit_highlight", active: true }, location.origin);
        }
      } catch (_e) {}
    });

    screen.appendChild(placeholder);
    screen.appendChild(iframe);
    body.appendChild(screen);

    var caption = document.createElement("figcaption");
    caption.className = "device-caption";
    var name = document.createElement("span");
    name.className = "device-name";
    var colorDot = document.createElement("span");
    colorDot.className = "device-color-dot";
    colorDot.style.backgroundColor = color;
    colorDot.style.boxShadow = "0 0 6px " + color;
    name.appendChild(colorDot);
    name.appendChild(document.createTextNode(d.name));
    var size = document.createElement("span");
    size.className = "device-size";
    size.textContent = d.width + " × " + d.height;
    var dpr = document.createElement("span");
    dpr.className = "device-dpr";
    dpr.textContent = formatDpr(d.dpr);

    var popout = document.createElement("button");
    popout.type = "button";
    popout.className = "device-popout";
    popout.appendChild(icon(["M7 13 13 7", "M8 7h5v5"]));
    popout.addEventListener("click", function () { popoutDevices([id], true); });

    var remove = document.createElement("button");
    remove.type = "button";
    remove.className = "device-remove";
    remove.appendChild(icon(["M5 5l10 10", "M15 5 5 15"]));
    remove.addEventListener("click", function () { toggleDevice(id, false); });

    caption.appendChild(name);
    caption.appendChild(size);
    caption.appendChild(dpr);
    body.appendChild(popout);
    body.appendChild(remove);

    root.appendChild(body);
    root.appendChild(caption);
    rack.appendChild(root);

    els[id] = { root: root, screen: screen, iframe: iframe, placeholder: placeholder, remove: remove, popout: popout, sizeEl: size };
    translateDevice(id);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { root.classList.remove("is-entering"); });
    });
    return els[id];
  }

  function popoutDevices(deviceIds, removeFromCurrent) {
    if (!deviceIds || !deviceIds.length) return;
    var u = new URL(location.origin + "/");
    u.searchParams.set("devices", deviceIds.join(","));
    if (state.url) u.searchParams.set("url", state.url);
    window.open(u.href, "_blank");
    if (removeFromCurrent && state.active.length > deviceIds.length) {
      deviceIds.forEach(function (id) {
        if (state.active.indexOf(id) > -1) toggleDevice(id, false);
      });
    }
  }

  function translateDevice(id) {
    var e = els[id], name = BY_ID[id].name;
    e.placeholder.textContent = t("placeholder");
    e.iframe.title = t("frameTitle", { name: name });
    e.remove.setAttribute("aria-label", t("remove", { name: name }));
    e.remove.title = t("remove", { name: name });
    if (e.popout) {
      e.popout.setAttribute("aria-label", t("popoutDevice", { name: name }));
      e.popout.title = t("popoutDevice", { name: name });
    }
  }

  function navigateFrame(id, url, bust) {
    var e = els[id];
    if (!e) return;
    if (!url) {
      e.iframe.hidden = true;
      e.iframe.removeAttribute("src");
      e.placeholder.hidden = false;
      return;
    }
    e.placeholder.hidden = true;
    e.iframe.hidden = false;
    e.root.classList.add("is-loading");
    e.iframe.src = proxyUrl(url, id, bust);
  }

  function toggleDevice(id, on) {
    var has = state.active.indexOf(id) > -1;
    if (on === undefined) on = !has;
    if (on && !has) {
      state.active.push(id);
      createDevice(id);
      if (state.url) navigateFrame(id, state.url);
    } else if (!on && has) {
      state.active.splice(state.active.indexOf(id), 1);
      els[id].root.remove();
      delete els[id];
      delete state.frameUrls[id];
    }
    store(STORE_DEVICES, state.active);
    storeTabDevices(state.active);
    syncMenu();
    layout();
  }

  // ---------- Acomodo y zoom ----------
  // Prueba acomodar las pantallas en 1, 2, … filas y se queda con la
  // opción que permite el zoom más grande. Más pantallas = menos zoom.
  // Con zoom manual se conserva ese acomodo y solo cambia la escala;
  // si no cabe, el tapete se puede recorrer con scroll.
  // ---------- Acomodo y zoom por tipo de dispositivo ----------
  // 1. Dentro de cada tipo (phone, tablet, desktop), cada dispositivo se ajusta
  //    en relación al dispositivo más grande de su mismo tipo para que ningún
  //    teléfono pequeño (p. ej. iPhone SE) o laptop se encoja innecesariamente.
  // 2. Entre tipos distintos, las tablets y los teléfonos se escalan en relación
  //    al dispositivo de mayor pantalla activo (manteniendo alturas visuales
  //    armónicas: Desktop 100%, Tablet 95%, Teléfono 88%) sin deformar jamás
  //    el aspect-ratio ni el viewport CSS real de ningún iframe.
  function computeRelativeScales(devices) {
    var byKind = { phone: [], tablet: [], desktop: [] };
    devices.forEach(function (d) {
      if (byKind[d.kind]) byKind[d.kind].push(d);
    });

    var maxByKind = {};
    ["phone", "tablet", "desktop"].forEach(function (k) {
      var list = byKind[k];
      if (!list.length) return;
      maxByKind[k] = {
        w: Math.max.apply(null, list.map(function (d) { return d.width; })),
        h: Math.max.apply(null, list.map(function (d) { return d.height; }))
      };
    });

    // Altura visual base de referencia según la categoría de mayor pantalla activa
    var groupScale = { phone: 1, tablet: 1, desktop: 1 };
    if (maxByKind.desktop) {
      // Si hay desktop/laptop activo, usamos una altura base de referencia de 780px
      // para que una pantalla de 1920x1080 no reduzca a los teléfonos ni a las tablets.
      var refDesktopH = 780;
      groupScale.desktop = refDesktopH / maxByKind.desktop.h;
      if (maxByKind.tablet) {
        groupScale.tablet = (refDesktopH * 0.95) / maxByKind.tablet.h;
      }
      if (maxByKind.phone) {
        groupScale.phone = (refDesktopH * 0.88) / maxByKind.phone.h;
      }
    } else if (maxByKind.tablet) {
      // Si el dispositivo más grande es una tablet, las tablets mandan (100%)
      // y los teléfonos se ajustan al 90% de la altura de la tablet más grande.
      var refTabletH = maxByKind.tablet.h;
      groupScale.tablet = 1;
      if (maxByKind.phone) {
        groupScale.phone = (refTabletH * 0.90) / maxByKind.phone.h;
      }
    } else {
      // Solo hay teléfonos: todos se ajustan en relación al teléfono más grande.
      groupScale.phone = 1;
    }

    var scales = {};
    devices.forEach(function (d) {
      var m = maxByKind[d.kind];
      // Escala relativa al dispositivo más grande de su mismo tipo (sin superar su ancho ni su alto)
      var withinKind = m ? Math.min(m.w / d.width, m.h / d.height) : 1;
      scales[d.id] = withinKind * (groupScale[d.kind] || 1);
    });
    return scales;
  }

  // Reparte los dispositivos en `r` filas equilibrando el ancho visual de cada fila
  // para evitar que una fila quede sobrecargada con los dispositivos más anchos.
  function partitionRows(devices, r, vWidthFn) {
    var n = devices.length;
    if (r <= 1) return [devices.slice()];
    if (r >= n) return devices.map(function (d) { return [d]; });

    var memo = {};
    function solve(start, rowsLeft) {
      var key = start + ":" + rowsLeft;
      if (memo[key]) return memo[key];
      if (rowsLeft === 1) {
        var lastRow = devices.slice(start);
        var w = lastRow.reduce(function (a, d) { return a + vWidthFn(d); }, 0);
        return (memo[key] = { maxW: w, rows: [lastRow] });
      }
      var bestPart = null;
      var curW = 0;
      for (var i = start; i <= n - rowsLeft; i++) {
        curW += vWidthFn(devices[i]);
        var rest = solve(i + 1, rowsLeft - 1);
        var worst = Math.max(curW, rest.maxW);
        if (!bestPart || worst < bestPart.maxW) {
          bestPart = {
            maxW: worst,
            rows: [devices.slice(start, i + 1)].concat(rest.rows)
          };
        }
      }
      return (memo[key] = bestPart);
    }
    return solve(0, r).rows;
  }

  function layout() {
    var n = state.active.length;
    matEmpty.hidden = n > 0;
    var W = stage.clientWidth - PAD_X * 2;
    var H = stage.clientHeight - PAD_TOP - PAD_BOTTOM;
    if (!n || W <= 0 || H <= 0) {
      rack.style.width = rack.style.height = "";
      updatePanCursor();
      setZoom((state.zoomMode === "fit" || state.zoomMode === "fill") ? 1 : state.zoomMode);
      return;
    }

    var devices = state.active.map(function (id) { return BY_ID[id]; });
    var relScales = computeRelativeScales(devices);
    function vW(d) { return d.width * relScales[d.id]; }
    function vH(d) { return d.height * relScales[d.id]; }

    var best = null;
    var isFill = state.zoomMode === "fill";
    // Detectamos monitor vertical (portrait) tanto por las dimensiones del contenedor como de la ventana/pantalla
    var isPortraitStage = H > W || window.innerHeight > window.innerWidth;
    var forceVerticalStack = state.stackMode === "stack";

    // Si estamos en un monitor vertical (portrait) o en modo Apilar (Vertical),
    // cada dispositivo que esté solo en su propia fila se escala independientemente para llenar
    // el 100% del ancho útil del monitor vertical, sin que un dispositivo de 1920px encoja al de 1366px.
    for (var r = 1; r <= n; r++) {
      if (forceVerticalStack && r < n) continue;

      var rows = partitionRows(devices, r, vW);
      if (rows.length !== r) continue;

      // En monitores verticales:
      // - Nunca ponemos un Desktop/Laptop junto a otro dispositivo en la misma fila.
      // - Si hay 3 o menos dispositivos en total, los apilamos 1 por fila para aprovechar la altura del monitor vertical.
      if (!forceVerticalStack && isPortraitStage && r < n) {
        if (n <= 3) continue;
        var hasDesktopSharingRow = rows.some(function (row) {
          return row.length > 1 && row.some(function (d) { return d.width >= 900 || d.kind === "desktop"; });
        });
        if (hasDesktopSharingRow) continue;
      }

      var sCandidate = 2.0;
      var sumRowH = 0;
      rows.forEach(function (row) {
        var sumW = row.reduce(function (a, d) { return a + vW(d); }, 0);
        var freeW = W - row.length * BEZEL - (row.length - 1) * GAP_X;
        sCandidate = Math.min(sCandidate, freeW / sumW);
        sumRowH += Math.max.apply(null, row.map(vH));
      });
      var freeH = H - r * (BEZEL + CAPTION) - (r - 1) * GAP_Y;
      var heightFit = freeH / sumRowH;
      if ((isFill && isPortraitStage && r > 1) || forceVerticalStack) {
        // En modo Fill sobre monitor vertical, priorizamos llenar el ancho del monitor
        sCandidate = Math.min(sCandidate, Math.max(heightFit, sCandidate));
      } else {
        sCandidate = Math.min(sCandidate, heightFit);
      }

      if (!best || sCandidate > best.s) {
        best = { s: sCandidate, rows: rows, freeH: freeH, sumRowH: sumRowH };
      }
    }

    var s;
    if (state.zoomMode === "fit" || state.zoomMode === "fill") {
      s = Math.max(ZOOM_MIN / 2, Math.min(2.0, best.s));
    } else {
      s = state.zoomMode;
    }
    state.isAutoVertical = isPortraitStage && best.rows.length === n && n > 1;

    var isStackedPortrait = (isPortraitStage || forceVerticalStack) && best.rows.length > 1;
    var effectiveZoomSamples = [];

    // Calculamos la escala final de cada dispositivo:
    // En monitor vertical / modo Vertical, si una fila tiene 1 solo dispositivo (ej. Laptop 1366 o Desktop 1920),
    // ese dispositivo llena directamente el ancho disponible W (en modo Fill) o se reparte proporcionalmente el alto (en modo Fit),
    // ignorando la penalización cruzada de `relScales` para que todos tengan el mismo ancho visual limpio.
    var extraH = isFill ? Math.max(0, best.freeH - best.sumRowH * s) : 0;
    var extraHPerRow = best.rows.length > 0 ? (extraH / best.rows.length) : 0;

    var rowScales = best.rows.map(function (row) {
      if (!isFill) return s;
      var sumW = row.reduce(function (a, d) { return a + vW(d); }, 0);
      var maxH = Math.max.apply(null, row.map(vH));
      var freeW = W - row.length * BEZEL - (row.length - 1) * GAP_X;
      var maxRowHAllowed = maxH * s + extraHPerRow;
      var sByW = sumW > 0 ? (freeW / sumW) : s;
      var sByH = maxH > 0 ? (maxRowHAllowed / maxH) : s;
      return Math.max(s, Math.min(s * 1.28, sByW, sByH));
    });

    function computeDeviceScale(d, row, ri) {
      if (isStackedPortrait && row.length === 1 && (state.zoomMode === "fill" || state.zoomMode === "fit")) {
        var freeW = W - BEZEL;
        var fitWScale = freeW / d.width;
        if (state.zoomMode === "fill" || forceVerticalStack) {
          // Si todas las filas caben en la altura H a ancho completo, usamos 100% del ancho.
          // Si no caben todas en H pero estamos en modo Fill, igual llenamos el 96% del ancho para que se vean grandes y nítidas.
          var perRowFreeH = (H - best.rows.length * (BEZEL + CAPTION) - (best.rows.length - 1) * GAP_Y) / best.rows.length;
          var fitHScale = perRowFreeH / d.height;
          if (best.rows.length <= 2) {
            return Math.min(fitWScale, Math.max(fitHScale, fitWScale * 0.96));
          }
          return Math.min(fitWScale, Math.max(fitHScale, fitWScale * 0.92));
        } else {
          // Modo Fit en monitor vertical: que todas las filas quepan exactamente en la altura sin scroll, pero cada una al máximo ancho posible
          var totalRawH = best.rows.reduce(function (acc, rItem) { return acc + rItem[0].height; }, 0);
          var availH = H - best.rows.length * (BEZEL + CAPTION) - (best.rows.length - 1) * GAP_Y;
          return Math.min(fitWScale, availH / totalRawH);
        }
      }
      return rowScales[ri] * relScales[d.id];
    }

    // Posiciones: filas centradas horizontal y verticalmente.
    var rowWidths = best.rows.map(function (row, ri) {
      return row.reduce(function (a, d) {
        var ds = computeDeviceScale(d, row, ri);
        return a + d.width * ds + BEZEL;
      }, 0) + (row.length - 1) * GAP_X;
    });
    var rowHeights = best.rows.map(function (row, ri) {
      return Math.max.apply(null, row.map(function (d) {
        var ds = computeDeviceScale(d, row, ri);
        return d.height * ds;
      })) + BEZEL + CAPTION;
    });
    var totalW = Math.max.apply(null, rowWidths);
    var totalH = rowHeights.reduce(function (a, b) { return a + b; }, 0) + (best.rows.length - 1) * GAP_Y;

    // Tamaño del área de scroll: al menos la pantalla, o lo que ocupe el contenido.
    var areaW = Math.max(W, totalW), areaH = Math.max(H, totalH);
    rack.style.width = Math.floor(areaW + PAD_X * 2) + "px";
    rack.style.height = Math.floor(areaH + PAD_TOP + PAD_BOTTOM) + "px";

    updatePanCursor();

    var y = PAD_TOP + (areaH - totalH) / 2;

    best.rows.forEach(function (row, ri) {
      var rowW = rowWidths[ri];
      var rowContentH = rowHeights[ri] - BEZEL - CAPTION;
      var x = PAD_X + (areaW - rowW) / 2;
      row.forEach(function (d) {
        var devScale = computeDeviceScale(d, row, ri);
        effectiveZoomSamples.push(devScale);
        var devH = d.height * devScale;
        // Centrar verticalmente cada dispositivo dentro de la altura de su fila
        var offsetY = y + Math.max(0, (rowContentH - devH) / 2);
        place(d, x, offsetY, devScale);
        x += d.width * devScale + BEZEL + GAP_X;
      });
      y += rowHeights[ri] + GAP_Y;
    });

    if (effectiveZoomSamples.length) {
      var avgScale = effectiveZoomSamples.reduce(function (a, b) { return a + b; }, 0) / effectiveZoomSamples.length;
      setZoom(avgScale);
    } else {
      setZoom(s);
    }
  }

  function place(d, x, y, devScale) {
    var e = els[d.id];
    e.scale = devScale;
    var w = d.width * devScale, h = d.height * devScale;
    e.screen.style.width = w + "px";
    e.screen.style.height = h + "px";
    e.iframe.width = d.width;
    e.iframe.height = d.height;
    e.iframe.style.width = d.width + "px";
    e.iframe.style.height = d.height + "px";
    if (e.sizeEl) {
      e.sizeEl.textContent = d.width + " × " + d.height;
    }
    e.root.style.width = (w + BEZEL) + "px";
    e.root.style.setProperty("--radius", Math.max(3, RADIUS[d.kind] * devScale) + "px");
    e.iframe.style.transform = "scale(" + devScale + ")";

    var t = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
    if (!e.root.dataset.placed) {
      // Primera vez: aparece en su sitio, sin deslizarse desde la esquina.
      e.root.style.transition = "none";
      e.root.style.transform = t;
      void e.root.offsetWidth;
      e.root.style.transition = "";
      e.root.dataset.placed = "1";
    } else {
      e.root.style.transform = t;
    }
  }

  function setZoom(s) {
    state.scale = s;
    stage.style.setProperty("--cell", (100 * s) + "px");
    stage.style.setProperty("--grid-x", PAD_X + "px");
    stage.style.setProperty("--grid-y", PAD_TOP + "px");
    // La leyenda de la cuadrícula está fuera del área de scroll.
    document.documentElement.style.setProperty("--cell", (100 * s) + "px");
    updateZoomUI();
  }

  function updateZoomUI() {
    var s = state.scale;
    zoomLabel.textContent = t("zoomValue", { n: Math.round(s * 100) });
    zoomFitBtn.setAttribute("aria-pressed", state.zoomMode === "fit" ? "true" : "false");
    if (zoomFillBtn) {
      zoomFillBtn.setAttribute("aria-pressed", state.zoomMode === "fill" ? "true" : "false");
      zoomFillBtn.title = t("zoomFillTitle");
    }
    if (stackBtn) {
      var isStacked = state.stackMode === "stack" || !!state.isAutoVertical;
      stackBtn.setAttribute("aria-pressed", isStacked ? "true" : "false");
      stackBtn.title = t("stackModeTitle");
    }
    zoomOutBtn.disabled = s <= ZOOM_MIN + 0.001;
    zoomInBtn.disabled = s >= ZOOM_MAX - 0.001;
    var label;
    label = t("zoomIn"); zoomInBtn.setAttribute("aria-label", label); zoomInBtn.title = label + " (" + MOD + " +)";
    label = t("zoomOut"); zoomOutBtn.setAttribute("aria-label", label); zoomOutBtn.title = label + " (" + MOD + " −)";
    zoomFitBtn.title = t("zoomFitTitle") + " (" + MOD + " 0)";
  }

  // Cambia el zoom manteniendo fijo un punto del tapete (el cursor, o el
  // centro si no hay cursor). anchor = {x, y} relativo a la esquina del tapete.
  var zoomingTimer;
  function applyZoom(mode, anchor) {
    var before = state.scale;
    if (mode !== "fit" && mode !== "fill") mode = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, mode));
    state.zoomMode = mode;
    store(STORE_ZOOM, mode);

    stage.classList.add("is-zooming");
    clearTimeout(zoomingTimer);
    zoomingTimer = setTimeout(function () { stage.classList.remove("is-zooming"); }, 200);

    var ax = anchor ? anchor.x : stage.clientWidth / 2;
    var ay = anchor ? anchor.y : stage.clientHeight / 2;
    var cx = stage.scrollLeft + ax, cy = stage.scrollTop + ay;

    layout();

    var ratio = state.scale / before;
    stage.scrollLeft = cx * ratio - ax;
    stage.scrollTop = cy * ratio - ay;
  }

  function stepZoom(dir) {
    var cur = state.scale, next;
    // Salta al siguiente paso que se note (al menos 4 % de diferencia).
    if (dir > 0) next = ZOOM_STEPS.filter(function (z) { return z > cur * 1.04; })[0] || ZOOM_MAX;
    else next = ZOOM_STEPS.filter(function (z) { return z < cur / 1.04; }).pop() || ZOOM_MIN;
    applyZoom(next);
  }

  function fitZoom() {
    applyZoom("fit");
    stage.scrollLeft = stage.scrollTop = 0;
  }

  function fillZoom() {
    applyZoom("fill");
    stage.scrollLeft = stage.scrollTop = 0;
  }

  function toggleStackMode() {
    if (state.stackMode === "stack" || state.isAutoVertical) {
      state.stackMode = state.stackMode === "stack" ? "auto" : "stack";
    } else {
      state.stackMode = "stack";
    }
    try { sessionStorage.setItem("rv.tab.stack", state.stackMode); } catch (_e) {}
    layout();
    stage.scrollLeft = stage.scrollTop = 0;
  }

  zoomInBtn.addEventListener("click", function () { stepZoom(1); });
  zoomOutBtn.addEventListener("click", function () { stepZoom(-1); });
  zoomFitBtn.addEventListener("click", fitZoom);
  if (zoomFillBtn) zoomFillBtn.addEventListener("click", fillZoom);
  if (stackBtn) stackBtn.addEventListener("click", toggleStackMode);

  // ⌘/Ctrl + y ⌘/Ctrl − hacen zoom en el visor en lugar de en Chrome.
  function onZoomKey(ev) {
    if (!(ev.metaKey || ev.ctrlKey) || ev.altKey) return;
    var k = ev.key;
    if (k === "+" || k === "=") stepZoom(1);
    else if (k === "-" || k === "_") stepZoom(-1);
    else if (k === "0") fitZoom();
    else return;
    ev.preventDefault();
    ev.stopPropagation();
  }

  // Pellizcar en el trackpad o Ctrl + rueda: Chrome los manda como "wheel"
  // con ctrlKey. toStage convierte las coordenadas del evento al tapete.
  function onZoomWheel(ev, toStage) {
    if (!ev.ctrlKey) return;
    ev.preventDefault();
    var p = toStage(ev.clientX, ev.clientY);
    // El trackpad manda pasos pequeños; la rueda del mouse, grandes. Se limita
    // cada evento a ±20 % para que un clic de rueda no salte de golpe.
    var factor = Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.01));
    factor = Math.min(1.2, Math.max(1 / 1.2, factor));
    applyZoom(state.scale * factor, p);
  }

  function stagePoint(clientX, clientY) {
    var r = stage.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  document.addEventListener("keydown", onZoomKey, true);
  // Rueda sobre el tapete: con Ctrl es zoom; sin Ctrl hace scroll en TODAS
  // las pantallas a la vez. Sobre una pantalla, el evento lo recibe solo
  // ese iframe, así que se desplaza únicamente esa.
  stage.addEventListener("wheel", function (ev) {
    if (ev.ctrlKey) { onZoomWheel(ev, stagePoint); return; }
    ev.preventDefault();
    scrollAllScreens(ev);
  }, { passive: false });

  function scrollAllScreens(ev) {
    var unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? stage.clientHeight : 1;
    // El gesto se mide en px de pantalla; dentro de cada página el contenido
    // está escalado, así que se divide por el zoom para que se sienta igual.
    var dx = ev.deltaX * unit / state.scale;
    var dy = ev.deltaY * unit / state.scale;
    if (ev.shiftKey && !dx) { dx = dy; dy = 0; }   // Shift + rueda = horizontal
    state.active.forEach(function (id) {
      var e = els[id];
      if (!e || e.iframe.hidden) return;
      try {
        e.iframe.contentWindow.postMessage({
          type: "rv:do_sync_scroll",
          dx: dx,
          dy: dy,
          force: true
        }, location.origin);
      } catch (_e) {}
    });
    if (state.sync) {
      postCrossTab({
        type: "bc:sync_scroll",
        dx: dx,
        dy: dy,
        force: true
      });
    }
  }

  // Para recorrer el tapete cuando el zoom no cabe: arrastrar el fondo.
  var pan = null;
  function canPan() {
    return stage.scrollWidth > stage.clientWidth + 1 || stage.scrollHeight > stage.clientHeight + 1;
  }
  function updatePanCursor() { stage.classList.toggle("can-pan", canPan()); }

  stage.addEventListener("pointerdown", function (ev) {
    if (ev.button !== 0 || !canPan()) return;
    if (ev.target.closest(".device-screen, button, a, input")) return;
    pan = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, left: stage.scrollLeft, top: stage.scrollTop };
    stage.setPointerCapture(ev.pointerId);
    stage.classList.add("is-panning");
    ev.preventDefault();
  });
  stage.addEventListener("pointermove", function (ev) {
    if (!pan || ev.pointerId !== pan.id) return;
    stage.scrollLeft = pan.left - (ev.clientX - pan.x);
    stage.scrollTop = pan.top - (ev.clientY - pan.y);
  });
  function endPan(ev) {
    if (!pan || ev.pointerId !== pan.id) return;
    pan = null;
    stage.classList.remove("is-panning");
  }
  stage.addEventListener("pointerup", endPan);
  stage.addEventListener("pointercancel", endPan);
  // Por si el pellizco cae fuera del tapete (en la barra de abajo).
  window.addEventListener("wheel", function (ev) { if (ev.ctrlKey) ev.preventDefault(); }, { passive: false });

  // Las páginas cargadas son del mismo origen (pasan por el proxy), así que
  // podemos escuchar el teclado y el pellizco también dentro de cada pantalla.
  function hookFrameZoom(iframe) {
    var w;
    try { w = iframe.contentWindow; if (!w || !w.document) return; } catch (_e) { return; }
    w.addEventListener("keydown", onZoomKey, true);
    w.addEventListener("keydown", function (ev) {
      if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey && (ev.key === "c" || ev.key === "C")) {
        ev.preventDefault();
        toggleInspector();
      } else if (ev.key === "Escape") {
        if (state.inspector) toggleInspector(false);
      }
    }, true);
    w.addEventListener("wheel", function (ev) {
      onZoomWheel(ev, function (x, y) {
        var r = iframe.getBoundingClientRect();
        return stagePoint(r.left + x * state.scale, r.top + y * state.scale);
      });
    }, { passive: false, capture: true });
  }

  // ---------- Buscar ----------
  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var url = normalizeUrl(input.value);
    if (!url) {
      toast(input.value.trim() ? t("toastInvalidUrl") : t("toastEmptyUrl"));
      input.focus();
      return;
    }
    input.value = url;
    state.url = url;
    state.frameUrls = {};
    store(STORE_URL, url);
    if (!state.active.length) toast(t("toastNoDevices"));
    state.active.forEach(function (id) { navigateFrame(id, url); });
    if (state.sync) {
      postCrossTab({ type: "bc:load_url", url: url });
    }
  });

  // ---------- Refrescar (borra cookies) ----------
  function clearDocumentCookies() {
    // Cookies que la página puso con JavaScript en este origen.
    document.cookie.split(";").forEach(function (c) {
      var name = c.split("=")[0].trim();
      if (name) document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    });
  }

  refreshBtn.addEventListener("click", function () {
    if (refreshBtn.disabled) return;
    refreshBtn.disabled = true;
    refreshBtn.classList.add("is-busy");

    fetch("/api/reset", { method: "POST", credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function () {
        clearDocumentCookies();
        if (!state.url) {
          toast(t("toastClearedNoUrl"));
          return;
        }
        state.active.forEach(function (id) {
          navigateFrame(id, state.frameUrls[id] || state.url, true);
        });
        if (state.sync) {
          postCrossTab({ type: "bc:reload" });
        }
        toast(t("toastCleared"));
      })
      .catch(function () {
        toast(t("toastResetFailed"));
      })
      .then(function () {
        refreshBtn.disabled = false;
        refreshBtn.classList.remove("is-busy");
      });
  });

  // Las páginas avisan cuando el usuario navega dentro de una pantalla,
  // para que Refrescar recargue la página donde está, no la inicial.
  // También sincroniza scroll, clics e inputs entre todos los dispositivos simulados.
  function broadcastToOtherFrames(sourceFrameId, payload) {
    state.active.forEach(function (id) {
      if (id === sourceFrameId) return;
      var item = els[id];
      if (item && item.iframe && !item.iframe.hidden && item.iframe.contentWindow) {
        try {
          item.iframe.contentWindow.postMessage(payload, location.origin);
        } catch (_e) {}
      }
    });
  }

  window.addEventListener("message", function (ev) {
    if (ev.origin !== location.origin || !ev.data) return;
    var d = ev.data;
    if (d.type === "rv:navigated") {
      var prevUrl = state.frameUrls[d.frame];
      if (els[d.frame]) state.frameUrls[d.frame] = d.url;
      fetchTraffic();
      postCrossTab({ type: "bc:traffic_ping" });
      if (flowState.recording && d.url && d.url !== prevUrl) {
        fetch("/api/flow", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            frame: d.frame,
            action: "navigate",
            selector: "window",
            tag: "document",
            text: d.url,
            value: d.url,
            url: d.url
          })
        }).then(function () {
          fetchFlow();
          postCrossTab({ type: "bc:flow_ping" });
        }).catch(function () {});
      }
    } else if (d.type === "rv:traffic_ping") {
      fetchTraffic();
      postCrossTab({ type: "bc:traffic_ping" });
    } else if (d.type === "rv:console_event") {
      fetch("/api/console", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(d)
      }).then(function () {
        fetchConsole();
        postCrossTab({ type: "bc:console_ping" });
      }).catch(function () {});
    } else if (d.type === "rv:flow_event") {
      if (!flowState.recording) return;
      fetch("/api/flow", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(d)
      }).then(function () {
        fetchFlow();
        postCrossTab({ type: "bc:flow_ping" });
      }).catch(function () {});
    } else if (d.type === "rv:audit_results") {
      fetch("/api/audit", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(d)
      }).then(function () {
        fetchAudit();
        postCrossTab({ type: "bc:audit_ping" });
      }).catch(function () {});
    } else if (d.type === "rv:storage_snapshot") {
      fetch("/api/storage", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(d)
      }).then(function () {
        fetchStorage();
        postCrossTab({ type: "bc:storage_ping" });
      }).catch(function () {});
    } else if (d.type === "rv:dom_layout_snapshot") {
      if (d.frame && pendingDomSnapshots[d.frame]) {
        pendingDomSnapshots[d.frame](d);
        delete pendingDomSnapshots[d.frame];
      }
    } else if (d.type === "rv:element_hover") {
      showInspectorHover(d);
    } else if (d.type === "rv:element_leave") {
      hideInspectorFloat();
    } else if (d.type === "rv:element_picked") {
      onInspectorPicked(d);
    } else if (d.type === "rv:exit_inspector") {
      if (state.inspector) toggleInspector(false);
    } else if (d.type === "rv:sync_scroll") {
      if (!state.sync) return;
      var scrollPayload = {
        type: "rv:do_sync_scroll",
        containerSelector: d.containerSelector || "",
        x: d.x,
        y: d.y,
        dx: d.dx,
        dy: d.dy
      };
      broadcastToOtherFrames(d.frame, scrollPayload);
      postCrossTab({ type: "bc:sync_scroll", payload: scrollPayload });
    } else if (d.type === "rv:sync_click") {
      if (!state.sync) return;
      var clickPayload = {
        type: "rv:do_sync_click",
        selector: d.selector,
        structuralSelector: d.structuralSelector,
        interactiveSelector: d.interactiveSelector,
        interactiveStructural: d.interactiveStructural,
        tag: d.tag,
        text: d.text,
        href: d.href,
        absHref: d.absHref
      };
      broadcastToOtherFrames(d.frame, clickPayload);
      postCrossTab({ type: "bc:sync_click", payload: clickPayload });
    } else if (d.type === "rv:sync_input") {
      if (!state.sync) return;
      var inputPayload = {
        type: "rv:do_sync_input",
        eventType: d.eventType,
        selector: d.selector,
        structuralSelector: d.structuralSelector,
        id: d.id,
        name: d.name,
        tag: d.tag,
        value: d.value,
        checked: d.checked,
        inputType: d.inputType
      };
      broadcastToOtherFrames(d.frame, inputPayload);
      postCrossTab({ type: "bc:sync_input", payload: inputPayload });
    }
  });

  // Recepción de eventos sincronizados desde otros monitores / pestañas
  if (syncChannel) {
    syncChannel.addEventListener("message", function (ev) {
      var msg = ev.data;
      if (!msg || msg.tabId === TAB_ID) return;

      if (msg.type === "bc:traffic_ping") {
        fetchTraffic();
        return;
      }
      if (msg.type === "bc:console_ping") {
        fetchConsole();
        return;
      }
      if (msg.type === "bc:audit_ping") {
        fetchAudit();
        return;
      }
      if (msg.type === "bc:flow_ping") {
        fetchFlow();
        return;
      }
      if (msg.type === "bc:storage_ping") {
        fetchStorage();
        return;
      }
      if (msg.type === "bc:inspected_ping" && msg.item) {
        lastInspectedElement = msg.item;
        return;
      }
      if (msg.type === "bc:traffic_clear") {
        trafficState.items = [];
        trafficState.selectedId = null;
        if (trafficCountEl) trafficCountEl.textContent = "0";
        renderTrafficTable();
        renderTrafficDetail();
        return;
      }
      if (msg.type === "bc:console_clear") {
        consoleState.items = [];
        consoleState.selectedId = null;
        updateConsoleBadge();
        renderConsoleTable();
        renderConsoleDetail();
        return;
      }
      if (msg.type === "bc:audit_clear") {
        auditState.items = [];
        auditState.selectedIdx = -1;
        updateAuditBadge();
        renderAuditTable();
        renderAuditDetail();
        return;
      }
      if (msg.type === "bc:flow_clear") {
        flowState.items = [];
        flowState.selectedId = null;
        if (flowCountEl) flowCountEl.textContent = "0";
        renderFlowTable();
        renderFlowDetail();
        return;
      }

      if (!state.sync) return;

      if (msg.type === "bc:load_url" && msg.url) {
        input.value = msg.url;
        state.url = msg.url;
        state.frameUrls = {};
        state.active.forEach(function (id) { navigateFrame(id, msg.url); });
      } else if (msg.type === "bc:reload") {
        clearDocumentCookies();
        if (state.url) {
          state.active.forEach(function (id) {
            navigateFrame(id, state.frameUrls[id] || state.url, true);
          });
        }
      } else if (msg.type === "bc:sync_scroll") {
        var sp = msg.payload || { type: "rv:do_sync_scroll", dx: msg.dx, dy: msg.dy, force: true };
        broadcastToOtherFrames(null, sp);
      } else if (msg.type === "bc:sync_click" && msg.payload) {
        broadcastToOtherFrames(null, msg.payload);
      } else if (msg.type === "bc:sync_input" && msg.payload) {
        broadcastToOtherFrames(null, msg.payload);
      }
    });
  }

  // ---------- Sincronización Multi-Dispositivo ----------
  function updateSyncUI() {
    if (!syncBtn) return;
    syncBtn.setAttribute("aria-pressed", state.sync ? "true" : "false");
    syncBtn.classList.toggle("is-active", state.sync);
  }

  function toggleSync(on, silent) {
    if (on === undefined) on = !state.sync;
    state.sync = !!on;
    store(STORE_SYNC, state.sync);
    updateSyncUI();

    state.active.forEach(function (id) {
      var item = els[id];
      if (item && item.iframe && item.iframe.contentWindow) {
        try {
          item.iframe.contentWindow.postMessage({
            type: "rv:set_sync",
            active: state.sync
          }, location.origin);
        } catch (_e) {}
      }
    });

    if (!silent) {
      toast(state.sync ? t("syncOn") : t("syncOff"));
    }
  }

  if (syncBtn) {
    syncBtn.addEventListener("click", function () {
      toggleSync();
    });
  }

  // ---------- Inspector de Elementos Flotante (Estilo IDE) ----------
  function copyText(text, successMsg) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast(successMsg);
      }).catch(function () {
        fallbackCopy(text, successMsg);
      });
    } else {
      fallbackCopy(text, successMsg);
    }
  }

  function fallbackCopy(text, successMsg) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      toast(successMsg);
    } catch (_e) {
      toast("Error al copiar");
    }
    ta.remove();
  }

  function hideInspectorFloat() {
    if (inspectFloat) inspectFloat.hidden = true;
  }

  function toggleInspector(on) {
    if (on === undefined) on = !state.inspector;
    state.inspector = !!on;

    if (inspectBtn) {
      inspectBtn.setAttribute("aria-pressed", state.inspector ? "true" : "false");
      inspectBtn.classList.toggle("is-active", state.inspector);
    }
    if (inspectBanner) {
      inspectBanner.hidden = !state.inspector;
    }
    if (!state.inspector) {
      hideInspectorFloat();
    }

    state.active.forEach(function (id) {
      var item = els[id];
      if (item && item.iframe && item.iframe.contentWindow) {
        try {
          item.iframe.contentWindow.postMessage({
            type: "rv:set_inspector",
            active: state.inspector
          }, location.origin);
        } catch (_e) {}
      }
    });
  }

  function showInspectorHover(data) {
    if (!state.inspector || !inspectFloat) return;
    var item = els[data.frame];
    if (!item || !item.iframe) return;

    var dObj = BY_ID[data.frame];
    var devText = dObj ? (dObj.name + " (" + dObj.width + "×" + dObj.height + ")") : (data.frame || "");
    var endpoint = data.url || state.frameUrls[data.frame] || state.url || "";
    if (inspectBadge) inspectBadge.textContent = "<" + (data.tag || "element") + ">";
    if (inspectDim) inspectDim.textContent = (data.width && data.height) ? (data.width + "×" + data.height + " px") : "";
    if (inspectDevice) {
      inspectDevice.textContent = devText;
      inspectDevice.style.color = deviceColor(data.frame);
    }
    if (inspectLink) inspectLink.textContent = endpoint;
    if (inspectSelector) inspectSelector.textContent = data.selector || "";
    if (inspectStyles) inspectStyles.textContent = data.stylesSummary || "";
    if (inspectStylesRow) inspectStylesRow.hidden = !data.stylesSummary;
    if (inspectCode) inspectCode.textContent = data.foldedHtml || "";

    inspectFloat.hidden = false;

    // Convertir coordenadas internas del iframe a coordenadas de la ventana principal
    var ir = item.iframe.getBoundingClientRect();
    var devScale = item.scale || state.scale || 1;
    var px = ir.left + (data.clientX || 0) * devScale;
    var py = ir.top + (data.clientY || 0) * devScale;

    var fw = inspectFloat.offsetWidth || 340;
    var fh = inspectFloat.offsetHeight || 180;
    var margin = 16;

    var x = px + 18;
    var y = py + 18;
    if (x + fw + margin > window.innerWidth) {
      x = Math.max(margin, px - fw - 16);
    }
    if (y + fh + margin > window.innerHeight) {
      y = Math.max(margin, py - fh - 16);
    }
    inspectFloat.style.transform = "translate3d(" + Math.round(x) + "px," + Math.round(y) + "px,0)";
  }

  function formatBoxString(box) {
    if (!box) return "";
    if (typeof box === "string") return box;
    if (typeof box === "object" && box.width !== undefined) {
      var s = box.width + "×" + box.height + "px (x:" + (box.x || 0) + ", y:" + (box.y || 0);
      if (box.scrollWidth && box.scrollWidth > box.width + 2) s += ", scrollW:" + box.scrollWidth + "px";
      if (box.viewportW) s += ", viewport:" + box.viewportW + "×" + box.viewportH + "px";
      if (box.overflowRightPx > 0) s += ", overflowRight:+" + box.overflowRightPx + "px";
      return s + ")";
    }
    return "";
  }

  function formatInspectedClipboardText(item) {
    if (!item) return "";
    var boxStr = formatBoxString(item.box);
    var lines = [
      "link: " + (item.url || state.url || ""),
      "device: " + (item.device_name || item.frame || "—")
    ];
    if (item.selector) lines.push("selector: " + item.selector);
    if (boxStr) lines.push("box: " + boxStr);
    if (item.stylesSummary) lines.push("styles: " + item.stylesSummary);
    lines.push("element: " + (item.html || ""));
    return lines.join("\n");
  }

  function onInspectorPicked(data) {
    if (!state.inspector) return;
    var dObj = BY_ID[data.frame];
    var devLabel = dObj ? (dObj.name + " (" + dObj.width + "×" + dObj.height + ")") : (data.frame || "");
    var endpoint = data.url || state.frameUrls[data.frame] || state.url || "";
    lastInspectedElement = {
      frame: data.frame,
      device_name: devLabel,
      url: endpoint,
      tag: data.tag || "element",
      selector: data.selector || "",
      width: data.width || 0,
      height: data.height || 0,
      box: data.box || "",
      stylesSummary: data.stylesSummary || "",
      stylesMap: data.stylesMap || {},
      html: data.html || ""
    };

    fetch("/api/inspected", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lastInspectedElement)
    }).catch(function () {});
    postCrossTab({ type: "bc:inspected_ping", item: lastInspectedElement });

    var payload = formatInspectedClipboardText(lastInspectedElement);
    // Al dar clic se copia link:, device:, selector:, box:, styles: y element: al portapapeles sin salir del modo inspección
    copyText(payload, t("copiedHtml"));

    if (inspectFloat) {
      inspectFloat.classList.add("is-copied");
    }
    if (inspectCopiedPill) {
      inspectCopiedPill.hidden = false;
    }
    clearTimeout(copiedPillTimer);
    copiedPillTimer = setTimeout(function () {
      if (inspectFloat) inspectFloat.classList.remove("is-copied");
      if (inspectCopiedPill) inspectCopiedPill.hidden = true;
    }, 1100);
  }

  if (inspectBtn) {
    inspectBtn.addEventListener("click", function () {
      toggleInspector();
    });
  }
  if (inspectClose) {
    inspectClose.addEventListener("click", function () {
      toggleInspector(false);
    });
  }

  window.addEventListener("keydown", function (ev) {
    if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey && (ev.key === "c" || ev.key === "C")) {
      ev.preventDefault();
      toggleInspector();
    } else if (ev.key === "Escape") {
      if (state.inspector) toggleInspector(false);
    }
  });

  // ---------- Tráfico HTTP (Estilo Burp Suite HTTP History) ----------
  function formatBytes(n) {
    if (!n || n <= 0) return "0 B";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(2) + " MB";
  }

  function statusClass(code) {
    if (code >= 200 && code < 300) return "status-2xx";
    if (code >= 300 && code < 400) return "status-3xx";
    if (code >= 400 && code < 500) return "status-4xx";
    return "status-5xx";
  }

  function buildDeviceChip(deviceId, deviceName) {
    var col = deviceColor(deviceId);
    var pill = document.createElement("span");
    pill.className = "device-pill";
    pill.style.setProperty("--dev-color", col);
    var dot = document.createElement("span");
    dot.className = "device-pill-dot";
    pill.appendChild(dot);
    pill.appendChild(document.createTextNode(deviceName || deviceId || "—"));
    return pill;
  }

  function populateTrafficDeviceSelect() {
    if (!trafficDeviceFilter) return;
    CATALOG.forEach(function (d) {
      var opt = document.createElement("option");
      opt.value = d.id;
      opt.textContent = d.name;
      opt.style.color = deviceColor(d.id);
      trafficDeviceFilter.appendChild(opt);
    });
  }

  function matchesTrafficFilter(item) {
    if (trafficState.deviceFilter !== "all" && item.device_id !== trafficState.deviceFilter) {
      return false;
    }
    var mf = trafficState.methodFilter;
    if (mf === "GET" && item.method !== "GET") return false;
    if (mf === "POST" && item.method !== "POST") return false;
    if (mf === "MUT" && ["PUT", "PATCH", "DELETE"].indexOf(item.method) === -1) return false;
    if (mf === "API" && item.mime !== "json" && item.method === "GET") return false;

    if (trafficState.searchQuery) {
      var q = trafficState.searchQuery.toLowerCase();
      var hay = (item.url + " " + item.method + " " + item.status + " " + item.device_name + " " + item.mime).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  }

  function renderTrafficDetail() {
    if (!trafficRawCode) return;
    var selected = null;
    for (var i = 0; i < trafficState.items.length; i++) {
      if (trafficState.items[i].id === trafficState.selectedId) {
        selected = trafficState.items[i];
        break;
      }
    }
    if (!selected) {
      trafficRawCode.textContent = t("trafficSelectHint");
      return;
    }
    trafficRawCode.textContent = trafficState.activeTab === "response" ? selected.raw_response : selected.raw_request;
  }

  function renderTrafficTable(scrollToBottom) {
    if (!trafficTbody) return;
    var filtered = trafficState.items.filter(matchesTrafficFilter);
    trafficTbody.innerHTML = "";
    if (trafficEmpty) trafficEmpty.hidden = filtered.length > 0;

    filtered.forEach(function (item, idx) {
      var tr = document.createElement("tr");
      if (item.id === trafficState.selectedId) tr.className = "is-selected";
      var devCol = deviceColor(item.device_id);
      tr.style.setProperty("--dev-color", devCol);

      var tdId = document.createElement("td");
      tdId.className = "col-id";
      tdId.textContent = "#" + item.id;

      var tdMethod = document.createElement("td");
      tdMethod.className = "col-method";
      var mBadge = document.createElement("span");
      mBadge.className = "method-badge method-" + item.method;
      mBadge.textContent = item.method;
      tdMethod.appendChild(mBadge);

      var tdStatus = document.createElement("td");
      tdStatus.className = "col-status " + statusClass(item.status);
      tdStatus.textContent = item.status || "ERR";

      var tdDevice = document.createElement("td");
      tdDevice.className = "col-device";
      tdDevice.appendChild(buildDeviceChip(item.device_id, item.device_name));
      tdDevice.title = item.device_name;

      var tdHost = document.createElement("td");
      tdHost.className = "col-host";
      tdHost.textContent = item.host;
      tdHost.title = item.host;

      var tdPath = document.createElement("td");
      tdPath.className = "col-path";
      tdPath.textContent = item.path;
      tdPath.title = item.url;

      var tdMime = document.createElement("td");
      tdMime.className = "col-mime";
      tdMime.textContent = item.mime;

      var tdSize = document.createElement("td");
      tdSize.className = "col-size";
      tdSize.textContent = formatBytes(item.size);

      var tdTime = document.createElement("td");
      tdTime.className = "col-time";
      tdTime.textContent = item.duration_ms + " ms";

      tr.appendChild(tdId);
      tr.appendChild(tdMethod);
      tr.appendChild(tdStatus);
      tr.appendChild(tdDevice);
      tr.appendChild(tdHost);
      tr.appendChild(tdPath);
      tr.appendChild(tdMime);
      tr.appendChild(tdSize);
      tr.appendChild(tdTime);

      tr.addEventListener("click", function () {
        trafficState.selectedId = item.id;
        // Si selecciona la última fila, sigue avanzando automáticamente con las nuevas
        trafficState.userPinned = idx < filtered.length - 1;
        renderTrafficTable(false);
        renderTrafficDetail();
      });

      trafficTbody.appendChild(tr);
    });

    if (scrollToBottom) {
      var wrap = trafficTbody.closest(".traffic-table-wrap");
      if (wrap) {
        wrap.scrollTop = wrap.scrollHeight;
      }
    }
  }

  var isFetchingTraffic = false;
  function fetchTraffic() {
    if (trafficState.paused || isFetchingTraffic) return;
    isFetchingTraffic = true;
    fetch("/api/traffic?since=" + trafficState.lastSeq, { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !Array.isArray(data.items) || !data.items.length) return;
        data.items.forEach(function (item) {
          trafficState.items.push(item);
          if (item.id > trafficState.lastSeq) trafficState.lastSeq = item.id;
        });
        if (trafficState.items.length > 400) {
          trafficState.items = trafficState.items.slice(trafficState.items.length - 400);
        }
        if (trafficCountEl) {
          trafficCountEl.textContent = String(trafficState.items.length);
        }
        if ((!trafficState.selectedId || !trafficState.userPinned) && trafficState.items.length) {
          trafficState.selectedId = trafficState.items[trafficState.items.length - 1].id;
        }
        if (trafficState.open && trafficState.panelMode === "traffic") {
          renderTrafficTable(true);
          renderTrafficDetail();
        }
      })
      .catch(function () {})
      .then(function () {
        isFetchingTraffic = false;
      });
  }

  // ---------- Consola del Navegador (Logs, Warnings y Errores) ----------
  function updateConsoleBadge() {
    if (!consoleCountEl) return;
    consoleCountEl.textContent = String(consoleState.items.length);
    var hasErr = consoleState.items.some(function (it) { return it.level === "error"; });
    consoleCountEl.classList.toggle("has-error", hasErr);
  }

  function matchesConsoleFilter(item) {
    if (trafficState.deviceFilter !== "all" && item.device_id !== trafficState.deviceFilter) {
      return false;
    }
    var lf = consoleState.levelFilter;
    if (lf === "error" && item.level !== "error") return false;
    if (lf === "warn" && item.level !== "warn") return false;
    if (lf === "info" && item.level !== "info") return false;
    if (lf === "log" && item.level !== "log" && item.level !== "debug") return false;

    if (trafficState.searchQuery) {
      var q = trafficState.searchQuery.toLowerCase();
      var hay = (item.message + " " + item.level + " " + item.device_name + " " + item.source + " " + item.url).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  }

  function getSelectedConsoleItem() {
    for (var i = 0; i < consoleState.items.length; i++) {
      if (consoleState.items[i].id === consoleState.selectedId) return consoleState.items[i];
    }
    return null;
  }

  function formatConsoleDetailText(item) {
    if (!item) return "";
    var lines = [
      "[" + item.time + "] [" + item.level.toUpperCase() + "] (" + item.device_name + ")",
      "URL: " + (item.url || "—")
    ];
    if (item.source) lines.push("Source: " + item.source);
    lines.push("", item.message || "");
    if (item.stack) {
      lines.push("", "--- Stack Trace ---", item.stack);
    }
    return lines.join("\n");
  }

  function renderConsoleDetail() {
    if (!consoleRawCode) return;
    var selected = getSelectedConsoleItem();
    if (!selected) {
      consoleRawCode.textContent = t("consoleSelectHint");
      return;
    }
    consoleRawCode.textContent = formatConsoleDetailText(selected);
  }

  function renderConsoleTable(scrollToBottom) {
    if (!consoleTbody) return;
    var filtered = consoleState.items.filter(matchesConsoleFilter);
    consoleTbody.innerHTML = "";
    if (consoleEmpty) consoleEmpty.hidden = filtered.length > 0;

    filtered.forEach(function (item, idx) {
      var tr = document.createElement("tr");
      if (item.id === consoleState.selectedId) tr.className = "is-selected";
      tr.style.setProperty("--dev-color", deviceColor(item.device_id));

      var tdId = document.createElement("td");
      tdId.className = "col-id";
      tdId.textContent = "#" + item.id;

      var tdLevel = document.createElement("td");
      tdLevel.className = "col-level";
      var lBadge = document.createElement("span");
      lBadge.className = "level-badge level-" + item.level;
      lBadge.textContent = item.level.toUpperCase();
      tdLevel.appendChild(lBadge);

      var tdDevice = document.createElement("td");
      tdDevice.className = "col-device";
      tdDevice.appendChild(buildDeviceChip(item.device_id, item.device_name));
      tdDevice.title = item.device_name;

      var tdMsg = document.createElement("td");
      tdMsg.className = "col-msg";
      tdMsg.textContent = (item.message || "").split("\n")[0];
      tdMsg.title = item.message || "";

      var tdSrc = document.createElement("td");
      tdSrc.className = "col-source";
      tdSrc.textContent = item.source || item.url || "—";
      tdSrc.title = item.source || item.url || "";

      var tdTime = document.createElement("td");
      tdTime.className = "col-time";
      tdTime.textContent = item.time || "";

      tr.appendChild(tdId);
      tr.appendChild(tdLevel);
      tr.appendChild(tdDevice);
      tr.appendChild(tdMsg);
      tr.appendChild(tdSrc);
      tr.appendChild(tdTime);

      tr.addEventListener("click", function () {
        consoleState.selectedId = item.id;
        consoleState.userPinned = idx < filtered.length - 1;
        renderConsoleTable(false);
        renderConsoleDetail();
      });

      consoleTbody.appendChild(tr);
    });

    if (scrollToBottom) {
      var wrap = consoleTbody.closest(".traffic-table-wrap");
      if (wrap) {
        wrap.scrollTop = wrap.scrollHeight;
      }
    }
  }

  var isFetchingConsole = false;
  function fetchConsole() {
    if (trafficState.paused || isFetchingConsole) return;
    isFetchingConsole = true;
    fetch("/api/console?since=" + consoleState.lastSeq, { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !Array.isArray(data.items) || !data.items.length) return;
        data.items.forEach(function (item) {
          consoleState.items.push(item);
          if (item.id > consoleState.lastSeq) consoleState.lastSeq = item.id;
        });
        if (consoleState.items.length > 500) {
          consoleState.items = consoleState.items.slice(consoleState.items.length - 500);
        }
        updateConsoleBadge();
        if ((!consoleState.selectedId || !consoleState.userPinned) && consoleState.items.length) {
          consoleState.selectedId = consoleState.items[consoleState.items.length - 1].id;
        }
        if (trafficState.open && trafficState.panelMode === "console") {
          renderConsoleTable(true);
          renderConsoleDetail();
        }
      })
      .catch(function () {})
      .then(function () {
        isFetchingConsole = false;
      });
  }

  // ---------- Auditoría Visual Automática (Overflow-X, Imágenes rotas/deformadas, Texto cortado, Área táctil) ----------
  function updateAuditBadge() {
    if (!auditCountEl) return;
    auditCountEl.textContent = String(auditState.items.length);
    var hasErr = auditState.items.some(function (it) { return it.severity === "error"; });
    auditCountEl.classList.toggle("has-error", hasErr);
  }

  function matchesAuditFilter(item) {
    if (trafficState.deviceFilter !== "all" && item.device_id !== trafficState.deviceFilter) {
      return false;
    }
    if (trafficState.searchQuery) {
      var q = trafficState.searchQuery.toLowerCase();
      var hay = ((item.kind || "") + " " + (item.selector || "") + " " + (item.summary || "") + " " + (item.device_name || "")).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  }

  function formatAuditIssueForAi(item) {
    if (!item) return "";
    var boxStr = formatBoxString(item.box);
    var stylesStr = item.stylesSummary || item.styles || "";
    var lines = [
      "### [" + (item.kind || "VISUAL") + "] en " + (item.device_name || item.device_id) + " (" + (item.viewport || "") + ")",
      "- **URL:** " + (item.url || state.url || "—"),
      "- **Severidad:** " + (item.severity || "warn").toUpperCase(),
      "- **Selector CSS:** `" + (item.selector || "") + "`",
      "- **Problema detectado:** " + (item.summary || ""),
      "- **Detalle técnico:** " + (item.detail || "")
    ];
    if (boxStr) lines.push("- **Layout Box:** `" + boxStr + "`");
    if (stylesStr) lines.push("- **Computed Styles:** `" + stylesStr + "`");
    if (item.html) {
      lines.push("- **HTML del elemento:**", "```html", item.html, "```");
    }
    return lines.join("\n");
  }

  function formatAllAuditIssuesForAi() {
    var filtered = auditState.items.filter(matchesAuditFilter);
    if (!filtered.length) return "Sin problemas visuales detectados.";
    var header = "## Diagnóstico de Auditoría Visual y Responsiva (" + filtered.length + " hallazgos)\n\n";
    return header + filtered.map(formatAuditIssueForAi).join("\n\n");
  }

  function renderAuditDetail() {
    if (!auditRawCode) return;
    var filtered = auditState.items.filter(matchesAuditFilter);
    var selected = (auditState.selectedIdx >= 0 && auditState.selectedIdx < filtered.length)
      ? filtered[auditState.selectedIdx]
      : (filtered.length ? filtered[0] : null);
    if (!selected) {
      auditRawCode.textContent = t("auditSelectHint");
      return;
    }
    auditRawCode.textContent = formatAuditIssueForAi(selected);
  }

  function renderAuditTable() {
    if (!auditTbody) return;
    var filtered = auditState.items.filter(matchesAuditFilter);
    auditTbody.innerHTML = "";
    if (auditEmpty) auditEmpty.hidden = filtered.length > 0;

    if (auditState.selectedIdx >= filtered.length) {
      auditState.selectedIdx = filtered.length ? 0 : -1;
    }

    filtered.forEach(function (item, idx) {
      var tr = document.createElement("tr");
      if (idx === auditState.selectedIdx) tr.className = "is-selected";
      tr.style.setProperty("--dev-color", deviceColor(item.device_id));

      var tdId = document.createElement("td");
      tdId.className = "col-id";
      tdId.textContent = "#" + (idx + 1);

      var tdKind = document.createElement("td");
      tdKind.className = "col-level";
      var kBadge = document.createElement("span");
      kBadge.className = "level-badge " + (item.severity === "error" ? "level-error" : "level-warn");
      kBadge.textContent = item.kind || "VISUAL";
      tdKind.appendChild(kBadge);

      var tdDevice = document.createElement("td");
      tdDevice.className = "col-device";
      tdDevice.appendChild(buildDeviceChip(item.device_id, item.device_name));

      var tdSel = document.createElement("td");
      tdSel.className = "col-host";
      tdSel.textContent = item.selector || "—";
      tdSel.title = item.selector || "";

      var tdDesc = document.createElement("td");
      tdDesc.className = "col-cmsg";
      tdDesc.textContent = (item.summary || "") + (item.detail ? " — " + item.detail : "");
      tdDesc.title = (item.summary || "") + "\n" + (item.detail || "");

      tr.appendChild(tdId);
      tr.appendChild(tdKind);
      tr.appendChild(tdDevice);
      tr.appendChild(tdSel);
      tr.appendChild(tdDesc);

      tr.addEventListener("click", function () {
        auditState.selectedIdx = idx;
        renderAuditTable();
        renderAuditDetail();
        // Hacer scroll y resaltar el elemento problemático dentro de ese dispositivo
        var devEntry = els[item.device_id];
        if (devEntry && devEntry.iframe && devEntry.iframe.contentWindow && item.selector) {
          try {
            devEntry.iframe.contentWindow.postMessage({
              type: "rv:focus_audit_element",
              selector: item.selector
            }, location.origin);
          } catch (_e) {}
        }
      });

      auditTbody.appendChild(tr);
    });
  }

  var isFetchingAudit = false;
  function fetchAudit() {
    if (isFetchingAudit) return;
    isFetchingAudit = true;
    fetch("/api/audit", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !Array.isArray(data.items)) return;
        auditState.items = data.items;
        if (auditState.selectedIdx === -1 && auditState.items.length) {
          auditState.selectedIdx = 0;
        }
        updateAuditBadge();
        if (trafficState.open && trafficState.panelMode === "audit") {
          renderAuditTable();
          renderAuditDetail();
        }
      })
      .catch(function () {})
      .then(function () {
        isFetchingAudit = false;
      });
  }

  function triggerAuditScan() {
    state.active.forEach(function (id) {
      var item = els[id];
      if (item && item.iframe && !item.iframe.hidden && item.iframe.contentWindow) {
        try {
          item.iframe.contentWindow.postMessage({ type: "rv:run_audit" }, location.origin);
        } catch (_e) {}
      }
    });
  }

  function toggleAuditHighlight(on) {
    if (on === undefined) on = !auditState.highlightOnScreens;
    auditState.highlightOnScreens = !!on;
    if (auditHighlightBtn) {
      auditHighlightBtn.setAttribute("aria-pressed", auditState.highlightOnScreens ? "true" : "false");
      auditHighlightBtn.classList.toggle("is-active", auditState.highlightOnScreens);
    }
    state.active.forEach(function (id) {
      var item = els[id];
      if (item && item.iframe && item.iframe.contentWindow) {
        try {
          item.iframe.contentWindow.postMessage({
            type: "rv:set_audit_highlight",
            active: auditState.highlightOnScreens
          }, location.origin);
        } catch (_e) {}
      }
    });
  }

  // ---------- Rastreador de Usuario (Pasos con Sección, Zona, Coordenadas, Scroll, Swipe + Playwright) ----------
  function matchesFlowFilter(item) {
    if (trafficState.deviceFilter !== "all" && item.device_id !== trafficState.deviceFilter) {
      return false;
    }
    if (trafficState.searchQuery) {
      var q = trafficState.searchQuery.toLowerCase();
      var hay = (
        (item.action || "") + " " +
        (item.section || "") + " " +
        (item.zone || "") + " " +
        (item.selector || "") + " " +
        (item.label || item.text || "") + " " +
        (item.value || "") + " " +
        (item.device_name || "")
      ).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  }

  function formatFlowStepLine(st, num) {
    var txt = st.label || st.text || "";
    var sec = st.section ? (" | **Sección:** " + st.section) : "";
    var zn = st.zone ? (" | **Zona:** " + st.zone) : "";
    var c = st.coords || {};
    var coordStr = (typeof c.x === "number" && typeof c.y === "number" && st.action !== "scroll")
      ? (" · `(x:" + c.x + "px, y:" + c.y + "px)`")
      : "";

    if (st.action === "navigate") {
      return num + ". **[NAVEGAR]** a `" + (st.url || st.value) + "` — *[" + st.device_name + "]*";
    }
    if (st.action === "scroll") {
      var targetDesc = (st.selector && st.selector !== "window") ? (" en contenedor `" + st.selector + "`") : " en página";
      return num + ". **[SCROLL]** " + (txt || st.value || "Deslizamiento") + targetDesc + sec + " — *[" + st.device_name + "]*";
    }
    if (st.action === "swipe") {
      return num + ". **[SWIPE]** " + (txt || "Arrastre") + " `" + (st.value || "") + "` en `" + (st.selector || st.tag) + "`" + sec + zn + " — *[" + st.device_name + "]*";
    }
    if (st.action === "click") {
      var label = txt ? (" (\"" + txt + "\")") : "";
      return num + ". **[CLIC]** en `" + (st.selector || st.tag) + "`" + label + sec + zn + coordStr + " — *[" + st.device_name + "]*";
    }
    if (st.action === "input") {
      return num + ". **[INPUT]** Escribir `" + (st.value || "") + "` en `" + (st.selector || st.tag) + "`" + (txt ? " (" + txt + ")" : "") + sec + zn + coordStr + " — *[" + st.device_name + "]*";
    }
    if (st.action === "submit") {
      return num + ". **[SUBMIT]** Enviar formulario `" + (st.selector || "form") + "`" + (txt ? " (\"" + txt + "\")" : "") + sec + " — *[" + st.device_name + "]*";
    }
    if (st.action === "keypress") {
      return num + ". **[TECLA]** `" + (st.value || txt) + "` sobre `" + (st.selector || st.tag) + "`" + sec + " — *[" + st.device_name + "]*";
    }
    return num + ". **[" + (st.action || "PASO").toUpperCase() + "]** en `" + (st.selector || "") + "`" + sec + zn + " — *[" + st.device_name + "]*";
  }

  function buildFlowMarkdown(steps) {
    if (!steps || !steps.length) return t("flowSelectHint");
    var lines = [
      "## Rastreador de Interacciones del Usuario (" + steps.length + " eventos)",
      "- **URL inicial:** " + (state.url || steps[0].url || "—"),
      ""
    ];
    steps.forEach(function (st, i) {
      lines.push(formatFlowStepLine(st, i + 1));
    });

    // Si hay un paso seleccionado en la tabla, mostrar su ficha técnica detallada abajo
    var selItem = null;
    if (flowState.selectedId) {
      for (var k = 0; k < steps.length; k++) {
        if (steps[k].id === flowState.selectedId) { selItem = steps[k]; break; }
      }
    }
    if (selItem) {
      var sc = selItem.coords || {};
      var sb = selItem.box || {};
      lines.push(
        "",
        "---",
        "### Detalle del Evento Seleccionado (#" + selItem.id + " · " + (selItem.action || "").toUpperCase() + ")",
        "- **Dispositivo:** " + selItem.device_name + " (" + selItem.time + ")",
        "- **Sección de la página:** " + (selItem.section || "—"),
        "- **Zona de la pantalla:** " + (selItem.zone || "—"),
        "- **Coordenadas exactas:** " + (typeof sc.x === "number" ? ("x=" + sc.x + "px, y=" + sc.y + "px (" + (sc.xPct || 0) + "% X, " + (sc.yPct || 0) + "% Y en viewport " + (sc.vw || 0) + "×" + (sc.vh || 0) + ")") : "—"),
        "- **Elemento / Selector:** `" + (selItem.selector || selItem.tag || "—") + "`",
        "- **Dimensiones del elemento:** " + (sb.width ? (sb.width + "×" + sb.height + "px en (" + sb.x + ", " + sb.y + ")") : "—"),
        "- **Etiqueta / Valor:** " + (selItem.label || "—") + (selItem.value ? (" → `" + selItem.value + "`") : "")
      );
    }

    return lines.join("\n");
  }

  function buildFlowPlaywright(steps) {
    if (!steps || !steps.length) return "// Realiza acciones en cualquier pantalla para generar el test de Playwright...";
    var startUrl = state.url || (steps[0] && steps[0].url) || "http://localhost:3000";
    var firstDev = BY_ID[steps[0].device_id] || BY_ID[state.active[0]] || { width: 1280, height: 800 };
    var lines = [
      "import { test, expect } from '@playwright/test';",
      "",
      "test('reproducir flujo de usuario', async ({ page }) => {",
      "  await page.setViewportSize({ width: " + firstDev.width + ", height: " + firstDev.height + " });",
      "  await page.goto(" + JSON.stringify(startUrl) + ");",
      ""
    ];
    steps.forEach(function (st) {
      var sel = st.selector || st.tag || "body";
      var comment = st.section ? (" // Sección: " + st.section + (st.zone ? " [" + st.zone + "]" : "")) : "";
      if (st.action === "navigate" && st.url) {
        lines.push("  await page.goto(" + JSON.stringify(st.url) + ");");
      } else if (st.action === "click") {
        lines.push("  await page.locator(" + JSON.stringify(sel) + ").first().click();" + comment);
      } else if (st.action === "scroll") {
        var sc = st.coords || {};
        if (sel && sel !== "window") {
          lines.push("  await page.locator(" + JSON.stringify(sel) + ").first().evaluate((el) => el.scrollTo(" + (sc.scrollLeft || 0) + ", " + (sc.scrollTop || 0) + "));" + comment);
        } else {
          lines.push("  await page.mouse.wheel(" + (sc.dx || 0) + ", " + (sc.dy || 0) + ");" + comment);
        }
      } else if (st.action === "swipe") {
        var sw = st.coords || {};
        lines.push(
          "  await page.mouse.move(" + (sw.x || 0) + ", " + (sw.y || 0) + ");",
          "  await page.mouse.down();",
          "  await page.mouse.move(" + (sw.endX || 0) + ", " + (sw.endY || 0) + ", { steps: 8 });",
          "  await page.mouse.up();" + comment
        );
      } else if (st.action === "input") {
        if (st.inputType === "checkbox" || st.inputType === "radio") {
          lines.push("  await page.locator(" + JSON.stringify(sel) + ").first().setChecked(" + (st.value === "checked" ? "true" : "false") + ");" + comment);
        } else {
          lines.push("  await page.locator(" + JSON.stringify(sel) + ").first().fill(" + JSON.stringify(st.value || "") + ");" + comment);
        }
      } else if (st.action === "keypress" && st.value) {
        lines.push("  await page.keyboard.press(" + JSON.stringify(st.value) + ");" + comment);
      } else if (st.action === "submit") {
        lines.push("  await page.locator(" + JSON.stringify(sel) + ").first().evaluate((f) => f.requestSubmit ? f.requestSubmit() : f.submit());" + comment);
      }
    });
    lines.push("});");
    return lines.join("\n");
  }

  function renderFlowDetail() {
    if (!flowRawCode) return;
    var filtered = flowState.items.filter(matchesFlowFilter);
    if (!filtered.length) {
      flowRawCode.textContent = t("flowSelectHint");
      return;
    }
    flowRawCode.textContent = flowState.format === "playwright"
      ? buildFlowPlaywright(filtered)
      : buildFlowMarkdown(filtered);
  }

  function flowBadgeClass(action) {
    if (action === "click") return "method-GET";
    if (action === "input" || action === "submit") return "method-POST";
    if (action === "scroll" || action === "swipe") return "method-PUT";
    return "method-PATCH";
  }

  function renderFlowTable(scrollToBottom) {
    if (!flowTbody) return;
    var filtered = flowState.items.filter(matchesFlowFilter);
    flowTbody.innerHTML = "";
    if (flowEmpty) flowEmpty.hidden = filtered.length > 0;

    filtered.forEach(function (item) {
      var tr = document.createElement("tr");
      if (item.id === flowState.selectedId) tr.className = "is-selected";
      tr.style.setProperty("--dev-color", deviceColor(item.device_id));

      var tdId = document.createElement("td");
      tdId.className = "col-id";
      tdId.textContent = "#" + item.id;

      var tdAct = document.createElement("td");
      tdAct.className = "col-method";
      var badge = document.createElement("span");
      badge.className = "method-badge " + flowBadgeClass(item.action);
      badge.textContent = (item.action || "step").toUpperCase();
      tdAct.appendChild(badge);

      var tdDev = document.createElement("td");
      tdDev.className = "col-device";
      tdDev.appendChild(buildDeviceChip(item.device_id, item.device_name));

      var tdSec = document.createElement("td");
      tdSec.className = "col-csource";
      var secText = (item.section || "—") + (item.zone ? (" · " + item.zone) : "");
      tdSec.textContent = secText;
      tdSec.title = secText;

      var tdSel = document.createElement("td");
      tdSel.className = "col-host";
      tdSel.textContent = item.selector || item.tag || "—";
      tdSel.title = item.selector || "";

      var tdVal = document.createElement("td");
      tdVal.className = "col-cmsg";
      var valText = item.action === "input"
        ? ("Valor: \"" + (item.value || "") + "\"")
        : (item.action === "scroll"
          ? (item.label || item.value || "Scroll")
          : (item.label || item.text || item.value || item.url || "—"));
      tdVal.textContent = valText;
      tdVal.title = valText;

      var tdTime = document.createElement("td");
      tdTime.className = "col-ctime";
      tdTime.textContent = item.time || "";

      tr.appendChild(tdId);
      tr.appendChild(tdAct);
      tr.appendChild(tdDev);
      tr.appendChild(tdSec);
      tr.appendChild(tdSel);
      tr.appendChild(tdVal);
      tr.appendChild(tdTime);

      tr.addEventListener("click", function () {
        flowState.selectedId = item.id;
        renderFlowTable(false);
        renderFlowDetail();
      });

      flowTbody.appendChild(tr);
    });

    if (scrollToBottom) {
      var wrap = flowTbody.closest(".traffic-table-wrap");
      if (wrap) wrap.scrollTop = wrap.scrollHeight;
    }
  }

  var isFetchingFlow = false;
  function fetchFlow() {
    if (isFetchingFlow) return;
    isFetchingFlow = true;
    fetch("/api/flow?since=" + flowState.lastSeq, { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !Array.isArray(data.items) || !data.items.length) return;
        data.items.forEach(function (item) {
          flowState.items.push(item);
          if (item.id > flowState.lastSeq) flowState.lastSeq = item.id;
        });
        if (flowState.items.length > 300) {
          flowState.items = flowState.items.slice(flowState.items.length - 300);
        }
        if (flowCountEl) {
          flowCountEl.textContent = String(flowState.items.length);
        }
        if (trafficState.open && trafficState.panelMode === "flow") {
          renderFlowTable(true);
          renderFlowDetail();
        }
      })
      .catch(function () {})
      .then(function () {
        isFetchingFlow = false;
      });
  }

  // ---------- Inspector de Storage, Cookies y Decodificador JWT ----------
  function decodeJwt(rawVal) {
    if (!rawVal || typeof rawVal !== "string") return null;
    var trimmed = rawVal.trim().replace(/^Bearer\s+/i, "").replace(/^"|"$/g, "");
    var parts = trimmed.split(".");
    if (parts.length !== 3 || trimmed.indexOf("eyJ") !== 0) return null;
    function b64Decode(str) {
      var b64 = str.replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      try {
        return JSON.parse(decodeURIComponent(escape(window.atob(b64))));
      } catch (_e) {
        try { return JSON.parse(window.atob(b64)); } catch (_e2) { return null; }
      }
    }
    var header = b64Decode(parts[0]);
    var payload = b64Decode(parts[1]);
    if (!header || !payload) return null;
    var expStatus = null;
    if (typeof payload.exp === "number") {
      var expMs = payload.exp * 1000;
      var diffMin = Math.round((expMs - Date.now()) / 60000);
      expStatus = {
        date: new Date(expMs).toISOString(),
        expired: expMs < Date.now(),
        summary: expMs < Date.now()
          ? ("EXPIRADO hace " + Math.abs(diffMin) + " min")
          : ("VÁLIDO (expira en " + diffMin + " min)")
      };
    }
    return { header: header, payload: payload, expStatus: expStatus };
  }

  function buildStorageRowsFromItems(rawItems) {
    var rows = [];
    (rawItems || []).forEach(function (it) {
      var jwt = decodeJwt(it.value);
      var metaParts = [];
      if (it.domain) metaParts.push(it.domain);
      if (it.path) metaParts.push("Path=" + it.path);
      if (it.http_only) metaParts.push("HttpOnly");
      if (it.secure) metaParts.push("Secure");
      rows.push({
        scope: it.store || "Storage",
        device_id: it.device_id || "all",
        device_name: it.device_name || it.device_id || "Servidor",
        key: it.key || "",
        value: it.value || "",
        meta: metaParts.join(" · "),
        jwt: jwt
      });
    });
    storageState.rows = rows;
  }

  function matchesStorageFilter(row) {
    if (trafficState.deviceFilter !== "all" && row.device_id !== "all" && row.device_id !== trafficState.deviceFilter) {
      return false;
    }
    if (trafficState.searchQuery) {
      var q = trafficState.searchQuery.toLowerCase();
      var hay = ((row.scope || "") + " " + (row.key || "") + " " + (row.value || "") + " " + (row.device_name || "")).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  }

  function formatStorageRowForAi(row) {
    if (!row) return "";
    var lines = [
      "### [" + row.scope + "] `" + row.key + "` (" + row.device_name + ")",
      "- **Valor bruto:** `" + row.value + "`"
    ];
    if (row.meta) lines.push("- **Contexto:** `" + row.meta + "`");
    if (row.jwt) {
      lines.push(
        "- **JWT Detectado:** " + (row.jwt.expStatus ? row.jwt.expStatus.summary : "Sí"),
        "- **JWT Header:**",
        "```json",
        JSON.stringify(row.jwt.header, null, 2),
        "```",
        "- **JWT Payload:**",
        "```json",
        JSON.stringify(row.jwt.payload, null, 2),
        "```"
      );
    }
    return lines.join("\n");
  }

  function formatAllStorageForAi() {
    var filtered = storageState.rows.filter(matchesStorageFilter);
    if (!filtered.length) return "Sin cookies ni claves en localStorage/sessionStorage.";
    return "## Estado de Storage, Cookies y JWT (" + filtered.length + " entradas)\n\n" +
      filtered.map(formatStorageRowForAi).join("\n\n");
  }

  function renderStorageDetail() {
    if (!storageRawCode) return;
    var filtered = storageState.rows.filter(matchesStorageFilter);
    var selected = (storageState.selectedIdx >= 0 && storageState.selectedIdx < filtered.length)
      ? filtered[storageState.selectedIdx]
      : (filtered.length ? filtered[0] : null);
    if (!selected) {
      storageRawCode.textContent = t("storageSelectHint");
      return;
    }
    storageRawCode.textContent = formatStorageRowForAi(selected);
  }

  function renderStorageTable() {
    if (!storageTbody) return;
    var filtered = storageState.rows.filter(matchesStorageFilter);
    storageTbody.innerHTML = "";
    if (storageEmpty) storageEmpty.hidden = filtered.length > 0;

    if (storageState.selectedIdx >= filtered.length) {
      storageState.selectedIdx = filtered.length ? 0 : -1;
    }

    filtered.forEach(function (row, idx) {
      var tr = document.createElement("tr");
      if (idx === storageState.selectedIdx) tr.className = "is-selected";
      tr.style.setProperty("--dev-color", row.device_id === "all" ? "#f59e0b" : deviceColor(row.device_id));

      var tdScope = document.createElement("td");
      tdScope.className = "col-method";
      var sBadge = document.createElement("span");
      sBadge.className = "method-badge " + (row.scope.indexOf("Cookie") === 0 ? "method-PUT" : (row.scope === "localStorage" ? "method-GET" : "method-POST"));
      sBadge.textContent = row.jwt ? (row.scope + " · JWT") : row.scope;
      tdScope.appendChild(sBadge);

      var tdDev = document.createElement("td");
      tdDev.className = "col-device";
      if (row.device_id === "all") {
        tdDev.textContent = row.device_name;
      } else {
        tdDev.appendChild(buildDeviceChip(row.device_id, row.device_name));
      }

      var tdKey = document.createElement("td");
      tdKey.className = "col-host";
      tdKey.textContent = row.key;
      tdKey.title = row.key;

      var tdVal = document.createElement("td");
      tdVal.className = "col-cmsg";
      tdVal.textContent = row.jwt && row.jwt.expStatus
        ? ("[" + row.jwt.expStatus.summary + "] " + row.value)
        : row.value;
      tdVal.title = row.value;

      tr.appendChild(tdScope);
      tr.appendChild(tdDev);
      tr.appendChild(tdKey);
      tr.appendChild(tdVal);

      tr.addEventListener("click", function () {
        storageState.selectedIdx = idx;
        renderStorageTable();
        renderStorageDetail();
      });

      storageTbody.appendChild(tr);
    });
  }

  var isFetchingStorage = false;
  function fetchStorage() {
    if (isFetchingStorage) return;
    isFetchingStorage = true;
    fetch("/api/storage", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !Array.isArray(data.items)) return;
        buildStorageRowsFromItems(data.items);
        if (storageState.selectedIdx === -1 && storageState.rows.length) {
          storageState.selectedIdx = 0;
        }
        if (trafficState.open && trafficState.panelMode === "storage") {
          renderStorageTable();
          renderStorageDetail();
        }
      })
      .catch(function () {})
      .then(function () {
        isFetchingStorage = false;
      });
  }

  function requestFramesStorage() {
    state.active.forEach(function (id) {
      var item = els[id];
      if (item && item.iframe && !item.iframe.hidden && item.iframe.contentWindow) {
        try {
          item.iframe.contentWindow.postMessage({ type: "rv:request_storage" }, location.origin);
        } catch (_e) {}
      }
    });
    fetchStorage();
  }

  // ---------- Cambio de Pestañas del Panel DevTools (HTTP / Consola / Auditoría / Flujo / Storage) ----------
  function setPanelMode(mode) {
    var validModes = ["traffic", "console", "audit", "flow", "storage"];
    trafficState.panelMode = validModes.indexOf(mode) > -1 ? mode : "traffic";
    var m = trafficState.panelMode;

    if (panelModeTraffic) panelModeTraffic.classList.toggle("is-active", m === "traffic");
    if (panelModeConsole) panelModeConsole.classList.toggle("is-active", m === "console");
    if (panelModeAudit) panelModeAudit.classList.toggle("is-active", m === "audit");
    if (panelModeFlow) panelModeFlow.classList.toggle("is-active", m === "flow");
    if (panelModeStorage) panelModeStorage.classList.toggle("is-active", m === "storage");

    if (trafficMethodPills) trafficMethodPills.hidden = m !== "traffic";
    if (consoleLevelPills) consoleLevelPills.hidden = m !== "console";

    if (trafficSplitView) trafficSplitView.hidden = m !== "traffic";
    if (consoleSplitView) consoleSplitView.hidden = m !== "console";
    if (auditSplitView) auditSplitView.hidden = m !== "audit";
    if (flowSplitView) flowSplitView.hidden = m !== "flow";
    if (storageSplitView) storageSplitView.hidden = m !== "storage";

    if (trafficBtn) {
      var tActive = trafficState.open && m === "traffic";
      trafficBtn.setAttribute("aria-pressed", tActive ? "true" : "false");
      trafficBtn.classList.toggle("is-active", tActive);
    }
    if (consoleBtn) {
      var cActive = trafficState.open && m === "console";
      consoleBtn.setAttribute("aria-pressed", cActive ? "true" : "false");
      consoleBtn.classList.toggle("is-active", cActive);
    }
    if (auditBtn) {
      var aActive = trafficState.open && m === "audit";
      auditBtn.setAttribute("aria-pressed", aActive ? "true" : "false");
      auditBtn.classList.toggle("is-active", aActive);
    }
    if (flowBtn) {
      var fActive = trafficState.open && m === "flow";
      flowBtn.setAttribute("aria-pressed", fActive ? "true" : "false");
      flowBtn.classList.toggle("is-active", fActive);
    }

    if (trafficState.open) {
      if (m === "console") {
        fetchConsole();
        renderConsoleTable(true);
        renderConsoleDetail();
      } else if (m === "audit") {
        triggerAuditScan();
        fetchAudit();
        renderAuditTable();
        renderAuditDetail();
      } else if (m === "flow") {
        fetchFlow();
        renderFlowTable(true);
        renderFlowDetail();
      } else if (m === "storage") {
        requestFramesStorage();
        renderStorageTable();
        renderStorageDetail();
      } else {
        fetchTraffic();
        renderTrafficTable(true);
        renderTrafficDetail();
      }
    }
  }

  function toggleTrafficPanel(on, mode) {
    if (mode && trafficState.open && trafficState.panelMode !== mode && on === undefined) {
      setPanelMode(mode);
      return;
    }
    if (on === undefined) on = !trafficState.open;
    trafficState.open = !!on;
    if (mode) trafficState.panelMode = mode;
    if (trafficPanel) trafficPanel.hidden = !trafficState.open;
    setPanelMode(trafficState.panelMode);
    setTimeout(layout, 50);
  }

  // ---------- Generador de Reporte IA de 1 Clic (Markdown Estructurado) ----------
  function getAiModalToggleMap() {
    var map = { element: true, console: true, http: true, audit: true, flow: true, storage: true };
    if (!aiModalToggles) return map;
    Array.prototype.slice.call(aiModalToggles.querySelectorAll("input[data-sec]")).forEach(function (chk) {
      map[chk.dataset.sec] = !!chk.checked;
    });
    return map;
  }

  function buildAiMarkdownReport() {
    var inc = getAiModalToggleMap();
    var nowStr = new Date().toLocaleTimeString();
    var activeDevs = state.active.map(function (id) {
      var d = BY_ID[id];
      return d ? (d.name + " (" + d.width + "×" + d.height + " @" + d.dpr + "x)") : id;
    });

    var md = [
      "# Reporte de Diagnóstico Web",
      "- **URL activa:** " + (state.url || "—"),
      "- **Pantallas activas (" + activeDevs.length + "):** " + (activeDevs.join(", ") || "Ninguna"),
      "- **Hora de captura:** " + nowStr,
      ""
    ];

    if (inc.element) {
      md.push("## 1. Último Elemento Inspeccionado y Estilos Computados");
      if (lastInspectedElement) {
        md.push(
          "- **Dispositivo:** " + (lastInspectedElement.device_name || lastInspectedElement.frame),
          "- **URL del frame:** " + (lastInspectedElement.url || state.url || "—"),
          "- **Selector CSS:** `" + (lastInspectedElement.selector || "—") + "`",
          "- **Layout Box:** `" + (formatBoxString(lastInspectedElement.box) || "—") + "`",
          "- **Computed Styles:** `" + (lastInspectedElement.stylesSummary || "—") + "`",
          "```html",
          lastInspectedElement.html || "",
          "```",
          ""
        );
      } else {
        md.push("_Ningún elemento seleccionado recientemente (usa el botón Inspeccionar y haz clic sobre un elemento)._", "");
      }
    }

    if (inc.console) {
      var errWarns = consoleState.items.filter(function (c) {
        return c.level === "error" || c.level === "warn";
      }).slice(-15);
      var recentLogs = errWarns.length ? errWarns : consoleState.items.slice(-10);
      md.push("## 2. Consola del Navegador (" + errWarns.length + " errores/warnings)");
      if (recentLogs.length) {
        recentLogs.forEach(function (c) {
          md.push("- **[" + c.level.toUpperCase() + "]** (" + c.device_name + " · " + c.time + "): `" + (c.message || "").replace(/\n/g, " ") + "`" + (c.source ? " _[" + c.source + "]_" : ""));
          if (c.stack && c.level === "error") {
            md.push("  ```", "  " + c.stack.split("\n").slice(0, 5).join("\n  "), "  ```");
          }
        });
        md.push("");
      } else {
        md.push("_Sin errores ni eventos en la consola._", "");
      }
    }

    if (inc.http) {
      var failedHttp = trafficState.items.filter(function (r) { return r.status >= 400 || r.status === 0; }).slice(-10);
      var recentHttp = trafficState.items.slice(-8);
      md.push("## 3. Tráfico HTTP / API (" + failedHttp.length + " peticiones fallidas 4xx/5xx)");
      if (failedHttp.length) {
        md.push("### Peticiones con error (4xx / 5xx):");
        failedHttp.forEach(function (r) {
          md.push(
            "- **" + r.method + " " + r.url + "** → **HTTP " + r.status + "** (" + r.device_name + ", " + r.duration_ms + " ms)",
            "  - Response Body: `" + ((r.res_body || "").slice(0, 260).replace(/\s+/g, " ") || "vacío") + "`"
          );
        });
      }
      if (recentHttp.length) {
        md.push("### Últimas peticiones HTTP:");
        recentHttp.forEach(function (r) {
          md.push("- `" + r.method + "` `" + r.path + "` → **" + r.status + "** (" + r.device_name + ", " + r.mime + ", " + r.duration_ms + " ms)");
        });
      } else {
        md.push("_Sin tráfico HTTP registrado._");
      }
      md.push("");
    }

    if (inc.audit) {
      md.push("## 4. Auditoría Visual y Responsiva (" + auditState.items.length + " hallazgos)");
      if (auditState.items.length) {
        auditState.items.slice(0, 15).forEach(function (a) {
          md.push("- **[" + a.kind + "]** en **" + a.device_name + "** (`" + a.selector + "`): " + a.summary + " — _" + a.detail + "_");
        });
      } else {
        md.push("_Sin desbordamientos horizontales ni imágenes rotas detectadas._");
      }
      md.push("");
    }

    if (inc.flow) {
      var recentSteps = flowState.items.slice(-20);
      md.push("## 5. Rastreador de Interacciones del Usuario (Clics, Scroll, Zona y Sección)");
      if (recentSteps.length) {
        recentSteps.forEach(function (st, idx) {
          md.push(formatFlowStepLine(st, idx + 1));
        });
      } else {
        md.push("_Sin interacciones registradas aún._");
      }
      md.push("");
    }

    if (inc.storage) {
      md.push("## 6. Estado de Sesión (Cookies, Storage y JWT)");
      if (storageState.rows.length) {
        storageState.rows.slice(0, 15).forEach(function (row) {
          var jwtInfo = row.jwt && row.jwt.expStatus ? (" — **JWT: " + row.jwt.expStatus.summary + "**") : "";
          md.push("- **[" + row.scope + "]** `" + row.key + "` = `" + String(row.value).slice(0, 90) + "` (" + row.device_name + ")" + jwtInfo);
        });
      } else {
        md.push("_Sin cookies ni datos en localStorage/sessionStorage._");
      }
      md.push("");
    }

    return md.join("\n");
  }

  function openAiReportModal() {
    triggerAuditScan();
    requestFramesStorage();
    Promise.all([
      fetch("/api/inspected", { credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch("/api/audit", { credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch("/api/flow?since=0", { credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch("/api/storage", { credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (results) {
      if (results[0] && results[0].item) lastInspectedElement = results[0].item;
      if (results[1] && Array.isArray(results[1].items)) {
        auditState.items = results[1].items;
        updateAuditBadge();
      }
      if (results[2] && Array.isArray(results[2].items)) {
        flowState.items = results[2].items;
        if (flowCountEl) flowCountEl.textContent = String(flowState.items.length);
      }
      if (results[3] && Array.isArray(results[3].items)) {
        buildStorageRowsFromItems(results[3].items);
      }

      var reportMd = buildAiMarkdownReport();
      if (aiReportTextarea) aiReportTextarea.value = reportMd;
      if (aiReportModal) aiReportModal.hidden = false;
      // Copiado inmediato de 1 clic al portapapeles para pegar directo en el chat de IA
      copyText(reportMd, t("aiReportCopied"));
    });
  }

  // ---------- Captura Visual Anotada (PNG 2x al Portapapeles) ----------
  function requestDomSnapshotFromFrame(id) {
    return new Promise(function (resolve) {
      var item = els[id];
      if (!item || !item.iframe || item.iframe.hidden || !item.iframe.contentWindow) {
        resolve(null);
        return;
      }
      var timer = setTimeout(function () {
        delete pendingDomSnapshots[id];
        resolve(null);
      }, 360);
      pendingDomSnapshots[id] = function (snap) {
        clearTimeout(timer);
        resolve(snap);
      };
      try {
        item.iframe.contentWindow.postMessage({ type: "rv:request_dom_layout" }, location.origin);
      } catch (_e) {
        clearTimeout(timer);
        delete pendingDomSnapshots[id];
        resolve(null);
      }
    });
  }

  var MODAL_HINT_RE = /\b(modal|dialog|overlay|backdrop|drawer|popup|popover|lightbox|sheet|swal|toast)\b/i;

  function isTransparentColor(c) {
    return !c || c === "transparent" || c === "rgba(0, 0, 0, 0)";
  }

  function parseCssRadius(val, w, h) {
    if (!val) return 0;
    var first = String(val).trim().split(/\s+/)[0];
    if (!first) return 0;
    var num = parseFloat(first);
    if (isNaN(num) || num <= 0) return 0;
    if (first.indexOf("%") > -1) {
      return Math.min(w, h) * (num / 100);
    }
    return Math.min(num, Math.min(w, h) / 2);
  }

  function traceRoundRect(ctx, x, y, w, h, r) {
    var rad = Math.max(0, Math.min(r || 0, Math.min(w, h) / 2));
    ctx.beginPath();
    if (rad <= 0.5) {
      ctx.rect(x, y, w, h);
      return;
    }
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
    ctx.closePath();
  }

  function extractGradientColors(bgImage) {
    if (!bgImage || bgImage === "none" || bgImage.indexOf("gradient") === -1) return null;
    var matches = bgImage.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8})/g);
    if (!matches || matches.length < 2) return null;
    return [matches[0], matches[matches.length - 1]];
  }

  var taintTestCanvas = null;
  var taintTestCtx = null;
  function canDrawImageSafely(imgEl) {
    try {
      if (!taintTestCanvas) {
        taintTestCanvas = document.createElement("canvas");
        taintTestCanvas.width = 2;
        taintTestCanvas.height = 2;
        taintTestCtx = taintTestCanvas.getContext("2d");
      }
      taintTestCtx.clearRect(0, 0, 2, 2);
      taintTestCtx.drawImage(imgEl, 0, 0, 1, 1);
      taintTestCtx.getImageData(0, 0, 1, 1);
      return true;
    } catch (_e) {
      return false;
    }
  }

  function paintLiveIframeDom(ctx, iframe, dx, dy, dw, dh, dWidth, dHeight, fallbackSnap) {
    var scale = dw / Math.max(1, dWidth);
    var doc = null;
    var win = null;
    try {
      doc = iframe && iframe.contentDocument;
      win = iframe && iframe.contentWindow;
    } catch (_e) {
      doc = null;
      win = null;
    }

    if (!doc || !win || !doc.body) {
      // Fallback si el documento no es accesible directamente
      var bgCol = (fallbackSnap && (fallbackSnap.bgPage || fallbackSnap.bg) && !isTransparentColor(fallbackSnap.bgPage || fallbackSnap.bg))
        ? (fallbackSnap.bgPage || fallbackSnap.bg)
        : "#FFFFFF";
      ctx.fillStyle = bgCol;
      ctx.fillRect(dx, dy, dw, dh);
      if (fallbackSnap && Array.isArray(fallbackSnap.nodes)) {
        fallbackSnap.nodes.forEach(function (n) {
          var nx = dx + n.x * scale;
          var ny = dy + n.y * scale;
          var nw = n.w * scale;
          var nh = n.h * scale;
          if (n.bg) { ctx.fillStyle = n.bg; ctx.fillRect(nx, ny, nw, nh); }
          var borderCol = n.border || n.bCol;
          if (borderCol) { ctx.strokeStyle = borderCol; ctx.lineWidth = 1; ctx.strokeRect(nx, ny, nw, nh); }
          if (n.text) {
            ctx.fillStyle = n.color || "#1B1F1D";
            var fSize = Math.max(7, Math.min(22, Math.round(((n.fontSize || n.fSize || 13)) * scale)));
            ctx.font = fSize + "px -apple-system, sans-serif";
            ctx.fillText(n.text.slice(0, 50), nx + 3, ny + Math.min(nh - 2, fSize + 3));
          }
        });
      }
      return;
    }

    // 1. Fondo base del documento (html / body)
    var htmlCs = win.getComputedStyle(doc.documentElement);
    var bodyCs = win.getComputedStyle(doc.body);
    var pageBg = "#FFFFFF";
    if (bodyCs && !isTransparentColor(bodyCs.backgroundColor)) {
      pageBg = bodyCs.backgroundColor;
    } else if (htmlCs && !isTransparentColor(htmlCs.backgroundColor)) {
      pageBg = htmlCs.backgroundColor;
    }
    ctx.fillStyle = pageBg;
    ctx.fillRect(dx, dy, dw, dh);

    var vw = win.innerWidth || dWidth;
    var vh = win.innerHeight || dHeight;

    // 2. Recorrer todos los elementos del DOM (sin límite de 320 nodos para incluir portales y modales al final del body)
    var allNodes = doc.body.querySelectorAll("*");
    var maxNodes = Math.min(allNodes.length, 4500);
    var items = [];

    for (var i = 0; i < maxNodes; i++) {
      var el = allNodes[i];
      var tag = (el.tagName || "").toLowerCase();
      if (tag === "script" || tag === "style" || tag === "link" || tag === "meta" || tag === "noscript" || tag === "template") continue;
      if (el.id && el.id.indexOf("__rv_") === 0) continue;
      if (el.namespaceURI === "http://www.w3.org/2000/svg" && tag !== "svg") continue;

      var cs = win.getComputedStyle(el);
      if (!cs || cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse") continue;

      var rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      if (rect.bottom < 0 || rect.right < 0 || rect.top > vh || rect.left > vw) continue;

      // Calcular opacidad efectiva, contexto de apilamiento (modales/overlays/fixed) y recorte (overflow)
      var effOpacity = 1;
      var tier = 0;
      var effZ = 0;
      var isModalTree = false;
      var isFixedTree = false;
      var clipBox = { left: 0, top: 0, right: vw, bottom: vh };
      var stoppedClipForFixed = false;

      var cur = el;
      while (cur && cur !== doc.documentElement) {
        var curCs = (cur === el) ? cs : win.getComputedStyle(cur);
        if (!curCs) break;
        if (curCs.display === "none" || curCs.visibility === "hidden") {
          effOpacity = 0;
          break;
        }
        var op = parseFloat(curCs.opacity);
        if (!isNaN(op)) effOpacity *= op;
        if (effOpacity <= 0.01) break;

        var pos = curCs.position;
        var zVal = parseInt(curCs.zIndex, 10);
        var hasZ = !isNaN(zVal);
        var curTag = (cur.tagName || "").toLowerCase();
        var role = cur.getAttribute ? (cur.getAttribute("role") || "") : "";
        var ariaModal = cur.getAttribute ? (cur.getAttribute("aria-modal") || "") : "";
        var clsAndId = ((typeof cur.className === "string" ? cur.className : "") + " " + (cur.id || ""));

        if (curTag === "dialog") {
          if (!cur.hasAttribute("open") && curCs.display === "none") {
            effOpacity = 0;
            break;
          }
          isModalTree = true;
        }
        if (ariaModal === "true" || role === "dialog" || role === "alertdialog") {
          isModalTree = true;
        }
        if ((pos === "fixed" || pos === "absolute") && MODAL_HINT_RE.test(clsAndId)) {
          isModalTree = true;
        }
        if (pos === "fixed") {
          isFixedTree = true;
          var curRect = (cur === el) ? rect : cur.getBoundingClientRect();
          if (curRect.width >= vw * 0.75 && curRect.height >= vh * 0.75) {
            isModalTree = true;
          }
          stoppedClipForFixed = true;
        }
        if (hasZ && zVal >= 40 && (pos === "fixed" || pos === "absolute")) {
          if ( zVal >= 100 || MODAL_HINT_RE.test(clsAndId)) {
            isModalTree = true;
          }
        }
        if (hasZ && zVal > effZ) {
          effZ = zVal;
        }

        // Recorte por contenedores con overflow hidden/auto/scroll
        if (!stoppedClipForFixed && cur !== el && cur !== doc.body) {
          var ovX = curCs.overflowX;
          var ovY = curCs.overflowY;
          if (ovX === "hidden" || ovX === "scroll" || ovX === "auto" || ovX === "clip" ||
              ovY === "hidden" || ovY === "scroll" || ovY === "auto" || ovY === "clip") {
            var cRect = cur.getBoundingClientRect();
            clipBox.left = Math.max(clipBox.left, cRect.left);
            clipBox.top = Math.max(clipBox.top, cRect.top);
            clipBox.right = Math.min(clipBox.right, cRect.right);
            clipBox.bottom = Math.min(clipBox.bottom, cRect.bottom);
          }
        }
        cur = cur.parentElement;
      }

      if (effOpacity <= 0.01) continue;
      if (clipBox.right <= clipBox.left || clipBox.bottom <= clipBox.top) continue;
      if (rect.right <= clipBox.left || rect.left >= clipBox.right || rect.bottom <= clipBox.top || rect.top >= clipBox.bottom) continue;

      if (isModalTree) {
        tier = 3;
      } else if (isFixedTree) {
        tier = 2;
      } else if (cs.position !== "static" || effZ !== 0) {
        tier = 1;
      } else {
        tier = 0;
      }

      items.push({
        el: el,
        tag: tag,
        cs: cs,
        rect: rect,
        clipBox: clipBox,
        effOpacity: effOpacity,
        tier: tier,
        effZ: effZ,
        domOrder: i
      });
    }

    // 3. Ordenar por capa real de apilamiento (flujo normal -> posicionados -> fixed -> modales/overlays)
    items.sort(function (a, b) {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.effZ !== b.effZ) return a.effZ - b.effZ;
      return a.domOrder - b.domOrder;
    });

    var textRange = doc.createRange();

    // 4. Pintar cada elemento en orden de apilamiento
    for (var idx = 0; idx < items.length; idx++) {
      var it = items[idx];
      var el = it.el;
      var tag = it.tag;
      var cs = it.cs;
      var rect = it.rect;

      var nx = dx + rect.left * scale;
      var ny = dy + rect.top * scale;
      var nw = rect.width * scale;
      var nh = rect.height * scale;

      ctx.save();

      // Recorte del contenedor padre si aplica
      var cx = dx + Math.max(0, it.clipBox.left) * scale;
      var cy = dy + Math.max(0, it.clipBox.top) * scale;
      var cw = Math.min(vw, it.clipBox.right) * scale - Math.max(0, it.clipBox.left) * scale;
      var ch = Math.min(vh, it.clipBox.bottom) * scale - Math.max(0, it.clipBox.top) * scale;
      ctx.beginPath();
      ctx.rect(cx, cy, Math.max(1, cw), Math.max(1, ch));
      ctx.clip();

      ctx.globalAlpha = Math.max(0, Math.min(1, it.effOpacity));

      // Si es un <dialog open>, pintar su ::backdrop si existe
      if (tag === "dialog") {
        var bdCs = win.getComputedStyle(el, "::backdrop");
        var bdCol = (bdCs && !isTransparentColor(bdCs.backgroundColor)) ? bdCs.backgroundColor : "rgba(15, 23, 42, 0.45)";
        ctx.fillStyle = bdCol;
        ctx.fillRect(dx, dy, dw, dh);
      }

      var radius = parseCssRadius(cs.borderTopLeftRadius || cs.borderRadius, nw, nh);

      // Sombra (box-shadow) para tarjetas y modales
      var bShadow = cs.boxShadow;
      if (bShadow && bShadow !== "none" && bShadow.indexOf("inset") === -1) {
        var shColMatch = bShadow.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8})/);
        if (shColMatch) {
          ctx.save();
          ctx.shadowColor = shColMatch[0];
          ctx.shadowBlur = Math.min(24, (it.tier >= 3 ? 18 : 8) * scale);
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = (it.tier >= 3 ? 6 : 2) * scale;
          traceRoundRect(ctx, nx, ny, nw, nh, radius);
          ctx.fillStyle = !isTransparentColor(cs.backgroundColor) ? cs.backgroundColor : "rgba(255,255,255,0.01)";
          ctx.fill();
          ctx.restore();
        }
      }

      // Fondo (color sólido o gradiente lineal)
      var bgCol = cs.backgroundColor;
      var gradCols = extractGradientColors(cs.backgroundImage);
      if (gradCols) {
        var grad = ctx.createLinearGradient(nx, ny, nx + nw, ny + nh);
        grad.addColorStop(0, gradCols[0]);
        grad.addColorStop(1, gradCols[1]);
        traceRoundRect(ctx, nx, ny, nw, nh, radius);
        ctx.fillStyle = grad;
        ctx.fill();
      } else if (!isTransparentColor(bgCol)) {
        traceRoundRect(ctx, nx, ny, nw, nh, radius);
        ctx.fillStyle = bgCol;
        ctx.fill();
      } else if (it.tier >= 3 && (cs.backdropFilter && cs.backdropFilter !== "none" || cs.webkitBackdropFilter && cs.webkitBackdropFilter !== "none")) {
        traceRoundRect(ctx, nx, ny, nw, nh, radius);
        ctx.fillStyle = "rgba(15, 23, 42, 0.28)";
        ctx.fill();
      }

      // Imágenes reales (<img> y <canvas>)
      if (tag === "img") {
        var drawnImg = false;
        if (el.complete && el.naturalWidth > 0 && canDrawImageSafely(el)) {
          try {
            ctx.save();
            traceRoundRect(ctx, nx, ny, nw, nh, radius);
            ctx.clip();
            ctx.drawImage(el, nx, ny, nw, nh);
            ctx.restore();
            drawnImg = true;
          } catch (_e) {
            drawnImg = false;
          }
        }
        if (!drawnImg) {
          traceRoundRect(ctx, nx, ny, nw, nh, radius);
          ctx.fillStyle = "rgba(148, 163, 184, 0.18)";
          ctx.fill();
        }
      } else if (tag === "canvas") {
        if (canDrawImageSafely(el)) {
          try {
            ctx.drawImage(el, nx, ny, nw, nh);
          } catch (_e) {}
        }
      } else if (tag === "svg" && typeof Path2D !== "undefined") {
        // Renderizado vectorial de iconos SVG
        try {
          var vb = el.viewBox && el.viewBox.baseVal;
          var vbW = (vb && vb.width) ? vb.width : (parseFloat(el.getAttribute("width")) || 24);
          var vbH = (vb && vb.height) ? vb.height : (parseFloat(el.getAttribute("height")) || 24);
          var vbX = (vb && vb.x) ? vb.x : 0;
          var vbY = (vb && vb.y) ? vb.y : 0;
          if (vbW > 0 && vbH > 0) {
            ctx.save();
            ctx.translate(nx, ny);
            ctx.scale(nw / vbW, nh / vbH);
            ctx.translate(-vbX, -vbY);
            var svgPaths = el.querySelectorAll("path");
            var svgColor = cs.color || "#1B1F1D";
            for (var sp = 0; sp < svgPaths.length; sp++) {
              var pEl = svgPaths[sp];
              var dAttr = pEl.getAttribute("d");
              if (!dAttr) continue;
              var pCs = win.getComputedStyle(pEl);
              var p2d = new Path2D(dAttr);
              var fillAttr = pEl.getAttribute("fill") || (pCs && pCs.fill) || "";
              var strokeAttr = pEl.getAttribute("stroke") || (pCs && pCs.stroke) || "";
              if (fillAttr && fillAttr !== "none" && !isTransparentColor(fillAttr)) {
                ctx.fillStyle = (fillAttr === "currentColor") ? svgColor : fillAttr;
                ctx.fill(p2d);
              }
              if (strokeAttr && strokeAttr !== "none" && !isTransparentColor(strokeAttr)) {
                ctx.strokeStyle = (strokeAttr === "currentColor") ? svgColor : strokeAttr;
                ctx.lineWidth = parseFloat(pEl.getAttribute("stroke-width") || (pCs && pCs.strokeWidth) || "1.8") || 1.8;
                ctx.stroke(p2d);
              } else if (!fillAttr || fillAttr === "currentColor") {
                ctx.fillStyle = svgColor;
                ctx.fill(p2d);
              }
            }
            ctx.restore();
          }
        } catch (_e) {}
      }

      // Bordes (uniformes o por lado)
      var btW = parseFloat(cs.borderTopWidth) || 0;
      var brW = parseFloat(cs.borderRightWidth) || 0;
      var bbW = parseFloat(cs.borderBottomWidth) || 0;
      var blW = parseFloat(cs.borderLeftWidth) || 0;
      if (btW > 0 || brW > 0 || bbW > 0 || blW > 0) {
        if (btW > 0 && Math.abs(btW - brW) < 0.5 && Math.abs(btW - bbW) < 0.5 && Math.abs(btW - blW) < 0.5 && !isTransparentColor(cs.borderTopColor)) {
          traceRoundRect(ctx, nx, ny, nw, nh, radius);
          ctx.strokeStyle = cs.borderTopColor;
          ctx.lineWidth = Math.max(0.75, btW * scale);
          ctx.stroke();
        } else {
          if (btW > 0 && !isTransparentColor(cs.borderTopColor)) {
            ctx.strokeStyle = cs.borderTopColor;
            ctx.lineWidth = Math.max(0.75, btW * scale);
            ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(nx + nw, ny); ctx.stroke();
          }
          if (bbW > 0 && !isTransparentColor(cs.borderBottomColor)) {
            ctx.strokeStyle = cs.borderBottomColor;
            ctx.lineWidth = Math.max(0.75, bbW * scale);
            ctx.beginPath(); ctx.moveTo(nx, ny + nh); ctx.lineTo(nx + nw, ny + nh); ctx.stroke();
          }
          if (blW > 0 && !isTransparentColor(cs.borderLeftColor)) {
            ctx.strokeStyle = cs.borderLeftColor;
            ctx.lineWidth = Math.max(0.75, blW * scale);
            ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(nx, ny + nh); ctx.stroke();
          }
          if (brW > 0 && !isTransparentColor(cs.borderRightColor)) {
            ctx.strokeStyle = cs.borderRightColor;
            ctx.lineWidth = Math.max(0.75, brW * scale);
            ctx.beginPath(); ctx.moveTo(nx + nw, ny); ctx.lineTo(nx + nw, ny + nh); ctx.stroke();
          }
        }
      }

      // Controles de formulario (<input>, <textarea>, <select>)
      if (tag === "input" || tag === "textarea" || tag === "select") {
        var inType = (el.getAttribute("type") || "text").toLowerCase();
        if (inType === "checkbox" || inType === "radio") {
          ctx.strokeStyle = "#64748B";
          ctx.lineWidth = 1.2;
          traceRoundRect(ctx, nx + 1, ny + 1, nw - 2, nh - 2, inType === "radio" ? nw / 2 : 3 * scale);
          ctx.stroke();
          if (el.checked) {
            ctx.fillStyle = "#1A73E8";
            traceRoundRect(ctx, nx + 3 * scale, ny + 3 * scale, nw - 6 * scale, nh - 6 * scale, inType === "radio" ? nw / 2 : 2 * scale);
            ctx.fill();
          }
        } else if (inType !== "hidden") {
          var valStr = "";
          var isPlaceholder = false;
          if (tag === "select") {
            valStr = (el.options && el.selectedIndex >= 0 && el.options[el.selectedIndex])
              ? el.options[el.selectedIndex].text
              : (el.value || "");
          } else if (inType === "password" && el.value) {
            valStr = new Array(Math.min(20, el.value.length) + 1).join("•");
          } else if (el.value) {
            valStr = el.value;
          } else if (el.getAttribute("placeholder")) {
            valStr = el.getAttribute("placeholder");
            isPlaceholder = true;
          }
          if (valStr) {
            var fSizeIn = Math.max(6, Math.min(26, (parseFloat(cs.fontSize) || 13) * scale));
            var fwIn = parseInt(cs.fontWeight || "400", 10);
            ctx.font = (fwIn >= 600 ? "600 " : "400 ") + fSizeIn + "px " + (cs.fontFamily || "-apple-system, sans-serif");
            ctx.fillStyle = isPlaceholder ? "rgba(100, 116, 139, 0.75)" : (cs.color || "#1B1F1D");
            ctx.textBaseline = "middle";
            var padL = (parseFloat(cs.paddingLeft) || 8) * scale;
            var textY = tag === "textarea" ? (ny + (parseFloat(cs.paddingTop) || 8) * scale + fSizeIn * 0.6) : (ny + nh / 2);
            ctx.save();
            traceRoundRect(ctx, nx + 1, ny + 1, nw - 2, nh - 2, radius);
            ctx.clip();
            ctx.fillText(valStr.replace(/\s+/g, " ").slice(0, 90), nx + padL, textY);
            ctx.restore();
          }
        }
      }

      // Nodos de texto directos (con posicionamiento exacto por línea vía Range.getClientRects)
      var childNodes = el.childNodes;
      if (childNodes && childNodes.length > 0 && tag !== "script" && tag !== "style" && tag !== "select" && tag !== "textarea") {
        var fSize = Math.max(5.5, Math.min(36, (parseFloat(cs.fontSize) || 13) * scale));
        var fwNum = parseInt(cs.fontWeight || "400", 10);
        var fStyle = (cs.fontStyle === "italic" ? "italic " : "");
        var fWeight = (!isNaN(fwNum) && fwNum >= 600) || cs.fontWeight === "bold" ? "600 " : "400 ";
        ctx.font = fStyle + fWeight + fSize + "px " + (cs.fontFamily || "-apple-system, BlinkMacSystemFont, sans-serif");
        ctx.fillStyle = cs.color || "#1B1F1D";
        ctx.textBaseline = "alphabetic";

        for (var c = 0; c < childNodes.length; c++) {
          var node = childNodes[c];
          if (node.nodeType !== 3) continue;
          var rawText = (node.nodeValue || "").replace(/\s+/g, " ").trim();
          if (!rawText) continue;

          if (cs.textTransform === "uppercase") rawText = rawText.toUpperCase();
          else if (cs.textTransform === "lowercase") rawText = rawText.toLowerCase();

          var lineRects = null;
          try {
            textRange.selectNodeContents(node);
            lineRects = textRange.getClientRects();
          } catch (_e) {
            lineRects = null;
          }

          if (!lineRects || lineRects.length === 0) continue;

          if (lineRects.length === 1) {
            var lr = lineRects[0];
            if (lr.width >= 1 && lr.height >= 1) {
              var tx = dx + lr.left * scale;
              var ty = dy + (lr.top + lr.height * 0.78) * scale;
              ctx.fillText(rawText, tx, ty);
            }
          } else {
            // Texto multilínea: distribuir palabras según el ancho real de cada línea
            var words = rawText.split(" ");
            var wIdx = 0;
            for (var rIdx = 0; rIdx < lineRects.length && wIdx < words.length; rIdx++) {
              var lRect = lineRects[rIdx];
              if (lRect.width < 1 || lRect.height < 1) continue;
              var maxLineW = lRect.width * scale + 4;
              var lineStr = words[wIdx++];
              if (rIdx === lineRects.length - 1) {
                while (wIdx < words.length) {
                  lineStr += " " + words[wIdx++];
                }
              } else {
                while (wIdx < words.length) {
                  var candidate = lineStr + " " + words[wIdx];
                  if (ctx.measureText(candidate).width <= maxLineW) {
                    lineStr = candidate;
                    wIdx++;
                  } else {
                    break;
                  }
                }
              }
              var ltx = dx + lRect.left * scale;
              var lty = dy + (lRect.top + lRect.height * 0.78) * scale;
              ctx.fillText(lineStr, ltx, lty);
            }
          }
        }
      }

      ctx.restore();
    }
  }

  function captureAnnotatedSnapshot() {
    if (!state.active.length) {
      toast(t("toastNoDevices"));
      return;
    }
    Promise.all(state.active.map(requestDomSnapshotFromFrame)).then(function (snapshots) {
      var snapByFrame = {};
      snapshots.forEach(function (s) {
        if (s && s.frame) snapByFrame[s.frame] = s;
      });

      var dpr = 2;
      var stageRect = stage.getBoundingClientRect();
      var headerH = 52;
      var footerH = 40;
      var canvasW = Math.max(960, Math.round(stageRect.width));
      var canvasH = Math.max(540, Math.round(stageRect.height)) + headerH + footerH;

      var canvas = document.createElement("canvas");
      canvas.width = canvasW * dpr;
      canvas.height = canvasH * dpr;
      var ctx = canvas.getContext("2d");
      ctx.scale(dpr, dpr);

      // Fondo claro neutro acorde con la interfaz (#E4E7E4)
      ctx.fillStyle = "#E4E7E4";
      ctx.fillRect(0, 0, canvasW, canvasH);

      // Cuadrícula sutil sobre el tapete
      ctx.strokeStyle = "rgba(27, 31, 29, 0.045)";
      ctx.lineWidth = 1;
      for (var gx = 0; gx < canvasW; gx += 40) {
        ctx.beginPath(); ctx.moveTo(gx, headerH); ctx.lineTo(gx, canvasH - footerH); ctx.stroke();
      }
      for (var gy = headerH; gy < canvasH - footerH; gy += 40) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(canvasW, gy); ctx.stroke();
      }

      // Barra superior clara
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, canvasW, headerH);
      ctx.strokeStyle = "#D0D5D0";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, headerH); ctx.lineTo(canvasW, headerH); ctx.stroke();

      ctx.fillStyle = "#1B1F1D";
      ctx.font = "600 14px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText("DevTool Multi-Display — Captura de Pantallas", 16, 22);

      ctx.fillStyle = "#5A625D";
      ctx.font = "500 11.5px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillText("URL: " + (state.url || "—") + "   |   Pantallas: " + state.active.length + "   |   Auditoría: " + auditState.items.length + " hallazgos", 16, 40);

      // Dibujar cada dispositivo activo con su DOM en vivo (incluyendo modales, diálogos y overlays)
      state.active.forEach(function (id) {
        var e = els[id];
        var d = BY_ID[id];
        if (!e || !d) return;
        var screenRect = e.screen.getBoundingClientRect();
        var dx = screenRect.left - stageRect.left;
        var dy = screenRect.top - stageRect.top + headerH;
        var dw = screenRect.width;
        var dh = screenRect.height;
        var col = deviceColor(id);
        var scale = dw / Math.max(1, d.width);

        // Marco con el color de contorno único del dispositivo
        ctx.save();
        ctx.shadowColor = "rgba(15, 23, 42, 0.12)";
        ctx.shadowBlur = 12;
        ctx.shadowOffsetY = 4;
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(dx - 2, dy - 2, dw + 4, dh + 4);
        ctx.restore();

        ctx.save();
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(dx - 2, dy - 2, dw + 4, dh + 4);

        // Contenido real de la pantalla (live DOM + modales/stacking contexts)
        ctx.beginPath();
        ctx.rect(dx, dy, dw, dh);
        ctx.clip();

        paintLiveIframeDom(ctx, e.iframe, dx, dy, dw, dh, d.width, d.height, snapByFrame[id]);

        // Anotaciones de Auditoría Visual sobre la pantalla (si existen hallazgos)
        var devIssues = auditState.items.filter(function (iss) { return iss.device_id === id && iss.box && iss.box.width; });
        devIssues.forEach(function (iss, iIdx) {
          var ix = dx + (iss.box.x || 0) * scale;
          var iy = dy + (iss.box.y || 0) * scale;
          var iw = Math.max(16, Math.min(dw - 4, iss.box.width * scale));
          var ih = Math.max(14, Math.min(dh - 4, iss.box.height * scale));
          var isErr = iss.severity === "error";
          ctx.strokeStyle = isErr ? "#DC2626" : "#D97706";
          ctx.lineWidth = 1.75;
          ctx.fillStyle = isErr ? "rgba(220, 38, 38, 0.14)" : "rgba(217, 119, 6, 0.14)";
          ctx.fillRect(ix, iy, iw, ih);
          ctx.strokeRect(ix, iy, iw, ih);

          var tagTxt = "#" + (iIdx + 1) + " " + iss.kind;
          ctx.font = "600 9.5px ui-monospace, monospace";
          var tw = ctx.measureText(tagTxt).width + 8;
          ctx.fillStyle = isErr ? "#DC2626" : "#D97706";
          ctx.fillRect(ix, Math.max(dy, iy - 14), tw, 14);
          ctx.fillStyle = "#FFFFFF";
          ctx.fillText(tagTxt, ix + 4, Math.max(dy + 10, iy - 4));
        });

        // Marcadores visuales de las últimas interacciones del usuario en esta pantalla (clics, inputs, swipes)
        var devSteps = flowState.items.filter(function (st) {
          return st.device_id === id && st.coords && typeof st.coords.x === "number" && st.action !== "scroll";
        }).slice(-5);
        devSteps.forEach(function (st, sIdx) {
          var sx = dx + st.coords.x * scale;
          var sy = dy + st.coords.y * scale;
          if (sx < dx || sx > dx + dw || sy < dy || sy > dy + dh) return;

          if (st.action === "swipe" && typeof st.coords.endX === "number") {
            var ex = dx + st.coords.endX * scale;
            var ey = dy + st.coords.endY * scale;
            ctx.strokeStyle = "rgba(26, 115, 232, 0.85)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(ex, ey);
            ctx.stroke();
          }

          ctx.fillStyle = "rgba(26, 115, 232, 0.22)";
          ctx.beginPath();
          ctx.arc(sx, sy, 11, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = "#1A73E8";
          ctx.strokeStyle = "#FFFFFF";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(sx, sy, 7.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = "#FFFFFF";
          ctx.font = "700 8.5px ui-monospace, monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(sIdx + 1), sx, sy + 0.5);
          ctx.textAlign = "left";
          ctx.textBaseline = "alphabetic";
        });

        ctx.restore();

        // Etiqueta inferior del dispositivo
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(dx + 7, dy + dh + 15, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#1B1F1D";
        ctx.font = "600 11.5px -apple-system, sans-serif";
        ctx.fillText(d.name + "  (" + d.width + "×" + d.height + ")", dx + 16, dy + dh + 19);
      });

      // Barra inferior clara con resumen de errores de Consola y HTTP
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, canvasH - footerH, canvasW, footerH);
      ctx.strokeStyle = "#D0D5D0";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, canvasH - footerH); ctx.lineTo(canvasW, canvasH - footerH); ctx.stroke();

      var errCount = consoleState.items.filter(function (c) { return c.level === "error"; }).length;
      var httpErrCount = trafficState.items.filter(function (r) { return r.status >= 400; }).length;
      var inspText = lastInspectedElement
        ? ("Último elemento: " + lastInspectedElement.selector + " [" + lastInspectedElement.device_name + "]")
        : "Sin elemento inspeccionado";
      ctx.fillStyle = "#3E4540";
      ctx.font = "500 11.5px ui-monospace, monospace";
      ctx.fillText(
        "Errores Consola: " + errCount + "   |   HTTP 4xx/5xx: " + httpErrCount + "   |   " + inspText,
        16,
        canvasH - 15
      );

      canvas.toBlob(function (blob) {
        if (!blob) return;
        if (navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem !== "undefined") {
          var item = new ClipboardItem({ "image/png": blob });
          navigator.clipboard.write([item]).then(function () {
            toast(t("snapshotCopied"));
          }).catch(function () {
            downloadBlobFallback(blob);
          });
        } else {
          downloadBlobFallback(blob);
        }
      }, "image/png");
    });
  }

  function downloadBlobFallback(blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "devtool-ai-snapshot-" + Date.now() + ".png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
    toast(t("snapshotDownloaded"));
  }

  function buildCurl(item) {
    if (!item) return "";
    var parts = ["curl -i -X " + item.method + " " + JSON.stringify(item.url)];
    var hdrs = item.req_headers || {};
    Object.keys(hdrs).forEach(function (k) {
      parts.push("  -H " + JSON.stringify(k + ": " + hdrs[k]));
    });
    if (item.req_body && item.method !== "GET") {
      parts.push("  --data-raw " + JSON.stringify(item.req_body));
    }
    return parts.join(" \\\n");
  }

  function getSelectedTrafficItem() {
    for (var i = 0; i < trafficState.items.length; i++) {
      if (trafficState.items[i].id === trafficState.selectedId) return trafficState.items[i];
    }
    return null;
  }

  populateTrafficDeviceSelect();

  if (trafficBtn) {
    trafficBtn.addEventListener("click", function () { toggleTrafficPanel(undefined, "traffic"); });
  }
  if (consoleBtn) {
    consoleBtn.addEventListener("click", function () { toggleTrafficPanel(undefined, "console"); });
  }
  if (auditBtn) {
    auditBtn.addEventListener("click", function () { toggleTrafficPanel(undefined, "audit"); });
  }
  if (flowBtn) {
    flowBtn.addEventListener("click", function () { toggleTrafficPanel(undefined, "flow"); });
  }
  if (panelModeTraffic) {
    panelModeTraffic.addEventListener("click", function () { setPanelMode("traffic"); });
  }
  if (panelModeConsole) {
    panelModeConsole.addEventListener("click", function () { setPanelMode("console"); });
  }
  if (panelModeAudit) {
    panelModeAudit.addEventListener("click", function () { setPanelMode("audit"); });
  }
  if (panelModeFlow) {
    panelModeFlow.addEventListener("click", function () { setPanelMode("flow"); });
  }
  if (panelModeStorage) {
    panelModeStorage.addEventListener("click", function () { setPanelMode("storage"); });
  }
  if (aiReportBtn) {
    aiReportBtn.addEventListener("click", openAiReportModal);
  }
  if (panelAiReportBtn) {
    panelAiReportBtn.addEventListener("click", openAiReportModal);
  }
  if (snapshotBtn) {
    snapshotBtn.addEventListener("click", captureAnnotatedSnapshot);
  }
  if (panelSnapshotBtn) {
    panelSnapshotBtn.addEventListener("click", captureAnnotatedSnapshot);
  }
  if (aiModalClose) {
    aiModalClose.addEventListener("click", function () {
      if (aiReportModal) aiReportModal.hidden = true;
    });
  }
  if (aiReportModal) {
    aiReportModal.addEventListener("click", function (ev) {
      if (ev.target === aiReportModal) aiReportModal.hidden = true;
    });
  }
  if (aiModalToggles) {
    aiModalToggles.addEventListener("change", function () {
      var md = buildAiMarkdownReport();
      if (aiReportTextarea) aiReportTextarea.value = md;
    });
  }
  if (aiModalCopyBtn) {
    aiModalCopyBtn.addEventListener("click", function () {
      var txt = aiReportTextarea ? aiReportTextarea.value : buildAiMarkdownReport();
      copyText(txt, t("aiReportCopied"));
    });
  }
  if (aiModalSnapshotBtn) {
    aiModalSnapshotBtn.addEventListener("click", captureAnnotatedSnapshot);
  }

  // Controles de Auditoría Visual
  if (auditScanBtn) {
    auditScanBtn.addEventListener("click", function () {
      triggerAuditScan();
      setTimeout(fetchAudit, 160);
    });
  }
  if (auditHighlightBtn) {
    auditHighlightBtn.addEventListener("click", function () {
      toggleAuditHighlight();
    });
  }
  if (auditCopyOneBtn) {
    auditCopyOneBtn.addEventListener("click", function () {
      var filtered = auditState.items.filter(matchesAuditFilter);
      var sel = (auditState.selectedIdx >= 0 && auditState.selectedIdx < filtered.length)
        ? filtered[auditState.selectedIdx]
        : filtered[0];
      if (sel) copyText(formatAuditIssueForAi(sel), t("copiedAudit"));
    });
  }
  if (auditCopyAllBtn) {
    auditCopyAllBtn.addEventListener("click", function () {
      copyText(formatAllAuditIssuesForAi(), t("copiedAudit"));
    });
  }

  // Controles de Flujo / Pasos
  if (flowTabMd) {
    flowTabMd.addEventListener("click", function () {
      flowState.format = "markdown";
      flowTabMd.classList.add("is-active");
      if (flowTabPw) flowTabPw.classList.remove("is-active");
      renderFlowDetail();
    });
  }
  if (flowTabPw) {
    flowTabPw.addEventListener("click", function () {
      flowState.format = "playwright";
      flowTabPw.classList.add("is-active");
      if (flowTabMd) flowTabMd.classList.remove("is-active");
      renderFlowDetail();
    });
  }
  if (flowRecordToggle) {
    flowRecordToggle.addEventListener("click", function () {
      flowState.recording = !flowState.recording;
      flowRecordToggle.setAttribute("aria-pressed", flowState.recording ? "true" : "false");
      flowRecordToggle.classList.toggle("is-active", flowState.recording);
      flowRecordToggle.textContent = flowState.recording ? t("flowRecording") : t("flowPaused");
    });
  }
  if (flowCopyBtn) {
    flowCopyBtn.addEventListener("click", function () {
      var filtered = flowState.items.filter(matchesFlowFilter);
      var txt = flowState.format === "playwright" ? buildFlowPlaywright(filtered) : buildFlowMarkdown(filtered);
      copyText(txt, t("copiedFlow"));
    });
  }

  // Controles de Storage / Cookies / JWT
  if (storageRefreshBtn) {
    storageRefreshBtn.addEventListener("click", requestFramesStorage);
  }
  if (storageCopyOneBtn) {
    storageCopyOneBtn.addEventListener("click", function () {
      var filtered = storageState.rows.filter(matchesStorageFilter);
      var sel = (storageState.selectedIdx >= 0 && storageState.selectedIdx < filtered.length)
        ? filtered[storageState.selectedIdx]
        : filtered[0];
      if (sel) copyText(formatStorageRowForAi(sel), t("copiedStorage"));
    });
  }
  if (storageCopyAllBtn) {
    storageCopyAllBtn.addEventListener("click", function () {
      copyText(formatAllStorageForAi(), t("copiedStorage"));
    });
  }

  if (trafficCloseBtn) {
    trafficCloseBtn.addEventListener("click", function () { toggleTrafficPanel(false); });
  }
  if (trafficPauseBtn) {
    trafficPauseBtn.addEventListener("click", function () {
      trafficState.paused = !trafficState.paused;
      trafficPauseBtn.classList.toggle("is-paused", trafficState.paused);
      trafficPauseBtn.textContent = trafficState.paused ? t("trafficResume") : t("trafficPause");
      if (trafficDot) trafficDot.classList.toggle("is-paused", trafficState.paused);
      if (!trafficState.paused) {
        fetchTraffic();
        fetchConsole();
        fetchFlow();
        fetchAudit();
      }
    });
  }
  if (trafficClearBtn) {
    trafficClearBtn.addEventListener("click", function () {
      var m = trafficState.panelMode;
      if (m === "console") {
        fetch("/api/console/clear", { method: "POST", credentials: "same-origin" }).catch(function () {});
        consoleState.items = [];
        consoleState.selectedId = null;
        updateConsoleBadge();
        renderConsoleTable();
        renderConsoleDetail();
        postCrossTab({ type: "bc:console_clear" });
      } else if (m === "audit") {
        fetch("/api/audit/clear", { method: "POST", credentials: "same-origin" }).catch(function () {});
        auditState.items = [];
        auditState.selectedIdx = -1;
        updateAuditBadge();
        renderAuditTable();
        renderAuditDetail();
        postCrossTab({ type: "bc:audit_clear" });
      } else if (m === "flow") {
        fetch("/api/flow/clear", { method: "POST", credentials: "same-origin" }).catch(function () {});
        flowState.items = [];
        flowState.selectedId = null;
        if (flowCountEl) flowCountEl.textContent = "0";
        renderFlowTable();
        renderFlowDetail();
        postCrossTab({ type: "bc:flow_clear" });
      } else if (m === "storage") {
        requestFramesStorage();
      } else {
        fetch("/api/traffic/clear", { method: "POST", credentials: "same-origin" }).catch(function () {});
        trafficState.items = [];
        trafficState.selectedId = null;
        if (trafficCountEl) trafficCountEl.textContent = "0";
        renderTrafficTable();
        renderTrafficDetail();
        postCrossTab({ type: "bc:traffic_clear" });
      }
    });
  }
  function openTrafficStandaloneWindow() {
    var activeMode = trafficState.panelMode || "traffic";
    toggleTrafficPanel(false);
    window.open(
      location.origin + "/?mode=traffic&tab=" + encodeURIComponent(activeMode),
      "rv_traffic_window",
      "width=1140,height=680,resizable=yes,scrollbars=yes"
    );
  }
  if (trafficPopoutBtn) {
    trafficPopoutBtn.addEventListener("click", openTrafficStandaloneWindow);
  }
  if (trafficRulerPopout) {
    trafficRulerPopout.addEventListener("click", openTrafficStandaloneWindow);
  }
  if (trafficSearch) {
    trafficSearch.addEventListener("input", function () {
      trafficState.searchQuery = trafficSearch.value.trim();
      renderTrafficTable();
      renderConsoleTable();
      renderAuditTable();
      renderAuditDetail();
      renderFlowTable();
      renderFlowDetail();
      renderStorageTable();
      renderStorageDetail();
    });
  }
  if (trafficDeviceFilter) {
    trafficDeviceFilter.addEventListener("change", function () {
      trafficState.deviceFilter = trafficDeviceFilter.value;
      renderTrafficTable();
      renderConsoleTable();
      renderAuditTable();
      renderAuditDetail();
      renderFlowTable();
      renderFlowDetail();
      renderStorageTable();
      renderStorageDetail();
    });
  }
  if (trafficMethodPills) {
    trafficMethodPills.addEventListener("click", function (ev) {
      var btn = ev.target.closest(".traffic-pill");
      if (!btn) return;
      trafficState.methodFilter = btn.dataset.filter || "all";
      Array.prototype.slice.call(trafficMethodPills.querySelectorAll(".traffic-pill")).forEach(function (p) {
        p.classList.toggle("is-active", p === btn);
      });
      renderTrafficTable();
    });
  }
  if (consoleLevelPills) {
    consoleLevelPills.addEventListener("click", function (ev) {
      var btn = ev.target.closest(".traffic-pill");
      if (!btn) return;
      consoleState.levelFilter = btn.dataset.level || "all";
      Array.prototype.slice.call(consoleLevelPills.querySelectorAll(".traffic-pill")).forEach(function (p) {
        p.classList.toggle("is-active", p === btn);
      });
      renderConsoleTable();
    });
  }
  trafficTabs.forEach(function (tabBtn) {
    tabBtn.addEventListener("click", function () {
      trafficState.activeTab = tabBtn.dataset.tab || "request";
      trafficTabs.forEach(function (b) { b.classList.toggle("is-active", b === tabBtn); });
      renderTrafficDetail();
    });
  });
  if (trafficCopyReq) {
    trafficCopyReq.addEventListener("click", function () {
      var item = getSelectedTrafficItem();
      if (item) copyText(item.raw_request, t("copiedReq"));
    });
  }
  if (trafficCopyRes) {
    trafficCopyRes.addEventListener("click", function () {
      var item = getSelectedTrafficItem();
      if (item) copyText(item.raw_response, t("copiedRes"));
    });
  }
  if (trafficCopyCurl) {
    trafficCopyCurl.addEventListener("click", function () {
      var item = getSelectedTrafficItem();
      if (item) copyText(buildCurl(item), t("copiedCurl"));
    });
  }
  if (consoleCopyBtn) {
    consoleCopyBtn.addEventListener("click", function () {
      var item = getSelectedConsoleItem();
      if (item) copyText(formatConsoleDetailText(item), t("copiedConsole"));
    });
  }

  // ---------- Redimensionamiento del panel de Tráfico / Consola (altura y divisor interno) ----------
  var STORE_PANEL_H = "rv.panel.height";
  var STORE_SPLIT_COL = "rv.panel.splitCol";
  var STORE_SPLIT_ROW = "rv.panel.splitRow";
  var trafficResizerTop = document.getElementById("traffic-resizer-top");
  var splitResizers = Array.prototype.slice.call(document.querySelectorAll(".traffic-split-resizer"));

  (function restorePanelSizes() {
    var savedH = load(STORE_PANEL_H);
    if (typeof savedH === "number" && savedH >= 120 && trafficPanel) {
      trafficPanel.style.setProperty("--traffic-h", savedH + "px");
    }
    var savedCol = load(STORE_SPLIT_COL);
    if (typeof savedCol === "number" && savedCol >= 20 && savedCol <= 80 && trafficPanel) {
      trafficPanel.style.setProperty("--traffic-split-col", savedCol + "%");
    }
    var savedRow = load(STORE_SPLIT_ROW);
    if (typeof savedRow === "number" && savedRow >= 20 && savedRow <= 80 && trafficPanel) {
      trafficPanel.style.setProperty("--traffic-split-row", savedRow + "%");
    }
  })();

  if (trafficResizerTop && trafficPanel) {
    trafficResizerTop.addEventListener("pointerdown", function (ev) {
      if (ev.button !== 0) return;
      ev.preventDefault();
      var startY = ev.clientY;
      var startH = trafficPanel.getBoundingClientRect().height;
      trafficResizerTop.setPointerCapture(ev.pointerId);
      document.body.classList.add("is-resizing-panel");

      function onMove(e) {
        var delta = startY - e.clientY;
        var maxH = Math.max(200, window.innerHeight - 110);
        var nextH = Math.round(Math.min(maxH, Math.max(120, startH + delta)));
        trafficPanel.style.setProperty("--traffic-h", nextH + "px");
        layout();
      }
      function onUp(e) {
        trafficResizerTop.removeEventListener("pointermove", onMove);
        trafficResizerTop.removeEventListener("pointerup", onUp);
        trafficResizerTop.removeEventListener("pointercancel", onUp);
        document.body.classList.remove("is-resizing-panel");
        var finalH = Math.round(trafficPanel.getBoundingClientRect().height);
        store(STORE_PANEL_H, finalH);
        layout();
      }
      trafficResizerTop.addEventListener("pointermove", onMove);
      trafficResizerTop.addEventListener("pointerup", onUp);
      trafficResizerTop.addEventListener("pointercancel", onUp);
    });
  }

  splitResizers.forEach(function (resizer) {
    resizer.addEventListener("pointerdown", function (ev) {
      if (ev.button !== 0 || !trafficPanel) return;
      ev.preventDefault();
      var splitContainer = resizer.parentElement;
      if (!splitContainer) return;
      resizer.setPointerCapture(ev.pointerId);
      document.body.classList.add("is-resizing-split");

      function onMove(e) {
        var rect = splitContainer.getBoundingClientRect();
        var isVerticalSplit = window.innerWidth <= 1200;
        if (isVerticalSplit) {
          var pctY = ((e.clientY - rect.top) / Math.max(1, rect.height)) * 100;
          var clampedY = Math.round(Math.min(82, Math.max(18, pctY)) * 10) / 10;
          trafficPanel.style.setProperty("--traffic-split-row", clampedY + "%");
          store(STORE_SPLIT_ROW, clampedY);
        } else {
          var pctX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 100;
          var clampedX = Math.round(Math.min(82, Math.max(18, pctX)) * 10) / 10;
          trafficPanel.style.setProperty("--traffic-split-col", clampedX + "%");
          store(STORE_SPLIT_COL, clampedX);
        }
      }
      function onUp() {
        resizer.removeEventListener("pointermove", onMove);
        resizer.removeEventListener("pointerup", onUp);
        resizer.removeEventListener("pointercancel", onUp);
        document.body.classList.remove("is-resizing-split");
      }
      resizer.addEventListener("pointermove", onMove);
      resizer.addEventListener("pointerup", onUp);
      resizer.addEventListener("pointercancel", onUp);
    });
  });

  setInterval(function () {
    fetchTraffic();
    fetchConsole();
    fetchFlow();
    fetchAudit();
  }, 900);

  // ---------- Menú Agregar dispositivo ----------
  function buildMenu() {
    var groups = [];
    var byGroup = {};
    CATALOG.forEach(function (d) {
      if (!byGroup[d.group]) { byGroup[d.group] = []; groups.push(d.group); }
      byGroup[d.group].push(d);
    });

    groups.forEach(function (g, gi) {
      var group = document.createElement("div");
      group.className = "device-menu-group";
      group.setAttribute("role", "group");
      var headingId = "menu-group-" + gi;
      group.setAttribute("aria-labelledby", headingId);

      var headingRow = document.createElement("div");
      headingRow.className = "device-menu-heading-row";

      var heading = document.createElement("p");
      heading.className = "device-menu-heading";
      heading.id = headingId;
      heading.dataset.i18n = "group_" + g;
      heading.textContent = t("group_" + g);

      var groupPopBtn = document.createElement("button");
      groupPopBtn.type = "button";
      groupPopBtn.className = "device-menu-popout";
      groupPopBtn.dataset.i18n = "popoutGroup";
      groupPopBtn.textContent = t("popoutGroup");
      groupPopBtn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        var ids = byGroup[g].map(function (d) { return d.id; });
        closeMenu(false);
        popoutDevices(ids, true);
      });

      headingRow.appendChild(heading);
      headingRow.appendChild(groupPopBtn);
      group.appendChild(headingRow);

      byGroup[g].forEach(function (d) {
        var item = document.createElement("button");
        item.type = "button";
        item.className = "device-menu-item";
        item.setAttribute("role", "menuitemcheckbox");
        item.setAttribute("aria-checked", "false");
        item.tabIndex = -1;
        item.dataset.id = d.id;

        var check = document.createElement("span");
        check.className = "device-menu-check";
        check.appendChild(icon(["m4.5 10.5 3.5 3.5 7.5-8"]));
        var label = document.createElement("span");
        label.className = "device-menu-label";
        var menuDot = document.createElement("span");
        menuDot.className = "device-color-dot";
        menuDot.style.backgroundColor = deviceColor(d.id);
        label.appendChild(menuDot);
        label.appendChild(document.createTextNode(d.name));
        var size = document.createElement("span");
        size.className = "device-menu-size";
        size.textContent = d.width + " × " + d.height;

        item.appendChild(check);
        item.appendChild(label);
        item.appendChild(size);
        item.addEventListener("click", function () { toggleDevice(d.id); });
        group.appendChild(item);
      });
      menu.appendChild(group);
    });
  }

  function menuItems() { return Array.prototype.slice.call(menu.querySelectorAll(".device-menu-item")); }

  function syncMenu() {
    menuItems().forEach(function (item) {
      item.setAttribute("aria-checked", state.active.indexOf(item.dataset.id) > -1 ? "true" : "false");
    });
  }

  function openMenu() {
    menu.hidden = false;
    addBtn.setAttribute("aria-expanded", "true");
    var items = menuItems();
    if (items.length) items[0].focus();
  }
  function closeMenu(returnFocus) {
    if (menu.hidden) return;
    menu.hidden = true;
    addBtn.setAttribute("aria-expanded", "false");
    if (returnFocus) addBtn.focus();
  }

  addBtn.addEventListener("click", function () {
    if (menu.hidden) openMenu(); else closeMenu(false);
  });
  addBtn.addEventListener("keydown", function (ev) {
    if (ev.key === "ArrowUp" || ev.key === "ArrowDown") { ev.preventDefault(); openMenu(); }
  });

  menu.addEventListener("keydown", function (ev) {
    var items = menuItems();
    var i = items.indexOf(document.activeElement);
    switch (ev.key) {
      case "ArrowDown": ev.preventDefault(); items[(i + 1) % items.length].focus(); break;
      case "ArrowUp": ev.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); break;
      case "Home": ev.preventDefault(); items[0].focus(); break;
      case "End": ev.preventDefault(); items[items.length - 1].focus(); break;
      case "Escape": ev.preventDefault(); closeMenu(true); break;
      case "Tab": closeMenu(false); break;
    }
  });

  document.addEventListener("pointerdown", function (ev) {
    if (!menu.hidden && !menu.contains(ev.target) && !addBtn.contains(ev.target)) closeMenu(false);
  });
  // Un clic dentro de un iframe no llega al documento: cerramos al perder el foco.
  window.addEventListener("blur", function () { closeMenu(false); });

  // ---------- Idioma ----------
  var langButtons = Array.prototype.slice.call(document.querySelectorAll(".lang-switch [data-lang]"));

  function syncLangSwitch() {
    langButtons.forEach(function (b) {
      b.setAttribute("aria-pressed", b.dataset.lang === I18N.getLang() ? "true" : "false");
    });
  }

  langButtons.forEach(function (b) {
    b.addEventListener("click", function () {
      if (!I18N.setLang(b.dataset.lang)) return;   // también traduce el HTML y el menú
      state.active.forEach(translateDevice);
      updateZoomUI();
      syncLangSwitch();
    });
  });

  // ---------- Inicio ----------
  buildMenu();
  I18N.applyStatic();
  syncLangSwitch();

  // También se puede abrir con ?url=ejemplo.com&devices=iphone-se,ipad-mini o ?mode=traffic&tab=console
  var params = new URLSearchParams(location.search);
  var paramMode = params.get("mode");
  var paramTab = params.get("tab");
  var paramDevices = params.get("devices");
  var paramUrl = params.get("url");

  if (paramMode === "traffic") {
    document.body.classList.add("is-traffic-standalone");
    var validTabs = ["traffic", "console", "audit", "flow", "storage"];
    var initialTab = validTabs.indexOf(paramTab) > -1 ? paramTab : "traffic";
    document.title = t("trafficTitle") + " — Responsive Viewer";
    toggleTrafficPanel(true, initialTab);
    return;
  }

  var tabSaved = loadTabDevices();
  var saved = paramDevices
    ? paramDevices.split(",")
    : (Array.isArray(tabSaved) && tabSaved.length ? tabSaved : load(STORE_DEVICES));
  var initial = (Array.isArray(saved) ? saved : DEFAULTS).filter(function (id) { return BY_ID[id]; });
  if (!Array.isArray(saved) || (saved.length && !initial.length)) initial = DEFAULTS.slice();
  storeTabDevices(initial);
  initial.forEach(function (id) { state.active.push(id); createDevice(id); });
  syncMenu();

  var savedUrl = paramUrl ? normalizeUrl(paramUrl) : load(STORE_URL);
  if (typeof savedUrl === "string" && savedUrl) {
    state.url = savedUrl;
    input.value = savedUrl;
    state.active.forEach(function (id) { navigateFrame(id, savedUrl); });
  }

  var savedSync = load(STORE_SYNC);
  if (typeof savedSync === "boolean") state.sync = savedSync;
  updateSyncUI();

  var savedZoom = load(STORE_ZOOM);
  if (savedZoom === "fit" || savedZoom === "fill") state.zoomMode = savedZoom;
  else if (typeof savedZoom === "number" && savedZoom >= ZOOM_MIN && savedZoom <= ZOOM_MAX) state.zoomMode = savedZoom;

  try {
    var savedStack = sessionStorage.getItem("rv.tab.stack");
    if (savedStack === "stack" || savedStack === "auto") state.stackMode = savedStack;
  } catch (_e) {}

  layout();
  if (window.ResizeObserver) new ResizeObserver(layout).observe(stage);
  else window.addEventListener("resize", layout);
})();
