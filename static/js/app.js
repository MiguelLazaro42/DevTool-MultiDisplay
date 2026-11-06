(function () {
  "use strict";

  // Guardia anti-recursión: nunca inicializar el visor dentro de un iframe hijo.
  if (window.self !== window.top) {
    return;
  }

  // ---------- Datos ----------
  var CATALOG = JSON.parse(document.getElementById("devices-data").textContent);
  var DEFAULTS = JSON.parse(document.getElementById("defaults-data").textContent);
  var WORKSPACE = {};
  try {
    var wsEl = document.getElementById("workspace-data");
    if (wsEl && wsEl.textContent) WORKSPACE = JSON.parse(wsEl.textContent) || {};
  } catch (_e) {}
  var BY_ID = {};
  CATALOG.forEach(function (d) { BY_ID[d.id] = d; });

  var I18N = window.RV_I18N;
  var t = I18N.t;

  // Medidas del acomodo (optimizadas para mayor aprovechamiento del espacio)
  var PAD_X = 12, PAD_TOP = 10, PAD_BOTTOM = 14;
  var GAP_X = 16, GAP_Y = 12;
  var BEZEL = 8;           // marco compacto (4 px por lado)
  var CAPTION = 24;        // etiqueta compacta
  var RADIUS = { phone: 44, tablet: 18, desktop: 6 };

  // Zoom propio del visor (no el de Chrome). Pasos como los de Chrome.
  var ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
  var ZOOM_MIN = 0.1, ZOOM_MAX = 2;
  var IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  var MOD = IS_MAC ? "⌘" : "Ctrl";

  var STORE_URL = "rv.url", STORE_DEVICES = "rv.devices", STORE_DEVICES_SECONDARY = "rv.devices.secondary", STORE_ZOOM = "rv.zoom", STORE_SYNC = "rv.sync";

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

  // Modal de Certificado Cliente (.p12 / .pfx)
  var certBtn = document.getElementById("cert-btn");
  var certBtnLabel = document.getElementById("cert-btn-label");
  var certModal = document.getElementById("cert-modal");
  var certModalClose = document.getElementById("cert-modal-close");
  var certActiveBanner = document.getElementById("cert-active-banner");
  var certActiveFilename = document.getElementById("cert-active-filename");
  var certActiveMeta = document.getElementById("cert-active-meta");
  var certFileInput = document.getElementById("cert-file-input");
  var certPathInput = document.getElementById("cert-path-input");
  var certPassInput = document.getElementById("cert-pass-input");
  var certProxyAssets = document.getElementById("cert-proxy-assets");
  var certAllowSelfSigned = document.getElementById("cert-allow-self-signed");
  var certErrorBox = document.getElementById("cert-error-box");
  var certApplyBtn = document.getElementById("cert-apply-btn");
  var certRemoveBtn = document.getElementById("cert-remove-btn");

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
  var inspectedByTier = { mobile: null, desktop: null };
  var inspectedByDevice = {};
  var templatesByDevice = {};
  var pendingDomSnapshots = {};

  function getDeviceTier(deviceId) {
    var d = BY_ID[deviceId];
    if (!d) return "desktop";
    if (d.kind === "phone" || d.kind === "tablet" || (d.width && d.width < 960)) return "mobile";
    return "desktop";
  }

  function getDeviceTierTag(deviceId) {
    return getDeviceTier(deviceId) === "mobile" ? "MÓVIL" : "DESKTOP";
  }

  // Canal de sincronización entre múltiples pestañas / monitores (BroadcastChannel)
  var TAB_ID = "tab_" + Math.random().toString(36).slice(2, 9);
  var SESSION_DEVICES = "rv.tab.devices";
  var SESSION_SLOT = "rv.tab.slot";
  var syncChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("rv_multidisplay_sync") : null;
  var initParams = new URLSearchParams(location.search);
  var userModifiedDevicesInTab = false;
  var popoutAckCallbacks = {};

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

  function filterValidDevices(list) {
    if (!Array.isArray(list)) return [];
    var seen = {};
    var res = [];
    list.forEach(function (id) {
      if (BY_ID[id] && !seen[id]) {
        seen[id] = true;
        res.push(id);
      }
    });
    return res;
  }

  function getSavedMainDevices() {
    var loc = filterValidDevices(load(STORE_DEVICES));
    if (loc.length) return loc;
    return filterValidDevices(WORKSPACE && WORKSPACE.main_devices);
  }

  function getSavedSecondaryDevices() {
    var loc = filterValidDevices(load(STORE_DEVICES_SECONDARY));
    if (loc.length) return loc;
    return filterValidDevices(WORKSPACE && WORKSPACE.secondary_devices);
  }

  function isPortraitEnvironment() {
    var scr = window.screen;
    var screenPortrait = scr && scr.availHeight && scr.availWidth && scr.availHeight > scr.availWidth;
    var winPortrait = window.innerHeight > window.innerWidth * 1.05;
    return !!(screenPortrait || winPortrait);
  }

  function detectInitialWindowSlot() {
    if (initParams.get("win") === "secondary" || initParams.has("devices") || window.name === "rv_secondary_window") {
      try { sessionStorage.setItem(SESSION_SLOT, "secondary"); } catch (_e) {}
      return "secondary";
    }
    try {
      var savedSlot = sessionStorage.getItem(SESSION_SLOT);
      if (savedSlot === "secondary" || savedSlot === "main") return savedSlot;
    } catch (_e) {}
    if (isPortraitEnvironment()) {
      try { sessionStorage.setItem(SESSION_SLOT, "secondary"); } catch (_e) {}
      return "secondary";
    }
    return "main";
  }

  var windowSlot = detectInitialWindowSlot();

  function syncUrlParamsWithState() {
    if (initParams.get("mode") === "traffic") return;
    var curParams = new URLSearchParams(location.search);
    if (windowSlot === "secondary" || curParams.has("devices") || curParams.has("win")) {
      var u = new URL(location.href);
      u.searchParams.set("win", "secondary");
      if (state.active.length) {
        u.searchParams.set("devices", state.active.join(","));
      } else {
        u.searchParams.delete("devices");
      }
      if (state.url) {
        u.searchParams.set("url", state.url);
      }
      try {
        window.history.replaceState(null, "", u.pathname + u.search + u.hash);
      } catch (_e) {}
    }
  }

  function persistWorkspaceToServer(extra) {
    var payload = extra ? Object.assign({}, extra) : {};
    if (windowSlot === "secondary") {
      payload.secondary_devices = state.active.slice();
      if (WORKSPACE) WORKSPACE.secondary_devices = state.active.slice();
    } else {
      payload.main_devices = state.active.slice();
      if (WORKSPACE) WORKSPACE.main_devices = state.active.slice();
    }
    if (state.url) payload.url = state.url;
    payload.sync = !!state.sync;
    fetch("/api/workspace", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).catch(function () {});
  }

  var updateSecondaryMenuBar = function () {};

  function saveActiveDevices() {
    storeTabDevices(state.active);
    if (windowSlot === "secondary") {
      store(STORE_DEVICES_SECONDARY, state.active);
      postCrossTab({ type: "bc:secondary_devices_updated", devices: state.active.slice() });
    } else {
      store(STORE_DEVICES, state.active);
    }
    syncUrlParamsWithState();
    persistWorkspaceToServer();
    updateSecondaryMenuBar();
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

    els[id] = { root: root, body: body, bezel: body, screen: screen, iframe: iframe, placeholder: placeholder, remove: remove, popout: popout, sizeEl: size };
    translateDevice(id);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { root.classList.remove("is-entering"); });
    });
    return els[id];
  }

  var openSecondaryTabs = {};

  function replaceActiveDevicesList(nextIds) {
    var clean = filterValidDevices(nextIds);
    if (!clean.length) return;
    state.active.slice().forEach(function (id) {
      if (clean.indexOf(id) === -1) {
        state.active.splice(state.active.indexOf(id), 1);
        if (els[id] && els[id].root) els[id].root.remove();
        delete els[id];
        delete state.frameUrls[id];
      }
    });
    clean.forEach(function (id) {
      if (state.active.indexOf(id) === -1) {
        state.active.push(id);
        createDevice(id);
        if (state.url) navigateFrame(id, state.url);
      }
    });
    saveActiveDevices();
    syncMenu();
    layout();
  }

  function popoutDevices(deviceIds, removeFromCurrent, replaceSecondary) {
    var cleanIds = filterValidDevices(deviceIds);
    if (!cleanIds.length) return;

    var existingSec = getSavedSecondaryDevices();
    var targetSecIds = replaceSecondary
      ? cleanIds
      : filterValidDevices(existingSec.concat(cleanIds));

    store(STORE_DEVICES_SECONDARY, targetSecIds);
    if (WORKSPACE) WORKSPACE.secondary_devices = targetSecIds.slice();
    fetch("/api/workspace", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secondary_devices: targetSecIds, url: state.url || "" })
    }).catch(function () {});

    var hasOpenSecondary = Object.keys(openSecondaryTabs).length > 0;
    if (hasOpenSecondary) {
      postCrossTab({
        type: "bc:popout_add",
        devices: targetSecIds,
        url: state.url || ""
      });
    } else {
      var u = new URL(location.origin + "/");
      u.searchParams.set("win", "secondary");
      u.searchParams.set("devices", targetSecIds.join(","));
      if (state.url) u.searchParams.set("url", state.url);
      window.open(u.href, "_blank");
    }

    if (removeFromCurrent && state.active.length > cleanIds.length) {
      cleanIds.forEach(function (id) {
        if (state.active.indexOf(id) > -1) toggleDevice(id, false);
      });
    }
    updateSecondaryMenuBar();
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
    userModifiedDevicesInTab = true;
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
    saveActiveDevices();
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
    // Si una ventana nueva (sin cambios manuales aún) se arrastra a un monitor vertical
    // y existen dispositivos guardados para la 2da pantalla/vertical, restaurarlos automáticamente.
    if (windowSlot === "main" && !userModifiedDevicesInTab && isPortraitEnvironment()) {
      var savedSec = getSavedSecondaryDevices();
      if (savedSec.length) {
        windowSlot = "secondary";
        try { sessionStorage.setItem(SESSION_SLOT, "secondary"); } catch (_e) {}
        postCrossTab({ type: "bc:secondary_alive" });
        replaceActiveDevicesList(savedSec);
        return;
      }
    }

    var n = state.active.length;
    matEmpty.hidden = n > 0;
    var viewportW = document.documentElement.clientWidth || window.innerWidth || stage.clientWidth;
    var rawStageW = Math.min(stage.clientWidth || viewportW, viewportW);
    var W = rawStageW - PAD_X * 2;
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
    var hasWideDesktopOrLaptop = devices.some(function (d) {
      return d.width >= 900 || d.kind === "desktop" || d.kind === "laptop";
    });
    var forceVerticalStack = state.stackMode === "stack" || (isPortraitStage && hasWideDesktopOrLaptop);

    // Si estamos en un monitor vertical (portrait) o en modo Apilar (Vertical),
    // cada dispositivo que esté solo en su propia fila se escala independientemente para llenar
    // el ancho útil del monitor vertical, sin que un dispositivo de 1920px encoja al de 1366px.
    for (var r = 1; r <= n; r++) {
      if (forceVerticalStack && r < n) continue;

      var rows = partitionRows(devices, r, vW);
      if (rows.length !== r) continue;

      // En monitores verticales:
      // - Si hay 4 o menos dispositivos, o si cualquier fila comparte un Desktop/Laptop, los apilamos 1 por fila.
      if (!forceVerticalStack && isPortraitStage && r < n) {
        if (n <= 4) continue;
        var hasDesktopSharingRow = rows.some(function (row) {
          return row.length > 1 && row.some(function (d) { return d.width >= 768 || d.kind === "desktop" || d.kind === "laptop"; });
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
        // En monitor vertical apilado, priorizamos llenar el ancho del monitor
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

    var isStackedPortrait = (isPortraitStage || forceVerticalStack) && best.rows.length >= 1;
    var effectiveZoomSamples = [];

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

    // Altura total cuando cada fila individual ocupa el 100% del ancho disponible (freeSingleW)
    var freeSingleW = Math.max(120, W - BEZEL);
    var totalHAtFullW = best.rows.reduce(function (acc, rItem) {
      var maxRowNormH = Math.max.apply(null, rItem.map(function (rd) {
        return rd.height * (freeSingleW / Math.max(1, rd.width));
      }));
      return acc + maxRowNormH;
    }, 0);
    var availStackH = Math.max(180, H - best.rows.length * (BEZEL + CAPTION) - (best.rows.length - 1) * GAP_Y);

    function computeDeviceScale(d, row, ri) {
      if (isStackedPortrait && row.length === 1) {
        var fitWScale = freeSingleW / d.width;
        var hRatio = totalHAtFullW > 0 ? (availStackH / totalHAtFullW) : 1;
        var baseFactor = (state.zoomMode === "fill" || state.stackMode === "stack")
          ? Math.min(1.0, Math.max(0.95, hRatio))
          : Math.min(1.0, Math.max(0.82, hRatio));
        var stackBase = fitWScale * baseFactor;
        if (state.zoomMode === "fill" || state.zoomMode === "fit") {
          return stackBase;
        }
        var manualRatio = s / Math.max(0.05, best.s);
        return stackBase * manualRatio;
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

    var originX = PAD_X + (areaW - totalW) / 2;
    var originY = PAD_TOP + (areaH - totalH) / 2;
    state.baseScale = s;
    state.layoutMetrics = {
      originX: originX,
      originY: originY,
      totalW: totalW,
      totalH: totalH
    };

    updatePanCursor();

    var y = originY;

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

  // Cambia el zoom manteniendo exactamente fijo el punto del contenido bajo el cursor
  // (o el centro de la ventana si no hay cursor). anchor = {x, y} relativo a la esquina del tapete.
  var zoomingTimer;
  function applyZoom(mode, anchor) {
    var beforeBase = state.baseScale || state.scale || 1;
    var beforeMetrics = state.layoutMetrics
      ? {
          originX: state.layoutMetrics.originX,
          originY: state.layoutMetrics.originY,
          totalW: state.layoutMetrics.totalW,
          totalH: state.layoutMetrics.totalH
        }
      : null;

    if (mode !== "fit" && mode !== "fill") {
      mode = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, mode));
    }
    state.zoomMode = mode;
    store(STORE_ZOOM, mode);

    stage.classList.add("is-zooming");
    clearTimeout(zoomingTimer);
    zoomingTimer = setTimeout(function () { stage.classList.remove("is-zooming"); }, 180);

    var ax = anchor ? anchor.x : stage.clientWidth / 2;
    var ay = anchor ? anchor.y : stage.clientHeight / 2;
    var beforeScrollLeft = stage.scrollLeft;
    var beforeScrollTop = stage.scrollTop;

    layout();

    var afterMetrics = state.layoutMetrics;
    if (beforeMetrics && afterMetrics && beforeMetrics.totalW > 1 && beforeMetrics.totalH > 1) {
      var relX = (beforeScrollLeft + ax) - beforeMetrics.originX;
      var relY = (beforeScrollTop + ay) - beforeMetrics.originY;
      var ratioX = afterMetrics.totalW / beforeMetrics.totalW;
      var ratioY = afterMetrics.totalH / beforeMetrics.totalH;
      stage.scrollLeft = Math.max(0, Math.round(afterMetrics.originX + relX * ratioX - ax));
      stage.scrollTop = Math.max(0, Math.round(afterMetrics.originY + relY * ratioY - ay));
    } else {
      var afterBase = state.baseScale || state.scale || 1;
      var ratio = afterBase / beforeBase;
      stage.scrollLeft = (beforeScrollLeft + ax) * ratio - ax;
      stage.scrollTop = (beforeScrollTop + ay) * ratio - ay;
    }
  }

  function stepZoom(dir, anchor) {
    var cur = state.baseScale || state.scale, next;
    // Salta al siguiente paso que se note (al menos 4 % de diferencia).
    if (dir > 0) next = ZOOM_STEPS.filter(function (z) { return z > cur * 1.04; })[0] || ZOOM_MAX;
    else next = ZOOM_STEPS.filter(function (z) { return z < cur / 1.04; }).pop() || ZOOM_MIN;
    applyZoom(next, anchor);
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

  // ⌘/Ctrl + , ⌘/Ctrl − , ⌘/Ctrl 0 (Fit) y ⌘/Ctrl 1 (100%) hacen zoom en el visor.
  function onZoomKey(ev) {
    if (!(ev.metaKey || ev.ctrlKey) || ev.altKey) return;
    var tag = ev.target && ev.target.tagName ? ev.target.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea") return;
    var k = ev.key;
    if (k === "+" || k === "=") stepZoom(1);
    else if (k === "-" || k === "_") stepZoom(-1);
    else if (k === "0") fitZoom();
    else if (k === "1") applyZoom(1);
    else return;
    ev.preventDefault();
    ev.stopPropagation();
  }

  function isZoomWheelEvent(ev) {
    return !!(ev && (ev.ctrlKey || ev.metaKey || ev.altKey));
  }

  // Pellizcar en el trackpad (Mac / Windows Precision Touchpad) o Ctrl / ⌘ / Alt + rueda del mouse:
  // Detecta si es un gesto continuo de trackpad (deltas pequeños/fraccionales) o un paso discreto de rueda de mouse.
  function applyWheelZoomDelta(deltaY, deltaMode, anchorPoint) {
    var base = state.baseScale || state.scale || 1;
    var absDy = Math.abs(deltaY);
    var isMouseWheelNotch = deltaMode === 1 || (absDy >= 40 && absDy % 1 === 0);
    var sensitivity;
    if (deltaMode === 1) {
      sensitivity = 0.045;
    } else if (isMouseWheelNotch) {
      sensitivity = 0.0018;
    } else {
      // Trackpad pinch o scroll fino con modificador: respuesta fluida y directa
      sensitivity = 0.0115;
    }
    var factor = Math.exp(-deltaY * sensitivity);
    factor = Math.min(1.22, Math.max(1 / 1.22, factor));
    applyZoom(base * factor, anchorPoint);
  }

  function onZoomWheel(ev, toStage) {
    if (!isZoomWheelEvent(ev)) return;
    ev.preventDefault();
    ev.stopPropagation();
    var p = toStage(ev.clientX, ev.clientY);
    var dy = ev.deltaY !== 0 ? ev.deltaY : ev.deltaX;
    applyWheelZoomDelta(dy, ev.deltaMode || 0, p);
  }

  function stagePoint(clientX, clientY) {
    var r = stage.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  // Soporte adicional para gestos nativos GestureEvent de Safari / WebKit en trackpad de Mac
  var gestureStartScale = null;
  function bindSafariGestureEvents(target, toStageFn) {
    target.addEventListener("gesturestart", function (ev) {
      ev.preventDefault();
      gestureStartScale = state.baseScale || state.scale || 1;
    }, { passive: false });
    target.addEventListener("gesturechange", function (ev) {
      if (gestureStartScale === null || typeof ev.scale !== "number") return;
      ev.preventDefault();
      var p = toStageFn(ev.clientX || (stage.clientWidth / 2), ev.clientY || (stage.clientHeight / 2));
      applyZoom(gestureStartScale * ev.scale, p);
    }, { passive: false });
    target.addEventListener("gestureend", function () {
      gestureStartScale = null;
    }, { passive: false });
  }
  bindSafariGestureEvents(stage, stagePoint);

  document.addEventListener("keydown", onZoomKey, true);
  // Rueda sobre el tapete: con Ctrl / ⌘ / Alt o pellizco de trackpad hace zoom;
  // sin modificador hace scroll en TODAS las pantallas a la vez.
  stage.addEventListener("wheel", function (ev) {
    if (isZoomWheelEvent(ev)) { onZoomWheel(ev, stagePoint); return; }
    ev.preventDefault();
    scrollAllScreens(ev);
  }, { passive: false });

  // Doble clic sobre el fondo del tapete: alterna entre Fit y 100% (1:1) anclado al cursor
  stage.addEventListener("dblclick", function (ev) {
    if (ev.target.closest(".device, button, a, input")) return;
    var p = stagePoint(ev.clientX, ev.clientY);
    if (state.zoomMode === "fit") {
      applyZoom(1, p);
    } else {
      fitZoom();
    }
  });

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

  // Para recorrer el tapete cuando el zoom no cabe: arrastrar el fondo, usar botón central del mouse o Espacio + arrastrar.
  var pan = null;
  var spacePressed = false;
  function canPan() {
    return stage.scrollWidth > stage.clientWidth + 1 || stage.scrollHeight > stage.clientHeight + 1;
  }
  function updatePanCursor() {
    stage.classList.toggle("can-pan", canPan() || spacePressed);
  }

  window.addEventListener("keydown", function (ev) {
    if (ev.code === "Space" && !spacePressed) {
      var tag = ev.target && ev.target.tagName ? ev.target.tagName.toLowerCase() : "";
      if (tag !== "input" && tag !== "textarea" && !ev.target.isContentEditable) {
        spacePressed = true;
        updatePanCursor();
      }
    }
  });
  window.addEventListener("keyup", function (ev) {
    if (ev.code === "Space" && spacePressed) {
      spacePressed = false;
      updatePanCursor();
    }
  });

  stage.addEventListener("pointerdown", function (ev) {
    var isMiddleClick = ev.button === 1;
    var isLeftPan = ev.button === 0 && (canPan() || spacePressed);
    if (!isMiddleClick && !isLeftPan) return;
    if (!isMiddleClick && !spacePressed && ev.target.closest(".device-screen, button, a, input")) return;
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
  window.addEventListener("wheel", function (ev) { if (isZoomWheelEvent(ev)) ev.preventDefault(); }, { passive: false });

  // Convierte coordenadas internas de un iframe al punto exacto en el tapete
  function iframePointToStage(iframe, x, y) {
    var r = iframe.getBoundingClientRect();
    var scaleX = r.width / Math.max(1, iframe.offsetWidth || parseFloat(iframe.width) || 1);
    var scaleY = r.height / Math.max(1, iframe.offsetHeight || parseFloat(iframe.height) || 1);
    return stagePoint(r.left + x * scaleX, r.top + y * scaleY);
  }

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
        return iframePointToStage(iframe, x, y);
      });
    }, { passive: false, capture: true });
    bindSafariGestureEvents(w, function (x, y) {
      return iframePointToStage(iframe, x, y);
    });
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
    syncUrlParamsWithState();
    persistWorkspaceToServer({ url: url });
    if (!state.active.length) toast(t("toastNoDevices"));
    state.active.forEach(function (id) { navigateFrame(id, url); });
    if (state.sync) {
      postCrossTab({ type: "bc:load_url", url: url });
    }
  });

  // ---------- Refrescar (borra caché, storage del sitio y cookies) ----------
  function clearDocumentCookies() {
    // Cookies que la página puso con JavaScript en este origen.
    document.cookie.split(";").forEach(function (c) {
      var name = c.split("=")[0].trim();
      if (name) document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    });
  }

  function clearSiteCacheAndStorage() {
    clearDocumentCookies();
    // Limpiar localStorage y sessionStorage de la app probada (preservando preferencias rv.* del visor)
    [window.localStorage, window.sessionStorage].forEach(function (st) {
      if (!st) return;
      try {
        var toRemove = [];
        for (var i = 0; i < st.length; i++) {
          var k = st.key(i);
          if (k && k.indexOf("rv.") !== 0) {
            toRemove.push(k);
          }
        }
        toRemove.forEach(function (k) { st.removeItem(k); });
      } catch (_e) {}
    });
    // Limpiar CacheStorage (Service Workers / PWA caches) si existe
    if (window.caches && typeof window.caches.keys === "function") {
      try {
        window.caches.keys().then(function (names) {
          names.forEach(function (n) { window.caches.delete(n); });
        }).catch(function () {});
      } catch (_e) {}
    }
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
        clearSiteCacheAndStorage();
        snapshotImageCache = {};
        trafficState.items = [];
        trafficState.lastSeq = 0;
        trafficState.selectedId = null;
        consoleState.items = [];
        consoleState.lastSeq = 0;
        consoleState.selectedId = null;
        auditState.items = [];
        auditState.selectedIdx = -1;
        flowState.items = [];
        flowState.lastSeq = 0;
        flowState.selectedId = null;
        storageState.serverCookies = [];
        storageState.byDevice = {};
        storageState.rows = [];
        storageState.selectedIdx = -1;
        templatesByDevice = {};
        inspectedByTier = { mobile: null, desktop: null };
        inspectedByDevice = {};
        lastInspectedElement = null;
        if (trafficCountEl) trafficCountEl.textContent = "0";
        if (flowCountEl) flowCountEl.textContent = "0";
        updateConsoleBadge();
        updateAuditBadge();
        renderTrafficTable();
        renderTrafficDetail();
        renderConsoleTable();
        renderConsoleDetail();
        renderAuditTable();
        renderAuditDetail();
        renderFlowTable();
        renderFlowDetail();
        renderStorageTable();
        renderStorageDetail();
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
    } else if (d.type === "rv:template_context") {
      fetch("/api/templates", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(d)
      }).then(function (r) { return r.ok ? r.json() : null; }).then(function (res) {
        if (res && res.item) {
          templatesByDevice[res.item.device_id] = res.item;
        }
        postCrossTab({ type: "bc:templates_ping" });
      }).catch(function () {});
    } else if (d.type === "rv:counterpart_found") {
      onCounterpartFound(d);
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
    } else if (d.type === "rv:iframe_zoom_wheel") {
      var zItem = els[d.frame];
      if (zItem && zItem.iframe) {
        var zAnchor = iframePointToStage(zItem.iframe, d.clientX || 0, d.clientY || 0);
        applyWheelZoomDelta(d.deltaY || 0, d.deltaMode || 0, zAnchor);
      }
    } else if (d.type === "rv:sync_scroll") {
      if (!state.sync) return;
      var scrollPayload = {
        type: "rv:do_sync_scroll",
        containerSelector: d.containerSelector || "",
        structuralSelector: d.structuralSelector || "",
        isInsideModal: !!d.isInsideModal,
        x: d.x,
        y: d.y,
        dx: d.dx,
        dy: d.dy,
        ratioX: d.ratioX,
        ratioY: d.ratioY
      };
      broadcastToOtherFrames(d.frame, scrollPayload);
      postCrossTab({ type: "bc:sync_scroll", payload: scrollPayload });
    } else if (d.type === "rv:sync_drag") {
      if (!state.sync) return;
      var dragPayload = {
        type: "rv:do_sync_drag",
        phase: d.phase,
        selector: d.selector || "",
        structuralSelector: d.structuralSelector || "",
        isInsideModal: !!d.isInsideModal,
        rx: d.rx,
        ry: d.ry,
        dx: d.dx,
        dy: d.dy,
        stepDx: d.stepDx,
        stepDy: d.stepDy,
        vw: d.vw,
        vh: d.vh,
        modalStyleDelta: d.modalStyleDelta || null
      };
      broadcastToOtherFrames(d.frame, dragPayload);
      postCrossTab({ type: "bc:sync_drag", payload: dragPayload });
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
        absHref: d.absHref,
        isModalClose: !!d.isModalClose,
        isBackdropClick: !!d.isBackdropClick,
        isInsideModal: !!d.isInsideModal,
        rx: d.rx,
        ry: d.ry
      };
      broadcastToOtherFrames(d.frame, clickPayload);
      postCrossTab({ type: "bc:sync_click", payload: clickPayload });
    } else if (d.type === "rv:sync_key") {
      if (!state.sync) return;
      var keyPayload = {
        type: "rv:do_sync_key",
        key: d.key,
        code: d.code,
        keyCode: d.keyCode,
        selector: d.selector
      };
      broadcastToOtherFrames(d.frame, keyPayload);
      postCrossTab({ type: "bc:sync_key", payload: keyPayload });
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

      if (msg.type === "bc:who_is_secondary") {
        if (windowSlot === "secondary") {
          postCrossTab({ type: "bc:secondary_alive" });
        }
        return;
      }
      if (msg.type === "bc:secondary_alive") {
        openSecondaryTabs[msg.tabId] = true;
        return;
      }
      if (msg.type === "bc:secondary_closed") {
        delete openSecondaryTabs[msg.tabId];
        return;
      }
      if (msg.type === "bc:secondary_devices_updated" && Array.isArray(msg.devices)) {
        if (WORKSPACE) WORKSPACE.secondary_devices = msg.devices.slice();
        updateSecondaryMenuBar();
        return;
      }
      if (msg.type === "bc:popout_add" && windowSlot === "secondary" && Array.isArray(msg.devices)) {
        if (msg.url && msg.url !== state.url) {
          state.url = msg.url;
          input.value = msg.url;
          state.frameUrls = {};
        }
        var merged = filterValidDevices(state.active.concat(msg.devices));
        if (merged.length) {
          userModifiedDevicesInTab = true;
          replaceActiveDevicesList(merged);
        }
        return;
      }
      if (msg.type === "bc:request_window_snapshot" && msg.requestId) {
        if (state.active.length && typeof renderLocalWindowSnapshotDataUrl === "function") {
          renderLocalWindowSnapshotDataUrl().then(function (snapPayload) {
            if (!snapPayload) return;
            postCrossTab({
              type: "bc:window_snapshot_response",
              requestId: msg.requestId,
              windowSlot: windowSlot,
              windowTitle: windowSlot === "secondary" ? "2da Pantalla / Monitor Vertical" : "Pantalla Principal",
              devices: state.active.map(function (id) {
                var d = BY_ID[id];
                return d ? (d.name + " (" + d.width + "×" + d.height + ")") : id;
              }),
              deviceCount: state.active.length,
              width: snapPayload.width,
              height: snapPayload.height,
              dataUrl: snapPayload.dataUrl
            });
          }).catch(function () {});
        }
        return;
      }
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
      if (msg.type === "bc:templates_ping") {
        fetch("/api/templates", { credentials: "same-origin" })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (data) {
            if (data && Array.isArray(data.items)) {
              data.items.forEach(function (it) { templatesByDevice[it.device_id] = it; });
            }
          }).catch(function () {});
        return;
      }
      if (msg.type === "bc:find_counterpart" && msg.identifiers) {
        broadcastToOtherFrames(msg.sourceFrame || null, {
          type: "rv:find_counterpart",
          identifiers: msg.identifiers
        });
        return;
      }
      if (msg.type === "bc:inspected_ping" && msg.item) {
        if (!msg.item.isCounterpart) {
          lastInspectedElement = msg.item;
        }
        var tKey = msg.item.tier || getDeviceTier(msg.item.device_id || msg.item.frame);
        inspectedByTier[tKey] = msg.item;
        if (msg.item.device_id || msg.item.frame) {
          inspectedByDevice[msg.item.device_id || msg.item.frame] = msg.item;
        }
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
      } else if (msg.type === "bc:sync_drag" && msg.payload) {
        broadcastToOtherFrames(null, msg.payload);
      } else if (msg.type === "bc:sync_click" && msg.payload) {
        broadcastToOtherFrames(null, msg.payload);
      } else if (msg.type === "bc:sync_key" && msg.payload) {
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

  function formatSingleInspectedBlock(header, item) {
    var boxStr = formatBoxString(item.box);
    var lines = [
      "[" + header + " — " + (item.device_name || item.frame || "—") + "]",
      "link: " + (item.url || state.url || ""),
      "device: " + (item.device_name || item.frame || "—")
    ];
    if (item.matchedBy) lines.push("match: " + item.matchedBy);
    if (item.section) lines.push("section: " + item.section);
    if (item.selector) lines.push("selector: " + item.selector);
    if (boxStr) lines.push("box: " + boxStr);
    if (item.stylesSummary) lines.push("styles: " + item.stylesSummary);
    lines.push("element: " + (item.html || ""));
    return lines.join("\n");
  }

  function formatInspectedClipboardText(item) {
    if (!item) return "";
    var mob = inspectedByTier.mobile;
    var desk = inspectedByTier.desktop;
    if (mob && desk) {
      return formatSingleInspectedBlock("VERSIÓN MÓVIL", mob) + "\n\n" + formatSingleInspectedBlock("VERSIÓN DESKTOP", desk);
    }
    var tierHdr = (item.tier === "mobile" ? "VERSIÓN MÓVIL" : "VERSIÓN DESKTOP");
    return formatSingleInspectedBlock(tierHdr, item);
  }

  function onCounterpartFound(data) {
    var dObj = BY_ID[data.frame];
    var devLabel = dObj ? (dObj.name + " (" + dObj.width + "×" + dObj.height + ")") : (data.frame || "");
    var endpoint = data.url || state.frameUrls[data.frame] || state.url || "";
    var tier = getDeviceTier(data.frame);
    var cpItem = {
      frame: data.frame,
      device_id: data.frame,
      device_name: devLabel,
      tier: tier,
      url: endpoint,
      tag: data.tag || "element",
      selector: data.selector || "",
      section: data.section || "",
      width: data.width || 0,
      height: data.height || 0,
      box: data.box || "",
      stylesSummary: data.stylesSummary || "",
      stylesMap: data.stylesMap || {},
      html: data.html || "",
      isCounterpart: true,
      matchedBy: data.matchedBy || "",
      notFoundInTemplate: !!data.notFoundInTemplate
    };
    inspectedByTier[tier] = cpItem;
    inspectedByDevice[data.frame] = cpItem;

    fetch("/api/inspected", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cpItem)
    }).catch(function () {});
    postCrossTab({ type: "bc:inspected_ping", item: cpItem });

    // Si el usuario acaba de inspeccionar en la otra versión (Móvil <-> Desktop), actualizar el portapapeles con ambas versiones
    if (state.inspector && lastInspectedElement && lastInspectedElement.tier !== tier) {
      var dualPayload = formatInspectedClipboardText(lastInspectedElement);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(dualPayload).catch(function () {});
      }
    }
  }

  function onInspectorPicked(data) {
    if (!state.inspector) return;
    var dObj = BY_ID[data.frame];
    var devLabel = dObj ? (dObj.name + " (" + dObj.width + "×" + dObj.height + ")") : (data.frame || "");
    var endpoint = data.url || state.frameUrls[data.frame] || state.url || "";
    var tier = getDeviceTier(data.frame);
    lastInspectedElement = {
      frame: data.frame,
      device_id: data.frame,
      device_name: devLabel,
      tier: tier,
      url: endpoint,
      tag: data.tag || "element",
      selector: data.selector || "",
      section: data.section || "",
      width: data.width || 0,
      height: data.height || 0,
      box: data.box || "",
      stylesSummary: data.stylesSummary || "",
      stylesMap: data.stylesMap || {},
      html: data.html || "",
      isCounterpart: false,
      matchedBy: "Selección directa del usuario"
    };
    inspectedByTier[tier] = lastInspectedElement;
    inspectedByDevice[data.frame] = lastInspectedElement;

    fetch("/api/inspected", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lastInspectedElement)
    }).catch(function () {});
    postCrossTab({ type: "bc:inspected_ping", item: lastInspectedElement });

    // Buscar automáticamente el elemento equivalente en los otros templates activos (Móvil <-> Desktop), incluyendo otros monitores
    if (data.identifiers) {
      broadcastToOtherFrames(data.frame, {
        type: "rv:find_counterpart",
        identifiers: data.identifiers
      });
      postCrossTab({
        type: "bc:find_counterpart",
        sourceFrame: data.frame,
        identifiers: data.identifiers
      });
    }

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

  function formatInspectedBlockForTier(title, item) {
    if (!item) return [];
    var out = [
      "### " + title + " — " + (item.device_name || item.frame || "—"),
      "- **URL / Ruta:** " + (item.url || state.url || "—"),
      "- **Estado en este template:** " + (item.matchedBy || (item.isCounterpart ? "Equivalente automático" : "Selección directa del usuario")),
      "- **Sección semántica:** " + (item.section || "—"),
      "- **Selector CSS:** `" + (item.selector || "—") + "`",
      "- **Layout Box:** `" + (formatBoxString(item.box) || "—") + "`",
      "- **Computed Styles:** `" + (item.stylesSummary || "—") + "`",
      "```html",
      item.html || "",
      "```",
      ""
    ];
    return out;
  }

  function formatTemplateProfileBlock(label, tpl) {
    if (!tpl) return [];
    var lines = [
      "### " + label + ": " + tpl.device_name + " (" + tpl.viewport + ")",
      "- **URL / Ruta cargada:** `" + (tpl.url || state.url || "—") + "`" + (tpl.title ? (' — Título: "' + tpl.title + '"') : ""),
      "- **Firma `<body>`:** `" + (tpl.bodySignature || "<body>") + "`",
      "- **Contenedores raíz del template:** " + ((tpl.rootContainers && tpl.rootContainers.length) ? tpl.rootContainers.map(function (c) { return "`" + c + "`"; }).join(", ") : "—"),
      "- **Hojas CSS cargadas:** " + ((tpl.stylesheets && tpl.stylesheets.length) ? tpl.stylesheets.map(function (s) { return "`" + s + "`"; }).join(", ") : "inline / internas"),
      "- **Secciones visibles (Landmarks):** " + ((tpl.landmarks && tpl.landmarks.length) ? tpl.landmarks.join(" · ") : "—")
    ];
    if (tpl.activeModal) {
      lines.push(
        "- **Modal / Diálogo abierto actualmente:** `" + tpl.activeModal.selector + "` (\"" + tpl.activeModal.title + "\", " + tpl.activeModal.box + ")"
      );
    }
    if (tpl.domOutline) {
      lines.push(
        "- **Estructura DOM del template (" + label + "):**",
        "```html",
        tpl.domOutline,
        "```"
      );
    }
    lines.push("");
    return lines;
  }

  function buildAiMarkdownReport() {
    var inc = getAiModalToggleMap();
    var nowStr = new Date().toLocaleTimeString();
    var activeSet = {};
    state.active.forEach(function (id) { activeSet[id] = true; });

    var activeDevs = state.active.map(function (id) {
      var d = BY_ID[id];
      return d ? ("[" + getDeviceTierTag(id) + "] " + d.name + " (" + d.width + "×" + d.height + " @" + d.dpr + "x)") : id;
    });

    // Priorizar siempre los templates de los dispositivos activos en esta ventana
    var mobileTpl = null;
    var desktopTpl = null;
    state.active.forEach(function (devId) {
      var tpl = templatesByDevice[devId];
      if (!tpl) return;
      if (tpl.tier === "mobile" && !mobileTpl) mobileTpl = tpl;
      if (tpl.tier === "desktop" && !desktopTpl) desktopTpl = tpl;
    });
    // Respaldo solo si hay otra ventana (popout) abierta con la misma URL
    Object.keys(templatesByDevice).forEach(function (devId) {
      var tpl = templatesByDevice[devId];
      if (!tpl) return;
      if (state.url && tpl.url && tpl.url.indexOf(state.url.replace(/\/$/, "")) === -1) return;
      if (tpl.tier === "mobile" && !mobileTpl) mobileTpl = tpl;
      if (tpl.tier === "desktop" && !desktopTpl) desktopTpl = tpl;
    });

    var md = [
      "# Reporte de Diagnóstico Web (Contexto Móvil + Desktop)",
      "- **URL activa:** " + (state.url || "—"),
      "- **Pantallas en esta ventana (" + activeDevs.length + "):** " + (activeDevs.join(", ") || "Ninguna"),
      "- **Hora de captura:** " + nowStr,
      ""
    ];

    if (inc.element) {
      md.push("## 1. Contexto de Templates (Versión Móvil vs. Versión Desktop) y Elemento Inspeccionado");

      if (mobileTpl || desktopTpl) {
        if (mobileTpl) {
          md = md.concat(formatTemplateProfileBlock("Template Versión Móvil", mobileTpl));
        } else {
          md.push("### Template Versión Móvil", "_Sin pantalla móvil activa actualmente._", "");
        }
        if (desktopTpl) {
          md = md.concat(formatTemplateProfileBlock("Template Versión Desktop", desktopTpl));
        } else {
          md.push("### Template Versión Desktop", "_Sin pantalla desktop activa actualmente._", "");
        }
      }

      var mobInsp = inspectedByTier.mobile;
      var deskInsp = inspectedByTier.desktop;
      if (mobInsp || deskInsp || lastInspectedElement) {
        if (mobInsp) {
          md = md.concat(formatInspectedBlockForTier("Elemento en Versión Móvil", mobInsp));
        }
        if (deskInsp) {
          md = md.concat(formatInspectedBlockForTier("Elemento Equivalente en Versión Desktop", deskInsp));
        }
        if (!mobInsp && !deskInsp && lastInspectedElement) {
          md = md.concat(formatInspectedBlockForTier("Último Elemento Inspeccionado", lastInspectedElement));
        }
      } else {
        md.push("_Ningún elemento puntual seleccionado con el Inspector (se incluye arriba la estructura DOM de ambos templates Móvil y Desktop)._", "");
      }
    }

    if (inc.console) {
      var seenConsoleKeys = {};
      var activeConsole = consoleState.items.filter(function (c) {
        if (state.active.length && !activeSet[c.device_id]) return false;
        var msg = (c.message || "").trim();
        if (msg === "Script error." || msg === "Script error") return false;
        var dedupKey = c.device_id + "|" + c.level + "|" + msg;
        if (seenConsoleKeys[dedupKey]) return false;
        seenConsoleKeys[dedupKey] = true;
        return true;
      });
      var errWarns = activeConsole.filter(function (c) {
        return c.level === "error" || c.level === "warn";
      }).slice(-15);
      var recentLogs = errWarns.length ? errWarns : activeConsole.slice(-10);
      md.push("## 2. Consola del Navegador por Versión (" + errWarns.length + " errores/warnings)");
      if (recentLogs.length) {
        recentLogs.forEach(function (c) {
          var tierTag = getDeviceTierTag(c.device_id);
          md.push("- **[" + c.level.toUpperCase() + "]** **[" + tierTag + " · " + c.device_name + "]** (" + c.time + "): `" + (c.message || "").replace(/\n/g, " ") + "`" + (c.source ? " _[" + c.source + "]_" : ""));
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
      var activeTraffic = trafficState.items.filter(function (r) {
        return !state.active.length || activeSet[r.device_id];
      });
      // Ignorar errores HTTP antiguos (ej. 503 de mantenimiento) si la misma URL ya respondió 200 después en ese dispositivo
      var latestStatusByReq = {};
      activeTraffic.forEach(function (r) {
        latestStatusByReq[r.device_id + "|" + r.method + "|" + r.url] = r.status;
      });
      var failedHttp = activeTraffic.filter(function (r) {
        if (r.status < 400 && r.status !== 0) return false;
        var latestSt = latestStatusByReq[r.device_id + "|" + r.method + "|" + r.url];
        return latestSt >= 400 || latestSt === 0;
      }).slice(-10);
      var recentHttp = activeTraffic.slice(-8);
      md.push("## 3. Tráfico HTTP / API por Versión (" + failedHttp.length + " peticiones fallidas 4xx/5xx)");
      if (failedHttp.length) {
        md.push("### Peticiones con error (4xx / 5xx):");
        failedHttp.forEach(function (r) {
          var tierTag = getDeviceTierTag(r.device_id);
          md.push(
            "- **[" + tierTag + " · " + r.device_name + "]** **" + r.method + " " + r.url + "** → **HTTP " + r.status + "** (" + r.duration_ms + " ms)",
            "  - Response Body: `" + ((r.res_body || "").slice(0, 260).replace(/\s+/g, " ") || "vacío") + "`"
          );
        });
      }
      if (recentHttp.length) {
        md.push("### Últimas peticiones HTTP:");
        recentHttp.forEach(function (r) {
          var tierTag = getDeviceTierTag(r.device_id);
          md.push("- **[" + tierTag + " · " + r.device_name + "]** `" + r.method + "` `" + r.path + "` → **" + r.status + "** (" + r.mime + ", " + r.duration_ms + " ms)");
        });
      } else {
        md.push("_Sin tráfico HTTP registrado._");
      }
      md.push("");
    }

    if (inc.audit) {
      var activeAudit = auditState.items.filter(function (a) {
        return !state.active.length || activeSet[a.device_id];
      });
      md.push("## 4. Auditoría Visual y Responsiva (Móvil vs. Desktop · " + activeAudit.length + " hallazgos)");
      if (activeAudit.length) {
        activeAudit.slice(0, 15).forEach(function (a) {
          var tierTag = getDeviceTierTag(a.device_id);
          md.push("- **[" + tierTag + " · " + a.device_name + "]** **[" + a.kind + "]** (`" + a.selector + "`): " + a.summary + " — _" + a.detail + "_");
        });
      } else {
        md.push("_Sin desbordamientos horizontales ni imágenes rotas detectadas._");
      }
      md.push("");
    }

    if (inc.flow) {
      var activeSteps = flowState.items.filter(function (st) {
        return !state.active.length || activeSet[st.device_id];
      }).slice(-20);
      md.push("## 5. Rastreador de Interacciones del Usuario (Clics, Scroll, Zona y Sección en Móvil y Desktop)");
      if (activeSteps.length) {
        activeSteps.forEach(function (st, idx) {
          var tierTag = getDeviceTierTag(st.device_id);
          md.push(formatFlowStepLine(st, idx + 1) + " **[" + tierTag + "]**");
        });
      } else {
        md.push("_Sin interacciones registradas aún._");
      }
      md.push("");
    }

    if (inc.storage) {
      var activeStorage = storageState.rows.filter(function (row) {
        return row.device_id === "all" || !state.active.length || activeSet[row.device_id];
      });
      md.push("## 6. Estado de Sesión (Cookies, Storage y JWT por Versión)");
      if (activeStorage.length) {
        activeStorage.slice(0, 15).forEach(function (row) {
          var tierTag = row.device_id === "all" ? "GLOBAL" : getDeviceTierTag(row.device_id);
          var jwtInfo = row.jwt && row.jwt.expStatus ? (" — **JWT: " + row.jwt.expStatus.summary + "**") : "";
          md.push("- **[" + tierTag + " · " + row.device_name + "]** **[" + row.scope + "]** `" + row.key + "` = `" + String(row.value).slice(0, 90) + "`" + jwtInfo);
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
      fetch("/api/storage", { credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch("/api/templates", { credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (results) {
      if (results[0]) {
        if (results[0].item) lastInspectedElement = results[0].item;
        if (results[0].by_tier) {
          if (results[0].by_tier.mobile) inspectedByTier.mobile = results[0].by_tier.mobile;
          if (results[0].by_tier.desktop) inspectedByTier.desktop = results[0].by_tier.desktop;
        }
        if (results[0].by_device) {
          inspectedByDevice = results[0].by_device;
        }
      }
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
      if (results[4] && Array.isArray(results[4].items)) {
        results[4].items.forEach(function (it) {
          templatesByDevice[it.device_id] = it;
        });
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

  function canDrawImageSafely(imgEl) {
    try {
      // Crear un canvas de prueba nuevo cada vez: si un canvas se contamina (tainted)
      // con una imagen cross-origin una sola vez, getImageData fallaría para siempre.
      var c = document.createElement("canvas");
      c.width = 1;
      c.height = 1;
      var cctx = c.getContext("2d");
      cctx.drawImage(imgEl, 0, 0, 1, 1);
      cctx.getImageData(0, 0, 1, 1);
      return true;
    } catch (_e) {
      return false;
    }
  }

  function extractCssUrl(bgImage) {
    if (!bgImage || bgImage === "none") return "";
    var m = bgImage.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/i);
    return (m && m[1]) ? m[1].trim() : "";
  }

  function toProxyAssetUrl(rawUrl, frameId, baseHref) {
    if (!rawUrl) return "";
    if (rawUrl.indexOf("data:") === 0 || rawUrl.indexOf("blob:") === 0) return rawUrl;
    var resolved = rawUrl;
    try {
      resolved = new URL(rawUrl, baseHref || state.url || location.href).href;
    } catch (_e) {
      resolved = rawUrl;
    }
    if (resolved.indexOf(location.origin + "/") === 0) {
      return resolved;
    }
    if (/^https?:\/\//i.test(resolved)) {
      return "/proxy?url=" + encodeURIComponent(resolved) + "&frame=" + encodeURIComponent(frameId || "");
    }
    return resolved;
  }

  var snapshotImageCache = {};

  function loadSafeImage(src, timeoutMs) {
    if (!src) return Promise.resolve(null);
    if (src.indexOf("data:") !== 0 && snapshotImageCache[src]) {
      return Promise.resolve(snapshotImageCache[src]);
    }
    return new Promise(function (resolve) {
      var img = new Image();
      img.crossOrigin = "anonymous";
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        resolve(null);
      }, timeoutMs || 1100);
      img.onload = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (img.naturalWidth > 0 && canDrawImageSafely(img)) {
          if (src.indexOf("data:") !== 0) {
            snapshotImageCache[src] = img;
          }
          resolve(img);
        } else {
          resolve(null);
        }
      };
      img.onerror = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(null);
      };
      img.src = src;
    });
  }

  function serializeSvgToDataUrl(svgEl, win) {
    try {
      var clone = svgEl.cloneNode(true);
      var rect = svgEl.getBoundingClientRect();
      var cs = win.getComputedStyle(svgEl);
      if (!clone.getAttribute("xmlns")) {
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      }
      clone.setAttribute("width", String(Math.max(1, Math.round(rect.width || 24))));
      clone.setAttribute("height", String(Math.max(1, Math.round(rect.height || 24))));
      if (cs && cs.color) {
        clone.style.color = cs.color;
      }
      var origChildren = svgEl.querySelectorAll("*");
      var cloneChildren = clone.querySelectorAll("*");
      for (var i = 0; i < origChildren.length && i < cloneChildren.length; i++) {
        var oCs = win.getComputedStyle(origChildren[i]);
        var cEl = cloneChildren[i];
        if (oCs) {
          if (oCs.fill && oCs.fill !== "none") cEl.setAttribute("fill", oCs.fill);
          if (oCs.stroke && oCs.stroke !== "none") {
            cEl.setAttribute("stroke", oCs.stroke);
            if (oCs.strokeWidth) cEl.setAttribute("stroke-width", oCs.strokeWidth);
          }
        }
      }
      var xml = new XMLSerializer().serializeToString(clone);
      return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
    } catch (_e) {
      return "";
    }
  }

  function prepareFrameAssetsForSnapshot(id) {
    return new Promise(function (resolve) {
      var assetCache = { bgByUrl: {}, imgByEl: new Map(), svgByEl: new Map() };
      try {
        var e = els[id];
        var d = BY_ID[id];
        if (!e || !e.iframe || !d) return resolve(assetCache);
        var doc = null;
        var win = null;
        try {
          doc = e.iframe.contentDocument;
          win = e.iframe.contentWindow;
        } catch (_e) {
          doc = null;
          win = null;
        }
        if (!doc || !win || !doc.body) return resolve(assetCache);

        var vw = win.innerWidth || d.width;
        var vh = win.innerHeight || d.height;
        var baseHref = (doc.location && doc.location.href && doc.location.href !== "about:blank")
          ? doc.location.href
          : (state.frameUrls[id] || state.url || location.href);

        var tasks = [];
        var seenBgUrls = {};
        var allNodes = doc.body.querySelectorAll("*");
        var maxNodes = Math.min(allNodes.length, 2200);

        function queueBgImage(cs) {
          if (!cs) return;
          var rawUrl = extractCssUrl(cs.backgroundImage);
          if (!rawUrl || seenBgUrls[rawUrl]) return;
          seenBgUrls[rawUrl] = true;
          var proxied = toProxyAssetUrl(rawUrl, id, baseHref);
          tasks.push(loadSafeImage(proxied, 1100).then(function (img) {
            if (img) assetCache.bgByUrl[rawUrl] = img;
          }));
        }

        queueBgImage(win.getComputedStyle(doc.documentElement));
        queueBgImage(win.getComputedStyle(doc.body));

        for (var i = 0; i < maxNodes; i++) {
          var el = allNodes[i];
          var rect = el.getBoundingClientRect();
          if (rect.width < 1 || rect.height < 1) continue;
          if (rect.bottom < 0 || rect.right < 0 || rect.top > vh || rect.left > vw) continue;

          var tag = (el.tagName || "").toLowerCase();
          var cs = win.getComputedStyle(el);
          if (!cs || cs.display === "none" || cs.visibility === "hidden") continue;

          queueBgImage(cs);

          if (tag === "img") {
            (function (imgEl) {
              if (imgEl.complete && imgEl.naturalWidth > 0 && canDrawImageSafely(imgEl)) {
                assetCache.imgByEl.set(imgEl, imgEl);
                return;
              }
              var rawSrc = imgEl.currentSrc || imgEl.getAttribute("src") || imgEl.getAttribute("data-src") || "";
              if (!rawSrc) return;
              var proxiedSrc = toProxyAssetUrl(rawSrc, id, baseHref);
              tasks.push(loadSafeImage(proxiedSrc, 1100).then(function (loaded) {
                if (loaded) assetCache.imgByEl.set(imgEl, loaded);
              }));
            })(el);
          } else if (tag === "svg") {
            (function (svgEl) {
              var dataUrl = serializeSvgToDataUrl(svgEl, win);
              if (!dataUrl) return;
              tasks.push(loadSafeImage(dataUrl, 600).then(function (loaded) {
                if (loaded) assetCache.svgByEl.set(svgEl, loaded);
              }));
            })(el);
          }
        }

        if (!tasks.length) return resolve(assetCache);
        Promise.all(tasks).then(function () {
          resolve(assetCache);
        }).catch(function () {
          resolve(assetCache);
        });
      } catch (_err) {
        resolve(assetCache);
      }
    });
  }

  function drawImageWithFit(ctx, img, x, y, w, h, fitMode) {
    if (!img || w <= 0 || h <= 0) return;
    var iw = img.naturalWidth || img.width || w;
    var ih = img.naturalHeight || img.height || h;
    if (iw <= 0 || ih <= 0) return;

    var mode = (fitMode || "").toLowerCase();
    if (mode.indexOf("cover") > -1) {
      var scaleCover = Math.max(w / iw, h / ih);
      var sw = w / scaleCover;
      var sh = h / scaleCover;
      var sx = Math.max(0, (iw - sw) / 2);
      var sy = Math.max(0, (ih - sh) / 2);
      ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
    } else if (mode.indexOf("contain") > -1) {
      var scaleContain = Math.min(w / iw, h / ih);
      var dw = iw * scaleContain;
      var dh = ih * scaleContain;
      var dx = x + (w - dw) / 2;
      var dy = y + (h - dh) / 2;
      ctx.drawImage(img, dx, dy, dw, dh);
    } else {
      ctx.drawImage(img, x, y, w, h);
    }
  }

  function paintPseudoOverlay(ctx, pseudoCs, nx, ny, nw, nh, radius, assetCache) {
    if (!pseudoCs) return;
    var content = pseudoCs.content;
    if (!content || content === "none" || content === "normal") return;
    var op = parseFloat(pseudoCs.opacity);
    if (!isNaN(op) && op <= 0.01) return;

    var bgCol = pseudoCs.backgroundColor;
    var bgUrl = extractCssUrl(pseudoCs.backgroundImage);
    var gradCols = extractGradientColors(pseudoCs.backgroundImage);
    var hasBgCol = !isTransparentColor(bgCol);
    var bgImg = (bgUrl && assetCache && assetCache.bgByUrl) ? assetCache.bgByUrl[bgUrl] : null;

    if (!hasBgCol && !gradCols && !bgImg) return;

    ctx.save();
    if (!isNaN(op) && op < 1) ctx.globalAlpha *= op;
    traceRoundRect(ctx, nx, ny, nw, nh, radius);
    ctx.clip();

    if (hasBgCol) {
      ctx.fillStyle = bgCol;
      ctx.fillRect(nx, ny, nw, nh);
    }
    if (bgImg) {
      try {
        drawImageWithFit(ctx, bgImg, nx, ny, nw, nh, pseudoCs.backgroundSize || "cover");
      } catch (_e) {}
    }
    if (gradCols) {
      var grad = ctx.createLinearGradient(nx, ny, nx, ny + nh);
      grad.addColorStop(0, gradCols[0]);
      grad.addColorStop(1, gradCols[1]);
      ctx.fillStyle = grad;
      ctx.fillRect(nx, ny, nw, nh);
    }
    ctx.restore();
  }

  function paintLiveIframeDom(ctx, iframe, dx, dy, dw, dh, dWidth, dHeight, fallbackSnap, assetCache) {
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
      var bgColFallback = (fallbackSnap && (fallbackSnap.bgPage || fallbackSnap.bg) && !isTransparentColor(fallbackSnap.bgPage || fallbackSnap.bg))
        ? (fallbackSnap.bgPage || fallbackSnap.bg)
        : "#FFFFFF";
      ctx.fillStyle = bgColFallback;
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

    var bodyBgUrl = extractCssUrl(bodyCs && bodyCs.backgroundImage) || extractCssUrl(htmlCs && htmlCs.backgroundImage);
    if (bodyBgUrl && assetCache && assetCache.bgByUrl && assetCache.bgByUrl[bodyBgUrl]) {
      try {
        drawImageWithFit(ctx, assetCache.bgByUrl[bodyBgUrl], dx, dy, dw, dh, (bodyCs && bodyCs.backgroundSize) || "cover");
      } catch (_e) {}
    }

    var vw = win.innerWidth || dWidth;
    var vh = win.innerHeight || dHeight;

    // 2. Recorrer todos los elementos del DOM manteniendo el orden jerárquico natural (padres antes que hijos)
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
          if (zVal >= 100 || MODAL_HINT_RE.test(clsAndId)) {
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

      // IMPORTANTE: No elevar elementos con position:relative al tier 1 por encima de sus propios hijos estáticos,
      // de lo contrario el fondo del contenedor padre tapa las imágenes y textos internos.
      if (isModalTree) {
        tier = 2;
      } else if (isFixedTree) {
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

    // 3. Ordenar respetando el orden DOM dentro de cada capa (flujo/relativo -> fixed -> modales)
    items.sort(function (a, b) {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.tier > 0 && a.effZ !== b.effZ) return a.effZ - b.effZ;
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

      var cx = dx + Math.max(0, it.clipBox.left) * scale;
      var cy = dy + Math.max(0, it.clipBox.top) * scale;
      var cw = Math.min(vw, it.clipBox.right) * scale - Math.max(0, it.clipBox.left) * scale;
      var ch = Math.min(vh, it.clipBox.bottom) * scale - Math.max(0, it.clipBox.top) * scale;
      ctx.beginPath();
      ctx.rect(cx, cy, Math.max(1, cw), Math.max(1, ch));
      ctx.clip();

      ctx.globalAlpha = Math.max(0, Math.min(1, it.effOpacity));

      if (tag === "dialog") {
        var bdCs = win.getComputedStyle(el, "::backdrop");
        var bdCol = (bdCs && !isTransparentColor(bdCs.backgroundColor)) ? bdCs.backgroundColor : "rgba(15, 23, 42, 0.45)";
        ctx.fillStyle = bdCol;
        ctx.fillRect(dx, dy, dw, dh);
      }

      var radius = parseCssRadius(cs.borderTopLeftRadius || cs.borderRadius, nw, nh);

      // Sombra (box-shadow)
      var bShadow = cs.boxShadow;
      if (bShadow && bShadow !== "none" && bShadow.indexOf("inset") === -1) {
        var shColMatch = bShadow.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8})/);
        if (shColMatch) {
          ctx.save();
          ctx.shadowColor = shColMatch[0];
          ctx.shadowBlur = Math.min(20, (it.tier >= 2 ? 16 : 6) * scale);
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = (it.tier >= 2 ? 5 : 2) * scale;
          traceRoundRect(ctx, nx, ny, nw, nh, radius);
          ctx.fillStyle = !isTransparentColor(cs.backgroundColor) ? cs.backgroundColor : "rgba(255,255,255,0.01)";
          ctx.fill();
          ctx.restore();
        }
      }

      // Color de fondo sólido
      var bgCol = cs.backgroundColor;
      if (!isTransparentColor(bgCol)) {
        traceRoundRect(ctx, nx, ny, nw, nh, radius);
        ctx.fillStyle = bgCol;
        ctx.fill();
      } else if (it.tier >= 1 && ((cs.backdropFilter && cs.backdropFilter !== "none") || (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== "none"))) {
        traceRoundRect(ctx, nx, ny, nw, nh, radius);
        ctx.fillStyle = "rgba(15, 23, 42, 0.25)";
        ctx.fill();
      }

      // Imagen de fondo CSS (background-image: url(...))
      var elBgUrl = extractCssUrl(cs.backgroundImage);
      var elBgImg = (elBgUrl && assetCache && assetCache.bgByUrl) ? assetCache.bgByUrl[elBgUrl] : null;
      if (elBgImg) {
        try {
          ctx.save();
          traceRoundRect(ctx, nx, ny, nw, nh, radius);
          ctx.clip();
          drawImageWithFit(ctx, elBgImg, nx, ny, nw, nh, cs.backgroundSize || "cover");
          ctx.restore();
        } catch (_e) {}
      }

      // Gradiente CSS (linear-gradient / radial-gradient)
      var gradCols = extractGradientColors(cs.backgroundImage);
      if (gradCols) {
        var grad = ctx.createLinearGradient(nx, ny, nx, ny + nh);
        grad.addColorStop(0, gradCols[0]);
        grad.addColorStop(1, gradCols[1]);
        traceRoundRect(ctx, nx, ny, nw, nh, radius);
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // Pseudo-elemento ::before (muy usado para overlays oscuros sobre imágenes/banners)
      try {
        var beforeCs = win.getComputedStyle(el, "::before");
        paintPseudoOverlay(ctx, beforeCs, nx, ny, nw, nh, radius, assetCache);
      } catch (_e) {}

      // Imágenes reales (<img>, <canvas>, <svg>)
      if (tag === "img") {
        var drawnImg = false;
        var cachedImg = (assetCache && assetCache.imgByEl && assetCache.imgByEl.get(el)) ||
                        ((el.complete && el.naturalWidth > 0 && canDrawImageSafely(el)) ? el : null);
        if (cachedImg) {
          try {
            ctx.save();
            traceRoundRect(ctx, nx, ny, nw, nh, radius);
            ctx.clip();
            drawImageWithFit(ctx, cachedImg, nx, ny, nw, nh, cs.objectFit || "fill");
            ctx.restore();
            drawnImg = true;
          } catch (_e) {
            drawnImg = false;
          }
        }
        if (!drawnImg) {
          traceRoundRect(ctx, nx, ny, nw, nh, radius);
          ctx.fillStyle = "rgba(148, 163, 184, 0.16)";
          ctx.fill();
        }
      } else if (tag === "canvas") {
        if (canDrawImageSafely(el)) {
          try {
            ctx.drawImage(el, nx, ny, nw, nh);
          } catch (_e) {}
        }
      } else if (tag === "svg") {
        var svgImg = assetCache && assetCache.svgByEl ? assetCache.svgByEl.get(el) : null;
        if (svgImg) {
          try {
            ctx.drawImage(svgImg, nx, ny, nw, nh);
          } catch (_e) {}
        } else if (typeof Path2D !== "undefined") {
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
            var fSizeIn = Math.max(5.5, Math.min(28, (parseFloat(cs.fontSize) || 13) * scale));
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
        var fSize = Math.max(4.5, Math.min(48, (parseFloat(cs.fontSize) || 13) * scale));
        var fwNum = parseInt(cs.fontWeight || "400", 10);
        var fStyle = (cs.fontStyle === "italic" ? "italic " : "");
        var fWeight = (!isNaN(fwNum) && fwNum >= 600) || cs.fontWeight === "bold" ? "600 " : "400 ";
        ctx.font = fStyle + fWeight + fSize + "px " + (cs.fontFamily || "-apple-system, BlinkMacSystemFont, sans-serif");
        ctx.fillStyle = cs.color || "#1B1F1D";
        ctx.textBaseline = "alphabetic";

        var tShadow = cs.textShadow;
        var hasTextShadow = tShadow && tShadow !== "none";
        if (hasTextShadow) {
          var tsCol = tShadow.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8})/);
          if (tsCol) {
            ctx.shadowColor = tsCol[0];
            ctx.shadowBlur = 4 * scale;
          }
        }

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
        if (hasTextShadow) {
          ctx.shadowColor = "transparent";
          ctx.shadowBlur = 0;
        }
      }

      // Pseudo-elemento ::after
      try {
        var afterCs = win.getComputedStyle(el, "::after");
        paintPseudoOverlay(ctx, afterCs, nx, ny, nw, nh, radius, assetCache);
      } catch (_e) {}

      ctx.restore();
    }
  }

  function paintCuttingMatBackground(ctx, x, y, w, h) {
    ctx.save();
    ctx.fillStyle = "#1F4D45";
    ctx.fillRect(x, y, w, h);

    ctx.strokeStyle = "rgba(232, 239, 235, 0.05)";
    ctx.lineWidth = 1;
    for (var gx = x; gx < x + w; gx += 20) {
      ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); ctx.stroke();
    }
    for (var gy = y; gy < y + h; gy += 20) {
      ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); ctx.stroke();
    }

    ctx.strokeStyle = "rgba(232, 239, 235, 0.11)";
    ctx.lineWidth = 1;
    for (var mx = x; mx < x + w; mx += 100) {
      ctx.beginPath(); ctx.moveTo(mx, y); ctx.lineTo(mx, y + h); ctx.stroke();
    }
    for (var my = y; my < y + h; my += 100) {
      ctx.beginPath(); ctx.moveTo(x, my); ctx.lineTo(x + w, my); ctx.stroke();
    }
    ctx.restore();
  }

  function paintDeviceFrameOnMat(ctx, id, stageRect, offsetX, offsetY, snapByFrame, assetsByFrame) {
    var e = els[id];
    var d = BY_ID[id];
    if (!e || !d || !e.screen) return;
    var bezelEl = e.body || e.bezel || e.screen.parentElement || e.screen;
    var bezelRect = bezelEl.getBoundingClientRect();
    var screenRect = e.screen.getBoundingClientRect();

    var bx = bezelRect.left - stageRect.left + offsetX;
    var by = bezelRect.top - stageRect.top + offsetY;
    var bw = bezelRect.width;
    var bh = bezelRect.height;

    var dx = screenRect.left - stageRect.left + offsetX;
    var dy = screenRect.top - stageRect.top + offsetY;
    var dw = screenRect.width;
    var dh = screenRect.height;
    var col = deviceColor(id);
    var scale = dw / Math.max(1, d.width);

    var bezelCs = window.getComputedStyle(bezelEl);
    var screenCs = window.getComputedStyle(e.screen);
    var bezelRadius = parseCssRadius((bezelCs && (bezelCs.borderTopLeftRadius || bezelCs.borderRadius)) || "16px", bw, bh);
    var screenRadius = parseCssRadius((screenCs && (screenCs.borderTopLeftRadius || screenCs.borderRadius)) || "8px", dw, dh);

    // 1. Bezel físico oscuro del dispositivo + borde del color identificador tal como se ve en pantalla
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.36)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 8;
    traceRoundRect(ctx, bx, by, bw, bh, bezelRadius);
    ctx.fillStyle = "#121615";
    ctx.fill();
    ctx.restore();

    ctx.save();
    traceRoundRect(ctx, bx, by, bw, bh, bezelRadius);
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();

    // 2. Pantalla interna recortada con sus esquinas redondeadas reales
    ctx.save();
    traceRoundRect(ctx, dx, dy, dw, dh, screenRadius);
    ctx.clip();

    try {
      paintLiveIframeDom(ctx, e.iframe, dx, dy, dw, dh, d.width, d.height, snapByFrame[id], assetsByFrame[id]);
    } catch (_err) {
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(dx, dy, dw, dh);
    }

    // Anotaciones de Auditoría Visual (solo si el usuario activó el resaltado de auditoría)
    if (auditState.highlightOnScreens) {
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
    }

    ctx.restore();

    // 3. Etiqueta inferior del dispositivo sobre el tapete verde
    var capY = by + bh + 16;
    ctx.save();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(bx + 6, capY - 4, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#E8EFEB";
    ctx.font = "600 12px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(d.name, bx + 15, capY);
    var nameW = ctx.measureText(d.name).width;

    ctx.fillStyle = "rgba(232, 239, 235, 0.68)";
    ctx.font = "500 11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(d.width + " × " + d.height, bx + 15 + nameW + 8, capY);
    ctx.restore();
  }

  function renderLocalWindowSnapshotDataUrl() {
    if (!state.active.length) return Promise.resolve(null);
    return Promise.all([
      Promise.all(state.active.map(requestDomSnapshotFromFrame)),
      Promise.all(state.active.map(prepareFrameAssetsForSnapshot))
    ]).then(function (results) {
      var snapshots = results[0] || [];
      var assetsList = results[1] || [];
      var snapByFrame = {};
      var assetsByFrame = {};
      snapshots.forEach(function (s) {
        if (s && s.frame) snapByFrame[s.frame] = s;
      });
      state.active.forEach(function (id, idx) {
        assetsByFrame[id] = assetsList[idx] || { bgByUrl: {}, imgByEl: new Map(), svgByEl: new Map() };
      });

      var dpr = 2;
      var stageRect = stage.getBoundingClientRect();
      var w = Math.max(640, Math.round(stageRect.width));
      var h = Math.max(420, Math.round(stageRect.height));

      var c = document.createElement("canvas");
      c.width = w * dpr;
      c.height = h * dpr;
      var cctx = c.getContext("2d");
      cctx.scale(dpr, dpr);

      paintCuttingMatBackground(cctx, 0, 0, w, h);

      state.active.forEach(function (id) {
        paintDeviceFrameOnMat(cctx, id, stageRect, 0, 0, snapByFrame, assetsByFrame);
      });

      return {
        width: w,
        height: h,
        dataUrl: c.toDataURL("image/png")
      };
    }).catch(function () {
      return null;
    });
  }

  function collectRemoteWindowSnapshots(timeoutMs) {
    return new Promise(function (resolve) {
      if (!syncChannel) return resolve([]);
      var expectedCount = Object.keys(openSecondaryTabs).length || (windowSlot === "secondary" ? 1 : 0);
      var reqId = "snap-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
      var collected = [];
      var done = false;
      var waitMs = expectedCount > 0 ? (timeoutMs || 1100) : 90;

      function finish() {
        if (done) return;
        done = true;
        clearTimeout(timer);
        syncChannel.removeEventListener("message", onMsg);
        resolve(collected);
      }

      function onMsg(ev) {
        var msg = ev.data;
        if (!msg || msg.tabId === TAB_ID) return;
        if (msg.type === "bc:window_snapshot_response" && msg.requestId === reqId && msg.dataUrl) {
          collected.push(msg);
          if (expectedCount > 0 && collected.length >= expectedCount) {
            finish();
          }
        }
      }

      syncChannel.addEventListener("message", onMsg);
      postCrossTab({ type: "bc:request_window_snapshot", requestId: reqId });
      var timer = setTimeout(finish, waitMs);
    });
  }

  function captureAnnotatedSnapshot() {
    if (!state.active.length) {
      toast(t("toastNoDevices"));
      return;
    }

    toast(I18N.getLang() === "es" ? "Generando captura…" : "Generating snapshot…");

    var hasOtherWindows = Object.keys(openSecondaryTabs).length > 0 || windowSlot === "secondary";
    var remoteWaitMs = hasOtherWindows ? 1100 : 90;

    Promise.all([
      Promise.all(state.active.map(requestDomSnapshotFromFrame)),
      Promise.all(state.active.map(prepareFrameAssetsForSnapshot)),
      collectRemoteWindowSnapshots(remoteWaitMs)
    ]).then(function (allResults) {
      var snapshots = allResults[0] || [];
      var assetsList = allResults[1] || [];
      var remoteSnaps = allResults[2] || [];

      var snapByFrame = {};
      var assetsByFrame = {};
      snapshots.forEach(function (s) {
        if (s && s.frame) snapByFrame[s.frame] = s;
      });
      state.active.forEach(function (id, idx) {
        assetsByFrame[id] = assetsList[idx] || { bgByUrl: {}, imgByEl: new Map(), svgByEl: new Map() };
      });

      return Promise.all(remoteSnaps.map(function (rs) {
        return loadSafeImage(rs.dataUrl, 1000).then(function (img) {
          return img ? { meta: rs, img: img } : null;
        });
      })).then(function (loadedRemotes) {
        var validRemotes = loadedRemotes.filter(Boolean);

        var dpr = 2;
        var stageRect = stage.getBoundingClientRect();
        var headerH = 48;
        var footerH = 36;
        var sectionBannerH = 32;

        var localW = Math.max(960, Math.round(stageRect.width));
        var localH = Math.max(500, Math.round(stageRect.height));

        var maxW = localW;
        var remotesTotalH = 0;
        validRemotes.forEach(function (r) {
          maxW = Math.max(maxW, r.meta.width || 960);
          remotesTotalH += sectionBannerH + (r.meta.height || 500);
        });

        var canvasW = maxW;
        var canvasH = headerH + (validRemotes.length ? sectionBannerH : 0) + localH + remotesTotalH + footerH;

        var canvas = document.createElement("canvas");
        canvas.width = canvasW * dpr;
        canvas.height = canvasH * dpr;
        var ctx = canvas.getContext("2d");
        ctx.scale(dpr, dpr);

        paintCuttingMatBackground(ctx, 0, headerH, canvasW, canvasH - headerH - footerH);

        // Barra superior oscura acorde al modo consola/tapete
        ctx.fillStyle = "#161B19";
        ctx.fillRect(0, 0, canvasW, headerH);
        ctx.strokeStyle = "rgba(232, 239, 235, 0.14)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, headerH); ctx.lineTo(canvasW, headerH); ctx.stroke();

        var totalDevicesCount = state.active.length;
        validRemotes.forEach(function (r) {
          totalDevicesCount += (r.meta.deviceCount || 0);
        });
        var windowsCount = 1 + validRemotes.length;

        ctx.fillStyle = "#F1F5F3";
        ctx.font = "600 13.5px -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.fillText(
          "DevTool Multi-Display — Captura Real (" + windowsCount + (windowsCount === 1 ? " pantalla" : " pantallas / monitores") + ")",
          16,
          20
        );

        ctx.fillStyle = "#9BA8A2";
        ctx.font = "500 11.5px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.fillText(
          "URL: " + (state.url || "—") + "   |   Dispositivos capturados: " + totalDevicesCount + "   |   Auditoría: " + auditState.items.length + " hallazgos",
          16,
          38
        );

        var curY = headerH;

        // Si hay más de una pantalla abierta, rotular cada sección
        if (validRemotes.length > 0) {
          ctx.fillStyle = "rgba(18, 22, 21, 0.72)";
          ctx.fillRect(0, curY, canvasW, sectionBannerH);
          ctx.fillStyle = "#34D399";
          ctx.font = "600 11.5px ui-monospace, SFMono-Regular, Menlo, monospace";
          var localTitle = windowSlot === "secondary" ? "VENTANA ACTUAL (2DA PANTALLA / MONITOR VERTICAL)" : "VENTANA ACTUAL (PANTALLA PRINCIPAL)";
          var localDevs = state.active.map(function (id) {
            var d = BY_ID[id];
            return d ? (d.name + " " + d.width + "×" + d.height) : id;
          }).join(" · ");
          ctx.fillText(localTitle + " — " + localDevs, 16, curY + 20);
          curY += sectionBannerH;
        }

        var localOffsetX = Math.max(0, Math.round((canvasW - stageRect.width) / 2));
        state.active.forEach(function (id) {
          paintDeviceFrameOnMat(ctx, id, stageRect, localOffsetX, curY, snapByFrame, assetsByFrame);
        });
        curY += localH;

        // Dibujar cada una de las otras ventanas / monitores abiertos
        validRemotes.forEach(function (r, rIdx) {
          ctx.fillStyle = "rgba(18, 22, 21, 0.82)";
          ctx.fillRect(0, curY, canvasW, sectionBannerH);
          ctx.strokeStyle = "rgba(232, 239, 235, 0.16)";
          ctx.beginPath(); ctx.moveTo(0, curY); ctx.lineTo(canvasW, curY); ctx.stroke();

          ctx.fillStyle = "#60A5FA";
          ctx.font = "600 11.5px ui-monospace, SFMono-Regular, Menlo, monospace";
          var remTitle = (r.meta.windowTitle || ("PANTALLA EXTERNA #" + (rIdx + 2))).toUpperCase();
          var remDevs = Array.isArray(r.meta.devices) ? r.meta.devices.join(" · ") : "";
          ctx.fillText(remTitle + (remDevs ? (" — " + remDevs) : ""), 16, curY + 20);
          curY += sectionBannerH;

          var rw = r.meta.width || localW;
          var rh = r.meta.height || localH;
          var rx = Math.max(0, Math.round((canvasW - rw) / 2));
          ctx.drawImage(r.img, rx, curY, rw, rh);
          curY += rh;
        });

        // Barra inferior con resumen de Consola y HTTP
        ctx.fillStyle = "#161B19";
        ctx.fillRect(0, canvasH - footerH, canvasW, footerH);
        ctx.strokeStyle = "rgba(232, 239, 235, 0.14)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, canvasH - footerH); ctx.lineTo(canvasW, canvasH - footerH); ctx.stroke();

        var errCount = consoleState.items.filter(function (c) { return c.level === "error"; }).length;
        var httpErrCount = trafficState.items.filter(function (r) { return r.status >= 400; }).length;
        var inspText = lastInspectedElement
          ? ("Último elemento: " + lastInspectedElement.selector + " [" + lastInspectedElement.device_name + "]")
          : "Sin elemento inspeccionado";
        ctx.fillStyle = "#C6D1CC";
        ctx.font = "500 11px ui-monospace, monospace";
        ctx.fillText(
          "Errores Consola: " + errCount + "   |   HTTP 4xx/5xx: " + httpErrCount + "   |   " + inspText,
          16,
          canvasH - 13
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
    }).catch(function (err) {
      console.error("Snapshot error:", err);
      toast("Error al generar la captura");
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

  // ---------- Certificado Cliente (.p12 / .pfx) para mTLS en Desarrollo ----------
  var certState = { active: false, filename: "" };

  function renderCertState(cert) {
    certState = cert || { active: false };
    var isActive = !!certState.active;
    if (certBtn) {
      certBtn.classList.toggle("is-active", isActive);
      certBtn.setAttribute("aria-pressed", isActive ? "true" : "false");
      certBtn.title = isActive && certState.filename
        ? "Certificado mTLS activo: " + certState.filename
        : t("certHint");
    }
    if (certBtnLabel) {
      certBtnLabel.textContent = ".p12";
    }
    if (certActiveBanner) {
      certActiveBanner.hidden = !isActive;
    }
    if (certActiveFilename) {
      certActiveFilename.textContent = certState.filename || "certificado.p12";
    }
    if (certActiveMeta) {
      var metaLines = [];
      if (certState.subject) metaLines.push("Subject: " + certState.subject);
      if (certState.issuer) metaLines.push("Issuer: " + certState.issuer);
      if (certState.not_after) metaLines.push("Expira: " + certState.not_after);
      certActiveMeta.textContent = metaLines.join(" | ");
    }
    if (certRemoveBtn) {
      certRemoveBtn.hidden = !isActive;
    }
    if (certProxyAssets && typeof certState.proxy_assets === "boolean") {
      certProxyAssets.checked = certState.proxy_assets;
    }
    if (certAllowSelfSigned && typeof certState.verify_ssl === "boolean") {
      certAllowSelfSigned.checked = !certState.verify_ssl;
    }
  }

  function fetchCertStatus() {
    fetch("/api/cert", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data && data.cert) renderCertState(data.cert);
      })
      .catch(function () {});
  }

  function reloadAllFramesForCert() {
    if (!state.url) return;
    state.active.forEach(function (id) {
      navigateFrame(id, state.frameUrls[id] || state.url, true);
    });
  }

  if (certBtn) {
    certBtn.addEventListener("click", function () {
      if (certErrorBox) certErrorBox.hidden = true;
      fetchCertStatus();
      if (certModal) certModal.hidden = false;
    });
  }
  if (certModalClose) {
    certModalClose.addEventListener("click", function () {
      if (certModal) certModal.hidden = true;
    });
  }
  if (certModal) {
    certModal.addEventListener("click", function (ev) {
      if (ev.target === certModal) certModal.hidden = true;
    });
  }

  if (certApplyBtn) {
    certApplyBtn.addEventListener("click", function () {
      if (certErrorBox) certErrorBox.hidden = true;
      var file = certFileInput && certFileInput.files && certFileInput.files[0];
      var pathVal = certPathInput ? certPathInput.value.trim() : "";
      var passVal = certPassInput ? certPassInput.value : "";
      var verifySsl = certAllowSelfSigned ? !certAllowSelfSigned.checked : false;
      var proxyAssets = certProxyAssets ? !!certProxyAssets.checked : true;

      var reqPromise;
      if (file) {
        var fd = new FormData();
        fd.append("file", file);
        fd.append("password", passVal);
        fd.append("verify_ssl", verifySsl ? "true" : "false");
        fd.append("proxy_assets", proxyAssets ? "true" : "false");
        reqPromise = fetch("/api/cert", {
          method: "POST",
          credentials: "same-origin",
          body: fd
        });
      } else if (pathVal) {
        reqPromise = fetch("/api/cert", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: pathVal,
            password: passVal,
            verify_ssl: verifySsl,
            proxy_assets: proxyAssets
          })
        });
      } else if (certState.active) {
        reqPromise = fetch("/api/cert", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            verify_ssl: verifySsl,
            proxy_assets: proxyAssets
          })
        });
      } else {
        if (certErrorBox) {
          certErrorBox.textContent = "Selecciona un archivo .p12 / .pfx o escribe su ruta local.";
          certErrorBox.hidden = false;
        }
        return;
      }

      certApplyBtn.disabled = true;
      reqPromise
        .then(function (r) { return r.json(); })
        .then(function (res) {
          certApplyBtn.disabled = false;
          if (!res || !res.ok) {
            if (certErrorBox) {
              certErrorBox.textContent = (res && res.error) || "Error al procesar el certificado .p12.";
              certErrorBox.hidden = false;
            }
            return;
          }
          renderCertState(res.cert);
          if (certModal) certModal.hidden = true;
          toast(t("certActivated"));
          reloadAllFramesForCert();
          postCrossTab({ type: "bc:reload" });
        })
        .catch(function () {
          certApplyBtn.disabled = false;
          if (certErrorBox) {
            certErrorBox.textContent = "No se pudo conectar con el servidor local para activar el certificado.";
            certErrorBox.hidden = false;
          }
        });
    });
  }

  if (certRemoveBtn) {
    certRemoveBtn.addEventListener("click", function () {
      fetch("/api/cert/clear", { method: "POST", credentials: "same-origin" })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res && res.cert) renderCertState(res.cert);
          if (certFileInput) certFileInput.value = "";
          if (certPathInput) certPathInput.value = "";
          if (certPassInput) certPassInput.value = "";
          if (certModal) certModal.hidden = true;
          toast(t("certRemoved"));
          reloadAllFramesForCert();
          postCrossTab({ type: "bc:reload" });
        })
        .catch(function () {});
    });
  }

  fetchCertStatus();

  // ---------- Menú Agregar dispositivo ----------
  var secondaryBarWrap = null;
  var secondaryBarBtn = null;

  updateSecondaryMenuBar = function () {
    if (!secondaryBarWrap || !secondaryBarBtn) return;
    if (windowSlot === "secondary") {
      secondaryBarWrap.hidden = true;
      return;
    }
    var secIds = getSavedSecondaryDevices();
    if (!secIds.length) {
      secondaryBarWrap.hidden = true;
      return;
    }
    secondaryBarWrap.hidden = false;
    secondaryBarBtn.textContent = t("openSecondaryScreen", { n: secIds.length });
  };

  function buildMenu() {
    secondaryBarWrap = document.createElement("div");
    secondaryBarWrap.className = "device-menu-secondary-bar";
    secondaryBarWrap.hidden = true;

    secondaryBarBtn = document.createElement("button");
    secondaryBarBtn.type = "button";
    secondaryBarBtn.className = "device-menu-secondary-btn";
    secondaryBarBtn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      var secIds = getSavedSecondaryDevices();
      closeMenu(false);
      if (secIds.length) {
        popoutDevices(secIds, false, true);
      }
    });
    secondaryBarWrap.appendChild(secondaryBarBtn);
    menu.appendChild(secondaryBarWrap);

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
        popoutDevices(ids, true, true);
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
      updateSecondaryMenuBar();
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

  if (windowSlot === "secondary") {
    postCrossTab({ type: "bc:secondary_alive" });
    window.addEventListener("beforeunload", function () {
      postCrossTab({ type: "bc:secondary_closed" });
    });
  } else {
    postCrossTab({ type: "bc:who_is_secondary" });
  }

  var tabSaved = filterValidDevices(loadTabDevices());
  var saved;
  if (tabSaved.length) {
    // 1. Si esta pestaña ya tenía dispositivos activos en esta sesión (p. ej. al dar F5 / Cmd+R), conservarlos siempre.
    saved = tabSaved;
  } else if (paramDevices) {
    // 2. Si es una ventana recién abierta con ?devices=..., usar esos dispositivos.
    saved = filterValidDevices(paramDevices.split(","));
  } else if (windowSlot === "secondary") {
    // 3. Si es la 2da ventana o monitor vertical, restaurar sus dispositivos guardados (localStorage o servidor).
    saved = getSavedSecondaryDevices();
    if (!saved.length) saved = getSavedMainDevices();
  } else {
    // 4. Ventana principal: restaurar sus dispositivos guardados (localStorage o servidor).
    saved = getSavedMainDevices();
  }

  var initial = (Array.isArray(saved) && saved.length) ? saved : DEFAULTS.slice();
  initial.forEach(function (id) { state.active.push(id); createDevice(id); });
  saveActiveDevices();
  syncMenu();

  var serverUrl = (WORKSPACE && typeof WORKSPACE.url === "string" && WORKSPACE.url) ? WORKSPACE.url : "";
  var savedUrl = paramUrl ? normalizeUrl(paramUrl) : (load(STORE_URL) || serverUrl);
  if (typeof savedUrl === "string" && savedUrl) {
    state.url = savedUrl;
    input.value = savedUrl;
    store(STORE_URL, savedUrl);
    syncUrlParamsWithState();
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
