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

  // ---------- Estado ----------
  var state = {
    active: [],        // ids de dispositivos en la mesa, en orden
    url: "",           // URL escrita en Buscar
    frameUrls: {},     // URL actual de cada pantalla (si el usuario navegó dentro)
    zoomMode: "fill",  // "fill" (aprovechar ventana), "fit" (ajustar todo) o un número fijo
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
  var inspectSelector = document.getElementById("inspect-selector");
  var inspectCode = document.getElementById("inspect-code");
  var inspectClose = document.getElementById("inspect-close");
  var copiedPillTimer = null;

  // ---------- Utilidades ----------
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_e) {}
  }
  function load(key) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (_e) { return null; }
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
    var remove = document.createElement("button");
    remove.type = "button";
    remove.className = "device-remove";
    remove.appendChild(icon(["M5 5l10 10", "M15 5 5 15"]));
    remove.addEventListener("click", function () { toggleDevice(id, false); });

    caption.appendChild(name);
    caption.appendChild(size);
    caption.appendChild(dpr);
    body.appendChild(remove);

    root.appendChild(body);
    root.appendChild(caption);
    rack.appendChild(root);

    els[id] = { root: root, screen: screen, iframe: iframe, placeholder: placeholder, remove: remove, sizeEl: size };
    translateDevice(id);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { root.classList.remove("is-entering"); });
    });
    return els[id];
  }

  function translateDevice(id) {
    var e = els[id], name = BY_ID[id].name;
    e.placeholder.textContent = t("placeholder");
    e.iframe.title = t("frameTitle", { name: name });
    e.remove.setAttribute("aria-label", t("remove", { name: name }));
    e.remove.title = t("remove", { name: name });
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

    for (var r = 1; r <= n; r++) {
      var rows = partitionRows(devices, r, vW);
      if (rows.length !== r) continue;

      var sCandidate = 2.0;
      var sumRowH = 0;
      rows.forEach(function (row) {
        var sumW = row.reduce(function (a, d) { return a + vW(d); }, 0);
        var freeW = W - row.length * BEZEL - (row.length - 1) * GAP_X;
        sCandidate = Math.min(sCandidate, freeW / sumW);
        sumRowH += Math.max.apply(null, row.map(vH));
      });
      var freeH = H - r * (BEZEL + CAPTION) - (r - 1) * GAP_Y;
      sCandidate = Math.min(sCandidate, freeH / sumRowH);

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

  zoomInBtn.addEventListener("click", function () { stepZoom(1); });
  zoomOutBtn.addEventListener("click", function () { stepZoom(-1); });
  zoomFitBtn.addEventListener("click", fitZoom);
  if (zoomFillBtn) zoomFillBtn.addEventListener("click", fillZoom);

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
      broadcastToOtherFrames(d.frame, {
        type: "rv:do_sync_scroll",
        x: d.x,
        y: d.y,
        dx: d.dx,
        dy: d.dy
      });
    } else if (d.type === "rv:sync_click") {
      if (!state.sync) return;
      broadcastToOtherFrames(d.frame, {
        type: "rv:do_sync_click",
        selector: d.selector,
        structuralSelector: d.structuralSelector,
        interactiveSelector: d.interactiveSelector,
        interactiveStructural: d.interactiveStructural,
        tag: d.tag,
        text: d.text,
        href: d.href,
        absHref: d.absHref
      });
    } else if (d.type === "rv:sync_input") {
      if (!state.sync) return;
      broadcastToOtherFrames(d.frame, {
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
      });
    }
  });

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

    if (inspectBadge) inspectBadge.textContent = "<" + (data.tag || "element") + ">";
    if (inspectDim) inspectDim.textContent = (data.width && data.height) ? (data.width + "×" + data.height + " px") : "";
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
    // Al dar clic se copia el elemento completo al portapapeles sin salir del modo inspección
    copyText(data.html || "", t("copiedHtml"));

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

      var heading = document.createElement("p");
      heading.className = "device-menu-heading";
      heading.id = headingId;
      heading.dataset.i18n = "group_" + g;
      heading.textContent = t("group_" + g);
      group.appendChild(heading);

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

  // También se puede abrir con ?url=ejemplo.com&devices=iphone-se,ipad-mini
  var params = new URLSearchParams(location.search);
  var paramDevices = params.get("devices");
  var paramUrl = params.get("url");

  var saved = paramDevices ? paramDevices.split(",") : load(STORE_DEVICES);
  var initial = (Array.isArray(saved) ? saved : DEFAULTS).filter(function (id) { return BY_ID[id]; });
  if (!Array.isArray(saved) || (saved.length && !initial.length)) initial = DEFAULTS.slice();
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

  layout();
  if (window.ResizeObserver) new ResizeObserver(layout).observe(stage);
  else window.addEventListener("resize", layout);
})();
