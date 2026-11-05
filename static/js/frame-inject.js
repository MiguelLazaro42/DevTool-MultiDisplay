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
  var nativeFetch = window.fetch;
  if (nativeFetch) {
    window.fetch = function (input, init) {
      try {
        var isReq = typeof Request !== "undefined" && input instanceof Request;
        var target = abs(isReq ? input.url : String(input));
        if (proxiable(target)) input = isReq ? new Request(via(target), input) : via(target);
      } catch (_e) {}
      return nativeFetch.call(this, input, init);
    };
  }

  var nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var target = abs(url);
    if (proxiable(target)) arguments[1] = via(target);
    return nativeOpen.apply(this, arguments);
  };

  // ---------- Aviso al visor ----------
  // Para que Refrescar recargue la página donde está esta pantalla.
  try { parent.postMessage({ type: "rv:navigated", frame: F, url: document.baseURI }, ORIGIN); } catch (_e) {}

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

  function onInspectMove(e) {
    if (!inspectorActive) return;
    var target = e.target;
    if (!target || target === overlayEl || (overlayEl && overlayEl.contains(target))) return;
    if (target === document.documentElement || target === document.body) return;

    ensureInspectorOverlay();
    var r = target.getBoundingClientRect();
    var sx = window.pageXOffset || document.documentElement.scrollLeft || 0;
    var sy = window.pageYOffset || document.documentElement.scrollTop || 0;

    overlayEl.style.top = (r.top + sy) + "px";
    overlayEl.style.left = (r.left + sx) + "px";
    overlayEl.style.width = r.width + "px";
    overlayEl.style.height = r.height + "px";
    overlayEl.style.display = "block";

    var label = target.tagName.toLowerCase();
    if (target.id) label += "#" + target.id;
    else if (target.classList && target.classList.length) label += "." + target.classList[0];
    label += " | " + Math.round(r.width) + "×" + Math.round(r.height);

    badgeEl.textContent = label;
    if (r.top < 32) {
      badgeEl.style.top = (r.height + 4) + "px";
    } else {
      badgeEl.style.top = "-26px";
    }
  }

  function onInspectClick(e) {
    if (!inspectorActive) return;
    var target = e.target;
    if (!target || target === overlayEl || (overlayEl && overlayEl.contains(target))) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    var r = target.getBoundingClientRect();
    var tag = target.tagName.toLowerCase();
    var selector = getSelector(target);
    var html = target.outerHTML;

    try {
      parent.postMessage({
        type: "rv:element_picked",
        frame: F,
        device: D,
        tag: tag,
        selector: selector,
        html: html,
        width: Math.round(r.width),
        height: Math.round(r.height)
      }, ORIGIN);
    } catch (_e) {}
  }

  window.addEventListener("mousemove", onInspectMove, true);
  window.addEventListener("click", onInspectClick, true);

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

  // 1. Emitir scroll sincronizado desde cualquier pantalla
  window.addEventListener("scroll", function () {
    var x = window.pageXOffset || document.documentElement.scrollLeft || 0;
    var y = window.pageYOffset || document.documentElement.scrollTop || 0;
    if (!syncActive || Date.now() < ignoreScrollUntil) {
      lastScrollX = x;
      lastScrollY = y;
      return;
    }
    var dx = x - lastScrollX;
    var dy = y - lastScrollY;
    lastScrollX = x;
    lastScrollY = y;
    if (dx === 0 && dy === 0) return;

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
  }, { passive: true });

  // 2. Emitir clics sincronizados
  window.addEventListener("click", function (e) {
    if (!syncActive || inspectorActive || isReplayingSync || !e.isTrusted) return;
    var target = e.target;
    if (!target || target === overlayEl || (overlayEl && overlayEl.contains(target))) return;

    var interactive = target.closest && target.closest("a, button, [role='button'], input, select, textarea, label, summary");
    var mainEl = interactive || target;
    var tag = mainEl.tagName ? mainEl.tagName.toLowerCase() : "";
    var text = (mainEl.innerText || "").trim().slice(0, 80);
    var aEl = target.closest && target.closest("a[href]");
    var href = aEl ? aEl.getAttribute("href") : "";
    var absHref = aEl ? aEl.href : "";

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

  // 3. Emitir escritura / cambios en inputs
  function onSyncInput(e) {
    if (!syncActive || inspectorActive || isReplayingSync || !e.isTrusted) return;
    var t = e.target;
    if (!t || !t.tagName) return;
    var tag = t.tagName.toLowerCase();
    if (tag !== "input" && tag !== "textarea" && tag !== "select") return;

    try {
      parent.postMessage({
        type: "rv:sync_input",
        frame: F,
        eventType: e.type,
        selector: getSelector(t, false),
        structuralSelector: getSelector(t, true),
        id: t.id || "",
        name: t.name || "",
        tag: tag,
        value: t.value,
        checked: !!t.checked,
        inputType: (t.type || "").toLowerCase()
      }, ORIGIN);
    } catch (_e) {}
  }
  window.addEventListener("input", onSyncInput, true);
  window.addEventListener("change", onSyncInput, true);

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
    }
  });
})();
