"""Catálogo de dispositivos que se pueden emular.

width/height son el viewport en píxeles CSS (lo que ve el CSS de la página),
dpr es el device pixel ratio. Para agregar un dispositivo basta con añadir
una entrada a DEVICES. "group" es una clave (phones, tablets, desktop) que la
interfaz traduce en static/js/i18n.js.
"""

UA_IPHONE = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
)
UA_IPAD = (
    "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
)
UA_PIXEL = (
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
)
UA_GALAXY = (
    "Mozilla/5.0 (Linux; Android 14; SM-S928B) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
)
UA_DESKTOP = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

DEVICES = [
    {"id": "iphone-se", "name": "iPhone SE", "group": "phones",
     "width": 375, "height": 667, "dpr": 2, "kind": "phone", "color": "#0284C7", "ua": UA_IPHONE},
    {"id": "iphone-14-pro", "name": "iPhone 14 Pro", "group": "phones",
     "width": 393, "height": 852, "dpr": 3, "kind": "phone", "color": "#2563EB", "ua": UA_IPHONE},
    {"id": "iphone-15-pro-max", "name": "iPhone 15 Pro Max", "group": "phones",
     "width": 430, "height": 932, "dpr": 3, "kind": "phone", "color": "#0891B2", "ua": UA_IPHONE},
    {"id": "pixel-7", "name": "Pixel 7", "group": "phones",
     "width": 412, "height": 915, "dpr": 2.625, "kind": "phone", "color": "#16A34A", "ua": UA_PIXEL},
    {"id": "galaxy-s24-ultra", "name": "Galaxy S24 Ultra", "group": "phones",
     "width": 384, "height": 824, "dpr": 3.75, "kind": "phone", "color": "#D97706", "ua": UA_GALAXY},
    {"id": "ipad-mini", "name": "iPad mini", "group": "tablets",
     "width": 768, "height": 1024, "dpr": 2, "kind": "tablet", "color": "#0D9488", "ua": UA_IPAD},
    {"id": "ipad-air", "name": "iPad Air", "group": "tablets",
     "width": 820, "height": 1180, "dpr": 2, "kind": "tablet", "color": "#059669", "ua": UA_IPAD},
    {"id": "laptop", "name": "Laptop", "group": "desktop",
     "width": 1366, "height": 768, "dpr": 1, "kind": "desktop", "color": "#EA580C", "ua": UA_DESKTOP},
    {"id": "macbook-pro-16", "name": "MacBook Pro 16\"", "group": "desktop",
     "width": 1728, "height": 1117, "dpr": 2, "kind": "desktop", "color": "#65A30D", "ua": UA_DESKTOP},
    {"id": "desktop-hd", "name": "Desktop Full HD", "group": "desktop",
     "width": 1920, "height": 1080, "dpr": 1, "kind": "desktop", "color": "#DC2626", "ua": UA_DESKTOP},
]

DEFAULT_DEVICE_IDS = ["iphone-14-pro", "pixel-7"]

DEVICES_BY_ID = {d["id"]: d for d in DEVICES}
