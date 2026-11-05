(function () {
  "use strict";

  // ---------- Datos ----------
  var CATALOG = JSON.parse(document.getElementById("devices-data").textContent);
  var DEFAULTS = JSON.parse(document.getElementById("defaults-data").textContent);
  var BY_ID = {};
  CATALOG.forEach(function (d) { BY_ID[d.id] = d; });

  var I18N = window.RV_I18N;
  var t = I18N.t;

  // Medidas del acomodo (en px de pantalla, no se escalan).
  var PAD_X = 32, PAD_TOP = 32, PAD_BOTTOM = 48;
  var GAP_X = 40, GAP_Y = 28;
  var BEZEL = 12;          // 6 px por lado
  var CAPTION = 44;        // nombre + medidas (2 líneas) debajo de cada pantalla
  var RADIUS = { phone: 46, tablet: 20, desktop: 6 };

  // Zoom propio del visor (no el de Chrome). Pasos como los de Chrome.
  var ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
  var ZOOM_MIN = 0.1, ZOOM_MAX = 2;
  var IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  var MOD = IS_MAC ? "⌘" : "Ctrl";

  var STORE_URL = "rv.url", STORE_DEVICES = "rv.devices", STORE_ZOOM = "rv.zoom";

  // ---------- Estado ----------
  var state = {
    active: [],        // ids de dispositivos en la mesa, en orden
    url: "",           // URL escrita en Buscar
    frameUrls: {},     // URL actual de cada pantalla (si el usuario navegó dentro)
    zoomMode: "fit",   // "fit" (automático) o un número fijo, p. ej. 0.5
    scale: 1,          // zoom que se está mostrando ahora
    inspector: false   // modo selector de elementos
  };
  var els = {};        // id -> { root, screen, iframe, placeholder }

  // ---------- Elementos ----------
  var stage = document.getElementById("stage");
  var rack = document.getElementById("rack");
  var matEmpty = document.getElementById("mat-empty");
  var zoomLabel = document.getElementById("zoom-label");
  var zoomInBtn = document.getElementById("zoom-in");
  var zoomOutBtn = document.getElementById("zoom-out");
  var zoomFitBtn = document.getElementById("zoom-fit");
  var form = document.getElementById("search-form");
  var input = document.getElementById("url-input");
  var refreshBtn = document.getElementById("refresh-btn");
  var addBtn = document.getElementById("add-btn");
  var menu = document.getElementById("device-menu");
  var toastEl = document.getElementById("toast");

  // Elementos del Inspector
  var inspectBtn = document.getElementById("inspect-btn");
  var inspectModal = document.getElementById("inspect-modal");
  var inspectBadge = document.getElementById("inspect-badge");
  var inspectSelector = document.getElementById("inspect-selector");
  var inspectCode = document.getElementById("inspect-code");
  var inspectClose = document.getElementById("inspect-close");
  var inspectCopyHtml = document.getElementById("inspect-copy-html");
  var inspectCopySelector = document.getElementById("inspect-copy-selector");
  var currentInspectedHtml = "";
  var currentInspectedSelector = "";

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
      if (state.inspector) {
        try {
          iframe.contentWindow.postMessage({ type: "rv:set_inspector", active: true }, location.origin);
        } catch (_e) {}
      }
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

    els[id] = { root: root, screen: screen, iframe: iframe, placeholder: placeholder, remove: remove };
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
  function layout() {
    var n = state.active.length;
    matEmpty.hidden = n > 0;
    var W = stage.clientWidth - PAD_X * 2;
    var H = stage.clientHeight - PAD_TOP - PAD_BOTTOM;
    if (!n || W <= 0 || H <= 0) {
      rack.style.width = rack.style.height = "";
      updatePanCursor();
      setZoom(state.zoomMode === "fit" ? 1 : state.zoomMode);
      return;
    }

    var devices = state.active.map(function (id) { return BY_ID[id]; });
    var best = null;

    for (var r = 1; r <= n; r++) {
      var per = Math.ceil(n / r);
      var rows = [];
      for (var i = 0; i < n; i += per) rows.push(devices.slice(i, i + per));
      if (rows.length !== r) continue;

      var s = 1;
      var sumRowH = 0;
      rows.forEach(function (row) {
        var sumW = row.reduce(function (a, d) { return a + d.width; }, 0);
        var free = W - row.length * BEZEL - (row.length - 1) * GAP_X;
        s = Math.min(s, free / sumW);
        sumRowH += Math.max.apply(null, row.map(function (d) { return d.height; }));
      });
      var freeH = H - r * (BEZEL + CAPTION) - (r - 1) * GAP_Y;
      s = Math.min(s, freeH / sumRowH);

      if (!best || s > best.s) best = { s: s, rows: rows };
    }

    var s = state.zoomMode === "fit" ? Math.max(ZOOM_MIN / 2, best.s) : state.zoomMode;
    setZoom(s);

    // Posiciones: filas centradas horizontal y verticalmente.
    var rowWidths = best.rows.map(function (row) {
      return row.reduce(function (a, d) { return a + d.width * s + BEZEL; }, 0) + (row.length - 1) * GAP_X;
    });
    var rowHeights = best.rows.map(function (row) {
      return Math.max.apply(null, row.map(function (d) { return d.height * s; })) + BEZEL + CAPTION;
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
      var x = PAD_X + (areaW - rowW) / 2;
      row.forEach(function (d) {
        place(d, x, y, s);
        x += d.width * s + BEZEL + GAP_X;
      });
      y += rowHeights[ri] + GAP_Y;
    });
  }

  function place(d, x, y, s) {
    var e = els[d.id];
    var w = d.width * s, h = d.height * s;
    e.screen.style.width = w + "px";
    e.screen.style.height = h + "px";
    e.root.style.width = (w + BEZEL) + "px";
    e.root.style.setProperty("--radius", Math.max(3, RADIUS[d.kind] * s) + "px");
    e.iframe.style.transform = "scale(" + s + ")";

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
    if (mode !== "fit") mode = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, mode));
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

  zoomInBtn.addEventListener("click", function () { stepZoom(1); });
  zoomOutBtn.addEventListener("click", function () { stepZoom(-1); });
  zoomFitBtn.addEventListener("click", fitZoom);

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
      try { e.iframe.contentWindow.scrollBy({ left: dx, top: dy, behavior: "instant" }); } catch (_e) {}
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
        closeInspectorModal();
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
  window.addEventListener("message", function (ev) {
    if (ev.origin !== location.origin || !ev.data) return;
    if (ev.data.type === "rv:navigated") {
      if (els[ev.data.frame]) state.frameUrls[ev.data.frame] = ev.data.url;
    } else if (ev.data.type === "rv:element_picked") {
      showInspectorModal(ev.data);
    }
  });

  // ---------- Inspector de Elementos ----------
  function formatHtml(raw) {
    if (!raw) return "";
    var formatted = "";
    var pad = 0;
    var tokens = raw.replace(/>\s*</g, "><").replace(/</g, "~#~<").split("~#~");
    tokens.forEach(function (token) {
      token = token.trim();
      if (!token) return;
      if (token.match(/^<\/\w/)) {
        pad = Math.max(0, pad - 1);
      }
      formatted += "  ".repeat(pad) + token + "\n";
      if (token.match(/^<\w[^>]*[^\/]>$/) && !token.match(/^<(input|img|br|hr|meta|link|col|base|source|area)/i)) {
        pad++;
      }
    });
    return formatted.trim() || raw;
  }

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

  function toggleInspector(on) {
    if (on === undefined) on = !state.inspector;
    state.inspector = on;
    if (inspectBtn) {
      inspectBtn.setAttribute("aria-pressed", state.inspector ? "true" : "false");
      inspectBtn.classList.toggle("is-active", state.inspector);
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

    if (state.inspector) {
      toast(t("inspectActive"));
    }
  }

  function closeInspectorModal() {
    if (inspectModal) inspectModal.hidden = true;
  }

  function showInspectorModal(data) {
    toggleInspector(false);
    currentInspectedHtml = data.html || "";
    currentInspectedSelector = data.selector || "";

    if (inspectBadge) inspectBadge.textContent = "<" + (data.tag || "element") + ">";
    if (inspectSelector) inspectSelector.textContent = data.selector || "";
    if (inspectCode) inspectCode.textContent = formatHtml(data.html || "");
    if (inspectModal) inspectModal.hidden = false;
  }

  if (inspectBtn) {
    inspectBtn.addEventListener("click", function () {
      toggleInspector();
    });
  }
  if (inspectClose) {
    inspectClose.addEventListener("click", closeInspectorModal);
  }
  if (inspectModal) {
    inspectModal.addEventListener("click", function (e) {
      if (e.target === inspectModal) closeInspectorModal();
    });
  }
  if (inspectCopyHtml) {
    inspectCopyHtml.addEventListener("click", function () {
      copyText(currentInspectedHtml, t("copiedHtml"));
    });
  }
  if (inspectCopySelector) {
    inspectCopySelector.addEventListener("click", function () {
      copyText(currentInspectedSelector, t("copiedSelector"));
    });
  }

  window.addEventListener("keydown", function (ev) {
    if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey && (ev.key === "c" || ev.key === "C")) {
      ev.preventDefault();
      toggleInspector();
    } else if (ev.key === "Escape") {
      if (state.inspector) toggleInspector(false);
      closeInspectorModal();
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

  var savedZoom = load(STORE_ZOOM);
  if (typeof savedZoom === "number" && savedZoom >= ZOOM_MIN && savedZoom <= ZOOM_MAX) state.zoomMode = savedZoom;

  layout();
  if (window.ResizeObserver) new ResizeObserver(layout).observe(stage);
  else window.addEventListener("resize", layout);
})();
