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
  var inspectLink = document.getElementById("inspect-link");
  var inspectSelector = document.getElementById("inspect-selector");
  var inspectCode = document.getElementById("inspect-code");
  var inspectClose = document.getElementById("inspect-close");
  var copiedPillTimer = null;

  // Elementos del Panel de Tráfico HTTP y Consola (estilo Burp Suite + DevTools)
  var trafficBtn = document.getElementById("traffic-btn");
  var trafficCountEl = document.getElementById("traffic-count");
  var consoleBtn = document.getElementById("console-btn");
  var consoleCountEl = document.getElementById("console-count");
  var trafficPanel = document.getElementById("traffic-panel");
  var trafficDot = document.getElementById("traffic-dot");
  var panelModeTraffic = document.getElementById("panel-mode-traffic");
  var panelModeConsole = document.getElementById("panel-mode-console");
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
  function createDevice(id) {
    var d = BY_ID[id];
    var root = document.createElement("figure");
    root.className = "device is-entering";
    root.dataset.kind = d.kind;

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
      } catch (_e) {}
    });

    screen.appendChild(placeholder);
    screen.appendChild(iframe);
    body.appendChild(screen);

    var caption = document.createElement("figcaption");
    caption.className = "device-caption";
    var name = document.createElement("span");
    name.className = "device-name";
    name.textContent = d.name;
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
    var isPortraitStage = H > W * 1.05;
    var forceVerticalStack = state.stackMode === "stack";

    for (var r = 1; r <= n; r++) {
      // Si el usuario activó el modo Apilar/Vertical (o está en un monitor vertical con pantallas anchas),
      // priorizamos acomodar las pantallas una debajo de otra para aprovechar el ancho completo del monitor vertical.
      if (forceVerticalStack && r < n) continue;

      var rows = partitionRows(devices, r, vW);
      if (rows.length !== r) continue;

      // En monitores verticales (portrait), evitamos poner múltiples dispositivos de escritorio/laptop en la misma fila
      // porque al ser pantallas horizontales (16:9) se encogerían a la mitad de su ancho innecesariamente.
      if (!forceVerticalStack && isPortraitStage && r < n) {
        var hasMultiWideInRow = rows.some(function (row) {
          return row.length > 1 && row.some(function (d) { return d.width >= 1000 || d.kind === "desktop"; });
        });
        if (hasMultiWideInRow) continue;
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
      // En modo Fill sobre monitores verticales o apilado vertical, permitimos que las filas aprovechen el ancho
      // completo aunque la altura total supere ligeramente el alto visible (permitiendo scroll vertical suave).
      var heightFit = freeH / sumRowH;
      if ((isFill && isPortraitStage && r > 1) || forceVerticalStack) {
        sCandidate = Math.min(sCandidate, Math.max(heightFit, sCandidate * 0.92));
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
    setZoom(s);

    // En modo Fill, si hay varias filas y una fila es más angosta que el ancho disponible,
    // le damos un impulso extra de escala (respetando la altura libre) para aprovechar la ventana.
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
      // En monitor vertical con dispositivos apilados (1 por fila), cada pantalla aprovecha su propio ancho al 100%
      if ((isPortraitStage || forceVerticalStack) && row.length === 1) {
        var maxVerticalBoost = forceVerticalStack ? sByW : Math.min(sByW, sByH * 1.15);
        return Math.max(s, Math.min(2.0, maxVerticalBoost));
      }
      return Math.max(s, Math.min(s * 1.28, sByW, sByH));
    });

    // Posiciones: filas centradas horizontal y verticalmente.
    var rowWidths = best.rows.map(function (row, ri) {
      var rs = rowScales[ri];
      return row.reduce(function (a, d) { return a + vW(d) * rs + BEZEL; }, 0) + (row.length - 1) * GAP_X;
    });
    var rowHeights = best.rows.map(function (row, ri) {
      var rs = rowScales[ri];
      return Math.max.apply(null, row.map(function (d) { return vH(d) * rs; })) + BEZEL + CAPTION;
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
      var rs = rowScales[ri];
      var rowContentH = rowHeights[ri] - BEZEL - CAPTION;
      var x = PAD_X + (areaW - rowW) / 2;
      row.forEach(function (d) {
        var devScale = rs * relScales[d.id];
        var devH = d.height * devScale;
        // Centrar verticalmente cada dispositivo dentro de la altura de su fila
        var offsetY = y + Math.max(0, (rowContentH - devH) / 2);
        place(d, x, offsetY, devScale);
        x += d.width * devScale + BEZEL + GAP_X;
      });
      y += rowHeights[ri] + GAP_Y;
    });
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
      if (els[d.frame]) state.frameUrls[d.frame] = d.url;
      fetchTraffic();
      postCrossTab({ type: "bc:traffic_ping" });
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

    var endpoint = data.url || state.frameUrls[data.frame] || state.url || "";
    if (inspectBadge) inspectBadge.textContent = "<" + (data.tag || "element") + ">";
    if (inspectDim) inspectDim.textContent = (data.width && data.height) ? (data.width + "×" + data.height + " px") : "";
    if (inspectLink) inspectLink.textContent = endpoint;
    if (inspectSelector) inspectSelector.textContent = data.selector || "";
    if (inspectCode) inspectCode.textContent = data.foldedHtml || "";

    inspectFloat.hidden = false;

    // Convertir coordenadas internas del iframe a coordenadas de la ventana principal
    var ir = item.iframe.getBoundingClientRect();
    var devScale = item.scale || state.scale || 1;
    var px = ir.left + (data.clientX || 0) * devScale;
    var py = ir.top + (data.clientY || 0) * devScale;

    var fw = inspectFloat.offsetWidth || 320;
    var fh = inspectFloat.offsetHeight || 160;
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

  function onInspectorPicked(data) {
    if (!state.inspector) return;
    var endpoint = data.url || state.frameUrls[data.frame] || state.url || "";
    var payload = "link: " + endpoint + "\nelement: " + (data.html || "");
    // Al dar clic se copia el endpoint (link:) y el elemento completo (element:) al portapapeles sin salir del modo inspección
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

  function populateTrafficDeviceSelect() {
    if (!trafficDeviceFilter) return;
    CATALOG.forEach(function (d) {
      var opt = document.createElement("option");
      opt.value = d.id;
      opt.textContent = d.name;
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
      tdDevice.textContent = item.device_name;
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
      tdDevice.textContent = item.device_name;
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

  function setPanelMode(mode) {
    trafficState.panelMode = mode === "console" ? "console" : "traffic";
    var isConsole = trafficState.panelMode === "console";

    if (panelModeTraffic) panelModeTraffic.classList.toggle("is-active", !isConsole);
    if (panelModeConsole) panelModeConsole.classList.toggle("is-active", isConsole);
    if (trafficMethodPills) trafficMethodPills.hidden = isConsole;
    if (consoleLevelPills) consoleLevelPills.hidden = !isConsole;
    if (trafficSplitView) trafficSplitView.hidden = isConsole;
    if (consoleSplitView) consoleSplitView.hidden = !isConsole;

    if (trafficBtn) {
      var tActive = trafficState.open && !isConsole;
      trafficBtn.setAttribute("aria-pressed", tActive ? "true" : "false");
      trafficBtn.classList.toggle("is-active", tActive);
    }
    if (consoleBtn) {
      var cActive = trafficState.open && isConsole;
      consoleBtn.setAttribute("aria-pressed", cActive ? "true" : "false");
      consoleBtn.classList.toggle("is-active", cActive);
    }

    if (trafficState.open) {
      if (isConsole) {
        fetchConsole();
        renderConsoleTable(true);
        renderConsoleDetail();
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
  if (panelModeTraffic) {
    panelModeTraffic.addEventListener("click", function () { setPanelMode("traffic"); });
  }
  if (panelModeConsole) {
    panelModeConsole.addEventListener("click", function () { setPanelMode("console"); });
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
      }
    });
  }
  if (trafficClearBtn) {
    trafficClearBtn.addEventListener("click", function () {
      if (trafficState.panelMode === "console") {
        fetch("/api/console/clear", { method: "POST", credentials: "same-origin" }).catch(function () {});
        consoleState.items = [];
        consoleState.selectedId = null;
        updateConsoleBadge();
        renderConsoleTable();
        renderConsoleDetail();
        postCrossTab({ type: "bc:console_clear" });
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
    });
  }
  if (trafficDeviceFilter) {
    trafficDeviceFilter.addEventListener("change", function () {
      trafficState.deviceFilter = trafficDeviceFilter.value;
      renderTrafficTable();
      renderConsoleTable();
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
  }, 800);

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
        label.textContent = d.name;
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
    var initialTab = paramTab === "console" ? "console" : "traffic";
    document.title = (initialTab === "console" ? t("console") : t("trafficTitle")) + " — Responsive Viewer";
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
