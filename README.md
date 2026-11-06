# DevTool MultiDisplay (Responsive Viewer)

Entorno de visualización multi-dispositivo, sincronización interactiva y depuración web asistida por IA construido con Flask. Permite probar aplicaciones web simultáneamente en teléfonos (iPhone / Android), tablets y escritorio, inspeccionando tráfico HTTP, consola, problemas visuales, almacenamiento y flujo de usuario en un solo lugar.

![Vista general de Responsive Viewer](Img/screenshot.png)

---

## Características principales

### 1. Visualización multi-dispositivo y soporte multi-plantilla
- **Barra de dirección**: escribe cualquier URL (`http://` o `https://`) y presiona Enter. Cada pantalla solicita el sitio a través del proxy local enviando su propio `User-Agent`, `Sec-CH-UA-Mobile`, `Sec-CH-UA-Platform`, `Viewport-Width` y `X-Device-Type`.
- **Soporte para plantillas separadas (Móvil vs. Escritorio)**: si tu servidor entrega un HTML distinto según el dispositivo (por ejemplo, una plantilla exclusiva para móvil y otra para escritorio), cada visor recibe y renderiza su plantilla correspondiente.
- **Sesiones aisladas o compartidas**: cada dispositivo mantiene su propio contenedor de cookies en el servidor. El botón **Refresh** recarga todas las pantallas y limpia las cookies de sesión y del navegador.

### 2. Sincronización inteligente entre pantallas (`Sync`)
- **Clics, formularios y teclado**: replica clics, escritura en campos de texto (`input` / `change`), envíos de formularios y pulsaciones de la tecla `Escape` en todas las vistas activas.
- **Búsqueda semántica entre plantillas**: cuando las estructuras DOM de móvil y escritorio difieren, localiza el elemento equivalente por `id`, atributos de pruebas, `href`, texto visible o etiquetas `aria-label`.
- **Scroll proporcional**: sincroniza el desplazamiento vertical y horizontal por porcentaje (`ratioY` / `ratioX`) tanto en el documento como dentro de contenedores desplazables.
- **Sincronización de modales, drawers y bottom sheets**:
  - Detecta cuando hay un modal o panel emergente abierto y sincroniza su scroll interno.
  - Replica en tiempo real el arrastre táctil o con ratón (`drag` / `swipe`) sobre modales y hojas inferiores.
  - Sincroniza el cierre del modal al pulsar el fondo oscuro (`backdrop`), el botón de cierre o la tecla `Escape`.

### 3. Disposición del lienzo y monitores verticales
- **Modos de ajuste**:
  - **Fit**: ajusta el zoom automáticamente para que todas las pantallas quepan en la ventana.
  - **Fill**: aprovecha el ancho disponible distribuyendo los dispositivos en filas.
  - **Stack**: apila los dispositivos verticalmente, ideal para monitores en orientación vertical (se activa automáticamente cuando el alto de la ventana supera al ancho).
- **Modo Focus (Maximizar)**: cada dispositivo cuenta con un botón en su esquina superior derecha para expandirlo al 100% del área de trabajo y regresar a la vista múltiple con un clic.
- **Zoom independiente**: controles `- / +`, atajos `Cmd +` / `Cmd -` / `Cmd 0` (`Ctrl` en Windows/Linux) y gesto de pellizco en trackpad sin alterar el zoom de la interfaz principal.

### 4. Soporte para certificados de cliente mTLS (`.p12` / `.pfx`)
Diseñado para entornos de desarrollo protegidos por certificado de cliente:
- **Carga desde la interfaz o CLI**: haz clic en el botón **Cert .p12** de la barra inferior para subir tu archivo `.p12` / `.pfx` o indicar su ruta local y contraseña.
- **Persistencia local**: el certificado se convierte automáticamente a formato `.pem` mediante `openssl` y se conserva en la carpeta local `.certs/` (ignorada por Git) para no tener que volver a cargarlo al reiniciar.
- **Túnel completo de recursos sin bloqueos de Keychain**: cuando hay un certificado activo, el proxy reescribe automáticamente scripts, hojas de estilo, imágenes, fuentes, `url()` de CSS y asignaciones dinámicas de JavaScript para que todo el tráfico pase por el backend Python con mTLS, evitando que el navegador o el Llavero de macOS (`Acceso a Llaveros`) pidan usuario y contraseña en cada pantalla.

### 5. Panel DevTools integrado (Modo Oscuro)
En la barra inferior puedes abrir y acoplar (abajo o a la derecha) el panel de herramientas con cinco pestañas:

- **HTTP Traffic**: historial completo de peticiones y respuestas que pasan por el proxy (método, código de estado, dispositivo, tipo MIME, tiempo de respuesta y tamaño). Permite filtrar por texto, método o estado, inspeccionar cabeceras y cuerpo completo, y copiar cualquier petición como comando `curl`.
- **Console**: captura en vivo de `console.log`, `console.info`, `console.warn`, `console.error`, errores de ejecución (`window.onerror`), promesas rechazadas (`unhandledrejection`) y fallos de carga de recursos (`<img>`, `<script>`, `<link>`) indicando desde qué dispositivo se originaron.
- **Visual (Auditoría Visual)**: analiza automáticamente el DOM de cada pantalla para detectar:
  - Desbordamientos horizontales (`OVERFLOW-X`) que rompen el diseño en móvil.
  - Imágenes rotas o sin dimensiones (`IMG-BROKEN`).
  - Textos cortados o desbordados (`TEXT-CLIP`).
  - Botones y enlaces con área táctil menor a `44x44 px` (`TAP-TARGET`).
  - Al hacer clic en cualquier hallazgo, el visor desplaza y resalta el elemento afectado en la pantalla correspondiente.
- **Flow (Rastreador de Usuario)**: graba paso a paso las acciones realizadas (clics, deslizamientos/scroll con dirección y porcentaje de profundidad, escritura en inputs y cambios de URL), registrando las coordenadas exactas, la zona de la pantalla (`Superior-Izquierda`, `Centro`, `Inferior-Derecha`, etc.) y la sección semántica (`Header`, `Navegación`, `Modal / Diálogo`, `Contenido principal`, `Footer`).
- **Storage / Cookies / JWT**: muestra las cookies `HttpOnly` del servidor, cookies de documento, `localStorage` y `sessionStorage` por dispositivo. Si detecta un token **JWT**, lo decodifica automáticamente mostrando su `header` y `payload` en JSON legible.

### 6. Inspector de elementos multi-plantilla (`Inspect`)
- Al activar **Inspect**, pasa el cursor sobre cualquier pantalla para ver las dimensiones, etiqueta, clases y estilos computados del elemento bajo el puntero.
- Al hacer clic sobre un elemento, se fija su selección y el visor busca automáticamente el **elemento equivalente en las demás pantallas** (móvil, tablet y escritorio), capturando el HTML y CSS de cada versión para compararlos.

### 7. Captura de pantalla fiel al estado en vivo (`Capture`)
- Captura exactamente lo que estás viendo en pantalla —incluyendo **modales abiertos**, menús desplegados, texto escrito en formularios, estados dinámicos de Alpine.js / React / Vue y la posición actual de scroll— clonando el DOM vivo e incrustando imágenes y estilos antes de renderizar el lienzo PNG.
- Permite copiar al portapapeles un mosaico con todas las pantallas activas o la captura individual de un dispositivo.

### 8. Reporte contextual para IA (`Report`)
- Genera un reporte en formato **Markdown** limpio y estructurado listo para pegar directamente en el chat de tu asistente de IA.
- Puedes activar o desactivar con un clic qué secciones incluir en el reporte:
  1. **Contexto Multi-Plantilla (Móvil vs. Desktop)**: estructura DOM, contenedores raíz, hojas de estilo y modales activos en cada versión.
  2. **Elemento Inspeccionado + CSS**: comparativa del elemento seleccionado entre la plantilla móvil y la de escritorio.
  3. **Consola / Errores**: errores y advertencias recientes de JavaScript y red.
  4. **Peticiones HTTP**: últimas llamadas a endpoints y respuestas con error (`4xx` / `5xx`).
  5. **Auditoría Visual**: problemas de diseño detectados por pantalla con selectores y dimensiones.
  6. **Flujo de Pasos (Reproducción)**: secuencia cronológica exacta de lo que hiciste antes del fallo.
  7. **Storage / Cookies / JWT**: estado de sesión relevante.

---

## Instalación

Solo necesitas **Python 3.9 o superior** y `openssl` (incluido por defecto en macOS y en la mayoría de distribuciones Linux).

### macOS y Linux

1. Clona este repositorio o descarga el código fuente:
   ```bash
   git clone https://github.com/MiguelLazaro42/DevTool-MultiDisplay.git
   cd DevTool-MultiDisplay
   ```
2. Ejecuta el instalador:
   ```bash
   bash install.sh
   ```
3. Para iniciarlo en ocasiones posteriores:
   ```bash
   ./start.sh
   ```

### Windows

1. Haz doble clic en **`install.bat`** para crear el entorno virtual e instalar las dependencias.
2. Para abrir el visor posteriormente, haz doble clic en **`start.bat`** (o usa `bash install.sh` y `./start.sh` desde Git Bash).

### Instalación manual para desarrollo

```bash
python3 -m venv .venv
source .venv/bin/activate        # En Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py --debug
```

---

## Opciones de línea de comandos

```bash
python app.py [opciones]
```

- `--port 5050`: puerto en el que escuchará el servidor local (si está ocupado, buscará automáticamente el siguiente puerto libre).
- `--no-browser`: inicia el servidor sin abrir automáticamente una pestaña en el navegador.
- `--debug`: activa la recarga automática de Flask al modificar archivos del código.
- `--cert /ruta/al/certificado.p12`: carga un certificado de cliente `.p12` / `.pfx` al arrancar.
- `--cert-pass "contraseña"`: contraseña del certificado `.p12` / `.pfx` (también configurable mediante las variables de entorno `RV_CERT_P12` y `RV_CERT_PASS`).

También puedes abrir el visor precargando una URL y dispositivos específicos mediante parámetros en la dirección:
```text
http://127.0.0.1:5050/?url=https://ejemplo.com&devices=iphone-se,iphone-15-pro-max,ipad-air
```

---

## Estructura del proyecto

```text
install.sh / install.bat     Instaladores automáticos (macOS, Linux y Windows)
start.sh / start.bat         Scripts de inicio rápido
app.py                       Servidor Flask, proxy mTLS (.p12), reescritura de assets y APIs de telemetría
devices.py                   Catálogo de dispositivos (dimensiones, DPR, User-Agent y categoría)
templates/index.html         Interfaz principal, barra de herramientas, panel DevTools y modales
templates/frame_error.html   Página de error mostrada dentro de un visor cuando falla la conexión
static/css/styles.css        Estilos del lienzo, marcos de dispositivos y tema oscuro del panel DevTools
static/js/app.js             Gestión del layout, zoom, paneles DevTools, capturas PNG y generador de reportes
static/js/frame-inject.js    Script inyectado en cada visor (sincronización, inspector, auditoría, flujo y proxy)
static/js/i18n.js            Textos de la interfaz en español e inglés
```

---

## Seguridad

Esta herramienta está diseñada exclusivamente para ejecutarse **en tu equipo local (`127.0.0.1`)** durante el desarrollo:

- No debe desplegarse en un servidor público, ya que `/proxy` realiza peticiones HTTP/HTTPS desde la máquina donde se ejecuta y utiliza el certificado `.p12` configurado localmente.
- Los certificados `.p12` convertidos se guardan únicamente en la carpeta local `.certs/` con permisos restringidos al usuario (`0600`) y están excluidos del control de versiones en `.gitignore`.
- Las cookies de las sesiones de prueba se mantienen en memoria y se eliminan al pulsar **Refresh** o al detener el servidor.
