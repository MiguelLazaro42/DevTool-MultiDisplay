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

  function getSelector(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return "";
    var path = [];
    while (el && el.nodeType === Node.ELEMENT_NODE) {
      var name = el.nodeName.toLowerCase();
      if (el.id) {
        path.unshift(name + "#" + el.id);
        break;
      }
      var sib = el, nth = 1;
      while ((sib = sib.previousElementSibling)) {
        if (sib.nodeName.toLowerCase() === name) nth++;
      }
      var part = name;
      if (nth > 1) part += ":nth-of-type(" + nth + ")";
      if (el.classList && el.classList.length) {
        part += "." + el.classList[0];
      }
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

    if (overlayEl) overlayEl.style.display = "none";

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
        html: html
      }, ORIGIN);
    } catch (_e) {}
  }

  window.addEventListener("mousemove", onInspectMove, true);
  window.addEventListener("click", onInspectClick, true);

  window.addEventListener("message", function (e) {
    if (e.origin !== ORIGIN || !e.data) return;
    if (e.data.type === "rv:set_inspector") {
      inspectorActive = !!e.data.active;
      if (!inspectorActive && overlayEl) {
        overlayEl.style.display = "none";
      }
    }
  });
})();
