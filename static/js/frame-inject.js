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
  var CERT_ACTIVE = (typeof __CERT_ACTIVE__ !== "undefined") ? !!__CERT_ACTIVE__ : false;
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

  function isSameSiteAsset(u) {
    if (!proxiable(u)) return false;
    try {
      var baseHost = new URL(document.baseURI).hostname.toLowerCase();
      var targetHost = new URL(u).hostname.toLowerCase();
      if (baseHost === targetHost) return true;
      var bp = baseHost.split(".");
      var tp = targetHost.split(".");
      if (bp.length >= 2 && tp.length >= 2 && bp.slice(-2).join(".") === tp.slice(-2).join(".")) {
        return true;
      }
    } catch (_e) {}
    return false;
  }

  if (CERT_ACTIVE && typeof MutationObserver === "function") {
    var certAssetObs = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        if (!added) continue;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (!node || node.nodeType !== 1) continue;
          var tag = (node.tagName || "").toLowerCase();
          if (tag === "script" || tag === "img" || tag === "source") {
            var rawSrc = node.getAttribute("src");
            if (rawSrc && rawSrc.indexOf("/proxy?") === -1) {
              var absSrc = abs(rawSrc);
              if (isSameSiteAsset(absSrc)) node.setAttribute("src", via(absSrc));
            }
          } else if (tag === "link") {
            var rawHref = node.getAttribute("href");
            if (rawHref && rawHref.indexOf("/proxy?") === -1) {
              var absHref = abs(rawHref);
              if (isSameSiteAsset(absHref)) node.setAttribute("href", via(absHref));
            }
          }
        }
      }
    });
    try {
      certAssetObs.observe(document.documentElement || document, { childList: true, subtree: true });
    } catch (_e) {}
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
    var secName = typeof getSemanticSection === "function" ? getSemanticSection(target) : "";
    var elText = (target.innerText || target.getAttribute("aria-label") || target.getAttribute("title") || target.getAttribute("placeholder") || target.value || "").replace(/\s+/g, " ").trim().slice(0, 80);

    try {
      parent.postMessage({
        type: "rv:element_picked",
        frame: F,
        device: D,
        url: getCurrentPageUrl(),
        tag: tag,
        selector: selector,
        section: secName,
        html: html,
        width: Math.round(r.width),
        height: Math.round(r.height),
        box: diag.box,
        stylesSummary: diag.stylesSummary,
        stylesMap: diag.stylesMap,
        identifiers: {
          id: target.id || "",
          testid: target.getAttribute("data-testid") || target.getAttribute("data-cy") || target.getAttribute("data-test") || "",
          name: target.getAttribute("name") || "",
          role: target.getAttribute("role") || "",
          href: target.getAttribute("href") || "",
          text: elText,
          tag: tag,
          selector: selector,
          section: secName
        }
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

  // ---------- Helpers de Modales / Overlays para Sincronización Multi-Vista ----------
  var MODAL_ROOT_SELECTOR = [
    "dialog[open]",
    "[aria-modal='true']",
    "[role='dialog']",
    "[role='alertdialog']",
    ".modal.show",
    ".modal.in",
    ".modal.is-active",
    ".modal.active",
    ".modal[style*='display: block']",
    ".modal[style*='display:block']",
    ".modal[style*='display: flex']",
    ".modal[style*='display:flex']",
    ".drawer",
    ".bottom-sheet",
    ".popup",
    "[class*='modal']",
    "[class*='dialog']",
    "[class*='drawer']",
    "[class*='bottom-sheet']",
    "[class*='sheet']"
  ].join(", ");

  function getOpenModals() {
    var list = [];
    var seen = [];
    var vw = window.innerWidth || document.documentElement.clientWidth || 1;
    var vh = window.innerHeight || document.documentElement.clientHeight || 1;
    try {
      var nodes = document.querySelectorAll(MODAL_ROOT_SELECTOR);
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (!el || el === overlayEl || (overlayEl && overlayEl.contains(el))) continue;
        if (!isVisible(el)) continue;
        var r = el.getBoundingClientRect();
        if (r.width < 80 || r.height < 60) continue;
        if (r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) continue;
        var st = window.getComputedStyle(el);
        var pos = st.position;
        var isDialogTag = el.tagName && el.tagName.toLowerCase() === "dialog";
        var hasAria = el.getAttribute("aria-modal") === "true" || el.getAttribute("role") === "dialog" || el.getAttribute("role") === "alertdialog";
        if (pos === "fixed" || pos === "absolute" || isDialogTag || hasAria || el.closest("[aria-modal='true'], [role='dialog'], dialog[open], .modal")) {
          if (seen.indexOf(el) === -1) {
            seen.push(el);
            list.push(el);
          }
        }
      }
    } catch (_e) {}

    // También detectar contenedores position:fixed grandes que actúen como modal/overlay sin clase estándar
    try {
      var centerEl = document.elementFromPoint(vw / 2, vh / 2);
      var curr = centerEl;
      while (curr && curr !== document.body && curr !== document.documentElement) {
        if (curr === overlayEl) break;
        var cst = window.getComputedStyle(curr);
        if (cst.position === "fixed") {
          var cr = curr.getBoundingClientRect();
          var isTopNavbar = cr.top <= 10 && cr.height < 100 && cr.width >= vw * 0.8;
          if (!isTopNavbar && cr.width >= 140 && cr.height >= 100 && seen.indexOf(curr) === -1) {
            seen.push(curr);
            list.push(curr);
          }
        }
        curr = curr.parentElement;
      }
    } catch (_e2) {}

    return list;
  }

  function isElementInsideModal(el) {
    if (!el || el.nodeType !== 1) return false;
    var vw = window.innerWidth || document.documentElement.clientWidth || 1;
    var curr = el;
    while (curr && curr !== document.body && curr !== document.documentElement) {
      if (curr === overlayEl) return false;
      var tag = (curr.tagName || "").toLowerCase();
      if (tag === "dialog") return true;
      var role = curr.getAttribute("role");
      if (role === "dialog" || role === "alertdialog" || curr.getAttribute("aria-modal") === "true") return true;
      var cls = (typeof curr.className === "string" ? curr.className : "").toLowerCase();
      if (/\b(modal|dialog|drawer|sheet|bottom-sheet|popup|lightbox|offcanvas)\b/.test(cls)) return true;
      try {
        var st = window.getComputedStyle(curr);
        if (st.position === "fixed") {
          var r = curr.getBoundingClientRect();
          var isTopNav = r.top <= 10 && r.height < 96 && r.width >= vw * 0.75;
          if (!isTopNav && r.height >= 100 && r.width >= 140) return true;
        }
      } catch (_e) {}
      curr = curr.parentElement;
    }
    return false;
  }

  function findEnclosingModalRoot(el) {
    if (!el || el.nodeType !== 1) return null;
    var curr = el;
    var bestFixed = null;
    while (curr && curr !== document.body && curr !== document.documentElement) {
      var tag = (curr.tagName || "").toLowerCase();
      var role = curr.getAttribute("role");
      var cls = (typeof curr.className === "string" ? curr.className : "").toLowerCase();
      if (tag === "dialog" || role === "dialog" || role === "alertdialog" || curr.getAttribute("aria-modal") === "true") {
        return curr;
      }
      if (/\b(modal-dialog|modal-content|modal|drawer|bottom-sheet|sheet|popup|offcanvas)\b/.test(cls)) {
        return curr;
      }
      try {
        var st = window.getComputedStyle(curr);
        if (st.position === "fixed" && !bestFixed) bestFixed = curr;
      } catch (_e) {}
      curr = curr.parentElement;
    }
    return bestFixed;
  }

  function isScrollableElement(el) {
    if (!el || el.nodeType !== 1) return false;
    var canV = (el.scrollHeight - el.clientHeight) > 2;
    var canH = (el.scrollWidth - el.clientWidth) > 2;
    if (!canV && !canH) return false;
    try {
      var st = window.getComputedStyle(el);
      var oy = st.overflowY;
      var ox = st.overflowX;
      var scrollYOk = canV && (oy === "auto" || oy === "scroll" || oy === "overlay" || el.tagName === "DIALOG");
      var scrollXOk = canH && (ox === "auto" || ox === "scroll" || ox === "overlay");
      return scrollYOk || scrollXOk;
    } catch (_e) {
      return canV || canH;
    }
  }

  function findBestScrollableInside(root) {
    if (!root || root.nodeType !== 1) return null;
    var best = null;
    var bestRange = 0;
    try {
      var descendants = root.querySelectorAll("*");
      for (var i = 0; i < descendants.length; i++) {
        var d = descendants[i];
        if (!isVisible(d)) continue;
        if (isScrollableElement(d)) {
          var range = (d.scrollHeight - d.clientHeight) + (d.scrollWidth - d.clientWidth);
          if (range > bestRange) {
            bestRange = range;
            best = d;
          }
        }
      }
    } catch (_e) {}
    if (best) return best;
    if (isScrollableElement(root)) return root;
    return null;
  }

  function findActiveScrollableModalContainer(hintSelector, structuralSelector, isModalScroll) {
    var selectors = [hintSelector, structuralSelector];
    for (var s = 0; s < selectors.length; s++) {
      var sel = selectors[s];
      if (!sel) continue;
      try {
        var el = document.querySelector(sel);
        if (el && isVisible(el)) {
          if (isScrollableElement(el)) return el;
          var childScroll = findBestScrollableInside(el);
          if (childScroll) return childScroll;
          var modalRoot = findEnclosingModalRoot(el);
          if (modalRoot) {
            var rootScroll = findBestScrollableInside(modalRoot);
            if (rootScroll) return rootScroll;
          }
        }
      } catch (_e) {}
    }

    if (isModalScroll) {
      var modals = getOpenModals();
      for (var m = modals.length - 1; m >= 0; m--) {
        var candidate = findBestScrollableInside(modals[m]);
        if (candidate) return candidate;
      }
    }

    // Fallback: si el selector existe aunque aún no tenga overflow mayor
    for (var f = 0; f < selectors.length; f++) {
      if (!selectors[f]) continue;
      try {
        var raw = document.querySelector(selectors[f]);
        if (raw) return raw;
      } catch (_e2) {}
    }
    return null;
  }

  function isModalCloseTrigger(el) {
    if (!el || el.nodeType !== 1) return false;
    if (!isElementInsideModal(el)) return false;
    var curr = el;
    for (var depth = 0; depth < 4 && curr && curr !== document.body; depth++) {
      var attrDismiss = (curr.getAttribute("data-bs-dismiss") || curr.getAttribute("data-dismiss") || curr.getAttribute("data-close") || "").toLowerCase();
      if (attrDismiss === "modal" || attrDismiss === "dialog" || attrDismiss === "drawer" || attrDismiss === "offcanvas" || curr.hasAttribute(" data-modal-close")) return true;
      var aria = (curr.getAttribute("aria-label") || curr.getAttribute("title") || "").toLowerCase();
      if (aria && /(close|cerrar|dismiss|salir)/.test(aria)) return true;
      var cls = (typeof curr.className === "string" ? curr.className : "").toLowerCase();
      if (/\b(btn-close|modal-close|dialog-close|close-btn|close-button|close-modal|close)\b/.test(cls)) return true;
      var txt = (curr.innerText || curr.textContent || "").trim();
      if ((txt === "×" || txt === "✕" || txt === "✖" || txt === "X" || txt === "x" || /^(cerrar|close)$/i.test(txt)) && (curr.tagName === "BUTTON" || curr.tagName === "A" || curr.getAttribute("role") === "button" || depth === 0)) {
        return true;
      }
      curr = curr.parentElement;
    }
    return false;
  }

  function isModalBackdropElement(el, clientX, clientY) {
    if (!el || el.nodeType !== 1) return false;
    var tag = (el.tagName || "").toLowerCase();
    var cls = (typeof el.className === "string" ? el.className : "").toLowerCase();
    if (/\b(modal-backdrop|backdrop|overlay|modal-overlay|dialog-backdrop|drawer-backdrop|offcanvas-backdrop)\b/.test(cls)) {
      return true;
    }
    var vw = window.innerWidth || document.documentElement.clientWidth || 1;
    var vh = window.innerHeight || document.documentElement.clientHeight || 1;
    var r = el.getBoundingClientRect();
    var coversViewport = r.width >= vw * 0.85 && r.height >= vh * 0.85;
    if (coversViewport && (tag === "dialog" || /\b(modal|drawer|sheet|popup|dialog)\b/.test(cls) || el.getAttribute("role") === "dialog")) {
      // Verificar que el clic fue sobre el contenedor externo (backdrop) y no dentro del cuadro de contenido si tiene un hijo diálogo
      var innerDialog = el.querySelector(".modal-dialog, .modal-content, [class*='modal-content'], [class*='dialog-content'], [class*='modal-box']");
      if (innerDialog && typeof clientX === "number" && typeof clientY === "number") {
        var ir = innerDialog.getBoundingClientRect();
        var insideInner = clientX >= ir.left && clientX <= ir.right && clientY >= ir.top && clientY <= ir.bottom;
        if (!insideInner) return true;
      } else if (tag === "dialog") {
        return true;
      }
    }
    return false;
  }

  function dispatchSyntheticPointerAndMouse(el, phase, clientX, clientY) {
    if (!el) return;
    var pType = phase === "start" ? "pointerdown" : (phase === "move" ? "pointermove" : "pointerup");
    var mType = phase === "start" ? "mousedown" : (phase === "move" ? "mousemove" : "mouseup");
    var buttons = phase === "end" ? 0 : 1;
    var evInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: Math.round(clientX || 0),
      clientY: Math.round(clientY || 0),
      screenX: Math.round(clientX || 0),
      screenY: Math.round(clientY || 0),
      button: 0,
      buttons: buttons
    };
    try {
      if (typeof PointerEvent === "function") {
        el.dispatchEvent(new PointerEvent(pType, Object.assign({ pointerId: 1, pointerType: "mouse", isPrimary: true }, evInit)));
      }
    } catch (_e) {}
    try {
      el.dispatchEvent(new MouseEvent(mType, evInit));
    } catch (_e2) {}
  }

  // 1. Emitir scroll sincronizado (ventana y contenedores internos / modales) y registrar en el Rastreador de Usuario
  var containerScrollMap = typeof WeakMap === "function" ? new WeakMap() : null;
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
      } else if (containerScrollMap && target && target.nodeType === 1) {
        containerScrollMap.set(target, { x: x, y: y });
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
          var vwDoc = Math.max(1, document.documentElement.clientWidth || window.innerWidth || 1);
          var vhDoc = Math.max(1, document.documentElement.clientHeight || window.innerHeight || 1);
          var maxDocX = Math.max(0, (document.documentElement.scrollWidth || document.body.scrollWidth || vwDoc) - vwDoc);
          var maxDocY = Math.max(0, (document.documentElement.scrollHeight || document.body.scrollHeight || vhDoc) - vhDoc);
          try {
            parent.postMessage({
              type: "rv:sync_scroll",
              frame: F,
              x: x,
              y: y,
              dx: dx,
              dy: dy,
              ratioX: maxDocX > 0 ? (x / maxDocX) : 0,
              ratioY: maxDocY > 0 ? (y / maxDocY) : 0
            }, ORIGIN);
          } catch (_e) {}
        }
      }
    } else if (target && target.nodeType === 1 && syncActive) {
      var prevC = (containerScrollMap && containerScrollMap.get(target)) || { x: x, y: y };
      var cDx = x - prevC.x;
      var cDy = y - prevC.y;
      if (containerScrollMap) containerScrollMap.set(target, { x: x, y: y });
      var maxCX = Math.max(0, (target.scrollWidth || 0) - (target.clientWidth || 0));
      var maxCY = Math.max(0, (target.scrollHeight || 0) - (target.clientHeight || 0));
      var inModal = isElementInsideModal(target);
      try {
        parent.postMessage({
          type: "rv:sync_scroll",
          frame: F,
          containerSelector: getSelector(target, false),
          structuralSelector: getSelector(target, true),
          isInsideModal: inModal,
          x: x,
          y: y,
          dx: cDx,
          dy: cDy,
          ratioX: maxCX > 0 ? (x / maxCX) : 0,
          ratioY: maxCY > 0 ? (y / maxCY) : 0
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

  // 1b. Detectar y sincronizar en tiempo real gestos de arrastre / movimiento de modales / bottom-sheets / sliders
  var pointerDownState = null;
  var activeDragReplayTarget = null;

  function captureModalInlineStyle(modalEl) {
    if (!modalEl || !modalEl.style) return null;
    return {
      transform: modalEl.style.transform || "",
      left: modalEl.style.left || "",
      top: modalEl.style.top || "",
      right: modalEl.style.right || "",
      bottom: modalEl.style.bottom || ""
    };
  }

  function hasModalStyleChanged(initial, current) {
    if (!initial || !current) return false;
    return initial.transform !== current.transform ||
      initial.left !== current.left ||
      initial.top !== current.top ||
      initial.right !== current.right ||
      initial.bottom !== current.bottom;
  }

  window.addEventListener("pointerdown", function (e) {
    if (inspectorActive || isReplayingSync || !e.isTrusted) return;
    var el = (e.target && e.target.nodeType === 1) ? e.target : document.body;
    if (el === overlayEl || (overlayEl && overlayEl.contains(el))) return;
    var r = el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0, width: 1, height: 1 };
    var inModal = isElementInsideModal(el);
    var modalRoot = inModal ? findEnclosingModalRoot(el) : null;
    pointerDownState = {
      x: e.clientX,
      y: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      time: Date.now(),
      lastEmitTs: 0,
      dragStarted: false,
      target: el,
      selector: getSelector(el, false),
      structuralSelector: getSelector(el, true),
      isInsideModal: inModal,
      modalRoot: modalRoot,
      initialModalStyle: captureModalInlineStyle(modalRoot),
      rx: Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width))),
      ry: Math.max(0, Math.min(1, (e.clientY - r.top) / Math.max(1, r.height)))
    };
  }, true);

  window.addEventListener("pointermove", function (e) {
    if (!pointerDownState || inspectorActive || isReplayingSync || !e.isTrusted) return;
    if (e.pointerType === "mouse" && e.buttons === 0) {
      pointerDownState = null;
      return;
    }
    var st = pointerDownState;
    var dx = Math.round(e.clientX - st.x);
    var dy = Math.round(e.clientY - st.y);
    var stepDx = Math.round(e.clientX - st.lastX);
    var stepDy = Math.round(e.clientY - st.lastY);

    if (!st.dragStarted) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      st.dragStarted = true;
      if (syncActive) {
        try {
          parent.postMessage({
            type: "rv:sync_drag",
            frame: F,
            phase: "start",
            selector: st.selector,
            structuralSelector: st.structuralSelector,
            isInsideModal: st.isInsideModal,
            rx: st.rx,
            ry: st.ry,
            dx: 0,
            dy: 0,
            stepDx: 0,
            stepDy: 0,
            vw: Math.max(1, window.innerWidth || 1),
            vh: Math.max(1, window.innerHeight || 1)
          }, ORIGIN);
        } catch (_e) {}
      }
    }

    var now = Date.now();
    if (now - st.lastEmitTs < 24) return;
    st.lastEmitTs = now;
    st.lastX = e.clientX;
    st.lastY = e.clientY;

    if (syncActive) {
      var curModalStyle = captureModalInlineStyle(st.modalRoot);
      var styleDelta = hasModalStyleChanged(st.initialModalStyle, curModalStyle) ? curModalStyle : null;
      try {
        parent.postMessage({
          type: "rv:sync_drag",
          frame: F,
          phase: "move",
          selector: st.selector,
          structuralSelector: st.structuralSelector,
          isInsideModal: st.isInsideModal,
          rx: st.rx,
          ry: st.ry,
          dx: dx,
          dy: dy,
          stepDx: stepDx,
          stepDy: stepDy,
          vw: Math.max(1, window.innerWidth || 1),
          vh: Math.max(1, window.innerHeight || 1),
          modalStyleDelta: styleDelta
        }, ORIGIN);
      } catch (_e2) {}
    }
  }, true);

  window.addEventListener("pointerup", function (e) {
    if (!pointerDownState || inspectorActive || isReplayingSync || !e.isTrusted) return;
    var st = pointerDownState;
    pointerDownState = null;
    var dx = Math.round(e.clientX - st.x);
    var dy = Math.round(e.clientY - st.y);

    if (st.dragStarted && syncActive) {
      var curModalStyle = captureModalInlineStyle(st.modalRoot);
      var styleDelta = hasModalStyleChanged(st.initialModalStyle, curModalStyle) ? curModalStyle : null;
      try {
        parent.postMessage({
          type: "rv:sync_drag",
          frame: F,
          phase: "end",
          selector: st.selector,
          structuralSelector: st.structuralSelector,
          isInsideModal: st.isInsideModal,
          rx: st.rx,
          ry: st.ry,
          dx: dx,
          dy: dy,
          stepDx: Math.round(e.clientX - st.lastX),
          stepDy: Math.round(e.clientY - st.lastY),
          vw: Math.max(1, window.innerWidth || 1),
          vh: Math.max(1, window.innerHeight || 1),
          modalStyleDelta: styleDelta
        }, ORIGIN);
      } catch (_e) {}
    }

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

    setTimeout(reportTemplateContext, 200);

    if (!syncActive) return;

    var modalClose = isModalCloseTrigger(mainEl);
    var backdropClick = !modalClose && isModalBackdropElement(target, cx, cy);
    var inModal = isElementInsideModal(target);
    var rx = box.width > 0 ? Math.max(0, Math.min(1, (cx - box.x) / box.width)) : 0.5;
    var ry = box.height > 0 ? Math.max(0, Math.min(1, (cy - box.y) / box.height)) : 0.5;

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
        absHref: absHref,
        isModalClose: modalClose,
        isBackdropClick: backdropClick,
        isInsideModal: inModal,
        rx: rx,
        ry: ry
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

  // 4. Registrar envío de formularios y teclas clave (Enter / Escape / Flechas en modales)
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
    var activeEl = document.activeElement || document.body;
    var activeTag = (activeEl.tagName || "body").toLowerCase();
    var isTypingField = (activeTag === "input" || activeTag === "textarea" || activeEl.isContentEditable);

    if (syncActive && (e.key === "Escape" || e.key === "Enter" || (!isTypingField && (e.key === "ArrowLeft" || e.key === "ArrowRight")))) {
      try {
        parent.postMessage({
          type: "rv:sync_key",
          frame: F,
          key: e.key,
          code: e.code || "",
          keyCode: e.keyCode || 0,
          selector: getSelector(activeEl, false)
        }, ORIGIN);
      } catch (_e) {}
    }

    if (e.key !== "Enter" && e.key !== "Escape") return;
    var box = getElementBox(activeEl);
    var zInfo = getScreenZoneAndCoords((box.x || 0) + (box.width || 0) / 2, (box.y || 0) + (box.height || 0) / 2);
    try {
      parent.postMessage({
        type: "rv:flow_event",
        frame: F,
        device: D,
        action: "keypress",
        selector: getSelector(activeEl, false),
        tag: activeTag,
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
      var candidates = document.querySelectorAll(d.tag + ", button, a, [role='button']");
      for (var k = 0; k < candidates.length; k++) {
        var cText = (candidates[k].innerText || candidates[k].getAttribute("aria-label") || candidates[k].getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 80);
        if (cText === d.text && isVisible(candidates[k])) return candidates[k];
      }
    }

    // Fallback para botón de cierre de modal entre plantillas distintas (Móvil vs Desktop)
    if (d.isModalClose) {
      var openModals = getOpenModals();
      for (var m = openModals.length - 1; m >= 0; m--) {
        var mRoot = openModals[m];
        try {
          var closeBtn = mRoot.querySelector("[data-bs-dismiss='modal'], [data-dismiss='modal'], [aria-label*='close' i], [aria-label*='cerrar' i], .btn-close, .modal-close, .close, [class*='close']");
          if (closeBtn && isVisible(closeBtn)) return closeBtn;
          var btns = mRoot.querySelectorAll("button, a, [role='button']");
          for (var b = 0; b < btns.length; b++) {
            if (isModalCloseTrigger(btns[b]) && isVisible(btns[b])) return btns[b];
          }
        } catch (_e) {}
      }
    }

    // Fallback para clic en el fondo (backdrop) del modal entre plantillas distintas
    if (d.isBackdropClick) {
      try {
        var bd = document.querySelector(".modal.show, .modal.in, .modal[style*='display: block'], dialog[open], .modal-backdrop, [class*='backdrop'], [class*='modal-overlay']");
        if (bd && isVisible(bd)) return bd;
      } catch (_e) {}
      var modalsForBd = getOpenModals();
      if (modalsForBd.length) return modalsForBd[modalsForBd.length - 1];
    }

    // Último intento aunque no sea visible (p. ej. enlace en menú móvil cerrado)
    for (var n = 0; n < selectors.length; n++) {
      if (!selectors[n]) continue;
      try {
        var anyEl = document.querySelector(selectors[n]);
        if (anyEl) return anyEl;
      } catch (_e) {}
    }
    return null;
  }

  function findSyncedDragElement(d) {
    var selectors = [d.selector, d.structuralSelector];
    for (var i = 0; i < selectors.length; i++) {
      if (!selectors[i]) continue;
      try {
        var el = document.querySelector(selectors[i]);
        if (el && isVisible(el)) return el;
      } catch (_e) {}
    }
    if (d.isInsideModal) {
      var modals = getOpenModals();
      if (modals.length) {
        var topModal = modals[modals.length - 1];
        var handle = topModal.querySelector(".modal-header, [class*='header'], [class*='handle'], [class*='drag']");
        return (handle && isVisible(handle)) ? handle : topModal;
      }
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
      ignoreScrollUntil = Date.now() + 110;
      if (d.containerSelector || d.isInsideModal) {
        var cEl = findActiveScrollableModalContainer(d.containerSelector, d.structuralSelector, d.isInsideModal);
        if (cEl) {
          var maxSX = Math.max(0, (cEl.scrollWidth || 0) - (cEl.clientWidth || 0));
          var maxSY = Math.max(0, (cEl.scrollHeight || 0) - (cEl.clientHeight || 0));
          if (typeof d.ratioX === "number" && maxSX > 0) {
            cEl.scrollLeft = Math.round(d.ratioX * maxSX);
          } else if (typeof d.x === "number") {
            cEl.scrollLeft = d.x;
          } else if (typeof d.dx === "number") {
            cEl.scrollLeft += d.dx;
          }
          if (typeof d.ratioY === "number" && maxSY > 0) {
            cEl.scrollTop = Math.round(d.ratioY * maxSY);
          } else if (typeof d.y === "number") {
            cEl.scrollTop = d.y;
          } else if (typeof d.dy === "number") {
            cEl.scrollTop += d.dy;
          }
          if (containerScrollMap) {
            containerScrollMap.set(cEl, { x: cEl.scrollLeft || 0, y: cEl.scrollTop || 0 });
          }
          return;
        }
        if (d.isInsideModal) return;
      }

      var beforeY = window.pageYOffset || document.documentElement.scrollTop || 0;
      var beforeX = window.pageXOffset || document.documentElement.scrollLeft || 0;
      if (d.y !== undefined && d.y <= 1 && typeof d.ratioY === "number" && d.ratioY <= 0.01) {
        window.scrollTo(d.x <= 1 ? 0 : (beforeX + (d.dx || 0)), 0);
      } else if (typeof d.dx === "number" || typeof d.dy === "number") {
        window.scrollBy(d.dx || 0, d.dy || 0);
      } else if (typeof d.ratioY === "number") {
        var vhDoc = Math.max(1, document.documentElement.clientHeight || window.innerHeight || 1);
        var maxDocY = Math.max(0, (document.documentElement.scrollHeight || document.body.scrollHeight || vhDoc) - vhDoc);
        window.scrollTo(beforeX, Math.round(d.ratioY * maxDocY));
      }
      var afterY = window.pageYOffset || document.documentElement.scrollTop || 0;
      var afterX = window.pageXOffset || document.documentElement.scrollLeft || 0;

      // Si hay un modal abierto que bloquea el scroll del body (overflow: hidden) o recibe rueda desde .stage, desplazar el contenedor del modal
      if (afterY === beforeY && afterX === beforeX && (d.dy || d.dx)) {
        var activeModalScroller = findActiveScrollableModalContainer("", "", true);
        if (activeModalScroller) {
          activeModalScroller.scrollTop += (d.dy || 0);
          activeModalScroller.scrollLeft += (d.dx || 0);
          if (containerScrollMap) {
            containerScrollMap.set(activeModalScroller, {
              x: activeModalScroller.scrollLeft || 0,
              y: activeModalScroller.scrollTop || 0
            });
          }
        }
      }

      lastScrollX = window.pageXOffset || document.documentElement.scrollLeft || 0;
      lastScrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
    } else if (d.type === "rv:do_sync_drag") {
      if (!syncActive) return;
      isReplayingSync = true;
      try {
        var dragEl = (d.phase === "start" || !activeDragReplayTarget)
          ? findSyncedDragElement(d)
          : activeDragReplayTarget;
        if (d.phase === "start") activeDragReplayTarget = dragEl;
        if (dragEl) {
          var r = dragEl.getBoundingClientRect();
          var rx = typeof d.rx === "number" ? d.rx : 0.5;
          var ry = typeof d.ry === "number" ? d.ry : 0.5;
          var vwCur = Math.max(1, window.innerWidth || 1);
          var vhCur = Math.max(1, window.innerHeight || 1);
          var scaleX = d.vw ? (vwCur / d.vw) : 1;
          var scaleY = d.vh ? (vhCur / d.vh) : 1;
          var startX = r.left + r.width * rx;
          var startY = r.top + r.height * ry;
          var curX = startX + (d.dx || 0) * scaleX;
          var curY = startY + (d.dy || 0) * scaleY;
          dispatchSyntheticPointerAndMouse(dragEl, d.phase, curX, curY);

          if (d.modalStyleDelta) {
            var mRoot = findEnclosingModalRoot(dragEl);
            if (mRoot && mRoot.style) {
              if (d.modalStyleDelta.transform !== undefined) mRoot.style.transform = d.modalStyleDelta.transform;
              if (d.modalStyleDelta.left !== undefined) mRoot.style.left = d.modalStyleDelta.left;
              if (d.modalStyleDelta.top !== undefined) mRoot.style.top = d.modalStyleDelta.top;
            }
          }
        }
        if (d.phase === "end") activeDragReplayTarget = null;
      } catch (_e) {}
      setTimeout(function () { isReplayingSync = false; }, 35);
    } else if (d.type === "rv:do_sync_click") {
      if (!syncActive) return;
      var el = findSyncedClickElement(d);
      isReplayingSync = true;
      try {
        if (el) {
          showSyncPulse(el);
          var cr = el.getBoundingClientRect();
          var clickX = d.isBackdropClick ? (cr.left + 6) : (cr.left + cr.width * (typeof d.rx === "number" ? d.rx : 0.5));
          var clickY = d.isBackdropClick ? (cr.top + 6) : (cr.top + cr.height * (typeof d.ry === "number" ? d.ry : 0.5));
          if (typeof el.focus === "function" && !d.isBackdropClick) el.focus({ preventScroll: true });
          dispatchSyntheticPointerAndMouse(el, "start", clickX, clickY);
          dispatchSyntheticPointerAndMouse(el, "end", clickX, clickY);
          if (d.isBackdropClick) {
            el.dispatchEvent(new MouseEvent("click", {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: Math.round(clickX),
              clientY: Math.round(clickY)
            }));
          } else {
            el.click();
          }
          setTimeout(reportTemplateContext, 200);
        } else if (d.absHref && proxiable(d.absHref)) {
          var here = document.baseURI.split("#")[0];
          if (d.absHref.split("#")[0] !== here || d.absHref.indexOf("#") === -1) {
            location.href = via(d.absHref);
          }
        }
      } catch (_e) {}
      setTimeout(function () { isReplayingSync = false; }, 60);
    } else if (d.type === "rv:do_sync_key") {
      if (!syncActive) return;
      isReplayingSync = true;
      try {
        var keyTarget = null;
        if (d.selector) {
          try { keyTarget = document.querySelector(d.selector); } catch (_e) {}
        }
        if (!keyTarget) keyTarget = document.activeElement || document.body;
        var kInit = {
          key: d.key || "",
          code: d.code || d.key || "",
          keyCode: d.keyCode || (d.key === "Escape" ? 27 : (d.key === "Enter" ? 13 : 0)),
          which: d.keyCode || (d.key === "Escape" ? 27 : (d.key === "Enter" ? 13 : 0)),
          bubbles: true,
          cancelable: true
        };
        keyTarget.dispatchEvent(new KeyboardEvent("keydown", kInit));
        document.dispatchEvent(new KeyboardEvent("keydown", kInit));
        window.dispatchEvent(new KeyboardEvent("keydown", kInit));
        keyTarget.dispatchEvent(new KeyboardEvent("keyup", kInit));
        if (d.key === "Escape") {
          var openDialogs = document.querySelectorAll("dialog[open]");
          for (var di = 0; di < openDialogs.length; di++) {
            if (typeof openDialogs[di].close === "function") openDialogs[di].close();
          }
        }
      } catch (_e2) {}
      setTimeout(function () { isReplayingSync = false; }, 50);
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
      reportTemplateContext();
    } else if (d.type === "rv:request_storage") {
      reportStorageSnapshot();
      reportTemplateContext();
    } else if (d.type === "rv:find_counterpart") {
      handleFindCounterpart(d.identifiers || {});
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

  // ---------- 7. Comparador de Templates (Versión Móvil vs Versión Desktop) ----------
  function buildDomOutline() {
    if (!document.body) return "";
    var lines = [];
    var topChildren = document.body.children;
    for (var i = 0; i < topChildren.length && lines.length < 28; i++) {
      var c = topChildren[i];
      var tag = (c.tagName || "").toLowerCase();
      if (tag === "script" || tag === "style" || tag === "link" || tag === "noscript" || c === overlayEl) continue;
      if (c.classList && c.classList.contains("__rv_audit_marker")) continue;
      var cs = window.getComputedStyle(c);
      var visNote = (cs.display === "none" || cs.visibility === "hidden") ? " [OCULTO: display:none]" : "";
      lines.push("- " + openTagStr(c, 3) + visNote);

      if (!visNote && c.children && c.children.length) {
        var subCount = 0;
        for (var j = 0; j < c.children.length && subCount < 6; j++) {
          var sub = c.children[j];
          var sTag = (sub.tagName || "").toLowerCase();
          if (sTag === "script" || sTag === "style") continue;
          var sCs = window.getComputedStyle(sub);
          var sVis = (sCs.display === "none" || sCs.visibility === "hidden") ? " [OCULTO]" : "";
          lines.push("  - " + openTagStr(sub, 2) + sVis);
          subCount++;
        }
      }
    }
    return lines.join("\n");
  }

  function detectActiveModalInfo() {
    if (!document.body) return null;
    var vw = Math.max(1, document.documentElement.clientWidth || window.innerWidth || 1);
    var vh = Math.max(1, document.documentElement.clientHeight || window.innerHeight || 1);
    var candidates = document.body.querySelectorAll("dialog[open], [aria-modal='true'], [role='dialog'], [role='alertdialog'], .modal, .drawer, .popup, .dialog");
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      var cs = window.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) <= 0.02) continue;
      var r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 40 || r.bottom <= 0 || r.top >= vh) continue;
      return {
        selector: getSelector(el, false),
        title: extractLandmarkHeading(el) || "Modal / Diálogo activo",
        box: Math.round(r.width) + "×" + Math.round(r.height) + "px",
        html: (el.outerHTML || "").slice(0, 1200)
      };
    }
    return null;
  }

  function reportTemplateContext() {
    try {
      if (!document.body) return;
      var bodySig = openTagStr(document.body, 5);
      var roots = [];
      var ch = document.body.children;
      for (var i = 0; i < ch.length && roots.length < 10; i++) {
        var el = ch[i];
        var t = (el.tagName || "").toLowerCase();
        if (t === "script" || t === "style" || t === "link" || t === "noscript" || el === overlayEl) continue;
        if (el.classList && el.classList.contains("__rv_audit_marker")) continue;
        var cs = window.getComputedStyle(el);
        if (cs.display === "none") continue;
        roots.push(getSelector(el, false));
      }

      var sheets = [];
      var links = document.querySelectorAll("link[rel='stylesheet']");
      for (var k = 0; k < links.length && sheets.length < 12; k++) {
        var href = links[k].getAttribute("href") || "";
        if (href) {
          var cleanHref = href.split("?")[0].split("/").slice(-2).join("/");
          sheets.push(cleanHref);
        }
      }

      var landmarks = [];
      var lEls = document.body.querySelectorAll("header, nav, main, aside, footer, form, section, [role='dialog'], dialog[open]");
      for (var m = 0; m < lEls.length && landmarks.length < 14; m++) {
        var le = lEls[m];
        var lcs = window.getComputedStyle(le);
        if (lcs.display === "none" || lcs.visibility === "hidden") continue;
        var lr = le.getBoundingClientRect();
        if (lr.width < 5 || lr.height < 5) continue;
        var hTxt = extractLandmarkHeading(le);
        landmarks.push(
          "<" + le.tagName.toLowerCase() + (le.id ? "#" + le.id : "") + ">" +
          (hTxt ? (' "' + hTxt + '"') : "") +
          " (" + Math.round(lr.width) + "×" + Math.round(lr.height) + "px)"
        );
      }

      parent.postMessage({
        type: "rv:template_context",
        frame: F,
        device: D,
        url: getCurrentPageUrl(),
        title: document.title || "",
        bodySignature: bodySig,
        rootContainers: roots,
        stylesheets: sheets,
        landmarks: landmarks,
        activeModal: detectActiveModalInfo(),
        domOutline: buildDomOutline()
      }, ORIGIN);
    } catch (_e) {}
  }

  function handleFindCounterpart(ident) {
    try {
      if (!document.body || !ident) return;
      var matched = null;
      var matchedBy = "";

      // 1. Por ID exacto
      if (ident.id) {
        var byId = document.getElementById(ident.id);
        if (byId) {
          matched = byId;
          matchedBy = "id (#" + ident.id + ")";
        }
      }
      // 2. Por data-testid / data-cy
      if (!matched && ident.testid) {
        try {
          var byTest = document.querySelector('[data-testid="' + safeIdent(ident.testid) + '"], [data-cy="' + safeIdent(ident.testid) + '"]');
          if (byTest) {
            matched = byTest;
            matchedBy = "data-testid (" + ident.testid + ")";
          }
        } catch (_e) {}
      }
      // 3. Por selector CSS exacto
      if (!matched && ident.selector) {
        try {
          var bySel = document.querySelector(ident.selector);
          if (bySel) {
            matched = bySel;
            matchedBy = "selector exacto (" + ident.selector + ")";
          }
        } catch (_e) {}
      }
      // 4. Por atributo name
      if (!matched && ident.name) {
        try {
          var byName = document.querySelector((ident.tag || "*") + '[name="' + safeIdent(ident.name) + '"]');
          if (byName) {
            matched = byName;
            matchedBy = "atributo name (" + ident.name + ")";
          }
        } catch (_e) {}
      }
      // 5. Por texto visible / etiqueta en el mismo tipo de elemento o botón/enlace equivalente
      if (!matched && ident.text && ident.text.length >= 2) {
        var queryTags = ident.tag ? (ident.tag + ", button, a, [role='button'], h1, h2, h3, label") : "button, a, [role='button'], h1, h2, h3, label";
        var candidates = document.body.querySelectorAll(queryTags);
        var normTarget = ident.text.toLowerCase();
        for (var i = 0; i < candidates.length; i++) {
          var c = candidates[i];
          var cTxt = (c.innerText || c.getAttribute("aria-label") || c.getAttribute("placeholder") || c.value || "").replace(/\s+/g, " ").trim().toLowerCase();
          if (cTxt === normTarget && isVisible(c)) {
            matched = c;
            matchedBy = 'texto equivalente ("' + ident.text.slice(0, 40) + '")';
            break;
          }
        }
      }
      // 6. Por enlace href
      if (!matched && ident.href) {
        var links = document.body.querySelectorAll("a[href]");
        for (var j = 0; j < links.length; j++) {
          if (links[j].getAttribute("href") === ident.href) {
            matched = links[j];
            matchedBy = "href (" + ident.href + ")";
            break;
          }
        }
      }

      if (matched) {
        var r = matched.getBoundingClientRect();
        var diag = extractElementDiagnostics(matched, r);
        var cs = window.getComputedStyle(matched);
        var isHiddenInThisTemplate = (cs.display === "none" || cs.visibility === "hidden" || (r.width === 0 && r.height === 0));
        parent.postMessage({
          type: "rv:counterpart_found",
          frame: F,
          device: D,
          url: getCurrentPageUrl(),
          tag: matched.tagName.toLowerCase(),
          selector: getSelector(matched, false),
          section: getSemanticSection(matched),
          html: matched.outerHTML,
          width: Math.round(r.width),
          height: Math.round(r.height),
          box: diag.box,
          stylesSummary: (isHiddenInThisTemplate ? "[OCULTO EN ESTE TEMPLATE] " : "") + diag.stylesSummary,
          stylesMap: diag.stylesMap,
          isCounterpart: true,
          matchedBy: matchedBy + (isHiddenInThisTemplate ? " — oculto en este viewport/template" : ""),
          notFoundInTemplate: false
        }, ORIGIN);
      } else {
        // El elemento no existe en este template (ej. template exclusivo para móvil vs desktop):
        // enviamos la estructura raíz de este template para que la IA vea ambos templates
        var fallbackRoot = document.querySelector("main, [role='main'], form, header, body") || document.body;
        var fr = fallbackRoot.getBoundingClientRect();
        var fDiag = extractElementDiagnostics(fallbackRoot, fr);
        parent.postMessage({
          type: "rv:counterpart_found",
          frame: F,
          device: D,
          url: getCurrentPageUrl(),
          tag: fallbackRoot.tagName.toLowerCase(),
          selector: getSelector(fallbackRoot, false),
          section: getSemanticSection(fallbackRoot),
          html: buildDomOutline(),
          width: Math.round(fr.width),
          height: Math.round(fr.height),
          box: fDiag.box,
          stylesSummary: fDiag.stylesSummary,
          stylesMap: fDiag.stylesMap,
          isCounterpart: true,
          matchedBy: "Elemento exclusivo del otro template (no existe '" + (ident.selector || ident.tag) + "' en este DOM)",
          notFoundInTemplate: true
        }, ORIGIN);
      }
    } catch (_e) {}
  }

  window.addEventListener("load", function () {
    setTimeout(function () {
      runVisualAudit();
      reportStorageSnapshot();
      reportTemplateContext();
    }, 500);
  });
})();
