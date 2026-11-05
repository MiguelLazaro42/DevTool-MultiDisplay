/* Se inyecta en cada página que pasa por /proxy (app.py reemplaza
   __FRAME__ y __DEVICE__). Hace que todo lo que la página pida a su sitio
   —enlaces, formularios (GET y POST), fetch y XMLHttpRequest— vuelva a
   pasar por el proxy. Así:
     - se envía con el User-Agent del dispositivo,
     - las cookies (por ejemplo la sesión al iniciar sesión) quedan en el
       frasco de esta pantalla,
     - las respuestas no traen X-Frame-Options, que haría que Chrome diga
       "rechazó la conexión" dentro del iframe. */
(function () {
  "use strict";
  var F = __FRAME__, D = __DEVICE__;
  var ORIGIN = location.origin;

  function abs(u) {
    try { return new URL(u, document.baseURI).href; } catch (_e) { return null; }
  }
  function proxiable(u) {
    return !!u && /^https?:/i.test(u) && new URL(u).origin !== ORIGIN;
  }
  function via(u) {
    return ORIGIN + "/proxy?frame=" + encodeURIComponent(F) +
      "&device=" + encodeURIComponent(D) + "&url=" + encodeURIComponent(u);
  }

  // ---------- Enlaces ----------
  // En fase de burbuja sobre window: si la página maneja el clic ella misma
  // (por ejemplo un router de una SPA), ya llamó a preventDefault y no tocamos nada.
  window.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a || a.hasAttribute("download")) return;
    if (a.target && a.target !== "_self") return;
    var href = a.href;
    if (!proxiable(href)) return;
    var here = document.baseURI.split("#")[0];
    if (href.split("#")[0] === here && href.indexOf("#") > -1) return; // ancla en la misma página
    e.preventDefault();
    location.href = via(href);
  });

  // ---------- Formularios ----------
  function formInfo(form, submitter) {
    var attr = function (name, fallback) {
      return (submitter && submitter.getAttribute("form" + name)) || form.getAttribute(name) || fallback;
    };
    var target = attr("target", "");
    if (target && target !== "_self") return null;
    var action = abs(attr("action", document.baseURI));
    if (!proxiable(action)) return null;
    return { method: attr("method", "get").toLowerCase(), action: action };
  }

  function sendForm(form, submitter, info) {
    if (info.method === "get") {
      // El navegador borraría la query del action al enviar por GET, así que
      // armamos la URL a mano.
      var data;
      try { data = new FormData(form, submitter || undefined); } catch (_e) { data = new FormData(form); }
      var u = new URL(info.action);
      u.search = new URLSearchParams(data).toString();
      location.href = via(u.href);
      return true;
    }
    // POST (u otro): el navegador lo envía tal cual (archivos, enctype…),
    // pero a nuestro proxy en lugar de directo al sitio.
    if (submitter && submitter.hasAttribute("formaction")) submitter.setAttribute("formaction", via(info.action));
    form.setAttribute("action", via(info.action));
    return false;
  }

  window.addEventListener("submit", function (e) {
    if (e.defaultPrevented) return;          // la página lo envía con JavaScript
    var info = formInfo(e.target, e.submitter);
    if (info && sendForm(e.target, e.submitter, info)) e.preventDefault();
  });

  // form.submit() no dispara el evento "submit".
  var nativeSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () {
    var info = formInfo(this, null);
    if (info && sendForm(this, null, info)) return;
    return nativeSubmit.call(this);
  };

  // ---------- fetch y XMLHttpRequest ----------
  function pingTraffic() {
    try { parent.postMessage({ type: "rv:traffic_ping", frame: F }, ORIGIN); } catch (_e) {}
  }

  var nativeFetch = window.fetch;
  if (nativeFetch) {
    window.fetch = function (input, init) {
      try {
        var isReq = typeof Request !== "undefined" && input instanceof Request;
        var target = abs(isReq ? input.url : String(input));
        if (proxiable(target)) input = isReq ? new Request(via(target), input) : via(target);
      } catch (_e) {}
      var p = nativeFetch.call(this, input, init);
      if (p && typeof p.then === "function") {
        p.then(pingTraffic, pingTraffic);
      }
      return p;
    };
  }

  var nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var target = abs(url);
    if (proxiable(target)) arguments[1] = via(target);
    this.addEventListener("loadend", pingTraffic);
    return nativeOpen.apply(this, arguments);
  };

  // ---------- Aviso al visor ----------
  // Para que Refrescar recargue la página donde está esta pantalla, y para obtener el endpoint actual.
  function getCurrentPageUrl() {
    try {
      var base = document.baseURI || "";
      if (location.pathname && location.pathname !== "/proxy") {
        return new URL(location.pathname + location.search + location.hash, base).href;
      }
      if (location.hash && base.indexOf("#") === -1) {
        return base + location.hash;
      }
      return base;
    } catch (_e) {
      return document.baseURI || location.href;
    }
  }

  function notifyNavigated() {
    try { parent.postMessage({ type: "rv:navigated", frame: F, url: getCurrentPageUrl() }, ORIGIN); } catch (_e) {}
  }
  notifyNavigated();
  window.addEventListener("hashchange", notifyNavigated);
  window.addEventListener("popstate", notifyNavigated);

  // ---------- Captura de Consola del Navegador y Errores ----------
  function formatConsoleArg(a, detailed) {
    if (a === undefined) return "undefined";
    if (a === null) return "null";
    if (typeof a === "string") return a;
    if (typeof a === "number" || typeof a === "boolean") return String(a);
    if (a instanceof Error) {
      return detailed ? (a.stack || (a.name + ": " + a.message)) : (a.name + ": " + a.message);
    }
    if (a && a.nodeType === 1 && a.outerHTML) {
      return detailed ? a.outerHTML.slice(0, 600) : ("<" + a.tagName.toLowerCase() + ">");
    }
    try {
      return JSON.stringify(a, null, detailed ? 2 : 0);
    } catch (_e) {
      return String(a);
    }
  }

  function emitConsole(level, args, sourceStr) {
    try {
      var summary = args.map(function (a) { return formatConsoleArg(a, false); }).join(" ");
      var detail = args.map(function (a) { return formatConsoleArg(a, true); }).join("\n\n");
      parent.postMessage({
        type: "rv:console_event",
        frame: F,
        device: D,
        level: level,
        message: summary.slice(0, 1200),
        detail: detail.slice(0, 10000),
        source: sourceStr || "",
        url: getCurrentPageUrl()
      }, ORIGIN);
    } catch (_e) {}
  }

  ["log", "info", "warn", "error", "debug"].forEach(function (lvl) {
    if (!window.console || typeof window.console[lvl] !== "function") return;
    var orig = window.console[lvl];
    window.console[lvl] = function () {
      var args = Array.prototype.slice.call(arguments);
      emitConsole(lvl === "debug" ? "log" : lvl, args, "console." + lvl);
      return orig.apply(window.console, arguments);
    };
  });

  window.addEventListener("error", function (e) {
    if (e.target && e.target !== window && e.target.tagName) {
      var tag = e.target.tagName.toLowerCase();
      var resUrl = e.target.src || e.target.href || "";
      if (resUrl) {
        emitConsole("error", ["Error al cargar recurso <" + tag + ">: " + resUrl], "<" + tag + ">");
      }
      return;
    }
    var msg = e.message || "Uncaught Error";
    var loc = (e.filename ? e.filename.split("/").pop() : "script") + (e.lineno ? (":" + e.lineno + (e.colno ? ":" + e.colno : "")) : "");
    var stack = (e.error && e.error.stack) ? e.error.stack : (msg + "\n  at " + (e.filename || "") + ":" + (e.lineno || 0));
    try {
      parent.postMessage({
        type: "rv:console_event",
        frame: F,
        device: D,
        level: "error",
        message: msg,
        detail: stack,
        source: loc,
        url: getCurrentPageUrl()
      }, ORIGIN);
    } catch (_e) {}
  }, true);

  window.addEventListener("unhandledrejection", function (e) {
    var reason = e.reason;
    var msg = "Unhandled Promise Rejection: " + (reason && reason.message ? reason.message : String(reason));
    var detail = (reason && reason.stack) ? reason.stack : formatConsoleArg(reason, true);
    try {
      parent.postMessage({
        type: "rv:console_event",
        frame: F,
        device: D,
        level: "error",
        message: msg,
        detail: detail,
        source: "Promise",
        url: getCurrentPageUrl()
      }, ORIGIN);
    } catch (_e) {}
  });

  // ---------- Inspector de Elementos ----------
  var inspectorActive = false;
  var overlayEl = null;
  var badgeEl = null;

  function ensureInspectorOverlay() {
    if (overlayEl) return;
    overlayEl = document.createElement("div");
    overlayEl.id = "__rv_inspect_box";
    overlayEl.style.cssText =
      "position:absolute;pointer-events:none;z-index:2147483647;" +
      "border:2px solid #1a73e8;background:rgba(26,115,232,0.18);" +
      "box-sizing:border-box;display:none;transition:top 35ms,left 35ms,width 35ms,height 35ms;";

    badgeEl = document.createElement("div");
    badgeEl.style.cssText =
      "position:absolute;top:-26px;left:-2px;background:#18201D;color:#CFE3DA;" +
      "font:600 11px/1.2 monospace;padding:4px 8px;border-radius:4px;white-space:nowrap;" +
      "box-shadow:0 4px 10px rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.15);" +
      "pointer-events:none;z-index:2147483647;";

    overlayEl.appendChild(badgeEl);
    (document.body || document.documentElement).appendChild(overlayEl);
  }

  function safeIdent(s) {
    return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : String(s).replace(/[^A-Za-z0-9_-]/g, "\\$&");
  }

  function getSelector(el, structuralOnly) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return "";
    var path = [];
    while (el && el.nodeType === Node.ELEMENT_NODE) {
      var name = el.nodeName.toLowerCase();
      if (el.id) {
        path.unshift(name + "#" + safeIdent(el.id));
        break;
      }
      var sib = el, nth = 1;
      while ((sib = sib.previousElementSibling)) {
        if (sib.nodeName.toLowerCase() === name) nth++;
      }
      var part = name;
      if (!structuralOnly && el.classList && el.classList.length) {
        for (var i = 0; i < el.classList.length; i++) {
          var c = el.classList[i];
          if (/^[A-Za-z_-][A-Za-z0-9_-]*$/.test(c)) {
            part += "." + c;
            break;
          }
        }
      }
      if (nth > 1) part += ":nth-of-type(" + nth + ")";
      path.unshift(part);
      el = el.parentElement;
      if (el && el.tagName && el.tagName.toLowerCase() === "body") break;
    }
    return path.join(" > ");
  }

  function openTagStr(el, maxAttrs) {
    var tag = el.tagName.toLowerCase();
    var out = "<" + tag;
    var attrs = el.attributes;
    if (attrs && attrs.length) {
      var shown = 0;
      var limit = maxAttrs || 3;
      for (var i = 0; i < attrs.length; i++) {
        var a = attrs[i];
        if (shown >= limit) {
          out += " …";
          break;
        }
        var val = (a.value || "").replace(/\s+/g, " ").trim();
        if (val.length > 34) val = val.slice(0, 31) + "…";
        out += " " + a.name + '="' + val.replace(/"/g, "&quot;") + '"';
        shown++;
      }
    }
    return out + ">";
  }

  // Genera una vista previa del HTML plegada (colapsada) estilo IDE
  function buildFoldedPreview(el) {
    if (!el || !el.tagName) return "";
    var tag = el.tagName.toLowerCase();
    var voidTags = /^(img|input|br|hr|meta|link|source|area|base|col|embed|param|track|wbr)$/i;
    if (voidTags.test(tag)) {
      return openTagStr(el, 4);
    }
    if (tag === "svg") {
      return "▸ " + openTagStr(el, 2) + " ⋯ </svg>";
    }

    var children = el.children ? Array.prototype.slice.call(el.children) : [];
    if (children.length === 0) {
      var txt = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!txt) return openTagStr(el, 3) + "</" + tag + ">";
      if (txt.length <= 54) {
        return openTagStr(el, 3) + txt + "</" + tag + ">";
      }
      return "▾ " + openTagStr(el, 3) + "\n  ▸ \"" + txt.slice(0, 50) + "…\" [texto plegado]\n</" + tag + ">";
    }

    var lines = ["▾ " + openTagStr(el, 3)];
    var maxShow = 3;
    for (var i = 0; i < Math.min(children.length, maxShow); i++) {
      var c = children[i];
      var cTag = c.tagName.toLowerCase();
      if (voidTags.test(cTag)) {
        lines.push("    " + openTagStr(c, 2));
      } else if (c.children && c.children.length > 0) {
        lines.push("  ▸ " + openTagStr(c, 2) + " ⋯ </" + cTag + "> (" + c.children.length + ")");
      } else {
        var cTxt = (c.textContent || "").replace(/\s+/g, " ").trim();
        if (cTxt.length > 36) {
          lines.push("  ▸ " + openTagStr(c, 2) + cTxt.slice(0, 32) + "… </" + cTag + ">");
        } else {
          lines.push("    " + openTagStr(c, 2) + cTxt + "</" + cTag + ">");
        }
      }
    }
    if (children.length > maxShow) {
      lines.push("  ⋯ +" + (children.length - maxShow) + " elementos plegados");
    }
    lines.push("</" + tag + ">");
    return lines.join("\n");
  }

  function extractElementDiagnostics(el, rect) {
    var r = rect || el.getBoundingClientRect();
    var vw = document.documentElement.clientWidth || window.innerWidth || 0;
    var vh = document.documentElement.clientHeight || window.innerHeight || 0;
    var box = {
      x: Math.round(r.left),
      y: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
      scrollWidth: el.scrollWidth || Math.round(r.width),
      clientWidth: el.clientWidth || Math.round(r.width),
      viewportW: vw,
      viewportH: vh,
      overflowRightPx: Math.max(0, Math.round(r.right - vw))
    };
    var stylesMap = {};
    var summaryParts = [];
    try {
      var cs = window.getComputedStyle(el);
      var keys = [
        ["display", "display"],
        ["position", "position"],
        ["flexDirection", "flex-direction"],
        ["justifyContent", "justify-content"],
        ["alignItems", "align-items"],
        ["flexWrap", "flex-wrap"],
        ["gap", "gap"],
        ["gridTemplateColumns", "grid-cols"],
        ["width", "width"],
        ["height", "height"],
        ["maxWidth", "max-width"],
        ["padding", "padding"],
        ["margin", "margin"],
        ["overflow", "overflow"],
        ["overflowX", "overflow-x"],
        ["zIndex", "z-index"],
        ["fontSize", "font-size"],
        ["fontWeight", "font-weight"],
        ["color", "color"],
        ["backgroundColor", "bg"]
      ];
      var ignoreDefaults = {
        "position": "static",
        "flex-direction": "row",
        "justify-content": "normal",
        "align-items": "normal",
        "flex-wrap": "nowrap",
        "gap": "normal",
        "grid-cols": "none",
        "max-width": "none",
        "padding": "0px",
        "margin": "0px",
        "overflow": "visible",
        "overflow-x": "visible",
        "z-index": "auto",
        "bg": "rgba(0, 0, 0, 0)"
      };
      for (var i = 0; i < keys.length; i++) {
        var prop = keys[i][0];
        var label = keys[i][1];
        var val = cs[prop];
        if (!val || val === ignoreDefaults[label]) continue;
        if ((label === "gap" || label === "padding" || label === "margin") && (val === "0px" || val === "normal")) continue;
        stylesMap[label] = val;
        if (summaryParts.length < 7 && label !== "width" && label !== "height" && label !== "color") {
          summaryParts.push(label + ": " + val);
        }
      }
      if (box.overflowRightPx > 1) {
        summaryParts.unshift("overflow-x: +" + box.overflowRightPx + "px");
      }
    } catch (_e) {}
    return {
      box: box,
      stylesMap: stylesMap,
      stylesSummary: summaryParts.join(" · ")
    };
  }

  function onInspectMove(e) {
    if (!inspectorActive) return;
    var target = e.target;
    if (!target || target === overlayEl || (overlayEl && overlayEl.contains(target))) return;
    if (target.classList && target.classList.contains("__rv_audit_marker")) return;
    if (target === document.documentElement) return;

    ensureInspectorOverlay();
    var r = target.getBoundingClientRect();
    var sx = window.pageXOffset || document.documentElement.scrollLeft || 0;
    var sy = window.pageYOffset || document.documentElement.scrollTop || 0;

    overlayEl.style.top = (r.top + sy) + "px";
    overlayEl.style.left = (r.left + sx) + "px";
    overlayEl.style.width = r.width + "px";
    overlayEl.style.height = r.height + "px";
    overlayEl.style.display = "block";

    var tag = target.tagName.toLowerCase();
    var label = tag;
    if (target.id) label += "#" + target.id;
    else if (target.classList && target.classList.length) label += "." + target.classList[0];

    var diag = extractElementDiagnostics(target, r);

    badgeEl.textContent = label + " | " + Math.round(r.width) + "×" + Math.round(r.height);
    if (r.top < 32) {
      badgeEl.style.top = (r.height + 4) + "px";
    } else {
      badgeEl.style.top = "-26px";
    }

    try {
      parent.postMessage({
        type: "rv:element_hover",
        frame: F,
        device: D,
        url: getCurrentPageUrl(),
        tag: label,
        selector: getSelector(target),
        foldedHtml: buildFoldedPreview(target),
        width: Math.round(r.width),
        height: Math.round(r.height),
        box: diag.box,
        stylesSummary: diag.stylesSummary,
        stylesMap: diag.stylesMap,
        clientX: e.clientX,
        clientY: e.clientY
      }, ORIGIN);
    } catch (_e) {}
  }

  function onInspectLeave() {
    if (!inspectorActive) return;
    if (overlayEl) overlayEl.style.display = "none";
    try {
      parent.postMessage({ type: "rv:element_leave", frame: F }, ORIGIN);
    } catch (_e) {}
  }

  function onInspectClick(e) {
    if (!inspectorActive) return;
    var target = e.target;
    if (!target || target === overlayEl || (overlayEl && overlayEl.contains(target))) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    // Destello verde de confirmación al copiar
    if (overlayEl) {
      overlayEl.style.borderColor = "#22c55e";
      overlayEl.style.background = "rgba(34, 197, 94, 0.26)";
      setTimeout(function () {
        if (overlayEl) {
          overlayEl.style.borderColor = "#1a73e8";
          overlayEl.style.background = "rgba(26, 115, 232, 0.18)";
        }
      }, 280);
    }

    var r = target.getBoundingClientRect();
    var tag = target.tagName.toLowerCase();
    var selector = getSelector(target);
    var html = target.outerHTML;
    var diag = extractElementDiagnostics(target, r);

    try {
      parent.postMessage({
        type: "rv:element_picked",
        frame: F,
        device: D,
        url: getCurrentPageUrl(),
        tag: tag,
        selector: selector,
        html: html,
        width: Math.round(r.width),
        height: Math.round(r.height),
        box: diag.box,
        stylesSummary: diag.stylesSummary,
        stylesMap: diag.stylesMap
      }, ORIGIN);
    } catch (_e) {}
  }

  window.addEventListener("mousemove", onInspectMove, true);
  document.documentElement.addEventListener("mouseleave", onInspectLeave, true);
  window.addEventListener("click", onInspectClick, true);
  window.addEventListener("keydown", function (e) {
    if (inspectorActive && e.key === "Escape") {
      e.preventDefault();
      try {
        parent.postMessage({ type: "rv:exit_inspector" }, ORIGIN);
      } catch (_e) {}
    }
  }, true);

  // ---------- Sincronización Multi-Dispositivo (Scroll, Clics, Inputs) ----------
  var syncActive = true;
  var isReplayingSync = false;
  var lastScrollX = window.pageXOffset || document.documentElement.scrollLeft || 0;
  var lastScrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
  var ignoreScrollUntil = 0;

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0 || el.offsetParent !== null;
  }

  function showSyncPulse(el) {
    if (!el || !el.getBoundingClientRect) return;
    var r = el.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) return;
    var sx = window.pageXOffset || document.documentElement.scrollLeft || 0;
    var sy = window.pageYOffset || document.documentElement.scrollTop || 0;
    var pulse = document.createElement("div");
    pulse.style.cssText =
      "position:absolute;pointer-events:none;z-index:2147483646;" +
      "border:2px solid #22c55e;background:rgba(34,197,94,0.22);border-radius:4px;" +
      "box-sizing:border-box;transition:opacity 280ms ease-out,transform 280ms ease-out;" +
      "top:" + (r.top + sy) + "px;left:" + (r.left + sx) + "px;" +
      "width:" + r.width + "px;height:" + r.height + "px;";
    (document.body || document.documentElement).appendChild(pulse);
    setTimeout(function () {
      pulse.style.opacity = "0";
      pulse.style.transform = "scale(1.04)";
    }, 20);
    setTimeout(function () {
      if (pulse.parentNode) pulse.parentNode.removeChild(pulse);
    }, 320);
  }

  // ---------- Rastreador de Usuario (Zona de Pantalla, Sección Semántica, Scroll, Swipe, Clic, Input) ----------
  function getScreenZoneAndCoords(clientX, clientY) {
    var vw = Math.max(1, document.documentElement.clientWidth || window.innerWidth || 1);
    var vh = Math.max(1, document.documentElement.clientHeight || window.innerHeight || 1);
    var x = Math.round(typeof clientX === "number" ? clientX : vw / 2);
    var y = Math.round(typeof clientY === "number" ? clientY : vh / 2);
    var xPct = Math.max(0, Math.min(100, Math.round((x / vw) * 100)));
    var yPct = Math.max(0, Math.min(100, Math.round((y / vh) * 100)));

    var vZone = yPct < 33 ? "Superior" : (yPct < 67 ? "Centro" : "Inferior");
    var hZone = xPct < 33 ? "Izquierda" : (xPct < 67 ? "Centro" : "Derecha");
    var zone = (vZone === "Centro" && hZone === "Centro") ? "Centro" : (vZone + "-" + hZone);

    return {
      x: x,
      y: y,
      xPct: xPct,
      yPct: yPct,
      vw: vw,
      vh: vh,
      zone: zone
    };
  }

  function extractLandmarkHeading(container) {
    if (!container || !container.querySelector) return "";
    var ariaLbl = container.getAttribute && (container.getAttribute("aria-label") || container.getAttribute("title") || "");
    if (ariaLbl) return ariaLbl.replace(/\s+/g, " ").trim().slice(0, 40);
    var ariaBy = container.getAttribute && container.getAttribute("aria-labelledby");
    if (ariaBy) {
      var refEl = document.getElementById(ariaBy.split(/\s+/)[0]);
      if (refEl && refEl.innerText) return refEl.innerText.replace(/\s+/g, " ").trim().slice(0, 40);
    }
    var h = container.querySelector("h1, h2, h3, h4, legend, [class*='title'], [class*='header']");
    if (h && h.innerText) {
      var ht = h.innerText.replace(/\s+/g, " ").trim();
      if (ht) return ht.slice(0, 40);
    }
    return "";
  }

  function getSemanticSection(el) {
    if (!el || el.nodeType !== 1) return "Página principal";
    var parts = [];
    var cur = el;
    var modalFound = false;
    var landmarkFound = false;

    while (cur && cur !== document.body && cur !== document.documentElement) {
      var tag = (cur.tagName || "").toLowerCase();
      var role = (cur.getAttribute && cur.getAttribute("role")) || "";
      var ariaModal = (cur.getAttribute && cur.getAttribute("aria-modal")) || "";
      var clsId = ((typeof cur.className === "string" ? cur.className : "") + " " + (cur.id || ""));

      if (!modalFound && (tag === "dialog" || ariaModal === "true" || role === "dialog" || role === "alertdialog" || /\b(modal|dialog|drawer|popup|popover|sheet|lightbox)\b/i.test(clsId))) {
        modalFound = true;
        var mTitle = extractLandmarkHeading(cur);
        var mId = cur.id ? ("#" + cur.id) : "";
        parts.unshift("Modal" + mId + (mTitle ? (' "' + mTitle + '"') : ""));
      } else if (!landmarkFound) {
        if (tag === "header" || role === "banner") {
          landmarkFound = true;
          parts.unshift("Encabezado (<header>)");
        } else if (tag === "nav" || role === "navigation") {
          landmarkFound = true;
          var nTitle = extractLandmarkHeading(cur);
          parts.unshift("Navegación (<nav>" + (nTitle ? ' "' + nTitle + '"' : "") + ")");
        } else if (tag === "form") {
          var fTitle = extractLandmarkHeading(cur) || cur.getAttribute("name") || (cur.id ? "#" + cur.id : "");
          parts.unshift("Formulario" + (fTitle ? (' "' + fTitle + '"') : " (<form>)"));
        } else if (tag === "table") {
          parts.unshift("Tabla (<table>)");
        } else if (tag === "aside" || role === "complementary") {
          landmarkFound = true;
          parts.unshift("Barra lateral (<aside>)");
        } else if (tag === "footer" || role === "contentinfo") {
          landmarkFound = true;
          parts.unshift("Pie de página (<footer>)");
        } else if (tag === "section" || tag === "article") {
          landmarkFound = true;
          var sTitle = extractLandmarkHeading(cur) || (cur.id ? "#" + cur.id : "");
          parts.unshift("Sección" + (sTitle ? (' "' + sTitle + '"') : (" (<" + tag + ">)")));
        } else if (tag === "main" || role === "main") {
          landmarkFound = true;
          var mainTitle = cur.id ? ("#" + cur.id) : "";
          parts.unshift("Contenido principal (<main" + mainTitle + ">)");
        }
      }
      cur = cur.parentElement;
    }

    if (!parts.length) {
      var nearSection = el.closest && el.closest("[id]");
      if (nearSection && nearSection !== document.body) {
        return "Contenedor #" + nearSection.id;
      }
      return "Cuerpo de página (<body>)";
    }
    // Evitar duplicados consecutivos y limitar a 2 niveles claros
    var unique = [];
    for (var i = 0; i < parts.length; i++) {
      if (unique.indexOf(parts[i]) === -1) unique.push(parts[i]);
    }
    return unique.slice(0, 2).join(" › ");
  }

  function getElementBox(el) {
    if (!el || !el.getBoundingClientRect) return {};
    var r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left),
      y: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height)
    };
  }

  // 1. Emitir scroll sincronizado (ventana y contenedores internos) y registrar en el Rastreador de Usuario
  var scrollTrackState = {
    timer: null,
    startX: lastScrollX,
    startY: lastScrollY,
    targetEl: null,
    tracking: false
  };

  window.addEventListener("scroll", function (e) {
    var target = e.target;
    var isDocScroll = (!target || target === document || target === document.documentElement || target === document.body);
    var x = isDocScroll ? (window.pageXOffset || document.documentElement.scrollLeft || 0) : (target.scrollLeft || 0);
    var y = isDocScroll ? (window.pageYOffset || document.documentElement.scrollTop || 0) : (target.scrollTop || 0);

    if (Date.now() < ignoreScrollUntil || isReplayingSync) {
      if (isDocScroll) {
        lastScrollX = x;
        lastScrollY = y;
      }
      return;
    }

    if (isDocScroll) {
      var dx = x - lastScrollX;
      var dy = y - lastScrollY;
      lastScrollX = x;
      lastScrollY = y;
      if (dx !== 0 || dy !== 0) {
        if (syncActive) {
          try {
            parent.postMessage({
              type: "rv:sync_scroll",
              frame: F,
              x: x,
              y: y,
              dx: dx,
              dy: dy
            }, ORIGIN);
          } catch (_e) {}
        }
      }
    } else if (target && target.nodeType === 1 && syncActive) {
      try {
        parent.postMessage({
          type: "rv:sync_scroll",
          frame: F,
          containerSelector: getSelector(target, false),
          x: x,
          y: y
        }, ORIGIN);
      } catch (_e) {}
    }

    // Consolidar el deslizamiento para el Rastreador del Usuario
    if (!scrollTrackState.tracking || scrollTrackState.targetEl !== (isDocScroll ? null : target)) {
      scrollTrackState.tracking = true;
      scrollTrackState.targetEl = isDocScroll ? null : target;
      scrollTrackState.startX = x;
      scrollTrackState.startY = y;
    }
    clearTimeout(scrollTrackState.timer);
    scrollTrackState.timer = setTimeout(function () {
      var endX = isDocScroll ? (window.pageXOffset || document.documentElement.scrollLeft || 0) : (target ? target.scrollLeft || 0 : 0);
      var endY = isDocScroll ? (window.pageYOffset || document.documentElement.scrollTop || 0) : (target ? target.scrollTop || 0 : 0);
      var totalDx = Math.round(endX - scrollTrackState.startX);
      var totalDy = Math.round(endY - scrollTrackState.startY);
      scrollTrackState.tracking = false;

      if (Math.abs(totalDx) < 12 && Math.abs(totalDy) < 12) return;

      var vw = Math.max(1, document.documentElement.clientWidth || window.innerWidth || 1);
      var vh = Math.max(1, document.documentElement.clientHeight || window.innerHeight || 1);
      var maxScrollY = isDocScroll
        ? Math.max(1, (document.documentElement.scrollHeight || document.body.scrollHeight || vh) - vh)
        : Math.max(1, (target.scrollHeight || vh) - (target.clientHeight || vh));
      var depthY = Math.max(0, Math.min(100, Math.round((endY / maxScrollY) * 100)));

      var dirParts = [];
      if (Math.abs(totalDy) >= 12) {
        dirParts.push((totalDy > 0 ? "Abajo +" : "Arriba ") + totalDy + "px");
      }
      if (Math.abs(totalDx) >= 12) {
        dirParts.push((totalDx > 0 ? "Derecha +" : "Izquierda ") + totalDx + "px");
      }
      var dirSummary = dirParts.join(", ") + " (profundidad: " + depthY + "%)";

      var centerEl = null;
      try {
        centerEl = isDocScroll ? document.elementFromPoint(vw / 2, vh / 2) : target;
      } catch (_e) {}
      var secName = getSemanticSection(centerEl || target || document.body);
      var scrollSel = isDocScroll ? "window" : getSelector(target, false);
      var zInfo = getScreenZoneAndCoords(vw / 2, vh / 2);

      try {
        parent.postMessage({
          type: "rv:flow_event",
          frame: F,
          device: D,
          action: "scroll",
          selector: scrollSel,
          tag: isDocScroll ? "window" : (target.tagName || "").toLowerCase(),
          label: dirSummary,
          value: "scrollTop=" + Math.round(endY) + "px (" + depthY + "%)",
          section: secName,
          zone: isDocScroll ? ("Vista al " + depthY + "%") : zInfo.zone,
          coords: {
            x: zInfo.x,
            y: zInfo.y,
            xPct: zInfo.xPct,
            yPct: depthY,
            dx: totalDx,
            dy: totalDy,
            scrollTop: Math.round(endY),
            scrollLeft: Math.round(endX),
            depthY: depthY,
            vw: vw,
            vh: vh
          },
          url: getCurrentPageUrl()
        }, ORIGIN);
      } catch (_e) {}
    }, 320);
  }, true);

  // 1b. Detectar gestos de arrastre / swipe horizontal o vertical
  var pointerDownState = null;
  window.addEventListener("pointerdown", function (e) {
    if (inspectorActive || isReplayingSync || !e.isTrusted) return;
    pointerDownState = {
      x: e.clientX,
      y: e.clientY,
      time: Date.now(),
      target: e.target
    };
  }, true);

  window.addEventListener("pointerup", function (e) {
    if (!pointerDownState || inspectorActive || isReplayingSync || !e.isTrusted) return;
    var st = pointerDownState;
    pointerDownState = null;
    var dx = Math.round(e.clientX - st.x);
    var dy = Math.round(e.clientY - st.y);
    var dist = Math.round(Math.sqrt(dx * dx + dy * dy));
    var elapsed = Date.now() - st.time;
    if (dist < 40 || elapsed > 2500) return;

    var el = (st.target && st.target.nodeType === 1) ? st.target : document.body;
    var zStart = getScreenZoneAndCoords(st.x, st.y);
    var zEnd = getScreenZoneAndCoords(e.clientX, e.clientY);
    var dir = Math.abs(dx) >= Math.abs(dy)
      ? (dx > 0 ? "Derecha +" + dx + "px" : "Izquierda " + dx + "px")
      : (dy > 0 ? "Abajo +" + dy + "px" : "Arriba " + dy + "px");

    try {
      parent.postMessage({
        type: "rv:flow_event",
        frame: F,
        device: D,
        action: "swipe",
        selector: getSelector(el, false),
        tag: (el.tagName || "").toLowerCase(),
        label: "Deslizar / Arrastrar (" + dir + ")",
        value: "(" + zStart.x + "," + zStart.y + ") → (" + zEnd.x + "," + zEnd.y + ")",
        section: getSemanticSection(el),
        zone: zStart.zone + " → " + zEnd.zone,
        coords: {
          x: zStart.x,
          y: zStart.y,
          xPct: zStart.xPct,
          yPct: zStart.yPct,
          endX: zEnd.x,
          endY: zEnd.y,
          dx: dx,
          dy: dy,
          vw: zStart.vw,
          vh: zStart.vh
        },
        box: getElementBox(el),
        url: getCurrentPageUrl()
      }, ORIGIN);
    } catch (_e) {}
  }, true);

  // 2. Emitir clics sincronizados y registrar en el Rastreador de Usuario (con coordenadas, zona y sección)
  window.addEventListener("click", function (e) {
    if (inspectorActive || isReplayingSync || !e.isTrusted) return;
    var target = e.target;
    if (!target || target === overlayEl || (overlayEl && overlayEl.contains(target))) return;

    var interactive = target.closest && target.closest("a, button, [role='button'], input, select, textarea, label, summary");
    var mainEl = interactive || target;
    var tag = mainEl.tagName ? mainEl.tagName.toLowerCase() : "";
    var text = (mainEl.innerText || mainEl.getAttribute("aria-label") || mainEl.getAttribute("title") || mainEl.getAttribute("placeholder") || mainEl.value || "").replace(/\s+/g, " ").trim().slice(0, 80);
    var aEl = target.closest && target.closest("a[href]");
    var href = aEl ? aEl.getAttribute("href") : "";
    var absHref = aEl ? aEl.href : "";
    var bestSel = interactive ? getSelector(interactive, false) : getSelector(target, false);

    var box = getElementBox(mainEl);
    var cx = (e.clientX && e.clientX > 0) ? e.clientX : ((box.x || 0) + (box.width || 0) / 2);
    var cy = (e.clientY && e.clientY > 0) ? e.clientY : ((box.y || 0) + (box.height || 0) / 2);
    var zInfo = getScreenZoneAndCoords(cx, cy);
    var secName = getSemanticSection(mainEl);

    try {
      parent.postMessage({
        type: "rv:flow_event",
        frame: F,
        device: D,
        action: "click",
        selector: bestSel,
        tag: tag,
        label: text,
        value: href || "",
        section: secName,
        zone: zInfo.zone + " (" + zInfo.xPct + "%, " + zInfo.yPct + "%)",
        coords: zInfo,
        box: box,
        url: getCurrentPageUrl()
      }, ORIGIN);
    } catch (_e) {}

    if (!syncActive) return;

    try {
      parent.postMessage({
        type: "rv:sync_click",
        frame: F,
        selector: getSelector(target, false),
        structuralSelector: getSelector(target, true),
        interactiveSelector: interactive ? getSelector(interactive, false) : "",
        interactiveStructural: interactive ? getSelector(interactive, true) : "",
        tag: tag,
        text: text,
        href: href,
        absHref: absHref
      }, ORIGIN);
    } catch (_e) {}
  }, true);

  // 3. Emitir escritura / cambios en inputs y registrar en el Rastreador de Usuario
  var flowInputTimers = new WeakMap();
  function onSyncInput(e) {
    if (inspectorActive || isReplayingSync || !e.isTrusted) return;
    var t = e.target;
    if (!t || !t.tagName) return;
    var tag = t.tagName.toLowerCase();
    if (tag !== "input" && tag !== "textarea" && tag !== "select") return;
    var inputType = (t.type || "").toLowerCase();
    var sel = getSelector(t, false);

    // Debounce para el grabador de flujo (registra el valor consolidado que escribió el usuario)
    if (e.type === "change" || e.type === "input") {
      clearTimeout(flowInputTimers.get(t));
      var timer = setTimeout(function () {
        var displayVal = inputType === "password" ? "••••••••" : (inputType === "checkbox" || inputType === "radio" ? (t.checked ? "checked" : "unchecked") : String(t.value || ""));
        var box = getElementBox(t);
        var zInfo = getScreenZoneAndCoords((box.x || 0) + (box.width || 0) / 2, (box.y || 0) + (box.height || 0) / 2);
        var secName = getSemanticSection(t);
        try {
          parent.postMessage({
            type: "rv:flow_event",
            frame: F,
            device: D,
            action: "input",
            selector: sel,
            tag: tag,
            inputType: inputType,
            label: t.placeholder || t.name || t.id || tag,
            value: displayVal.slice(0, 200),
            section: secName,
            zone: zInfo.zone + " (" + zInfo.xPct + "%, " + zInfo.yPct + "%)",
            coords: zInfo,
            box: box,
            url: getCurrentPageUrl()
          }, ORIGIN);
        } catch (_e) {}
      }, e.type === "change" ? 40 : 550);
      flowInputTimers.set(t, timer);
    }

    if (!syncActive) return;

    try {
      parent.postMessage({
        type: "rv:sync_input",
        frame: F,
        eventType: e.type,
        selector: sel,
        structuralSelector: getSelector(t, true),
        id: t.id || "",
        name: t.name || "",
        tag: tag,
        value: t.value,
        checked: !!t.checked,
        inputType: inputType
      }, ORIGIN);
    } catch (_e) {}
  }
  window.addEventListener("input", onSyncInput, true);
  window.addEventListener("change", onSyncInput, true);

  // 4. Registrar envío de formularios y teclas clave (Enter / Escape)
  window.addEventListener("submit", function (e) {
    if (inspectorActive || isReplayingSync || !e.isTrusted) return;
    var form = e.target;
    if (!form || !form.tagName) return;
    var box = getElementBox(form);
    var zInfo = getScreenZoneAndCoords((box.x || 0) + (box.width || 0) / 2, (box.y || 0) + (box.height || 0) / 2);
    try {
      parent.postMessage({
        type: "rv:flow_event",
        frame: F,
        device: D,
        action: "submit",
        selector: getSelector(form, false),
        tag: "form",
        label: extractLandmarkHeading(form) || form.getAttribute("action") || "Formulario",
        value: form.getAttribute("method") || "POST",
        section: getSemanticSection(form),
        zone: zInfo.zone + " (" + zInfo.xPct + "%, " + zInfo.yPct + "%)",
        coords: zInfo,
        box: box,
        url: getCurrentPageUrl()
      }, ORIGIN);
    } catch (_e) {}
  }, true);

  window.addEventListener("keydown", function (e) {
    if (inspectorActive || isReplayingSync || !e.isTrusted) return;
    if (e.key !== "Enter" && e.key !== "Escape") return;
    var activeEl = document.activeElement || document.body;
    var box = getElementBox(activeEl);
    var zInfo = getScreenZoneAndCoords((box.x || 0) + (box.width || 0) / 2, (box.y || 0) + (box.height || 0) / 2);
    try {
      parent.postMessage({
        type: "rv:flow_event",
        frame: F,
        device: D,
        action: "keypress",
        selector: getSelector(activeEl, false),
        tag: (activeEl.tagName || "body").toLowerCase(),
        label: "Tecla " + e.key,
        value: e.key,
        section: getSemanticSection(activeEl),
        zone: zInfo.zone,
        coords: zInfo,
        box: box,
        url: getCurrentPageUrl()
      }, ORIGIN);
    } catch (_e) {}
  }, true);

  function findSyncedClickElement(d) {
    var selectors = [d.selector, d.interactiveSelector, d.structuralSelector, d.interactiveStructural];
    for (var i = 0; i < selectors.length; i++) {
      var sel = selectors[i];
      if (!sel) continue;
      try {
        var found = document.querySelector(sel);
        if (found && isVisible(found)) return found;
      } catch (_e) {}
    }
    if (d.href) {
      try {
        var links = document.querySelectorAll("a[href]");
        for (var j = 0; j < links.length; j++) {
          if (links[j].getAttribute("href") === d.href && isVisible(links[j])) return links[j];
        }
      } catch (_e) {}
    }
    if (d.tag && d.text) {
      var candidates = document.querySelectorAll(d.tag);
      for (var k = 0; k < candidates.length; k++) {
        var cText = (candidates[k].innerText || "").trim().slice(0, 80);
        if (cText === d.text && isVisible(candidates[k])) return candidates[k];
      }
    }
    // Último intento aunque no sea visible (p. ej. enlace en menú móvil cerrado)
    for (var m = 0; m < selectors.length; m++) {
      if (!selectors[m]) continue;
      try {
        var anyEl = document.querySelector(selectors[m]);
        if (anyEl) return anyEl;
      } catch (_e) {}
    }
    return null;
  }

  window.addEventListener("message", function (e) {
    if (e.origin !== ORIGIN || !e.data) return;
    var d = e.data;
    if (d.type === "rv:set_inspector") {
      inspectorActive = !!d.active;
      if (!inspectorActive && overlayEl) {
        overlayEl.style.display = "none";
      }
    } else if (d.type === "rv:set_sync") {
      syncActive = !!d.active;
    } else if (d.type === "rv:do_sync_scroll") {
      if (!syncActive && !d.force) return;
      ignoreScrollUntil = Date.now() + 90;
      if (d.containerSelector) {
        try {
          var cEl = document.querySelector(d.containerSelector);
          if (cEl) {
            cEl.scrollLeft = d.x || 0;
            cEl.scrollTop = d.y || 0;
          }
        } catch (_e) {}
        return;
      }
      if (d.y !== undefined && d.y <= 1) {
        window.scrollTo(d.x <= 1 ? 0 : (window.pageXOffset + d.dx), 0);
      } else {
        window.scrollBy(d.dx, d.dy);
      }
      lastScrollX = window.pageXOffset || document.documentElement.scrollLeft || 0;
      lastScrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
    } else if (d.type === "rv:do_sync_click") {
      if (!syncActive) return;
      var el = findSyncedClickElement(d);
      isReplayingSync = true;
      try {
        if (el) {
          showSyncPulse(el);
          if (typeof el.focus === "function") el.focus({ preventScroll: true });
          el.click();
        } else if (d.absHref && proxiable(d.absHref)) {
          var here = document.baseURI.split("#")[0];
          if (d.absHref.split("#")[0] !== here || d.absHref.indexOf("#") === -1) {
            location.href = via(d.absHref);
          }
        }
      } catch (_e) {}
      setTimeout(function () { isReplayingSync = false; }, 60);
    } else if (d.type === "rv:do_sync_input") {
      if (!syncActive) return;
      var inp = null;
      var inpSelectors = [d.selector, d.structuralSelector];
      for (var i = 0; i < inpSelectors.length; i++) {
        if (!inpSelectors[i]) continue;
        try {
          inp = document.querySelector(inpSelectors[i]);
          if (inp) break;
        } catch (_e) {}
      }
      if (!inp && d.id) inp = document.getElementById(d.id);
      if (!inp && d.name) {
        try { inp = document.querySelector(d.tag + '[name="' + safeIdent(d.name) + '"]'); } catch (_e) {}
      }
      if (inp) {
        isReplayingSync = true;
        try {
          if (d.inputType === "checkbox" || d.inputType === "radio") {
            inp.checked = d.checked;
          } else {
            inp.value = d.value;
          }
          inp.dispatchEvent(new Event("input", { bubbles: true }));
          if (d.eventType === "change") {
            inp.dispatchEvent(new Event("change", { bubbles: true }));
          }
        } catch (_e) {}
        setTimeout(function () { isReplayingSync = false; }, 40);
      }
    } else if (d.type === "rv:run_diagnostics") {
      runVisualAudit(!!d.highlight);
      reportStorageSnapshot();
    } else if (d.type === "rv:set_audit_highlight") {
      auditHighlightEnabled = !!d.active;
      if (auditHighlightEnabled) {
        runVisualAudit(true);
      } else {
        clearAuditMarkers();
      }
    } else if (d.type === "rv:focus_audit_element") {
      focusAuditElement(d.selector);
    } else if (d.type === "rv:request_dom_layout") {
      sendDomLayoutSnapshot(d.requestId);
    }
  });

  // ---------- 4. Detector Automático de Problemas Visuales / Responsive ----------
  var auditHighlightEnabled = false;
  var auditMarkerEls = [];
  var lastAuditIssues = [];

  function clearAuditMarkers() {
    while (auditMarkerEls.length) {
      var m = auditMarkerEls.pop();
      if (m && m.parentNode) m.parentNode.removeChild(m);
    }
  }

  function renderAuditMarkers(issues) {
    clearAuditMarkers();
    if (!auditHighlightEnabled || !issues || !issues.length) return;
    var sx = window.pageXOffset || document.documentElement.scrollLeft || 0;
    var sy = window.pageYOffset || document.documentElement.scrollTop || 0;
    issues.forEach(function (iss) {
      if (!iss.box || !iss.box.width || !iss.box.height) return;
      var marker = document.createElement("div");
      marker.className = "__rv_audit_marker";
      var isErr = iss.severity === "error";
      var color = isErr ? "#EF4444" : "#F59E0B";
      marker.style.cssText =
        "position:absolute;pointer-events:none;z-index:2147483645;" +
        "border:2px dashed " + color + ";background:" + (isErr ? "rgba(239,68,68,0.14)" : "rgba(245,158,11,0.14)") + ";" +
        "box-sizing:border-box;border-radius:3px;" +
        "top:" + (iss.box.y + sy) + "px;left:" + (iss.box.x + sx) + "px;" +
        "width:" + iss.box.width + "px;height:" + iss.box.height + "px;";
      var pill = document.createElement("span");
      pill.style.cssText =
        "position:absolute;top:-18px;left:0;background:" + color + ";color:#fff;" +
        "font:700 9.5px/1.2 monospace;padding:2px 5px;border-radius:3px;white-space:nowrap;";
      pill.textContent = iss.kind + " (" + iss.box.width + "×" + iss.box.height + ")";
      marker.appendChild(pill);
      (document.body || document.documentElement).appendChild(marker);
      auditMarkerEls.push(marker);
    });
  }

  function focusAuditElement(selector) {
    if (!selector) return;
    try {
      var el = document.querySelector(selector);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      setTimeout(function () {
        showSyncPulse(el);
        if (auditHighlightEnabled) runVisualAudit(true);
      }, 260);
    } catch (_e) {}
  }

  function hasOverflowHiddenAncestor(el) {
    var cur = el.parentElement;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      try {
        var cs = window.getComputedStyle(cur);
        if (cs.overflowX === "hidden" || cs.overflowX === "clip" || cs.overflowX === "auto" || cs.overflowX === "scroll") {
          return true;
        }
      } catch (_e) {}
      cur = cur.parentElement;
    }
    return false;
  }

  function runVisualAudit(forceHighlight) {
    if (forceHighlight !== undefined) auditHighlightEnabled = !!forceHighlight;
    var issues = [];
    var seenSelectors = {};
    try {
      var docEl = document.documentElement;
      var vw = docEl.clientWidth || window.innerWidth || 0;
      var vh = docEl.clientHeight || window.innerHeight || 0;
      if (vw <= 0) return;

      var all = document.body ? document.body.querySelectorAll("*") : [];
      var maxNodes = Math.min(all.length, 900);

      for (var i = 0; i < maxNodes; i++) {
        var el = all[i];
        if (!el || el === overlayEl || (el.classList && el.classList.contains("__rv_audit_marker"))) continue;
        var tag = el.tagName.toLowerCase();
        if (tag === "script" || tag === "style" || tag === "meta" || tag === "link" || tag === "noscript") continue;

        var r = el.getBoundingClientRect();
        if (r.width <= 0 && r.height <= 0 && tag !== "img") continue;

        var cs = window.getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) continue;

        var sel = getSelector(el, false);
        var diag = null;

        // 1. Imágenes rotas o deformadas
        if (tag === "img") {
          var src = el.getAttribute("src") || "";
          if (!src || (el.complete && el.naturalWidth === 0)) {
            diag = diag || extractElementDiagnostics(el, r);
            issues.push({
              kind: "IMG-ROTA",
              severity: "error",
              selector: sel,
              tag: tag,
              summary: "Imagen rota o sin cargar (" + (src ? src.slice(0, 50) : "sin src") + ")",
              detail: "El elemento <img> no cargó correctamente (naturalWidth = 0). src=" + src,
              box: diag.box,
              styles: diag.stylesSummary,
              html: (el.outerHTML || "").slice(0, 600)
            });
            continue;
          } else if (el.complete && el.naturalWidth > 10 && el.naturalHeight > 10 && r.width > 24 && r.height > 24) {
            var natRatio = el.naturalWidth / el.naturalHeight;
            var curRatio = r.width / r.height;
            var diffRatio = Math.abs(natRatio - curRatio) / natRatio;
            if (diffRatio > 0.22 && cs.objectFit !== "cover" && cs.objectFit !== "contain" && cs.objectFit !== "scale-down") {
              diag = diag || extractElementDiagnostics(el, r);
              issues.push({
                kind: "IMG-DEFORMADA",
                severity: "warn",
                selector: sel,
                tag: tag,
                summary: "Proporción de imagen estirada (" + Math.round(r.width) + "×" + Math.round(r.height) + "px vs original " + el.naturalWidth + "×" + el.naturalHeight + ")",
                detail: "La imagen pierde su aspect-ratio original en este viewport. Sugerencia CSS: agregar object-fit: cover o height: auto.",
                box: diag.box,
                styles: diag.stylesSummary,
                html: (el.outerHTML || "").slice(0, 600)
              });
            }
          }
        }

        // 2. Desbordamiento horizontal fuera del viewport (causa scroll horizontal roto)
        var overflowRight = Math.round(r.right - vw);
        var overflowLeft = Math.round(-r.left);
        if ((overflowRight > 3 || overflowLeft > 3) && !hasOverflowHiddenAncestor(el) && cs.position !== "fixed") {
          // Evitar reportar al padre si un hijo directo también desborda igual
          var childOverflowsSame = false;
          if (el.children && el.children.length) {
            for (var c = 0; c < el.children.length; c++) {
              var cr = el.children[c].getBoundingClientRect();
              if (Math.round(cr.right - vw) >= overflowRight - 2) {
                childOverflowsSame = true;
                break;
              }
            }
          }
          if (!childOverflowsSame && !seenSelectors["ov:" + sel]) {
            seenSelectors["ov:" + sel] = true;
            diag = diag || extractElementDiagnostics(el, r);
            var sideMsg = overflowRight > 3
              ? ("se sale +" + overflowRight + "px por la derecha del viewport (" + vw + "px)")
              : ("se sale -" + overflowLeft + "px por la izquierda del viewport");
            issues.push({
              kind: "DESBORDE-X",
              severity: "error",
              selector: sel,
              tag: tag,
              summary: "<" + tag + "> (" + Math.round(r.width) + "×" + Math.round(r.height) + "px) " + sideMsg,
              detail: "El elemento excede el ancho de la pantalla (" + vw + "px) provocando desbordamiento horizontal.",
              box: diag.box,
              styles: diag.stylesSummary,
              html: (el.outerHTML || "").slice(0, 600)
            });
          }
        }

        // 3. Texto truncado / cortado sin ellipsis
        if (el.children.length === 0 && (el.textContent || "").trim().length > 3) {
          if (el.scrollWidth > el.clientWidth + 8 && (cs.overflowX === "hidden" || cs.overflowX === "clip") && cs.textOverflow !== "ellipsis") {
            diag = diag || extractElementDiagnostics(el, r);
            issues.push({
              kind: "TEXTO-CORTADO",
              severity: "warn",
              selector: sel,
              tag: tag,
              summary: "Texto cortado horizontalmente (" + el.clientWidth + "px disponibles para " + el.scrollWidth + "px)",
              detail: "Contenido de texto \"" + (el.textContent || "").trim().slice(0, 60) + "\" excede su contenedor con overflow:hidden sin text-overflow:ellipsis.",
              box: diag.box,
              styles: diag.stylesSummary,
              html: (el.outerHTML || "").slice(0, 600)
            });
          }
        }

        // 4. Botones / enlaces demasiado pequeños en móvil (< 28x28px)
        if (vw <= 500 && (tag === "button" || tag === "input" || (tag === "a" && el.getAttribute("href")))) {
          if (r.width > 0 && r.height > 0 && (r.width < 26 || r.height < 26)) {
            diag = diag || extractElementDiagnostics(el, r);
            issues.push({
              kind: "ÁREA-TÁCTIL",
              severity: "warn",
              selector: sel,
              tag: tag,
              summary: "Control interactivo muy pequeño en móvil (" + Math.round(r.width) + "×" + Math.round(r.height) + "px)",
              detail: "En pantallas táctiles se recomienda al menos 32×32px (ideal 44×44px) para evitar errores al tocar.",
              box: diag.box,
              styles: diag.stylesSummary,
              html: (el.outerHTML || "").slice(0, 600)
            });
          }
        }

        if (issues.length >= 35) break;
      }
    } catch (_e) {}

    lastAuditIssues = issues;
    if (auditHighlightEnabled) {
      renderAuditMarkers(issues);
    }

    try {
      parent.postMessage({
        type: "rv:audit_results",
        frame: F,
        device: D,
        url: getCurrentPageUrl(),
        issues: issues
      }, ORIGIN);
    } catch (_e) {}
  }

  // ---------- 5. Inspector de Storage (localStorage, sessionStorage, document.cookie) ----------
  function reportStorageSnapshot() {
    var localItems = [];
    var sessionItems = [];
    var docCookies = [];
    try {
      if (window.localStorage) {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf("rv.") !== 0) {
            localItems.push({ key: k, value: localStorage.getItem(k) });
          }
        }
      }
    } catch (_e) {}
    try {
      if (window.sessionStorage) {
        for (var j = 0; j < sessionStorage.length; j++) {
          var sk = sessionStorage.key(j);
          if (sk && sk.indexOf("rv.") !== 0) {
            sessionItems.push({ key: sk, value: sessionStorage.getItem(sk) });
          }
        }
      }
    } catch (_e) {}
    try {
      if (document.cookie) {
        document.cookie.split(";").forEach(function (pair) {
          var eq = pair.indexOf("=");
          if (eq > -1) {
            docCookies.push({
              key: pair.slice(0, eq).trim(),
              value: pair.slice(eq + 1).trim()
            });
          }
        });
      }
    } catch (_e) {}

    try {
      parent.postMessage({
        type: "rv:storage_snapshot",
        frame: F,
        device: D,
        url: getCurrentPageUrl(),
        local: localItems,
        session: sessionItems,
        doc_cookies: docCookies
      }, ORIGIN);
    } catch (_e) {}
  }

  // ---------- 6. Captura de Geometría DOM para Snapshot Visual Anotado ----------
  function sendDomLayoutSnapshot(requestId) {
    var nodes = [];
    var bgPage = "#ffffff";
    try {
      var bodyCs = window.getComputedStyle(document.body || document.documentElement);
      if (bodyCs.backgroundColor && bodyCs.backgroundColor !== "rgba(0, 0, 0, 0)") {
        bgPage = bodyCs.backgroundColor;
      } else {
        var htmlCs = window.getComputedStyle(document.documentElement);
        if (htmlCs.backgroundColor && htmlCs.backgroundColor !== "rgba(0, 0, 0, 0)") {
          bgPage = htmlCs.backgroundColor;
        }
      }
      var vw = document.documentElement.clientWidth || window.innerWidth || 0;
      var vh = document.documentElement.clientHeight || window.innerHeight || 0;
      var all = document.body ? document.body.querySelectorAll("*") : [];
      var limit = Math.min(all.length, 3000);

      for (var i = 0; i < limit; i++) {
        var el = all[i];
        if (!el || el === overlayEl || (el.classList && el.classList.contains("__rv_audit_marker"))) continue;
        var r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw + 120) continue;
        if (r.width < 2 || r.height < 2) continue;
        var cs = window.getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) continue;

        var bg = cs.backgroundColor !== "rgba(0, 0, 0, 0)" ? cs.backgroundColor : "";
        var bCol = (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopColor !== "rgba(0, 0, 0, 0)") ? cs.borderTopColor : "";
        var radius = parseFloat(cs.borderTopLeftRadius) || 0;
        var directText = "";
        for (var c = 0; c < el.childNodes.length; c++) {
          if (el.childNodes[c].nodeType === 3) {
            directText += el.childNodes[c].nodeValue;
          }
        }
        directText = directText.replace(/\s+/g, " ").trim().slice(0, 65);
        var tag = el.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "button") {
          directText = directText || (el.value || el.placeholder || "").slice(0, 50);
        }

        if (bg || bCol || directText || tag === "img" || tag === "button" || tag === "input") {
          var z = parseInt(cs.zIndex, 10);
          var isFixed = cs.position === "fixed" || tag === "dialog" || el.getAttribute("aria-modal") === "true";
          nodes.push({
            tag: tag,
            x: Math.round(r.left),
            y: Math.round(r.top),
            w: Math.round(r.width),
            h: Math.round(r.height),
            bg: bg,
            border: bCol,
            radius: Math.min(24, Math.round(radius)),
            text: directText,
            color: cs.color || "#111827",
            fontSize: Math.min(28, Math.max(9, parseFloat(cs.fontSize) || 13)),
            fontWeight: cs.fontWeight || "400",
            tier: isFixed ? 2 : (cs.position !== "static" ? 1 : 0),
            z: isNaN(z) ? 0 : z,
            order: i
          });
        }
      }
      nodes.sort(function (a, b) {
        if (a.tier !== b.tier) return a.tier - b.tier;
        if (a.z !== b.z) return a.z - b.z;
        return a.order - b.order;
      });
    } catch (_e) {}

    try {
      parent.postMessage({
        type: "rv:dom_layout_snapshot",
        requestId: requestId,
        frame: F,
        device: D,
        url: getCurrentPageUrl(),
        bgPage: bgPage,
        nodes: nodes,
        auditIssues: lastAuditIssues
      }, ORIGIN);
    } catch (_e) {}
  }

  window.addEventListener("load", function () {
    setTimeout(function () {
      runVisualAudit();
      reportStorageSnapshot();
    }, 500);
  });
})();
