// SAWebUI — Framework & Guía Interactiva para Modders en GTA San Andreas.
//
// API Integrada (CefRenderBridge.h):
//   window.SAWeb.emit(nombre, datos)  -> Envia evento saweb:main:<nombre> al script
//   window.SAWeb.receive(nombre, ...)  -> Recibe llamadas del nativo (SAWeb.ui.send)
//   window.SAWeb.tick()                -> Llamado por el runtime en cada frame (~60fps)
//   window.SAWeb.hasBridge             -> Confirma presencia del shim C++

const INBOUND = ["fromScript", "echo", "tick", "set", "poke", "input", "ready", "hello", "demo_action"];
const EMIT_THROTTLE_MS = 100;

// Estado del puente y variables globales
const bridgeReady = !!(window.SAWeb && window.SAWeb.hasBridge);

const rowsBox = document.getElementById("rows");
const stripLeft = document.getElementById("strip-left");
const stripRight = document.getElementById("strip-right");
const tabsBox = document.getElementById("tabs");
const tutBox = document.getElementById("tutorial-box");
const tutTitle = document.getElementById("tut-title");
const tutContent = document.getElementById("tut-content");
const tutClose = document.getElementById("tut-close");
const tutAction = document.getElementById("tut-action");
const navPrev = document.getElementById("nav-prev");
const navNext = document.getElementById("nav-next");

let currentTab = "demo";
let selectedIndex = 0;
let lastEmitAt = 0;
let lastEvent = "—";
let lastEventIncoming = false;
let lastEventAt = 0;
let focused = false;
// La pagina NO puede saber si el teclado le llega. En la ASI el teclado cuelga
// del mismo modo que el cursor (SAWEB_SET_CURSOR), y ese comando no se puede
// llamar desde aca: solo el script lo maneja. Por eso arranca en false, que es
// el default de la ASI, y el script le manda el estado con el evento "input".
let inputOn = false;
let currentTutorialData = null;

// Log de eventos para la pestaña Logger
const eventLogs = [];

// ---------------------------------------------------------------- TAB DATA --

const TABS = {
  demo: {
    label: "Demo",
    rows: [
      {
        id: "ready",
        label: "emit · ready",
        kind: "fixed",
        value: 1,
        text: () => (bridgeReady ? "ENVIADO" : "SIN PUENTE"),
        tutorial: {
          title: "Evento 'ready'",
          html: `<p>El evento <b>ready</b> se emite cuando la página termina de cargar su DOM y está lista para interactuar con el script de CLEO JS.</p>
                 <p><span class="badge badge-info">HTML</span> <code>window.SAWeb.emit("ready", { ui: "main" });</code></p>
                 <p><span class="badge badge-success">CLEO</span> <code>on("main", "ready", (data) => { ... });</code></p>
                 <p>Es una buena práctica enviar este evento al inicializar tu UI para que el script pueda enviarle datos de bienvenida mediante <code>SAWeb.ui.send()</code>.</p>`,
          actionLabel: "Re-emitir 'ready'",
          action: () => emit("ready", { ui: "main", timestamp: Date.now() })
        }
      },
      {
        id: "slider",
        label: "emit · slider",
        kind: "range",
        value: 50,
        text: (r) => String(r.value),
        tutorial: {
          title: "Controles Range (Sliders)",
          html: `<p>Los controles deslizantes emiten eventos continuos. Para evitar saturar la cola de eventos nativos (capacidad 256), se aplica un <b>throttle de 100ms</b>.</p>
                 <pre><code>// HTML (Event listener con Throttle)
input.addEventListener("input", () => {
  if (performance.now() - lastEmit >= 100) {
    window.SAWeb.emit("slider", { value: input.value });
  }
});</code></pre>
                 <p>Al soltar el control (<code>change</code>), se envía siempre el valor final exacto.</p>`,
          actionLabel: "Probar Slider 75",
          action: () => {
            const row = getRowState("slider");
            if (row) {
              row.value = 75;
              setBar(row, 0.75);
              if (row.input) row.input.value = 75;
              emit("slider", { value: 75 });
            }
          }
        }
      },
      {
        id: "text",
        label: "emit · text",
        kind: "text",
        value: "",
        text: (r) => (r.value ? r.value.length + " car." : "—"),
        tutorial: {
          title: "Campos de Texto e Inputs",
          html: `<p>Los inputs de texto requieren que el usuario haga click previo en la UI para tomar el foco del teclado (vía WndProc hook).</p>
                 <p><span class="badge badge-warn">Regla de Oro</span> Todo <code>&lt;input&gt;</code> dentro de un contenedor Flexbox <b>DEBE</b> tener <code>min-width: 0</code> en CSS o se saldrá de la caja.</p>
                 <pre><code>.row input[type="text"] {
  flex: 1 1 auto;
  min-width: 0; /* IMPRESCINDIBLE */
}</code></pre>`,
          actionLabel: "Enviar Texto Demo",
          action: () => {
            const row = getRowState("text");
            if (row) {
              row.value = "Grove Street";
              if (row.input) row.input.value = "Grove Street";
              emit("text", { value: "Grove Street" });
            }
          }
        }
      },
      {
        id: "tick",
        label: "tick",
        kind: "meter",
        fps: 0,
        text: (r) => Math.round(r.fps) + " fps",
        tutorial: {
          title: "Bucle Frame `tick()`",
          html: `<p>El runtime llama automáticamente a <code>window.SAWeb.tick()</code> en cada frame (~60fps) si la función está definida.</p>
                 <pre><code>window.SAWeb.tick = () => {
  // Código de actualización por frame o 1 Hz
  updateUI();
};</code></pre>
                 <p><span class="badge badge-danger">Anti-patrón</span> <b>NO</b> uses <code>setInterval()</code> para refrescos de interfaz. Usa <code>tick()</code>.</p>`,
          actionLabel: "Simular Tick Test",
          action: () => emit("poke", { from: "tick_test" })
        }
      }
    ]
  },
  cleo: {
    label: "CLEO",
    rows: [
      {
        id: "cleo_reg",
        label: "1. Registrar UI",
        kind: "fixed",
        value: 1,
        text: () => "register()",
        tutorial: {
          title: "SAWeb.ui.register(id, url)",
          html: `<p>Registra un identificador de interfaz asociado a una ruta relativa dentro de <code>modloader\\SAWebUI\\web</code>.</p>
                 <pre><code>import SAWeb from "../modloader/SAWebUI/cleo/SAWebUI/SAWeb.js";

// Registrar UI con ID 'panel'
SAWeb.ui.register("panel", "index.html");</code></pre>
                 <p>También puedes apuntar a cualquier archivo en el disco pasando la ruta absoluta o relativa completa.</p>`,
          actionLabel: "Copiar Ejemplo CLEO",
          action: () => alert("Código CLEO listo para usar en tu script JS.")
        }
      },
      {
        id: "cleo_open",
        label: "2. Abrir / Cerrar",
        kind: "fixed",
        value: 1,
        text: () => "open/toggle",
        tutorial: {
          title: "Control de Estado de la UI",
          html: `<p>Abre, cierra o conmuta una interfaz previamente registrada:</p>
                 <pre><code>SAWeb.ui.open("panel");    // Abrir UI
SAWeb.ui.close("panel");   // Cerrar UI
SAWeb.ui.toggle("panel");  // Retorna true si quedó abierta
SAWeb.ui.isOpen("panel");  // Retorna boolean</code></pre>
                 <p>Si llamas a <code>open()</code> en un ID no registrado, se registra automáticamente usando <code>index.html</code>.</p>`,
          actionLabel: "Test Toggle Event",
          action: () => emit("echo", { action: "toggle_test" })
        }
      },
      {
        id: "cleo_events",
        label: "3. Eventos CLEO",
        kind: "fixed",
        value: 1,
        text: () => "send() / on()",
        tutorial: {
          title: "Envío y Recepción de Eventos",
          html: `<p>Enviar datos al HTML:</p>
                 <pre><code>SAWeb.ui.send("panel", "refresh", { dinero: 5000 });</code></pre>
                 <p>Escuchar eventos provenientes del HTML:</p>
                 <pre><code>import { on } from "../modloader/SAWebUI/cleo/SAWebUI/SAWeb.js";

const off = on("panel", "buy_weapon", (data) => {
  log("Compró arma ID: " + data.id);
});
// off() para cancelar la suscripción</code></pre>`,
          actionLabel: "Probar Envío Evento",
          action: () => emit("fromScript", { status: "test_ok", msg: "Hola desde CLEO" })
        }
      },
      {
        id: "cleo_cursor",
        label: "4. Cursor Mouse",
        kind: "fixed",
        value: 1,
        text: () => "setCursor()",
        tutorial: {
          title: "Modos del Cursor en Pantalla",
          html: `<p>Por defecto el cursor está oculto (<b>HIDDEN</b>) para permitir menus manejados por teclado. Si tu UI requiere puntero de ratón, actívalo desde CLEO:</p>
                 <pre><code>SAWeb.setCursor(SAWeb.CursorMode.VISIBLE); // 1: Forzar visible
SAWeb.setCursor(SAWeb.CursorMode.HIDDEN);  // 0: Forzar oculto
SAWeb.setCursor(SAWeb.CursorMode.AUTO);    // -1: Visible si hay UI abierta</code></pre>
                 <p><span class="badge badge-warn">Nota</span> El cursor <b>NO</b> se puede modificar desde el HTML por seguridad; se solicita desde el script de CLEO.</p>`,
          actionLabel: "Info Cursor",
          action: () => emit("echo", { info: "CursorMode" })
        }
      }
    ]
  },
  html: {
    label: "HTML",
    rows: [
      {
        id: "html_bridge",
        label: "1. Shim window.SAWeb",
        kind: "fixed",
        value: 1,
        text: () => "hasBridge",
        tutorial: {
          title: "Objeto Nativo window.SAWeb",
          html: `<p>El runtime inyecta <code>window.SAWeb</code> de forma sincrónica antes de ejecutar los scripts del HTML.</p>
                 <pre><code>if (window.SAWeb && window.SAWeb.hasBridge) {
  console.log("Puente C++ activo");
}</code></pre>
                 <p><span class="badge badge-danger">Crucial</span> <b>NUNCA</b> crees stubs u objetos <code>window.SAWeb = {}</code> en el HTML, ya que anularán el puente C++.</p>`,
          actionLabel: "Verificar Puente",
          action: () => alert("Bridge State: " + (bridgeReady ? "CONECTADO OK" : "DESCONECTADO"))
        }
      },
      {
        id: "html_emit",
        label: "2. window.SAWeb.emit",
        kind: "fixed",
        value: 1,
        text: () => "emit(name, data)",
        tutorial: {
          title: "Enviar Eventos al Nativo",
          html: `<p>Manda información desde la página web hacia el script de CLEO/C++:</p>
                 <pre><code>window.SAWeb.emit("comprar", { item: "AK-47", precio: 2500 });</code></pre>
                 <p>El objeto <code>data</code> se serializa como JSON antes de cruzar la capa IPC.</p>`,
          actionLabel: "Emitir Evento Test",
          action: () => emit("poke", { test: "emit_demo", time: new Date().toLocaleTimeString() })
        }
      },
      {
        id: "html_on",
        label: "3. window.SAWeb.on",
        kind: "fixed",
        value: 1,
        text: () => "on(name, fn)",
        tutorial: {
          title: "Recibir Eventos de CLEO",
          html: `<p>Suscríbete a eventos enviados desde CLEO con <code>SAWeb.ui.send()</code>:</p>
                 <pre><code>const off = window.SAWeb.on("refresh", (data) => {
  document.getElementById("saldo").textContent = data.dinero;
});
// Para cancelar: off();</code></pre>`,
          actionLabel: "Simular Inbound",
          action: () => {
            pushEvent("fromScript { dinero: 7500 }", true);
          }
        }
      }
    ]
  },
  design: {
    label: "Diseño",
    rows: [
      {
        id: "des_bg",
        label: "1. Fondo Transparente",
        kind: "fixed",
        value: 1,
        text: () => "transparent",
        tutorial: {
          title: "Integración Visual con el Juego",
          html: `<p>Para que la UI no tape el juego con un fondo sólido, establece <code>background: transparent</code> en CSS:</p>
                 <pre><code>html, body {
  background: transparent;
  margin: 0;
  height: 100%;
  overflow: hidden;
}

.box {
  background: rgba(8, 8, 8, 0.86); /* Panel traslúcido */
}</code></pre>
                 <p>El runtime procesa el canal Alfa nativo de Direct3D9 (<code>rwRASTERFORMAT8888</code>).</p>`,
          actionLabel: "Verificar Estilo",
          action: () => alert("Estilo de fondo: Transparente con paneles traslúcidos OK.")
        }
      },
      {
        id: "des_font",
        label: "2. Fuentes & Tipografía",
        kind: "fixed",
        value: 1,
        text: () => "Diploma / Gothic",
        tutorial: {
          title: "Tipografía Vanilla GTA San Andreas",
          html: `<p>Para lograr la estética original del menú Stats de GTA SA, utiliza las fuentes oficiales incluidas:</p>
                 <pre><code>@font-face {
  font-family: "SAWeb Diploma";
  src: url("assets/webfonts_Diploma-Regular/Diploma-Regular.ttf.woff") format("woff");
}

#title {
  font-family: "SAWeb Diploma", serif;
  color: #ece5d3;
}</code></pre>`,
          actionLabel: "Ver Tipografía",
          action: () => alert("Fuente actual: SAWeb Diploma / Gothic")
        }
      },
      {
        id: "des_res",
        label: "3. Escalado Responsivo",
        kind: "fixed",
        value: 1,
        text: () => "vw / vh Units",
        tutorial: {
          title: "Diseño Basado en Viewport (vw / vh)",
          html: `<p>Como el render de CEF se ajusta dinámicamente a la resolución del juego, usa unidades de viewport para que las cajas y textos mantengan sus proporciones en 720p, 1080p, 4K, etc.</p>
                 <pre><code>:root {
  --margin-x: 3.75vw;
  --panel-w: 22vw;
  --row-h: 3.1vh;
}</code></pre>`,
          actionLabel: "Info Escalado",
          action: () => alert("Resolución actual del viewport CEF: " + window.innerWidth + "x" + window.innerHeight)
        }
      }
    ]
  },
  rules: {
    label: "Reglas",
    rows: [
      {
        id: "rule_queue",
        label: "1. Cola de 256 Eventos",
        kind: "fixed",
        value: 1,
        text: () => "Max 256 IPC",
        tutorial: {
          title: "Límite de la Cola de Eventos IPC",
          html: `<p>La cola de mensajes entre CEF y el proceso principal tiene un límite de <b>256 eventos</b>.</p>
                 <p><span class="badge badge-danger">Importante</span> No emitas eventos en cada evento <code>mousemove</code> o en loops rápidos. Aplica siempre <i>Throttle</i> o <i>Debounce</i>.</p>`,
          actionLabel: "Test Throttle Safe",
          action: () => emit("poke", { safe: true })
        }
      },
      {
        id: "rule_focus",
        label: "2. Foco WndProc",
        kind: "fixed",
        value: 1,
        text: () => "mousedown Focus",
        tutorial: {
          title: "Enrutamiento de Teclado",
          html: `<p>El teclado se enruta a la página web solo cuando esta toma foco mediante un click (evento <code>mousedown</code>).</p>
                 <pre><code>document.addEventListener("mousedown", () => {
  focused = true;
});</code></pre>
                 <p>Mientras la UI tiene el foco, las teclas no mueven al personaje en GTA SA.</p>`,
          actionLabel: "Probar Foco",
          action: () => {
            focused = true;
            paintStripLeft();
          }
        }
      },
      {
        id: "rule_flex",
        label: "3. min-width: 0 Flex",
        kind: "fixed",
        value: 1,
        text: () => "min-width: 0",
        tutorial: {
          title: "Regla Flexbox para Inputs",
          html: `<p>Cualquier elemento <code>&lt;input&gt;</code> ubicado dentro de un contenedor con <code>display: flex</code> debe incluir <code>min-width: 0</code> en CSS.</p>
                 <p>Sin esta regla, el navegador asigna un ancho intrínseco predeterminado de ~20 caracteres que hace desbordar la caja.</p>`,
          actionLabel: "Info Flexbox",
          action: () => alert("Regla aplicada en style.css a todos los inputs de texto.")
        }
      }
    ]
  },
  logger: {
    label: "Log",
    rows: [
      {
        id: "log_history",
        label: "Historial Eventos",
        kind: "fixed",
        value: 1,
        text: () => eventLogs.length + " evts",
        tutorial: {
          title: "Monitor de Eventos IPC en Tiempo Real",
          html: `<p>A continuación se lista el registro de los últimos eventos entrantes y salientes:</p>
                 <pre><code id="log-console">Cargando eventos...</code></pre>`,
          actionLabel: "Limpiar Log",
          action: () => {
            eventLogs.length = 0;
            updateLogConsole();
          }
        }
      }
    ]
  }
};

// State Map para renderizado
const stateMap = {};

for (const tabKey in TABS) {
  stateMap[tabKey] = TABS[tabKey].rows.map((row) => ({
    ...row,
    el: null,
    fill: null,
    input: null
  }));
}

// ---------------------------------------------------------------- HELPERS --

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function jsonable(v) {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return null;
  }
}

function fmt(v) {
  if (typeof v === "string") return '"' + (v.length > 16 ? v.slice(0, 16) + "…" : v) + '"';
  return JSON.stringify(v);
}

function setBar(row, ratio) {
  if (row.fill) {
    row.fill.style.width = (clamp01(ratio) * 100).toFixed(2) + "%";
  }
}

function valueOf(row) {
  return typeof row.value === "function" ? row.value(row) : row.value;
}

function getRowState(id) {
  for (const tabKey in stateMap) {
    const found = stateMap[tabKey].find((r) => r.id === id);
    if (found) return found;
  }
  return null;
}

function pushEvent(label, incoming) {
  lastEvent = label;
  lastEventIncoming = incoming;
  lastEventAt = performance.now();
  stripRight.textContent = lastEvent;
  stripRight.classList.toggle("incoming", lastEventIncoming);

  // Guardar en el log
  const timeStr = new Date().toLocaleTimeString("es-AR", { hour12: false });
  eventLogs.unshift(`[${timeStr}] ${incoming ? "IN  " : "OUT "} ${label}`);
  if (eventLogs.length > 25) eventLogs.pop();
  updateLogConsole();
}

function updateLogConsole() {
  const codeEl = document.getElementById("log-console");
  if (codeEl) {
    codeEl.textContent = eventLogs.length ? eventLogs.join("\n") : "(Sin eventos registrados)";
  }
}

function paintStripLeft() {
  if (!bridgeReady) {
    stripLeft.textContent = "SIN PUENTE";
    stripLeft.className = "warn";
    return;
  }
  if (!inputOn) {
    // Con el teclado apagado el juego se lo quedo. F12 lo prende.
    stripLeft.textContent = "F12";
    stripLeft.className = "warn";
    return;
  }
  if (!focused) {
    stripLeft.textContent = "HACE CLICK";
    stripLeft.className = "warn";
    return;
  }
  const currentRows = stateMap[currentTab];
  if (currentRows && currentRows[selectedIndex]) {
    const row = currentRows[selectedIndex];
    stripLeft.textContent = row.text ? row.text(row) : "—";
    stripLeft.className = "";
  } else {
    stripLeft.textContent = "—";
    stripLeft.className = "";
  }
}

function emit(name, data) {
  if (!bridgeReady) {
    pushEvent(name + " (sin puente)", false);
    return false;
  }
  const ok = window.SAWeb.emit(name, data) !== false;
  pushEvent(name + " " + fmt(jsonable(data)), !ok);
  return ok;
}

// ------------------------------------------------------------- TUTORIAL MODAL --

function showTutorial(row) {
  if (!row || !row.tutorial) return;
  currentTutorialData = row.tutorial;

  tutTitle.textContent = row.tutorial.title;
  tutContent.innerHTML = row.tutorial.html;

  if (row.tutorial.actionLabel && row.tutorial.action) {
    tutAction.style.display = "inline-block";
    tutAction.textContent = row.tutorial.actionLabel;
    tutAction.onclick = () => row.tutorial.action();
  } else {
    tutAction.style.display = "none";
  }

  tutBox.classList.remove("hidden");
  updateLogConsole();
}

function hideTutorial() {
  tutBox.classList.add("hidden");
  currentTutorialData = null;
}

tutClose.addEventListener("click", hideTutorial);

// ------------------------------------------------------------------- RENDER --

function buildRow(row) {
  const el = document.createElement("div");
  el.className = "row";
  el.setAttribute("role", "option");
  el.dataset.id = row.id;

  const label = document.createElement("span");
  label.className = "label";
  label.textContent = row.label;
  el.appendChild(label);

  if (row.kind === "text") {
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 40;
    input.value = row.value;
    input.placeholder = "Escribir...";
    let last = 0;
    input.addEventListener("input", () => {
      row.value = input.value;
      if (performance.now() - last >= EMIT_THROTTLE_MS) {
        last = performance.now();
        emit("text", { value: input.value });
      }
      paintStripLeft();
    });
    input.addEventListener("change", () => emit("text", { value: input.value }));
    el.appendChild(input);
    row.input = input;
  } else {
    const track = document.createElement("div");
    track.className = "track";

    const fill = document.createElement("div");
    fill.className = "fill";
    track.appendChild(fill);
    row.fill = fill;

    if (row.kind === "range") {
      const input = document.createElement("input");
      input.type = "range";
      input.min = "0";
      input.max = "100";
      input.value = row.value;
      input.addEventListener("input", () => {
        row.value = Number(input.value);
        setBar(row, row.value / 100);
        const now = performance.now();
        if (now - lastEmitAt >= EMIT_THROTTLE_MS) {
          lastEmitAt = now;
          emit("slider", { value: row.value });
        }
        paintStripLeft();
      });
      input.addEventListener("change", () => emit("slider", { value: Number(input.value) }));
      track.appendChild(input);
      row.input = input;
    }

    el.appendChild(track);
  }

  if (row.kind === "meter" || row.kind === "fixed") el.classList.add("readonly");

  el.addEventListener("click", () => {
    const rows = stateMap[currentTab];
    const idx = rows.indexOf(row);
    if (idx !== -1) {
      selectRow(idx);
      showTutorial(row);
    }
  });

  row.el = el;
  return el;
}

function renderTab(tabKey) {
  currentTab = tabKey;
  rowsBox.innerHTML = "";

  const rows = stateMap[tabKey];
  for (const row of rows) {
    rowsBox.appendChild(buildRow(row));
    if (row.kind === "range") setBar(row, row.value / 100);
    else if (row.kind === "fixed") setBar(row, Number(row.value));
  }

  // Actualizar botones de pestaña
  const tabBtns = tabsBox.querySelectorAll(".tab");
  tabBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabKey);
  });

  selectRow(0);
}

function selectRow(index) {
  const rows = stateMap[currentTab];
  if (!rows || rows.length === 0) return;

  selectedIndex = (index + rows.length) % rows.length;
  for (const [i, row] of rows.entries()) {
    if (row.el) {
      row.el.classList.toggle("selected", i === selectedIndex);
      row.el.setAttribute("aria-selected", i === selectedIndex ? "true" : "false");
    }
  }

  const row = rows[selectedIndex];
  paintStripLeft();

  if (row && row.kind === "text" && row.input) {
    row.input.focus();
  }
}

function stepRow(dir) {
  selectRow(selectedIndex + dir);
}

function switchTab(dir) {
  const tabKeys = Object.keys(TABS);
  const curIdx = tabKeys.indexOf(currentTab);
  const nextIdx = (curIdx + dir + tabKeys.length) % tabKeys.length;
  renderTab(tabKeys[nextIdx]);
}

// ----------------------------------------------------------- TECLADO & EVENTOS --

tabsBox.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (btn && btn.dataset.tab) {
    renderTab(btn.dataset.tab);
  }
});

navPrev.addEventListener("click", () => switchTab(-1));
navNext.addEventListener("click", () => switchTab(1));

document.addEventListener("keydown", (e) => {
  const typing = document.activeElement && document.activeElement.tagName === "INPUT" &&
    document.activeElement.type === "text";

  if (e.key === "Escape") {
    hideTutorial();
    return;
  }

  if (e.key === "ArrowDown") {
    e.preventDefault();
    stepRow(1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    stepRow(-1);
  } else if (e.key === "Enter") {
    e.preventDefault();
    const rows = stateMap[currentTab];
    if (rows && rows[selectedIndex]) {
      showTutorial(rows[selectedIndex]);
    }
  } else if (!typing && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    e.preventDefault();
    nudge(e.key === "ArrowRight" ? 1 : -1);
  } else if (!typing && (e.key.toLowerCase() === "q" || e.key.toLowerCase() === "e")) {
    e.preventDefault();
    switchTab(e.key.toLowerCase() === "e" ? 1 : -1);
  }
});

function nudge(dir) {
  const rows = stateMap[currentTab];
  if (!rows || !rows[selectedIndex]) return;
  const row = rows[selectedIndex];

  if (row.kind === "range") {
    const next = Math.max(0, Math.min(100, row.value + dir * 5));
    row.value = next;
    setBar(row, next / 100);
    if (row.input) row.input.value = next;
    paintStripLeft();
    emit("slider", { value: next });
  } else if (row.kind === "text" && row.input) {
    row.input.focus();
  } else {
    // Si no es un control, izquierda/derecha cambia de pestaña
    switchTab(dir);
  }
}

// Con el teclado apagado el click NO marca foco: mostrar "HACE CLICK" mientras
// el teclado sigue OFF seria mentira, porque el click no cambia nada del lado
// del input. El aviso de F12 tiene que seguir ahi.
document.addEventListener("mousedown", () => {
  if (!inputOn) {
    return;
  }
  focused = true;
  paintStripLeft();
});

// ------------------------------------------------------------- ENTRADA CLEO --

if (window.SAWeb) {
  for (const name of INBOUND) {
    window.SAWeb.on(name, (data) => {
      // El script avisa si el input de la UI quedo prendido o apagado (prende lo
      // mismo que el cursor, con F12). Es la unica fuente de verdad aca.
      if (name === "input" && data && typeof data.enabled === "boolean") {
        inputOn = data.enabled;
        // Al prender el teclado hay que volver a pedir foco con un click: el
        // click anterior pudo haber ocurrido con el teclado apagado.
        if (inputOn) {
          focused = false;
        }
        paintStripLeft();
      }
      pushEvent(name + " " + fmt(jsonable(data)), true);

      if (name === "set" && data && typeof data.row === "string") {
        const target = getRowState(data.row);
        if (target && target.kind === "range") {
          target.value = Number(data.value) || 0;
          setBar(target, target.value / 100);
          if (target.input) target.input.value = target.value;
          paintStripLeft();
        }
      }
    });
  }
}

// -------------------------------------------------------------------- FRAME --

let frames = 0;
let fpsAt = performance.now();

function tick() {
  frames++;

  if (lastEventAt && performance.now() - lastEventAt > 6000) {
    lastEventAt = 0;
    lastEvent = "—";
    stripRight.textContent = "—";
  }

  const now = performance.now();
  if (now - fpsAt >= 1000) {
    const tickRow = getRowState("tick");
    if (tickRow) {
      tickRow.fps = (frames * 1000) / (now - fpsAt);
      if (currentTab === "demo" && selectedIndex === 3) paintStripLeft();
    }
    frames = 0;
    fpsAt = now;
  }

  const tickRow = getRowState("tick");
  if (tickRow) {
    const phase = (now % 2000) / 2000;
    setBar(tickRow, phase < 0.5 ? phase * 2 : 2 - phase * 2);
  }
}

if (window.SAWeb) {
  window.SAWeb.tick = tick;
}

// --------------------------------------------------------------------- INIT --

renderTab("demo");
stripRight.textContent = "—";
paintStripLeft();

if (bridgeReady) {
  emit("ready", { ui: "main", mode: "guide_framework" });
}
