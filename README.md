# SAWebUI

**Runtime de interfaces web para GTA San Andreas.** Renderiza HTML/CSS/JS dentro del juego usando
CEF (Chromium Embedded Framework) en modo OSR, y expone una API pública para que cualquier mod
controle UIs, eventos y estado **sin saber nada de CEF, D3D9 ni Win32**.

La UI es HTML normal: se edita y se recarga, no se compila.

```text
HTML/CSS/JS  →  CEF OSR  →  OnPaint()  →  buffer BGRA  →  RwRaster/RwTexture  →  GTA (D3D9)
```

---

## Índice

| Sección | Qué cubre |
|---|---|
| [Qué es](#qué-es) | Alcance y pipelines |
| [Contenido del repo](#contenido-del-repo) | Qué hay en cada carpeta |
| [Instalación](#instalación) | Dónde va cada archivo y el paso obligatorio de CLEO |
| [Configuración](#configuración-sawebuiini) | `SAWebUI.ini` |
| [Uso rápido](#uso-rápido) | Mod CLEO ↔ página web, mínimo y funcional |
| [Referencia de API](#referencia-de-api) | 9 exports C, 7 comandos CLEO, facade JS, `window.SAWeb` |
| [Eventos](#eventos) | Formato de nombres y payloads |
| [Ciclo de vida](#ciclo-de-vida-de-una-ui) | Estados y transiciones |
| [Input y cursor](#input-y-cursor) | Modo Game/Web, foco, modos de cursor |
| [Reglas visuales](#reglas-visuales) | Cómo se ve bien una UI dentro del juego |
| [Multi-UI](#multi-ui) | Varias páginas a la vez |
| [Depuración](#depuración) | Logs, líneas clave, cache |
| [Límites conocidos](#límites-conocidos) | Lo que trunca y lo que desborda |
| [Anti-patrones](#anti-patrones) | Lo que no hay que hacer |
| [Alcance](#alcance-runtime-no-framework-de-gameplay) | Qué NO es este proyecto |

---

## Qué es

`SAWebUI.SA.asi` es un **runtime de UI web**, no un framework de juego. No sabe qué es `money`,
`inventory`, `weapon` o `mission`, y no debe aprenderlo.

SAWeb se ocupa de:

- CEF OSR (crear/destruir browser, cargar HTML, renderizar)
- input y hit-test
- cursor y foco de teclado
- mensajería JS ↔ nativo
- puente a RenderWare / D3D9

Todo lo de dominio (qué eventos existen, qué significan, cómo se rutean) es del mod que lo usa.
La única frontera es:

```text
mod  ──►  SAWeb.ui.send()  /  window.SAWeb.receive()  ◄──  mod
```

### Pipeline de input

```text
Windows → WndProc de SAWeb → hit-test → mapeo de coords → CEF → DOM (<button>, <input>, …)
```

### Eventos, en ambos sentidos

```text
HTML  →  window.SAWeb.emit()  →  CefMessageRouter  →  cola de la ASI  →  SAWeb.cleo  →  TriggerEvent  →  mod
mod   →  SAWeb.ui.send()      →  cola / ExecuteJS   →  window.SAWeb.receive()  →  HTML
```

### Decisiones de diseño que explican el comportamiento

- **No se usa D3D9 directo** (`DrawPrimitiveUP`): produjo corrupción visual y crasheos. Todo overlay
  va por `CSprite2d::DrawTxRect` sobre una textura de RenderWare.
- **La transparencia es de CSS, no de C++**: el raster usa `rwRASTERFORMAT8888` y `DrawTxRect`
  honra el alpha por píxel aunque el vertex color sea opaco. `background: transparent` alcanza.
- **El Plugin-SDK no tiene evento de input** para SA: el subclass del WndProc es la única vía.
- **Toda llamada a CEF se postea al UI thread** (`CefPostTask`); nunca desde el hilo del juego.
- **Cerrar una UI no destruye el runtime**: el browser queda vivo y oculto, listo para reabrirse.

---

## Contenido del repo

Este repo es el **mod ya compilado e instalado**, tal cual vive en
`<GTA SA>\modloader\SAWebUI\`. El proyecto C++ que lo produce vive aparte (ver
[Nota sobre el código fuente](#nota-sobre-el-código-fuente)).

```text
SAWebUI/
├─ SAWebUI.SA.asi            runtime (CEF OSR + render + input + API)      1.1 MB
├─ SAWebUICefHelper.exe      proceso helper (renderer de CEF) + puente JS  630 KB
├─ SAWebUICefCache/          caché de CEF (regenerable)
├─ SAWebUI.ini               configuración (WebRoot, Index)
├─ SAWebUICef.log            log del runtime
├─ web\                      la UI — editable sin recompilar
│  ├─ index.html
│  ├─ style.css
│  ├─ app.js                 guía interactiva para modders + demo
│  └─ assets\
└─ cleo\
   ├─ SAWebUI\
   │  ├─ SAWeb.js            facade JS para los mods (API v1)
   │  ├─ sa-commands.json    declaración de los 7 comandos para sa.json
   │  └─ sa-commands.txt     paso a paso de esa instalación
   └─ cleo_plugins\
      └─ SAWeb.cleo          plugin CLEO (7 comandos + OnAfterScripts)
```

> **Los dos loaders no se comportan igual.** El `.cleo` sí se carga desde
> `modloader\SAWebUI\cleo\cleo_plugins\`, pero lo carga **ModLoader**, no CLEO — no aparece en la
> lista de plugins de `cleo_redux.log`, pero sus comandos sí se registran. Los `.js` **no** se cargan
> desde ahí: el script loader de CLEO Redux solo escanea la raíz de `cleo\`. El facade se importa por
> **ruta relativa** desde scripts ubicados en esa raíz.

Desinstalar es borrar `modloader\SAWebUI\`.

---

## Requisitos

- GTA San Andreas con ASI Loader
- CLEO Redux v7 (para el plugin y el facade JS)
- ModLoader (para que cargue el `.cleo` de `cleo_plugins\`)

---

## Instalación

1. Copiar el contenido de este repo a `<GTA SA>\modloader\SAWebUI\`.
2. **Declarar los 7 comandos en CLEO** — este paso es **obligatorio**:

   Abrir `<GTA SA>\cleo\.config\sa.json` y copiar el objeto con `"name": "saweb"` de
   `cleo\SAWebUI\sa-commands.json` dentro del array `"extensions"`, al final.

   CUIDADO con las comas: si `"saweb"` es el último elemento, el anterior lleva coma y `"saweb"` no;
   si hay más elementos después, `"saweb"` lleva coma.

   Sin esto CLEO no registra los comandos y `native()` tira
   `Command with the name SAWEB_… not found`. No es metadata decorativa.

   CLEO Redux solo lee `cleo\.config\` de la **raíz del juego**: se probó una `sa.json` dentro de
   `modloader\SAWebUI\cleo\.config\` y los 7 commands quedaron sin declarar. Por eso el mod trae el
   archivo para copiar a mano.

3. Verificar al arrancar: `cleo_redux.log` debe mostrar `Registering command SAWEB_…` **siete** veces
   y ningún `unknown command SAWEB`. Una actualización de CLEO Redux puede pisar `sa.json` y sacar
   la sección; si pasa, volver a copiarla.

---

## Configuración (`SAWebUI.ini`)

Solo dos claves, leídas al arrancar el juego. Un INI ausente es el primer arranque normal; si algo
falta o está mal, el runtime usa el default y lo anota en `SAWebUICef.log`.

```ini
[SAWeb]
WebRoot = modloader\SAWebUI\web
Index   = index.html
```

| Clave | Formas admitidas | Default |
|---|---|---|
| `WebRoot` | `modloader\SAWebUI\web` (relativa al juego) · `\carpeta` (raíz del juego) · `D:\carpeta` (absoluta) | `modloader\SAWebUI\web` |
| `Index` | Página dentro de `WebRoot`. Debe ser relativa. | `index.html` |

Mover `web\` es **editar el INI**, no recompilar. Y para apuntar una UI a un lugar puntual tampoco
hace falta tocar la config:

```js
SAWeb.ui.register("panel", "C:/ruta/a/cualquier/index.html");
```

---

## Uso rápido

### Desde un mod (CLEO JS)

El import es una **ruta relativa**, no un nombre de paquete, y el script que importa tiene que estar
en la **raíz de `cleo\`** (el script loader solo escanea ahí; scripts en subcarpetas no se ejecutan
solos, los carga otro boot script y entonces el `../` cuenta desde el archivo que los importa).

```js
import SAWeb, { on } from "../modloader/SAWebUI/cleo/SAWebUI/SAWeb.js";
import { KeyCode } from "../.config/enums";

(async () => {
  on("panel", "ready", () => {
    SAWeb.ui.send("panel", "refresh", { from: "cleo" });
  });

  on("panel", "weapon:buy", (data) => log("compró " + data.id));

  log("registro: " + SAWeb.ui.register("panel", "index.html"));
  await asyncWait(200);
  log("abro: " + SAWeb.ui.open("panel"));

  while (true) {
    await asyncWait(0);
    if (Pad.IsKeyJustPressed(KeyCode.J)) {
      log("toggle: " + (SAWeb.ui.toggle("panel") ? "ABIERTO" : "CERRADO"));
    }
  }
})().catch((e) => log("error: " + e));
```

- `open()` sobre un id no registrado lo registra solo con `index.html`.
- **Los listeners solo funcionan en contexto async** (dentro de una `async`, con `await asyncWait()`),
  nunca con `wait()` bloqueante.
- `on()` siempre devuelve una función de baja, en ambos lados del puente. La segunda llamada
  devuelve `false`.

### Desde la página (HTML)

**No definir `window.SAWeb` a mano.** El shim es el dueño del namespace y se instala
sincrónicamente antes de que corra cualquier script de la página, así que cualquier stub se pierde.

```html
<script>
  if (window.SAWeb && window.SAWeb.hasBridge) {
    // HTML → nativo
    document.getElementById("comprar").addEventListener("click", () => {
      window.SAWeb.emit("weapon:buy", { id: 1, precio: 500 });
    });

    // nativo → HTML
    const off = window.SAWeb.on("refresh", (data) => {
      document.getElementById("estado").textContent = JSON.stringify(data);
    });

    // lógica de 1 Hz (el repaint va a 60 fps por su cuenta)
    window.SAWeb.tick = () => {
      document.getElementById("reloj").textContent =
        new Date().toLocaleTimeString("es-AR", { hour12: false });
    };

    window.SAWeb.emit("ready", { ui: "main" });
  }
</script>
```

`window.SAWeb` lo inyecta el proceso renderer (`saweb::RenderBridgeApp`, dentro de
`SAWebUICefHelper.exe`) vía `CefMessageRouter` con `CefV8Context::Eval` en `OnContextCreated`.
No hay que incluir ningún script.

> **El helper es parte del puente**: si el proceso renderer no recibe su `CefRenderProcessHandler`,
> `window.SAWeb` nunca se inyecta y la página queda muda sin explicar por qué.

---

## Referencia de API

`SAWEB_API_VERSION = 1`, **congelada**. Los nombres, firmas y semántica no cambian sin subir la
versión. El freeze está mecanizado por un test que falla si aparece un export, cambia una firma, el
plugin deja de resolver alguno de los que exporta la ASI, o se registra un comando nuevo.

La configuración interna (`SAWebUI.ini`) **no** forma parte de la API.

### 9 exports C (`SAWebApi.h`)

```c
unsigned int version = SAWeb_GetApiVersion();     // 1
SAWeb_RegisterUi("panel", "index.html");
SAWeb_OpenUi("panel");
int isOpen = SAWeb_IsUiOpen("panel");
SAWeb_CloseUi("panel");
SAWeb_ToggleUi("panel");                          // 1 = quedó abierta
SAWeb_SendEvent("panel", "refresh", "{\"a\":1}"); // dataJson: JSON o string
SAWeb_SetCursorVisible(SAWEB_CURSOR_AUTO);        // -1 auto, 0 oculto, 1 visible
```

`SAWeb_PollEvent` es **interna**: la usa `SAWeb.cleo` para drenar la cola de eventos y no forma parte
de la API para mods.

Resolución dinámica (lo que hace el plugin CLEO):

```cpp
HMODULE mod = GetModuleHandleA("SAWebUI.SA.asi");
auto open = reinterpret_cast<int(*)(const char*)>(GetProcAddress(mod, "SAWeb_OpenUi"));
```

El plugin verifica `SAWeb_GetApiVersion() == 1`; si no coincide, no registra ningún comando.

### 7 comandos CLEO (`native(...)`)

| Comando | Inputs | Output | Descripción |
|---|---|---|---|
| `SAWEB_REGISTER_UI` | `uiId`, `url` | `result` | Registra una UI |
| `SAWEB_OPEN_UI` | `uiId` | `result` | Abre la UI (registra sola si no existe) |
| `SAWEB_CLOSE_UI` | `uiId` | `result` | Cierra la UI (no la destruye) |
| `SAWEB_TOGGLE_UI` | `uiId` | `result` | Alterna; `1` = quedó abierta |
| `SAWEB_IS_UI_OPEN` | `uiId` | `result` | `1` si está abierta |
| `SAWEB_SEND_EVENT` | `uiId`, `eventName`, `dataJson` | `result` | Evento hacia el HTML |
| `SAWEB_SET_CURSOR` | `mode` (`-1`/`0`/`1`) | `result` | Modo del cursor |

`result`: `1` = éxito, `0` = fallo. Los ids de opcodes son `E700`–`E706`.

### Facade JS (`cleo\SAWebUI\SAWeb.js`)

```js
SAWeb.version;                       // 1
SAWeb.ui.register(uiId, url = "");
SAWeb.ui.open(uiId);
SAWeb.ui.close(uiId);
SAWeb.ui.isOpen(uiId);               // boolean
SAWeb.ui.toggle(uiId);               // boolean → true si quedó abierta
SAWeb.ui.send(uiId, eventName, data = null);
SAWeb.on(uiId, eventName, callback);
SAWeb.onAny(uiId, callback);
SAWeb.setCursor(mode);
SAWeb.CursorMode;                    // { AUTO: -1, HIDDEN: 0, VISIBLE: 1 }
```

`onAny` recibe exactamente los mismos eventos que `on()`, pero con el **nombre pelado**
(`"slider"`, `"weapon:buy"`) en lugar del nombre completo:

```js
const off = SAWeb.onAny("main", (event, data) => log(event + " -> " + JSON.stringify(data)));
// "slider" -> { value: 73 }
```

El callback de `on()` recibe el `data` ya parseado (si el payload era JSON) y como segundo argumento
el valor crudo. El facade acepta las dos formas de payload que aparecen en distintas builds de CLEO
Redux (payload directo y objeto de evento) para no tener que adivinar.

### Dentro del HTML (`window.SAWeb`)

| Miembro | Descripción |
|---|---|
| `emit(name, data?)` | Manda un evento al nativo. Devuelve `true` si el router recibió el mensaje |
| `on(name, fn)` | Suscribe un listener. Devuelve la función de baja |
| `receive(name, data)` | Dispatch interno (lo llama `SAWeb.ui.send`). Devuelve cuántos listeners corrieron |
| `tick()` | **La llama la ASI 1 vez por segundo** (solo si la página la define) |
| `hasBridge` | `true` si el shim se inyectó correctamente |

---

## Eventos

```text
saweb:<uiId>:<eventName>
```

- `<eventName>` **no puede contener `:`** (es el separador). Lo mismo para `uiId`.
- El `data` es JSON serializado. Del lado CEF llega como `CefValue`; del lado CLEO llega parseado si
  es JSON válido, o como string si no lo era.

Ejemplo: el HTML emite `window.SAWeb.emit("button", { value: 42 })` en la UI `main` → el mod escucha
`on("main", "button", cb)`.

El agregado de `onAny()` lo genera el plugin CLEO **después** de que el evento sale de la cola de la
ASI, así que no la carga. CLEO Redux hace coincidencia exacta de nombres y no tiene wildcard, así que
el agregado no puede venir del renderer: la ruta CEF→ASI y el protocolo público quedan intactos.

---

## Ciclo de vida de una UI

```text
register ──► Closed ──open──► Opening ──(OnAfterCreated)──► Open
                ▲                                            │
                └────────────── close ◄── Closing ◄──────────┘

Open ──(crash del renderer)──► Crashed ──open──► Opening (browser nuevo)
```

- `open()` sobre una UI ya abierta es **no-op**.
- `close()` no destruye nada: el browser queda oculto y listo. El frame pump sigue vivo, solo deja de
  producir frames.
- `open()` después de un crash crea un browser nuevo (nunca se reutiliza el cadáver).
- Al abrir se resetea el estado de input (posición previa, rueda acumulada) y el webview toma foco.

---

## Input y cursor

Con alguna UI abierta, el input se enruta según dónde esté el puntero:

| Puntero | Destino | Teclado |
|---|---|---|
| Dentro de una UI abierta | CEF → DOM | Al webview con foco (el juego no lo ve) |
| Fuera de la UI | GTA | Al juego |

Con todas las UIs cerradas, todo va al juego y el cursor se oculta.

| Gesto | Resultado |
|---|---|
| Mover el mouse | `mousemove` en el DOM si el puntero está sobre la UI |
| Click izq./der. | `click` / `contextmenu` |
| Arrastrar | `mousedown` + `mousemove` con botón → sirve para `<input type="range">` |
| Rueda | `wheel` |
| Teclado | Va al webview **si tiene el foco** (hace click en la UI primero) |

El foco del teclado se toma al hacer click dentro de la UI y se suelta al clickear fuera o al cerrarla.
Con el foco activo las teclas **no** llegan al juego, para que escribir en un `<input>` no mueva a CJ.

### Modo de cursor

**El default es `HIDDEN`, y el teclado va atado a lo mismo.** Abrir una UI **no** saca el puntero de
la pantalla **ni** se queda con el teclado: se puede seguir jugando con el menú abierto. El click
igual funciona, porque el mouse va por el WndProc hook y no por el cursor del sistema.

```js
SAWeb.setCursor(SAWeb.CursorMode.VISIBLE);   //  1: cursor + teclado para la UI
SAWeb.setCursor(SAWeb.CursorMode.HIDDEN);    //  0: cursor oculto y teclado para el juego (default)
SAWeb.setCursor(SAWeb.CursorMode.AUTO);      // -1: lo mismo, pero solo si hay alguna UI abierta
```

Son **un** interruptor, no dos: el modo del cursor decide también si la UI recibe teclado. No está
atado al foco del mouse a propósito — el foco se recalcula cada vez que el puntero pasa por encima
de la UI, así que si el gate fuera el foco el teclado se prendería y apagaría solo mientras movemos
el mouse.

**Nada de esto se maneja desde la página**: `emit()` solo llega a la cola de eventos y los comandos
del puente son de CLEO. Si una página necesita prenderlo, tiene que exponer un comando propio y que
el script lo llame. (La UI de ejemplo de este repo anuncia un atajo F12 para alternar el cursor.)

Comprobación en el log: con el default tiene que dar
`SAWeb cursor: flips=0 (openUis=1 mode=0 keys=0)`. Con el default anterior (`AUTO`) el cursor salía
siempre que hubiera una UI abierta y, como el juego lo oculta cada frame, había que pelearlo frame a
frame — se ve en el log como `flips` altos.

---

## Reglas visuales

- `background: transparent` en `html` y `body` para ver el juego detrás. **Esto es solo CSS: no hace
  falta tocar la ASI.** Un panel con `rgba(...)` sale semitransparente solo.
- Paneles compactos con bordes oscuros; evitar Material Design puro.
- Tipografías `Tahoma` / `Arial` / estilo GTA clásico.
- Colores oscuros con acentos (naranja/ámbar/gris), bordes negros.
- La página se estira a la resolución del juego: usar layouts fluidos (`flex`, `grid`, `%`, `rem`),
  no anchos fijos en píxeles.
- Evitar overlays que tapen todo el centro: el puntero fuera del panel vuelve a controlar a CJ.
- Todo `<input>` dentro de un contenedor `flex` necesita `min-width: 0`. Sin eso el input usa su
  ancho intrínseco (~20 caracteres) y se sale de la caja sin avisar.

```css
html, body { background: transparent; margin: 0; height: 100%; overflow: hidden; }
.panel {
  position: absolute; left: 20px; top: 20px; width: 660px; padding: 14px 18px;
  color: #f4ead5; background: rgba(10, 14, 20, 0.92); border: 2px solid #222;
  font-family: Tahoma, Arial, sans-serif;
}
```

> Para comprobar la transparencia sin compilar nada: poné `background: transparent` en una página
> cualquiera. Si se ve el juego, el alpha anda. Esa prueba de 30 segundos evita derivar el mecanismo
> desde el C++.

---

## Multi-UI

Cada página tiene su id, su browser, su textura y su rect:

```js
SAWeb.ui.register("inventory", "inventory/index.html");
SAWeb.ui.register("market", "market/index.html");
SAWeb.ui.open("inventory");
```

Cada página vive en su subcarpeta dentro de `modloader\SAWebUI\web\`. La ruta es relativa a esa
carpeta (la define el `WebRoot` del INI). Hoy las UIs se dibujan a pantalla completa y se superponen
en orden de registro: **la última dibujada gana el hit-test del mouse**.

---

## Depuración

| Log | Qué mira |
|---|---|
| `<GTA SA>\modloader\SAWebUI\SAWebUICef.log` | Runtime: CEF, render, input, cursor, puente |
| `<GTA SA>\cleo_redux.log` | Scripts: carga, registro de comandos, eventos |

Orden de comprobación cuando algo no funciona:

1. `SAWebUICef.log` — ¿`SAWeb window hook installed`? ¿`SAWeb input first event …`? ¿`tick=alive`?
2. `cleo_redux.log` — ¿se cargó el script? ¿se registró el evento `ready`?
3. En la página, `window.SAWeb.hasBridge` para descartar un shim no inyectado.
4. Caché de CEF si los cambios de HTML no aparecen.

### Líneas clave del log

| Línea | Significado |
|---|---|
| `SAWeb bridge hello: ui=main {"v":2,"q":true,"e":true,"m":true}` | El shim se anunció. `q` = el router llegó al renderer; `e` = instalado sincrónicamente; `m` = marcadores OK |
| `SAWeb bridge ready: ui=main gen=1` | El puente pasó a listo. `gen` cuenta **contextos de renderer**, no aperturas de UI |
| `SAWeb bridge down: ui=main reason=ui-closed gen=1` | Dejó de estar listo. Motivos: `ui-closed`, `browser-closed`, `renderer-crash`, `renderer-terminated` |
| `SAWeb window hook installed` | El WndProc quedó enganchado; sin esto no hay input |
| `SAWeb input first event …` | Hit-test + mapeo funcionando |
| `tick=alive` / `tick=stopped` | El frame pump está vivo o se detuvo (solo debería detenerse si muere el browser) |
| `SAWeb emit: main:<event>` | Llegó un evento desde el HTML |
| `SAWeb event queue overflow: … dropped=N` | Se perdieron eventos: el mod no está drenando la cola a tiempo |
| `SAWeb bridge: ignored request …` | Request del renderer con prefijo desconocido; indica bug en el shim |
| `SAWeb cursor hook: … showSlots=N` | Si `N=0`, el juego no oculta el cursor por IAT (no debería pasar) |

### Cache de CEF

```powershell
Remove-Item -Recurse -Force '<GTA SA>\modloader\SAWebUI\SAWebUICefCache'
```

Cache-busting por URL (en el runtime, `gCefUrl`): `gCefUrl = ToFileUrl(gCefWebPath) + L"?v=2";`

---

## Límites conocidos

- `dataJson` de `SAWEB_SEND_EVENT` viaja como string de comando CLEO: **~255 caracteres útiles**.
  `strncpy_s(..., _TRUNCATE)` **trunca en silencio** y corta el JSON por la mitad sin log ni código de
  error.
- `uiId` y `eventName` no deben contener `:`.
- La cola de eventos del HTML a la ASI está acotada a **256** y descarta los más viejos si desborda.
  Cada descarte queda registrado como
  `SAWeb event queue overflow: last=<evento> size=256 dropped=N` (primera pérdida y luego cada 16).
- El tamaño de vista de CEF se recalcula al cambiar la resolución y la textura se recrea.

---

## Anti-patrones

- **Definir `window.SAWeb` o stubs en la página**: el shim es el dueño y los reemplaza.
- **`window.SAWeb.tick = tick` sin guardarlo**: si el shim no se inyectó eso tira `TypeError`, y si
  está antes del bloque de init se come el render entero — la página queda muda sin decir por qué.
  Va dentro de un `if (window.SAWeb)`.
- **Poner un color de fondo opaco en `html`/`body`**: tapa el juego. No es que falte blending en la
  ASI. Un gris opaco se ve bien en el editor y en el juego es una pantalla gris que esconde todo.
- Depender de `setInterval` para el refresh principal: el runtime ya refresca a 60 fps; `tick` es
  para lógica de 1 Hz, no para el repaint.
- Emitir eventos en cada `mousemove` (inunda la cola de 256 y cada descarte queda logueado).
- Asumir que el input funciona sin hacer click antes en la UI (el teclado necesita foco).
- Poner scripts en subcarpetas de `cleo\`: no se ejecutan solos.
- Usar D3D9 directo en la ASI: provoca corrupción visual; los overlays van por `CSprite2d`.

---

## Alcance: runtime, no framework de gameplay

SAWeb es un runtime de UI web para GTA SA. No sabe qué es `money`, `inventory`, `weapon`, `mission`
o `player`, y no debe aprenderlo.

Los mods siguen viendo únicamente `SAWeb.ui.*` / `SAWeb.on` / `SAWeb.onAny` / `window.SAWeb`:
nada de CEF.

**Descartado a propósito:** cualquier API de dominio en SAWeb (dinero, inventario, armas) y un
protocolo v2 con payloads grandes — eso vive en el mod, o el arreglo barato cuando aparezca la UI que
lo sufre es loguear el truncamiento.

---

## Nota sobre el código fuente

Este repo contiene **el mod compilado**, no el proyecto que lo produce. El source C++ (runtime,
bridge CLEO, helper, SDK de CEF, tests) vive en `C:\Dev\SAWebUI` y compila a
`bin\GTA-SA\Release\SAWebUI.SA.asi`.

Tests del bridge, sin necesidad de abrir el juego (requieren Node, no GTA ni CEF):

```powershell
cd C:\Dev\SAWebUI
node tests/run.js
```

Verifican el shim embebido en el runtime y el facade `SAWeb.js` (contrato, carrera, ownership,
hello, reintentos).

> El post-build de la ASI ejecuta `taskkill /IM gta_sa.exe`. Para no matar la partida en curso,
> agregar `/p:PostBuildEventUseInBuild=false` y copiar el `.asi` a mano con el juego cerrado.

---

## Autoría

**Yeiko** · [github.com/YeikoD/SAWebUI](https://github.com/YeikoD/SAWebUI)
