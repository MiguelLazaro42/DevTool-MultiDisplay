"""Servidor Flask del visor responsive.

La página principal muestra varias pantallas (iframes) con la misma URL.
Cada iframe no carga el sitio directamente: pasa por /proxy, que descarga la
página con el User-Agent del dispositivo, quita las cabeceras que impiden
mostrarla dentro de un iframe y guarda las cookies en un "frasco" (jar)
separado por pantalla. /api/reset vacía todos esos frascos.
"""

import argparse
import collections
import datetime
import html
import json
import logging
import os
import re
import shutil
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import warnings
import webbrowser
from urllib.parse import quote, urljoin, urlparse

# El Python que trae macOS usa LibreSSL y urllib3 avisa al arrancar; no
# afecta al visor, así que no mostramos ese aviso a los usuarios.
warnings.filterwarnings("ignore", message="urllib3 v2 only supports OpenSSL")

import requests  # noqa: E402
import urllib3  # noqa: E402
from flask import Flask, Response, jsonify, render_template, request
from flask import cli as flask_cli

from devices import DEFAULT_DEVICE_IDS, DEVICES, DEVICES_BY_ID

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

app = Flask(__name__)
app.config["TEMPLATES_AUTO_RELOAD"] = True
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0
app.config["MAX_CONTENT_LENGTH"] = 32 * 1024 * 1024  # 32 MB máx para certificados .p12

REQUEST_TIMEOUT = 15  # segundos

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CERTS_DIR = os.path.join(BASE_DIR, ".certs")
ACTIVE_PEM_PATH = os.path.join(CERTS_DIR, "active_client_cert.pem")
ACTIVE_META_PATH = os.path.join(CERTS_DIR, "active_cert.json")

_cert_lock = threading.Lock()
_cert_state = {
    "active": False,
    "filename": "",
    "pem_path": "",
    "subject": "",
    "issuer": "",
    "not_before": "",
    "not_after": "",
    "verify_ssl": False,
    "proxy_assets": True,
    "updated_at": "",
}


def _find_openssl_bin():
    if os.path.isfile("/usr/bin/openssl") and os.access("/usr/bin/openssl", os.X_OK):
        return "/usr/bin/openssl"
    return shutil.which("openssl") or "openssl"


def _run_openssl_pkcs12(openssl_bin, p12_path, extra_args, password):
    env = dict(os.environ)
    env["RV_P12_PASS"] = password or ""
    cmd = [openssl_bin, "pkcs12", "-in", p12_path] + extra_args + ["-passin", "env:RV_P12_PASS"]
    res = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=10)
    if res.returncode != 0:
        # Reintentar con -legacy por si el binario es OpenSSL 3.x y el .p12 usa cifrado clásico RC2/3DES
        cmd_legacy = [openssl_bin, "pkcs12", "-legacy", "-in", p12_path] + extra_args + ["-passin", "env:RV_P12_PASS"]
        res_leg = subprocess.run(cmd_legacy, capture_output=True, text=True, env=env, timeout=10)
        if res_leg.returncode == 0:
            return res_leg
    return res


def _extract_cert_metadata(openssl_bin, pem_path):
    meta = {"subject": "", "issuer": "", "not_before": "", "not_after": ""}
    try:
        res = subprocess.run(
            [openssl_bin, "x509", "-in", pem_path, "-noout", "-subject", "-issuer", "-dates"],
            capture_output=True, text=True, timeout=6,
        )
        if res.returncode == 0:
            for line in res.stdout.splitlines():
                line_s = line.strip()
                if line_s.startswith("subject="):
                    meta["subject"] = line_s[len("subject="):].strip()
                elif line_s.startswith("issuer="):
                    meta["issuer"] = line_s[len("issuer="):].strip()
                elif line_s.startswith("notBefore="):
                    meta["not_before"] = line_s[len("notBefore="):].strip()
                elif line_s.startswith("notAfter="):
                    meta["not_after"] = line_s[len("notAfter="):].strip()
    except Exception:
        pass
    return meta


def _reset_all_sessions():
    with _sessions_lock:
        for sess in _sessions.values():
            try:
                sess.close()
            except Exception:
                pass
        _sessions.clear()


def install_p12_certificate(p12_bytes, password="", filename="certificado.p12", verify_ssl=False, proxy_assets=True):
    """Convierte un certificado cliente .p12/.pfx a PEM unificado, valida el par
    llave/certificado con ssl.SSLContext y lo activa para todas las pantallas."""
    os.makedirs(CERTS_DIR, mode=0o700, exist_ok=True)
    openssl_bin = _find_openssl_bin()

    fd, tmp_p12 = tempfile.mkstemp(prefix="upload_", suffix=".p12", dir=CERTS_DIR)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(p12_bytes)
        os.chmod(tmp_p12, 0o600)

        # 1. Extraer certificado de cliente (hoja)
        cl_res = _run_openssl_pkcs12(openssl_bin, tmp_p12, ["-clcerts", "-nokeys"], password)
        if cl_res.returncode != 0:
            err_msg = (cl_res.stderr or cl_res.stdout or "").strip()
            if "mac verify failure" in err_msg.lower() or "bad decrypt" in err_msg.lower() or "invalid password" in err_msg.lower():
                raise ValueError("Contraseña del certificado .p12 incorrecta.")
            raise ValueError(f"No se pudo leer el archivo .p12 ({err_msg[:180] or 'formato inválido'}).")

        cl_pem = cl_res.stdout or ""
        ca_pem = ""
        if "-----BEGIN CERTIFICATE-----" in cl_pem:
            ca_res = _run_openssl_pkcs12(openssl_bin, tmp_p12, ["-cacerts", "-nokeys"], password)
            if ca_res.returncode == 0 and "-----BEGIN CERTIFICATE-----" in (ca_res.stdout or ""):
                ca_pem = ca_res.stdout
        else:
            # Algunos .p12 generados en Windows/Java no etiquetan el bag como clcerts
            all_certs_res = _run_openssl_pkcs12(openssl_bin, tmp_p12, ["-nokeys"], password)
            cl_pem = all_certs_res.stdout or ""

        # 2. Extraer llave privada sin cifrar (-nodes) para que urllib3/requests pueda usarla sin prompt interactivo
        pk_res = _run_openssl_pkcs12(openssl_bin, tmp_p12, ["-nocerts", "-nodes"], password)
        pk_pem = pk_res.stdout or ""

        if "-----BEGIN CERTIFICATE-----" not in cl_pem:
            raise ValueError("El archivo .p12 no contiene ningún certificado X.509.")
        if "PRIVATE KEY-----" not in pk_pem:
            raise ValueError("El archivo .p12 no contiene una llave privada válida.")

        combined_pem = cl_pem.strip() + "\n"
        if ca_pem.strip():
            combined_pem += ca_pem.strip() + "\n"
        combined_pem += pk_pem.strip() + "\n"

        with open(ACTIVE_PEM_PATH, "w", encoding="utf-8") as pf:
            pf.write(combined_pem)
        os.chmod(ACTIVE_PEM_PATH, 0o600)

        # 3. Validar que el motor SSL de Python pueda cargar la cadena y la llave privada
        test_ctx = ssl.create_default_context()
        test_ctx.load_cert_chain(certfile=ACTIVE_PEM_PATH)

        meta = _extract_cert_metadata(openssl_bin, ACTIVE_PEM_PATH)
        now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        with _cert_lock:
            _cert_state.update({
                "active": True,
                "filename": os.path.basename(filename or "certificado.p12"),
                "pem_path": ACTIVE_PEM_PATH,
                "subject": meta["subject"],
                "issuer": meta["issuer"],
                "not_before": meta["not_before"],
                "not_after": meta["not_after"],
                "verify_ssl": bool(verify_ssl),
                "proxy_assets": bool(proxy_assets),
                "updated_at": now_str,
            })
            saved_meta = {k: v for k, v in _cert_state.items() if k != "pem_path"}
            with open(ACTIVE_META_PATH, "w", encoding="utf-8") as mf:
                json.dump(saved_meta, mf, ensure_ascii=False, indent=2)

        _reset_all_sessions()
        return get_public_cert_state()
    finally:
        try:
            if os.path.exists(tmp_p12):
                os.remove(tmp_p12)
        except Exception:
            pass


def load_persisted_certificate():
    """Carga el certificado .p12 previamente guardado en .certs/ al iniciar el servidor."""
    if not os.path.isfile(ACTIVE_PEM_PATH) or not os.path.isfile(ACTIVE_META_PATH):
        return
    try:
        test_ctx = ssl.create_default_context()
        test_ctx.load_cert_chain(certfile=ACTIVE_PEM_PATH)
        with open(ACTIVE_META_PATH, encoding="utf-8") as mf:
            meta = json.load(mf)
        with _cert_lock:
            _cert_state.update({
                "active": True,
                "filename": meta.get("filename", "certificado.p12"),
                "pem_path": ACTIVE_PEM_PATH,
                "subject": meta.get("subject", ""),
                "issuer": meta.get("issuer", ""),
                "not_before": meta.get("not_before", ""),
                "not_after": meta.get("not_after", ""),
                "verify_ssl": bool(meta.get("verify_ssl", False)),
                "proxy_assets": bool(meta.get("proxy_assets", True)),
                "updated_at": meta.get("updated_at", ""),
            })
    except Exception:
        pass


def clear_active_certificate():
    with _cert_lock:
        _cert_state.update({
            "active": False,
            "filename": "",
            "pem_path": "",
            "subject": "",
            "issuer": "",
            "not_before": "",
            "not_after": "",
            "updated_at": "",
        })
    for p in (ACTIVE_PEM_PATH, ACTIVE_META_PATH):
        try:
            if os.path.exists(p):
                os.remove(p)
        except Exception:
            pass
    _reset_all_sessions()


def get_public_cert_state():
    with _cert_lock:
        return {
            "active": _cert_state["active"],
            "filename": _cert_state["filename"],
            "subject": _cert_state["subject"],
            "issuer": _cert_state["issuer"],
            "not_before": _cert_state["not_before"],
            "not_after": _cert_state["not_after"],
            "verify_ssl": _cert_state["verify_ssl"],
            "proxy_assets": _cert_state["proxy_assets"],
            "updated_at": _cert_state["updated_at"],
        }


load_persisted_certificate()

# Una sesión de requests (con su propio jar de cookies) por pantalla.
_sessions = {}
_sessions_lock = threading.Lock()

# Historial de peticiones HTTP (estilo Burp Suite HTTP History).
_traffic_log = collections.deque(maxlen=400)
_traffic_seq = 0
_traffic_lock = threading.Lock()

# Historial de eventos de Consola del navegador (log, warn, error, exceptions).
_console_log = collections.deque(maxlen=400)
_console_seq = 0
_console_lock = threading.Lock()

# Historial de pasos / flujo de usuario (Clicks, Inputs, Navegación) para reproducir bugs con IA.
_flow_log = collections.deque(maxlen=250)
_flow_seq = 0
_flow_lock = threading.Lock()

# Resultados de auditoría visual / responsive por dispositivo.
_audit_by_device = {}
_audit_lock = threading.Lock()

# Estado de localStorage / sessionStorage / document.cookie reportado por cada dispositivo.
_client_storage_by_device = {}
_storage_lock = threading.Lock()

# Último elemento inspeccionado/copiado (compartido entre monitores y separado por versión móvil vs desktop).
_last_inspected = {}
_inspected_by_tier = {}
_inspected_by_device = {}
_inspected_lock = threading.Lock()

# Contexto estructural de cada template activo (Móvil vs Desktop) reportado por cada pantalla.
_templates_by_device = {}
_templates_lock = threading.Lock()


def _device_tier(device):
    kind = (device or {}).get("kind", "")
    width = (device or {}).get("width", 0) or 0
    if kind in ("phone", "tablet") or (0 < width < 960):
        return "mobile"
    return "desktop"


def _format_body_preview(raw_bytes, content_type, max_chars=12000):
    if not raw_bytes:
        return ""
    ct = (content_type or "").lower()
    if any(b in ct for b in ("image/", "font/", "audio/", "video/", "application/octet-stream", "application/pdf", "application/zip")):
        return f"[Contenido binario: {len(raw_bytes)} bytes ({content_type})]"
    try:
        text = raw_bytes.decode("utf-8", errors="replace")
    except Exception:
        return f"[{len(raw_bytes)} bytes]"
    if "json" in ct or (text.strip().startswith(("{", "[")) and text.strip().endswith(("}", "]"))):
        try:
            parsed_json = json.loads(text)
            text = json.dumps(parsed_json, indent=2, ensure_ascii=False)
        except Exception:
            pass
    if len(text) > max_chars:
        return text[:max_chars] + f"\n\n... [Truncado: {len(text) - max_chars} caracteres más]"
    return text


def _short_mime(content_type, is_doc):
    ct = (content_type or "").lower()
    if "json" in ct:
        return "json"
    if "html" in ct:
        return "doc" if is_doc else "html"
    if "javascript" in ct or "ecmascript" in ct:
        return "js"
    if "css" in ct:
        return "css"
    if "xml" in ct:
        return "xml"
    if "image/" in ct:
        return "img"
    if "text/" in ct:
        return "text"
    return "other"


def record_traffic(device, method, target_url, req_headers, req_body_bytes, status_code, reason, res_headers, res_body_bytes, duration_ms, is_doc):
    global _traffic_seq
    parsed = urlparse(target_url)
    path_query = (parsed.path or "/") + (("?" + parsed.query) if parsed.query else "")
    req_ct = req_headers.get("Content-Type", "")
    res_ct = res_headers.get("Content-Type", "") if res_headers else ""

    req_body_str = _format_body_preview(req_body_bytes, req_ct, max_chars=8000)
    res_body_str = _format_body_preview(res_body_bytes, res_ct, max_chars=12000)

    req_lines = [f"{method} {path_query} HTTP/1.1", f"Host: {parsed.netloc}"]
    for k, v in req_headers.items():
        if k.lower() != "host":
            req_lines.append(f"{k}: {v}")
    raw_req = "\r\n".join(req_lines) + "\r\n\r\n" + (req_body_str or "")

    res_lines = [f"HTTP/1.1 {status_code} {reason or ''}"]
    for k, v in (res_headers or {}).items():
        res_lines.append(f"{k}: {v}")
    raw_res = "\r\n".join(res_lines) + "\r\n\r\n" + (res_body_str or "")

    with _traffic_lock:
        _traffic_seq += 1
        entry = {
            "id": _traffic_seq,
            "time": datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3],
            "device_id": device["id"],
            "device_name": device["name"],
            "method": method,
            "url": target_url,
            "host": parsed.netloc,
            "path": path_query,
            "status": status_code,
            "reason": reason or "",
            "mime": _short_mime(res_ct, is_doc),
            "content_type": res_ct.split(";")[0].strip() if res_ct else "",
            "size": len(res_body_bytes) if res_body_bytes else 0,
            "duration_ms": duration_ms,
            "req_headers": dict(req_headers),
            "req_body": req_body_str,
            "res_headers": dict(res_headers) if res_headers else {},
            "res_body": res_body_str,
            "raw_request": raw_req,
            "raw_response": raw_res,
        }
        _traffic_log.append(entry)

# Cabeceras de la respuesta original que no se reenvían al navegador.
DROPPED_HEADERS = {
    "x-frame-options",
    "content-security-policy",
    "content-security-policy-report-only",
    "set-cookie",
    "content-encoding",
    "content-length",
    "transfer-encoding",
    "connection",
    "strict-transport-security",
    "date",
    "server",
}

META_CSP_RE = re.compile(
    r"<meta[^>]+http-equiv\s*=\s*[\"']?content-security-policy[^>]*>", re.I
)
HEAD_OPEN_RE = re.compile(r"<head(\s[^>]*)?>", re.I)

ASSET_TAG_RE = re.compile(
    r"<(?:script|link|img|source|video|audio)\b[^>]*>",
    re.I,
)
SRC_HREF_ATTR_RE = re.compile(
    r"(\b(?:src|href)\s*=\s*)([\"'])([^\"']+)\2",
    re.I,
)
INTEGRITY_ATTR_RE = re.compile(r"\s+\b(?:integrity|crossorigin)\s*=\s*(?:[\"'][^\"']*[\"']|[^\s>]+)", re.I)
CSS_URL_RE = re.compile(r"url\(\s*([\"']?)([^\"')]+)\1\s*\)", re.I)


def _same_site_host(host_a, host_b):
    if not host_a or not host_b:
        return False
    ha = host_a.split(":")[0].lower().strip(".")
    hb = host_b.split(":")[0].lower().strip(".")
    if ha == hb:
        return True
    parts_a = ha.split(".")
    parts_b = hb.split(".")
    if len(parts_a) >= 2 and len(parts_b) >= 2:
        if parts_a[-2:] == parts_b[-2:]:
            return True
    return False


def _build_proxy_asset_url(abs_url, frame_id, device_id):
    return f"/proxy?frame={quote(frame_id, safe='')}&device={quote(device_id, safe='')}&url={quote(abs_url, safe='')}"


def _rewrite_html_assets_for_proxy(html_text, base_url, frame_id, device_id):
    """Cuando hay un certificado .p12 activo, reescribe los recursos del mismo
    sitio (<script src>, <link href>, <img src>, <source src>) para que pasen
    también por /proxy presentando el certificado cliente."""
    parsed_base = urlparse(base_url)
    base_host = parsed_base.hostname or ""

    def _repl_tag(tag_match):
        tag_str = tag_match.group(0)
        tag_lower = tag_str.lower()
        if tag_lower.startswith("<link") and not any(rel in tag_lower for rel in ("stylesheet", "preload", "modulepreload", "icon", "manifest")):
            return tag_str
        rewritten_any = [False]

        def _repl_attr(attr_match):
            attr_prefix, quote_ch, raw_val = attr_match.group(1), attr_match.group(2), attr_match.group(3).strip()
            if not raw_val or raw_val.startswith(("data:", "blob:", "javascript:", "mailto:", "tel:", "about:", "#", "/proxy?")):
                return attr_match.group(0)
            abs_target = urljoin(base_url, raw_val)
            parsed_target = urlparse(abs_target)
            if parsed_target.scheme not in ("http", "https"):
                return attr_match.group(0)
            if not _same_site_host(base_host, parsed_target.hostname or ""):
                return attr_match.group(0)
            rewritten_any[0] = True
            proxied = _build_proxy_asset_url(abs_target, frame_id, device_id)
            return f"{attr_prefix}{quote_ch}{html.escape(proxied, quote=True)}{quote_ch}"

        new_tag = SRC_HREF_ATTR_RE.sub(_repl_attr, tag_str)
        if rewritten_any[0]:
            new_tag = INTEGRITY_ATTR_RE.sub("", new_tag)
        return new_tag

    return ASSET_TAG_RE.sub(_repl_tag, html_text)


def _rewrite_css_urls_for_proxy(css_text, base_url, frame_id, device_id):
    """Reescribe url(...) dentro de archivos CSS servidos por /proxy cuando hay
    certificado .p12 activo (para fuentes web e imágenes de fondo)."""
    parsed_base = urlparse(base_url)
    base_host = parsed_base.hostname or ""

    def _repl(match):
        quote_ch, raw_val = match.group(1), match.group(2).strip()
        if not raw_val or raw_val.startswith(("data:", "blob:", "#", "/proxy?")):
            return match.group(0)
        abs_target = urljoin(base_url, raw_val)
        parsed_target = urlparse(abs_target)
        if parsed_target.scheme not in ("http", "https"):
            return match.group(0)
        if not _same_site_host(base_host, parsed_target.hostname or ""):
            return match.group(0)
        proxied = _build_proxy_asset_url(abs_target, frame_id, device_id)
        q = quote_ch or '"'
        return f"url({q}{proxied}{q})"

    return CSS_URL_RE.sub(_repl, css_text)


def get_session(frame_id):
    with _sessions_lock:
        session = _sessions.get(frame_id)
        if session is None:
            session = requests.Session()
            _sessions[frame_id] = session
        with _cert_lock:
            if _cert_state["active"] and _cert_state["pem_path"] and os.path.isfile(_cert_state["pem_path"]):
                session.cert = _cert_state["pem_path"]
                session.verify = bool(_cert_state["verify_ssl"])
            else:
                session.cert = None
                session.verify = True
        return session


FRAME_INJECT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "js", "frame-inject.js")


def frame_script(frame_id, device_id, cert_proxy_assets=False):
    """Script que se inyecta en cada página para que enlaces, formularios y
    peticiones sigan pasando por el proxy (ver static/js/frame-inject.js)."""
    with open(FRAME_INJECT_PATH, encoding="utf-8") as f:
        source = f.read()
    source = (
        source.replace("__FRAME__", json.dumps(frame_id))
        .replace("__DEVICE__", json.dumps(device_id))
        .replace("__CERT_ACTIVE__", "true" if cert_proxy_assets else "false")
    )
    return "<script>" + source.replace("</", "<\\/") + "</script>"


# Mensajes que se muestran dentro de una pantalla cuando la página no carga.
# El idioma llega como ?lang= desde la interfaz (inglés por defecto).
ERRORS = {
    "en": {
        "title": "Couldn't load the page",
        "invalid_url": "This address isn't valid. Use a URL that starts with http:// or https://.",
        "unknown_device": "Unknown device.",
        "timeout": "The site took too long to respond.",
        "connect": "Couldn't connect to the site ({name}).",
    },
    "es": {
        "title": "No se pudo cargar la página",
        "invalid_url": "La dirección no es válida. Usa una URL que empiece con http:// o https://.",
        "unknown_device": "Dispositivo desconocido.",
        "timeout": "El sitio tardó demasiado en responder.",
        "connect": "No se pudo conectar con el sitio ({name}).",
    },
}


def error_page(key, url, **fmt):
    lang = request.args.get("lang", "en")
    strings = ERRORS.get(lang, ERRORS["en"])
    page = render_template(
        "frame_error.html",
        lang=lang if lang in ERRORS else "en",
        title=strings["title"],
        message=strings[key].format(**fmt),
        url=url,
    )
    return Response(page, status=502, mimetype="text/html")


@app.route("/")
def index():
    return render_template(
        "index.html", devices=DEVICES, default_device_ids=DEFAULT_DEVICE_IDS
    )


# Cabeceras de la petición que sí se reenvían al sitio (además de las que
# empiezan con X-, como X-Requested-With o X-CSRF-Token).
FORWARDED_REQUEST_HEADERS = ("Content-Type", "Authorization")


@app.route("/proxy", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
def proxy():
    url = (request.args.get("url") or "").strip()
    frame_id = re.sub(r"[^A-Za-z0-9_-]", "", request.args.get("frame", ""))[:64] or "default"
    device = DEVICES_BY_ID.get(request.args.get("device", ""))

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return error_page("invalid_url", url)
    if device is None:
        return error_page("unknown_device", url)

    is_mobile_ua = device.get("kind") == "phone"
    ua_str = device["ua"]
    platform_hint = '"iOS"' if ("iPhone" in ua_str or "iPad" in ua_str) else ('"Android"' if "Android" in ua_str else '"macOS"')
    headers = {
        "User-Agent": ua_str,
        "Accept": request.headers.get(
            "Accept", "text/html,application/xhtml+xml,*/*;q=0.8"
        ),
        "Accept-Language": request.headers.get("Accept-Language", "en-US,en;q=0.9"),
        "Sec-CH-UA-Mobile": "?1" if is_mobile_ua else "?0",
        "Sec-CH-UA-Platform": platform_hint,
        "Viewport-Width": str(device.get("width", 1280)),
        "X-Device-Type": "mobile" if device.get("kind") == "phone" else ("tablet" if device.get("kind") == "tablet" else "desktop"),
    }
    for name in FORWARDED_REQUEST_HEADERS:
        if name in request.headers:
            headers[name] = request.headers[name]
    for name, value in request.headers.items():
        if name.lower().startswith("x-") and not name.lower().startswith("x-forwarded"):
            headers[name] = value

    site = f"{parsed.scheme}://{parsed.netloc}"
    data = None
    if request.method != "GET":
        data = request.get_data()
        # Muchos sitios rechazan un POST (login, CSRF) si Origin/Referer no son
        # los suyos. El navegador mandaría los del visor, así que ponemos los del sitio.
        headers["Origin"] = site
        headers["Referer"] = site + "/"
    else:
        headers["Referer"] = site + "/"

    sec_dest = request.headers.get("Sec-Fetch-Dest", "")
    is_document = sec_dest in ("iframe", "frame", "document", "") and request.method == "GET"
    t0 = time.time()

    try:
        upstream = get_session(frame_id).request(
            request.method, url, headers=headers, data=data,
            timeout=REQUEST_TIMEOUT, allow_redirects=True,
        )
    except requests.exceptions.Timeout:
        dur = round((time.time() - t0) * 1000)
        record_traffic(device, request.method, url, headers, data, 504, "Gateway Timeout", {}, b"", dur, is_document)
        return error_page("timeout", url)
    except requests.exceptions.RequestException as exc:
        dur = round((time.time() - t0) * 1000)
        record_traffic(device, request.method, url, headers, data, 502, exc.__class__.__name__, {}, b"", dur, is_document)
        return error_page("connect", url, name=exc.__class__.__name__)

    dur = round((time.time() - t0) * 1000)
    content_type = upstream.headers.get("Content-Type", "")
    body = upstream.content

    record_traffic(
        device,
        request.method,
        upstream.url or url,
        headers,
        data,
        upstream.status_code,
        upstream.reason,
        upstream.headers,
        body,
        dur,
        is_document,
    )

    with _cert_lock:
        cert_proxy_assets = bool(_cert_state["active"] and _cert_state["proxy_assets"])

    if "text/html" in content_type.lower() and is_document:
        if "charset" not in content_type.lower():
            # Sin charset en la cabecera, requests asume ISO-8859-1; mejor adivinar.
            upstream.encoding = upstream.apparent_encoding or "utf-8"
        text = upstream.text
        text = META_CSP_RE.sub("", text)
        if cert_proxy_assets:
            text = _rewrite_html_assets_for_proxy(text, upstream.url or url, frame_id, device["id"])
        injection = f'<base href="{html.escape(upstream.url, quote=True)}">' + frame_script(frame_id, device["id"], cert_proxy_assets=cert_proxy_assets)
        if HEAD_OPEN_RE.search(text):
            text = HEAD_OPEN_RE.sub(lambda m: m.group(0) + injection, text, count=1)
        else:
            text = injection + text
        body = text.encode("utf-8")
        content_type = "text/html; charset=utf-8"
    elif "text/css" in content_type.lower() and cert_proxy_assets:
        if "charset" not in content_type.lower():
            upstream.encoding = upstream.apparent_encoding or "utf-8"
        css_text = _rewrite_css_urls_for_proxy(upstream.text, upstream.url or url, frame_id, device["id"])
        body = css_text.encode("utf-8")
        content_type = "text/css; charset=utf-8"

    resp = Response(body, status=upstream.status_code)
    for name, value in upstream.headers.items():
        if name.lower() not in DROPPED_HEADERS and name.lower() != "content-type":
            resp.headers[name] = value
    resp.headers["Content-Type"] = content_type or "application/octet-stream"
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["Access-Control-Allow-Origin"] = "*"
    return resp


@app.route("/api/reset", methods=["POST"])
def reset():
    """Borra todas las cookies: las del servidor (un jar por pantalla) y las
    que el navegador guardó para este origen."""
    with _sessions_lock:
        cleared = len(_sessions)
        for session in _sessions.values():
            session.close()
        _sessions.clear()

    resp = jsonify({"ok": True, "cleared_sessions": cleared})
    resp.headers["Clear-Site-Data"] = '"cookies"'
    # Respaldo para navegadores que ignoran Clear-Site-Data.
    for name in request.cookies:
        resp.delete_cookie(name)
    return resp


@app.route("/api/traffic", methods=["GET"])
def api_traffic():
    since = request.args.get("since", 0, type=int)
    with _traffic_lock:
        items = [e for e in _traffic_log if e["id"] > since]
    return jsonify({"items": items})


@app.route("/api/traffic/clear", methods=["POST"])
def api_traffic_clear():
    with _traffic_lock:
        _traffic_log.clear()
    return jsonify({"ok": True})


@app.route("/api/console", methods=["GET", "POST"])
def api_console():
    global _console_seq
    if request.method == "POST":
        payload = request.get_json(silent=True) or {}
        device = DEVICES_BY_ID.get(payload.get("device", ""), {"id": payload.get("device", "unknown"), "name": payload.get("device", "Unknown")})
        with _console_lock:
            _console_seq += 1
            entry = {
                "id": _console_seq,
                "time": datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3],
                "device_id": device["id"],
                "device_name": device["name"],
                "level": (payload.get("level") or "log").lower(),
                "message": (payload.get("message") or "")[:4000],
                "detail": (payload.get("detail") or "")[:12000],
                "source": (payload.get("source") or "")[:500],
                "url": (payload.get("url") or "")[:1000],
            }
            _console_log.append(entry)
        return jsonify({"ok": True, "item": entry})

    since = request.args.get("since", 0, type=int)
    with _console_lock:
        items = [e for e in _console_log if e["id"] > since]
    return jsonify({"items": items})


@app.route("/api/console/clear", methods=["POST"])
def api_console_clear():
    with _console_lock:
        _console_log.clear()
    return jsonify({"ok": True})


@app.route("/api/flow", methods=["GET", "POST"])
def api_flow():
    global _flow_seq
    if request.method == "POST":
        payload = request.get_json(silent=True) or {}
        dev_id = payload.get("device") or payload.get("frame") or "unknown"
        device = DEVICES_BY_ID.get(dev_id, {"id": dev_id, "name": dev_id})
        with _flow_lock:
            _flow_seq += 1
            entry = {
                "id": _flow_seq,
                "time": datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3],
                "device_id": device["id"],
                "device_name": device["name"],
                "action": (payload.get("action") or "click").lower(),
                "selector": (payload.get("selector") or "")[:600],
                "tag": (payload.get("tag") or "")[:80],
                "label": (payload.get("label") or payload.get("text") or "")[:600],
                "value": (payload.get("value") or "")[:1000],
                "url": (payload.get("url") or "")[:1000],
                "section": (payload.get("section") or "")[:300],
                "zone": (payload.get("zone") or "")[:120],
                "coords": payload.get("coords") or {},
                "box": payload.get("box") or {},
                "inputType": (payload.get("inputType") or "")[:60],
            }
            _flow_log.append(entry)
        return jsonify({"ok": True, "item": entry})

    since = request.args.get("since", 0, type=int)
    with _flow_lock:
        items = [e for e in _flow_log if e["id"] > since]
    return jsonify({"items": items})


@app.route("/api/flow/clear", methods=["POST"])
def api_flow_clear():
    with _flow_lock:
        _flow_log.clear()
    return jsonify({"ok": True})


@app.route("/api/audit", methods=["GET", "POST"])
def api_audit():
    if request.method == "POST":
        payload = request.get_json(silent=True) or {}
        dev_id = payload.get("device") or payload.get("frame") or "unknown"
        device = DEVICES_BY_ID.get(dev_id, {"id": dev_id, "name": dev_id, "width": 0, "height": 0})
        issues = payload.get("issues") or []
        cleaned = []
        for idx, iss in enumerate(issues[:80]):
            cleaned.append({
                "id": f"{dev_id}:{idx + 1}",
                "device_id": device["id"],
                "device_name": device["name"],
                "viewport": f"{device.get('width', 0)}×{device.get('height', 0)}",
                "kind": (iss.get("kind") or "LAYOUT")[:60],
                "severity": (iss.get("severity") or "warn")[:20],
                "selector": (iss.get("selector") or "")[:500],
                "tag": (iss.get("tag") or "")[:80],
                "summary": (iss.get("summary") or "")[:600],
                "detail": (iss.get("detail") or "")[:4000],
                "box": iss.get("box") or {},
                "styles": iss.get("styles") or "",
                "html": (iss.get("html") or "")[:2500],
                "url": (payload.get("url") or "")[:1000],
            })
        with _audit_lock:
            _audit_by_device[dev_id] = cleaned
        return jsonify({"ok": True, "count": len(cleaned)})

    with _audit_lock:
        all_issues = []
        for dev_list in _audit_by_device.values():
            all_issues.extend(dev_list)
    return jsonify({"items": all_issues})


@app.route("/api/audit/clear", methods=["POST"])
def api_audit_clear():
    with _audit_lock:
        _audit_by_device.clear()
    return jsonify({"ok": True})


@app.route("/api/storage", methods=["GET", "POST"])
def api_storage():
    if request.method == "POST":
        payload = request.get_json(silent=True) or {}
        dev_id = payload.get("device") or payload.get("frame") or "unknown"
        with _storage_lock:
            _client_storage_by_device[dev_id] = {
                "url": (payload.get("url") or "")[:1000],
                "local": payload.get("local") or [],
                "session": payload.get("session") or [],
                "doc_cookies": payload.get("doc_cookies") or [],
                "updated_at": datetime.datetime.now().strftime("%H:%M:%S"),
            }
        return jsonify({"ok": True})

    items = []
    seq = 0
    # 1. Cookies del jar del servidor por cada sesión (incluye HttpOnly)
    with _sessions_lock:
        session_snapshot = list(_sessions.items())
    for frame_id, sess in session_snapshot:
        device = DEVICES_BY_ID.get(frame_id, {"id": frame_id, "name": frame_id})
        try:
            for c in sess.cookies:
                seq += 1
                http_only = bool(getattr(c, "_rest", {}).get("HttpOnly") or "HttpOnly" in getattr(c, "_rest", {}))
                items.append({
                    "id": seq,
                    "device_id": device["id"],
                    "device_name": device["name"],
                    "store": "HttpOnly Cookie" if http_only else "Cookie",
                    "key": c.name,
                    "value": c.value or "",
                    "domain": c.domain or "",
                    "path": c.path or "/",
                    "secure": bool(c.secure),
                    "http_only": http_only,
                    "expires": c.expires,
                })
        except Exception:
            pass

    # 2. localStorage y sessionStorage reportados por los iframes
    with _storage_lock:
        client_snapshot = dict(_client_storage_by_device)
    for dev_id, st in client_snapshot.items():
        device = DEVICES_BY_ID.get(dev_id, {"id": dev_id, "name": dev_id})
        for entry in st.get("local", []):
            seq += 1
            items.append({
                "id": seq,
                "device_id": device["id"],
                "device_name": device["name"],
                "store": "localStorage",
                "key": str(entry.get("key", ""))[:300],
                "value": str(entry.get("value", ""))[:8000],
                "domain": st.get("url", ""),
                "path": "",
                "secure": False,
                "http_only": False,
                "expires": None,
            })
        for entry in st.get("session", []):
            seq += 1
            items.append({
                "id": seq,
                "device_id": device["id"],
                "device_name": device["name"],
                "store": "sessionStorage",
                "key": str(entry.get("key", ""))[:300],
                "value": str(entry.get("value", ""))[:8000],
                "domain": st.get("url", ""),
                "path": "",
                "secure": False,
                "http_only": False,
                "expires": None,
            })
        for entry in st.get("doc_cookies", []):
            ck_name = str(entry.get("key", ""))[:300]
            if not ck_name:
                continue
            if any(x["device_id"] == device["id"] and x["key"] == ck_name and "Cookie" in x["store"] for x in items):
                continue
            seq += 1
            items.append({
                "id": seq,
                "device_id": device["id"],
                "device_name": device["name"],
                "store": "Cookie (JS)",
                "key": ck_name,
                "value": str(entry.get("value", ""))[:8000],
                "domain": st.get("url", ""),
                "path": "/",
                "secure": False,
                "http_only": False,
                "expires": None,
            })

    return jsonify({"items": items})


@app.route("/api/inspected", methods=["GET", "POST"])
def api_inspected():
    global _last_inspected
    if request.method == "POST":
        payload = request.get_json(silent=True) or {}
        dev_id = payload.get("device") or payload.get("frame") or "unknown"
        device = DEVICES_BY_ID.get(dev_id, {"id": dev_id, "name": dev_id, "width": 0, "height": 0, "kind": "desktop"})
        tier = _device_tier(device)
        is_counterpart = bool(payload.get("isCounterpart"))
        item_data = {
            "time": datetime.datetime.now().strftime("%H:%M:%S"),
            "device_id": device["id"],
            "device_name": device["name"],
            "kind": device.get("kind", "desktop"),
            "tier": tier,
            "viewport": f"{device.get('width', 0)}×{device.get('height', 0)}",
            "url": payload.get("url") or "",
            "tag": payload.get("tag") or "",
            "selector": payload.get("selector") or "",
            "section": (payload.get("section") or "")[:300],
            "width": payload.get("width") or 0,
            "height": payload.get("height") or 0,
            "box": payload.get("box") or {},
            "stylesSummary": payload.get("stylesSummary") or "",
            "stylesMap": payload.get("stylesMap") or {},
            "html": (payload.get("html") or "")[:12000],
            "isCounterpart": is_counterpart,
            "matchedBy": (payload.get("matchedBy") or "")[:120],
            "notFoundInTemplate": bool(payload.get("notFoundInTemplate")),
        }
        with _inspected_lock:
            if not is_counterpart:
                _last_inspected = item_data
            _inspected_by_tier[tier] = item_data
            _inspected_by_device[device["id"]] = item_data
        return jsonify({
            "ok": True,
            "item": _last_inspected,
            "by_tier": dict(_inspected_by_tier),
            "by_device": dict(_inspected_by_device),
        })

    with _inspected_lock:
        data = dict(_last_inspected) if _last_inspected else None
        by_tier = dict(_inspected_by_tier)
        by_dev = dict(_inspected_by_device)
    return jsonify({"item": data, "by_tier": by_tier, "by_device": by_dev})


@app.route("/api/templates", methods=["GET", "POST"])
def api_templates():
    if request.method == "POST":
        payload = request.get_json(silent=True) or {}
        dev_id = payload.get("device") or payload.get("frame") or "unknown"
        device = DEVICES_BY_ID.get(dev_id, {"id": dev_id, "name": dev_id, "width": 0, "height": 0, "kind": "desktop"})
        tier = _device_tier(device)
        entry = {
            "updated_at": datetime.datetime.now().strftime("%H:%M:%S"),
            "device_id": device["id"],
            "device_name": device["name"],
            "kind": device.get("kind", "desktop"),
            "tier": tier,
            "viewport": f"{device.get('width', 0)}×{device.get('height', 0)}",
            "url": (payload.get("url") or "")[:1000],
            "title": (payload.get("title") or "")[:300],
            "bodySignature": (payload.get("bodySignature") or "")[:400],
            "rootContainers": (payload.get("rootContainers") or [])[:15],
            "stylesheets": (payload.get("stylesheets") or [])[:15],
            "landmarks": (payload.get("landmarks") or [])[:20],
            "activeModal": payload.get("activeModal") or None,
            "domOutline": (payload.get("domOutline") or "")[:4000],
        }
        with _templates_lock:
            _templates_by_device[device["id"]] = entry
        return jsonify({"ok": True, "item": entry})

    with _templates_lock:
        items = list(_templates_by_device.values())
    return jsonify({"items": items})


@app.route("/api/cert", methods=["GET", "POST"])
def api_cert():
    if request.method == "GET":
        return jsonify({"ok": True, "cert": get_public_cert_state()})

    # POST: subir nuevo archivo .p12/.pfx, indicar ruta local o actualizar opciones
    if request.files and "file" in request.files:
        f = request.files["file"]
        raw_bytes = f.read()
        if not raw_bytes:
            return jsonify({"ok": False, "error": "El archivo .p12 seleccionado está vacío."}), 400
        password = request.form.get("password", "")
        verify_ssl = request.form.get("verify_ssl", "false").lower() in ("true", "1", "yes", "on")
        proxy_assets = request.form.get("proxy_assets", "true").lower() in ("true", "1", "yes", "on")
        try:
            cert_info = install_p12_certificate(
                raw_bytes,
                password=password,
                filename=f.filename or "certificado.p12",
                verify_ssl=verify_ssl,
                proxy_assets=proxy_assets,
            )
            return jsonify({"ok": True, "cert": cert_info})
        except ValueError as exc:
            return jsonify({"ok": False, "error": str(exc)}), 400
        except Exception as exc:
            return jsonify({"ok": False, "error": f"Error al procesar el certificado: {exc}"}), 400

    payload = request.get_json(silent=True) or {}
    local_path = (payload.get("path") or "").strip()
    if local_path:
        expanded = os.path.expanduser(local_path)
        if not os.path.isfile(expanded):
            return jsonify({"ok": False, "error": f"No se encontró el archivo en la ruta: {local_path}"}), 400
        try:
            with open(expanded, "rb") as lf:
                raw_bytes = lf.read()
            cert_info = install_p12_certificate(
                raw_bytes,
                password=payload.get("password", ""),
                filename=os.path.basename(expanded),
                verify_ssl=bool(payload.get("verify_ssl", False)),
                proxy_assets=bool(payload.get("proxy_assets", True)),
            )
            return jsonify({"ok": True, "cert": cert_info})
        except ValueError as exc:
            return jsonify({"ok": False, "error": str(exc)}), 400
        except Exception as exc:
            return jsonify({"ok": False, "error": f"Error al cargar el archivo .p12: {exc}"}), 400

    # Actualizar solo flags (verify_ssl / proxy_assets) si ya hay un certificado activo
    with _cert_lock:
        if "verify_ssl" in payload:
            _cert_state["verify_ssl"] = bool(payload["verify_ssl"])
        if "proxy_assets" in payload:
            _cert_state["proxy_assets"] = bool(payload["proxy_assets"])
        if _cert_state["active"] and os.path.isfile(ACTIVE_META_PATH):
            try:
                saved_meta = {k: v for k, v in _cert_state.items() if k != "pem_path"}
                with open(ACTIVE_META_PATH, "w", encoding="utf-8") as mf:
                    json.dump(saved_meta, mf, ensure_ascii=False, indent=2)
            except Exception:
                pass
    _reset_all_sessions()
    return jsonify({"ok": True, "cert": get_public_cert_state()})


@app.route("/api/cert/clear", methods=["POST"])
def api_cert_clear():
    clear_active_certificate()
    return jsonify({"ok": True, "cert": get_public_cert_state()})


def find_free_port(preferred, attempts=20):
    """Devuelve el primer puerto libre a partir de `preferred`."""
    for port in range(preferred, preferred + attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise SystemExit(f"No free port found between {preferred} and {preferred + attempts - 1}.")


def main():
    parser = argparse.ArgumentParser(description="Responsive Viewer")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", 5050)),
                        help="port to use (default 5050, or the next free one)")
    parser.add_argument("--no-browser", action="store_true",
                        help="don't open the browser automatically")
    parser.add_argument("--debug", action="store_true",
                        help="reload the server when the code changes (for development)")
    parser.add_argument("--cert", type=str, default=os.environ.get("RV_CERT_P12", ""),
                        help="path to a client .p12/.pfx certificate for mTLS development sites")
    parser.add_argument("--cert-pass", type=str, default=os.environ.get("RV_CERT_PASS", ""),
                        help="password for the .p12/.pfx certificate")
    args = parser.parse_args()

    if args.cert:
        cert_file = os.path.expanduser(args.cert)
        if os.path.isfile(cert_file):
            try:
                with open(cert_file, "rb") as cf:
                    install_p12_certificate(cf.read(), password=args.cert_pass, filename=os.path.basename(cert_file))
                print(f"  Loaded client certificate: {cert_file}", flush=True)
            except Exception as exc:
                print(f"  Warning: could not load certificate {cert_file}: {exc}", flush=True)

    # Con --debug, Flask arranca el servidor dos veces (el segundo proceso
    # trae WERKZEUG_RUN_MAIN): solo el primero busca puerto y abre el navegador.
    reloaded = os.environ.get("WERKZEUG_RUN_MAIN") == "true"
    if reloaded:
        port = int(os.environ["RV_PORT"])
    else:
        # El puerto 5000 lo usa AirPlay en macOS; por eso 5050 por defecto.
        port = find_free_port(args.port)
        os.environ["RV_PORT"] = str(port)
        url = f"http://127.0.0.1:{port}"
        print(f"\n  Responsive Viewer is running at {url}", flush=True)
        print("  Press Ctrl+C to stop it.\n", flush=True)
        if not args.no_browser:
            threading.Timer(1.0, webbrowser.open, args=(url,)).start()

    if not args.debug:
        # Sin el aviso rojo de "development server" ni una línea por cada
        # petición: para quien solo usa el visor, eso es ruido.
        logging.getLogger("werkzeug").setLevel(logging.ERROR)
        flask_cli.show_server_banner = lambda *a, **k: None

    app.run(host="127.0.0.1", port=port, debug=args.debug)


if __name__ == "__main__":
    main()
