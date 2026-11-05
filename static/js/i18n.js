/* Interface strings. English is the default language.
   To add a language, copy the "en" block, translate it and add a button
   with data-lang="xx" to the language switch in templates/index.html. */
(function () {
  "use strict";

  var STRINGS = {
    en: {
      screens: "Screens",
      emptyTitle: "No devices yet.",
      emptyHint: "Use <strong>Add device</strong> to add one.",
      gridLegend: "1 square = 100 px",
      scrollHint: "Scroll on the mat to move every screen at once",
      zoomValue: "{n}%",
      zoomGroup: "Zoom",
      zoomIn: "Zoom in",
      zoomOut: "Zoom out",
      zoomFit: "Fit",
      zoomFitTitle: "Fit all screens into window",
      zoomFill: "Fill",
      zoomFillTitle: "Maximize screens to fill window width",
      language: "Language",
      searchLabel: "Page address",
      searchPlaceholder: "Enter your page URL, e.g. localhost:3000",
      load: "Load",
      refresh: "Refresh",
      refreshHint: "clears cookies",
      refreshTitle: "Reload every screen and clear its cookies",
      addDevice: "Add device",
      devicesMenu: "Devices",
      placeholder: "Enter a URL below to see it here.",
      frameTitle: "{name} preview",
      remove: "Remove {name}",
      group_phones: "Phones",
      group_tablets: "Tablets",
      group_desktop: "Desktop",
      toastInvalidUrl: "That address isn't valid. Try something like example.com",
      toastEmptyUrl: "Enter a URL to load it.",
      toastNoDevices: "Add a device to see the page.",
      toastClearedNoUrl: "Cookies cleared. Enter a URL to load the screens.",
      toastCleared: "Cookies cleared. Screens reloaded.",
      toastResetFailed: "Couldn't clear cookies. Check that the server is still running.",
      inspect: "Inspect",
      inspectHint: "Inspect elements live and copy code (Cmd/Ctrl+Shift+C)",
      inspectActive: "Inspector active: click any element",
      autoCopy: "Auto-copy",
      autoCopyHint: "Copy HTML immediately on click",
      inspectSelectPrompt: "Click any element",
      inspectSelectHint: "Hover over any screen and click to inspect and copy code live.",
      copy: "Copy",
      copyHtml: "Copy HTML",
      copySelector: "Copy Selector",
      copiedHtml: "HTML copied to clipboard!",
      copiedSelector: "CSS selector copied!",
      close: "Close",
      inspectBanner: "<strong>Inspect Mode</strong> · Hover to preview · <strong>Click</strong> to copy element to clipboard · Press <kbd>Esc</kbd> to exit",
      inspectFloatHint: "Click to copy element · Press Esc to exit",
      inspectCopiedBadge: "✓ Copied!",
      sync: "Sync",
      syncHint: "Sync scroll, clicks and typing across all screens",
      syncOn: "Sync enabled: scroll, clicks and inputs are mirrored",
      syncOff: "Sync disabled: screens move independently"
    },
    es: {
      screens: "Pantallas",
      emptyTitle: "No hay pantallas todavía.",
      emptyHint: "Usa <strong>Agregar dispositivo</strong> para poner una.",
      gridLegend: "1 cuadro = 100 px",
      scrollHint: "Haz scroll en el tapete para mover todas las pantallas a la vez",
      zoomValue: "{n} %",
      zoomGroup: "Zoom",
      zoomIn: "Acercar",
      zoomOut: "Alejar",
      zoomFit: "Ajustar",
      zoomFitTitle: "Ajustar todas las pantallas a la ventana",
      zoomFill: "Llenar",
      zoomFillTitle: "Aprovechar al máximo el ancho de la ventana",
      language: "Idioma",
      searchLabel: "Dirección de la página",
      searchPlaceholder: "Escribe la URL de tu página, por ejemplo localhost:3000",
      load: "Cargar",
      refresh: "Refrescar",
      refreshHint: "borra cookies",
      refreshTitle: "Recarga todas las pantallas y borra sus cookies",
      addDevice: "Agregar dispositivo",
      devicesMenu: "Dispositivos",
      placeholder: "Escribe una URL abajo para verla aquí.",
      frameTitle: "Vista en {name}",
      remove: "Quitar {name}",
      group_phones: "Teléfonos",
      group_tablets: "Tablets",
      group_desktop: "Escritorio",
      toastInvalidUrl: "Esa dirección no es válida. Prueba con algo como ejemplo.com",
      toastEmptyUrl: "Escribe una URL para cargarla.",
      toastNoDevices: "Agrega un dispositivo para ver la página.",
      toastClearedNoUrl: "Cookies borradas. Escribe una URL para cargar las pantallas.",
      toastCleared: "Cookies borradas. Pantallas recargadas.",
      toastResetFailed: "No se pudieron borrar las cookies. Revisa que el servidor siga corriendo.",
      inspect: "Inspeccionar",
      inspectHint: "Inspecciona elementos en vivo y copia código (Cmd/Ctrl+Shift+C)",
      inspectActive: "Inspector activo: haz clic en cualquier elemento",
      autoCopy: "Auto-copiar",
      autoCopyHint: "Copiar HTML inmediatamente al hacer clic",
      inspectSelectPrompt: "Haz clic en cualquier elemento",
      inspectSelectHint: "Pasa el ratón sobre cualquier pantalla y haz clic para ver y copiar su código al instante.",
      copy: "Copiar",
      copyHtml: "Copiar HTML",
      copySelector: "Copiar Selector",
      copiedHtml: "¡Elemento copiado al portapapeles!",
      copiedSelector: "¡Selector CSS copiado!",
      close: "Cerrar",
      inspectBanner: "<strong>Modo Inspección</strong> · Pasa el mouse para ver · <strong>Da clic</strong> para copiar al portapapeles · Presiona <kbd>Esc</kbd> para salir",
      inspectFloatHint: "Clic para copiar elemento · Esc para salir",
      inspectCopiedBadge: "✓ ¡Copiado!",
      sync: "Sincronizar",
      syncHint: "Sincronizar scroll, clics y escritura en todas las pantallas",
      syncOn: "Sincronización activada: scroll, clics y texto",
      syncOff: "Sincronización desactivada: control independiente"
    }
  };

  var DEFAULT_LANG = "en";
  var STORE_LANG = "rv.lang";
  var lang = DEFAULT_LANG;

  try {
    var saved = localStorage.getItem(STORE_LANG);
    if (saved && STRINGS[saved]) lang = saved;
  } catch (_e) {}

  function t(key, vars) {
    var s = (STRINGS[lang] && STRINGS[lang][key]) || STRINGS[DEFAULT_LANG][key] || key;
    if (vars) {
      Object.keys(vars).forEach(function (k) { s = s.split("{" + k + "}").join(vars[k]); });
    }
    return s;
  }

  // Applies translations to elements marked in the HTML:
  // data-i18n (text), data-i18n-html, data-i18n-placeholder,
  // data-i18n-title, data-i18n-aria-label.
  function applyStatic(root) {
    root = root || document;
    document.documentElement.lang = lang;
    root.querySelectorAll("[data-i18n]").forEach(function (el) { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll("[data-i18n-html]").forEach(function (el) { el.innerHTML = t(el.dataset.i18nHtml); });
    root.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) { el.placeholder = t(el.dataset.i18nPlaceholder); });
    root.querySelectorAll("[data-i18n-title]").forEach(function (el) { el.title = t(el.dataset.i18nTitle); });
    root.querySelectorAll("[data-i18n-aria-label]").forEach(function (el) { el.setAttribute("aria-label", t(el.dataset.i18nAriaLabel)); });
  }

  function setLang(next) {
    if (!STRINGS[next] || next === lang) return false;
    lang = next;
    try { localStorage.setItem(STORE_LANG, lang); } catch (_e) {}
    applyStatic();
    return true;
  }

  window.RV_I18N = {
    t: t,
    applyStatic: applyStatic,
    setLang: setLang,
    getLang: function () { return lang; },
    languages: Object.keys(STRINGS)
  };
})();
