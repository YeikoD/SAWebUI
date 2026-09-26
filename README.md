# SAWebUI

**Web UI runtime for GTA San Andreas.** Renders HTML/CSS/JS inside the game using
CEF (Chromium Embedded Framework) in OSR mode, and exposes a public API so any mod can
drive UIs, events and state **without knowing anything about CEF, D3D9 or Win32**.

The UI is plain HTML: it is edited and reloaded, not compiled.

```text
HTML/CSS/JS  →  CEF OSR  →  OnPaint()  →  BGRA buffer  →  RwRaster/RwTexture  →  GTA (D3D9)
```

---

## Contents

| Section | What it covers |
|---|---|
| [What it is](#what-it-is) | Scope and pipelines |
| [Repo contents](#repo-contents) | What is in each folder |
| [Installation](#installation) | Where each file goes and the mandatory CLEO step |
| [Configuration](#configuration-sawebuiini) | `SAWebUI.ini` |
| [Quick start](#quick-start) | CLEO mod ↔ web page, minimal and working |
| [API reference](#api-reference) | 9 C exports, 7 CLEO commands, JS facade, `window.SAWeb` |
| [Events](#events) | Naming format and payloads |
| [Lifecycle](#ui-lifecycle) | States and transitions |
| [Input and cursor](#input-and-cursor) | Game/Web mode, focus, cursor modes |
| [Visual rules](#visual-rules) | How a UI looks good inside the game |
| [Multi-UI](#multi-ui) | Several pages at once |
| [Debugging](#debugging) | Logs, key lines, cache |
| [Known limits](#known-limits) | What gets truncated and what overflows |
| [Anti-patterns](#anti-patterns) | What not to do |
| [Scope](#scope-runtime-not-a-gameplay-framework) | What this project is NOT |

---

## What it is

`SAWebUI.SA.asi` is a **web UI runtime**, not a game framework. It does not know what `money`,
`inventory`, `weapon` or `mission` are, and it should not learn.

SAWeb takes care of:

- CEF OSR (create/destroy browser, load HTML, render)
- input and hit-testing
- cursor and keyboard focus
- JS ↔ native messaging
- the RenderWare / D3D9 bridge

Everything domain-specific (which events exist, what they mean, how they are routed) belongs to
the mod that uses it. The only boundary is:

```text
mod  ──►  SAWeb.ui.send()  /  window.SAWeb.receive()  ◄──  mod
```

### Input pipeline

```text
Windows → SAWeb WndProc → hit-test → coordinate mapping → CEF → DOM (<button>, <input>, …)
```

### Events, in both directions

```text
HTML  →  window.SAWeb.emit()  →  CefMessageRouter  →  ASI queue  →  SAWeb.cleo  →  TriggerEvent  →  mod
mod   →  SAWeb.ui.send()      →  queue / ExecuteJS   →  window.SAWeb.receive()  →  HTML
```

### Design decisions that explain the behaviour

- **D3D9 is not used directly** (`DrawPrimitiveUP`): it caused visual corruption and crashes. Every
  overlay goes through `CSprite2d::DrawTxRect` on a RenderWare texture.
- **Transparency comes from CSS, not C++**: the raster uses `rwRASTERFORMAT8888` and `DrawTxRect`
  honours per-pixel alpha even when the vertex color is opaque. `background: transparent` is enough.
- **The Plugin-SDK has no input event** for SA: subclassing the WndProc is the only way.
- **Every CEF call is posted to the UI thread** (`CefPostTask`); never from the game thread.
- **Closing a UI does not destroy the runtime**: the browser stays alive and hidden, ready to be
  reopened.

---

## Repo contents

This repo is **the mod already compiled and installed**, exactly as it lives in
`<GTA SA>\modloader\SAWebUI\`. The C++ project that produces it lives elsewhere (see
[Note about the source code](#note-about-the-source-code)).

```text
SAWebUI/
├─ SAWebUI.SA.asi            runtime (CEF OSR + render + input + API)      1.1 MB
├─ SAWebUICefHelper.exe      helper process (CEF renderer) + JS bridge     630 KB
├─ SAWebUICefCache/          CEF cache (regenerable)
├─ SAWebUI.ini               configuration (WebRoot, Index)
├─ SAWebUICef.log            runtime log
├─ web\                      the UI — editable without recompiling
│  ├─ index.html
│  ├─ style.css
│  ├─ app.js                 interactive guide for modders + demo
│  └─ assets\
└─ cleo\
   ├─ SAWebUI\
   │  ├─ SAWeb.js            JS facade for mods (API v1)
   │  ├─ sa-commands.json    declaration of the 7 commands for sa.json
   │  └─ sa-commands.txt     step by step for that installation
   └─ cleo_plugins\
      └─ SAWeb.cleo          CLEO plugin (7 commands + OnAfterScripts)
```

> **The two loaders do not behave the same.** The `.cleo` *is* loaded from
> `modloader\SAWebUI\cleo\cleo_plugins\`, but **ModLoader** loads it, not CLEO — it does not show up
> in the plugin list of `cleo_redux.log`, yet its commands do get registered. The `.js` files are
> **not** loaded from there: the CLEO Redux script loader only scans the root of `cleo\`. The facade is
> imported by **relative path** from scripts located in that root.

Uninstalling means deleting `modloader\SAWebUI\`.

---

## Requirements

- GTA San Andreas with an ASI Loader
- CLEO Redux v7 (for the plugin and the JS facade)
- ModLoader (so it loads the `.cleo` from `cleo_plugins\`)

---

## Installation

1. Copy the contents of this repo to `<GTA SA>\modloader\SAWebUI\`.
2. **Declare the 7 commands in CLEO** — this step is **mandatory**:

   Open `<GTA SA>\cleo\.config\sa.json` and copy the object with `"name": "saweb"` from
   `cleo\SAWebUI\sa-commands.json` into the `"extensions"` array, at the end.

   WATCH the commas: if `"saweb"` is the last element, the previous one keeps the comma and
   `"saweb"` does not; if there are elements after it, `"saweb"` keeps the comma.

   Without this, CLEO does not register the commands and `native()` throws
   `Command with the name SAWEB_… not found`. It is not decorative metadata.

   CLEO Redux only reads `cleo\.config\` from the **game root**: a `sa.json` inside
   `modloader\SAWebUI\cleo\.config\` was tried and the 7 commands stayed undeclared. That is why the
   mod ships the file to be copied by hand.

3. Verify on startup: `cleo_redux.log` must show `Registering command SAWEB_…` **seven** times and
   no `unknown command SAWEB`. A CLEO Redux update may overwrite `sa.json` and drop the section; if
   that happens, copy it again.

---

## Configuration (`SAWebUI.ini`)

Only two keys, read when the game starts. A missing INI is the normal first run; if something is
missing or wrong, the runtime uses the default and logs it in `SAWebUICef.log`.

```ini
[SAWeb]
WebRoot = modloader\SAWebUI\web
Index   = index.html
```

| Key | Accepted forms | Default |
|---|---|---|
| `WebRoot` | `modloader\SAWebUI\web` (relative to the game) · `\folder` (game root) · `D:\folder` (absolute) | `modloader\SAWebUI\web` |
| `Index` | Page inside `WebRoot`. Must be relative. | `index.html` |

Moving `web\` means **editing the INI**, not recompiling. And to point a UI at a specific place you
don't have to touch the config either:

```js
SAWeb.ui.register("panel", "C:/path/to/any/index.html");
```

---

## Quick start

### From a mod (CLEO JS)

The import is a **relative path**, not a package name, and the script doing the importing must be in
the **root of `cleo\`** (the script loader only scans there; scripts in subfolders do not run on their
own, another boot script loads them and then the `../` counts from the file doing the importing).

```js
import SAWeb, { on } from "../modloader/SAWebUI/cleo/SAWebUI/SAWeb.js";
import { KeyCode } from "../.config/enums";

(async () => {
  on("panel", "ready", () => {
    SAWeb.ui.send("panel", "refresh", { from: "cleo" });
  });

  on("panel", "weapon:buy", (data) => log("bought " + data.id));

  log("registered: " + SAWeb.ui.register("panel", "index.html"));
  await asyncWait(200);
  log("opened: " + SAWeb.ui.open("panel"));

  while (true) {
    await asyncWait(0);
    if (Pad.IsKeyJustPressed(KeyCode.J)) {
      log("toggle: " + (SAWeb.ui.toggle("panel") ? "OPEN" : "CLOSED"));
    }
  }
})().catch((e) => log("error: " + e));
```

- `open()` on an unregistered id registers it on its own with `index.html`.
- **Listeners only work in an async context** (inside an `async`, with `await asyncWait()`), never
  with blocking `wait()`.
- `on()` always returns an unsubscribe function, on both sides of the bridge. The second call returns
  `false`.

### From the page (HTML)

**Do not define `window.SAWeb` by hand.** The shim owns the namespace and installs itself
synchronously before any page script runs, so any stub is lost.

```html
<script>
  if (window.SAWeb && window.SAWeb.hasBridge) {
    // HTML → native
    document.getElementById("buy").addEventListener("click", () => {
      window.SAWeb.emit("weapon:buy", { id: 1, price: 500 });
    });

    // native → HTML
    const off = window.SAWeb.on("refresh", (data) => {
      document.getElementById("state").textContent = JSON.stringify(data);
    });

    // 1 Hz logic (repaint already runs at 60 fps on its own)
    window.SAWeb.tick = () => {
      document.getElementById("clock").textContent =
        new Date().toLocaleTimeString("en-US", { hour12: false });
    };

    window.SAWeb.emit("ready", { ui: "main" });
  }
</script>
```

`window.SAWeb` is injected by the renderer process (`saweb::RenderBridgeApp`, inside
`SAWebUICefHelper.exe`) via `CefMessageRouter` with `CefV8Context::Eval` on `OnContextCreated`.
There is no script to include.

> **The helper is part of the bridge**: if the renderer process does not receive its
> `CefRenderProcessHandler`, `window.SAWeb` is never injected and the page goes mute with no
> explanation.

---

## API reference

`SAWEB_API_VERSION = 1`, **frozen**. Names, signatures and semantics do not change without bumping
the version. The freeze is enforced by a test that fails if an export appears, a signature changes,
the plugin stops resolving one of the ones the ASI exports, or a new command gets registered.

The internal configuration (`SAWebUI.ini`) is **not** part of the API.

### 9 C exports (`SAWebApi.h`)

```c
unsigned int version = SAWeb_GetApiVersion();     // 1
SAWeb_RegisterUi("panel", "index.html");
SAWeb_OpenUi("panel");
int isOpen = SAWeb_IsUiOpen("panel");
SAWeb_CloseUi("panel");
SAWeb_ToggleUi("panel");                          // 1 = ended up open
SAWeb_SendEvent("panel", "refresh", "{\"a\":1}"); // dataJson: JSON or string
SAWeb_SetCursorVisible(SAWEB_CURSOR_AUTO);        // -1 auto, 0 hidden, 1 visible
```

`SAWeb_PollEvent` is **internal**: `SAWeb.cleo` uses it to drain the event queue and it is not part
of the API for mods.

Dynamic resolution (what the CLEO plugin does):

```cpp
HMODULE mod = GetModuleHandleA("SAWebUI.SA.asi");
auto open = reinterpret_cast<int(*)(const char*)>(GetProcAddress(mod, "SAWeb_OpenUi"));
```

The plugin checks `SAWeb_GetApiVersion() == 1`; if it does not match, it registers no command.

### 7 CLEO commands (`native(...)`)

| Command | Inputs | Output | Description |
|---|---|---|---|
| `SAWEB_REGISTER_UI` | `uiId`, `url` | `result` | Registers a UI |
| `SAWEB_OPEN_UI` | `uiId` | `result` | Opens the UI (registers it if missing) |
| `SAWEB_CLOSE_UI` | `uiId` | `result` | Closes the UI (does not destroy it) |
| `SAWEB_TOGGLE_UI` | `uiId` | `result` | Toggles; `1` = ended up open |
| `SAWEB_IS_UI_OPEN` | `uiId` | `result` | `1` if open |
| `SAWEB_SEND_EVENT` | `uiId`, `eventName`, `dataJson` | `result` | Event towards the HTML |
| `SAWEB_SET_CURSOR` | `mode` (`-1`/`0`/`1`) | `result` | Cursor mode |

`result`: `1` = success, `0` = failure. The opcode ids are `E700`–`E706`.

### JS facade (`cleo\SAWebUI\SAWeb.js`)

```js
SAWeb.version;                       // 1
SAWeb.ui.register(uiId, url = "");
SAWeb.ui.open(uiId);
SAWeb.ui.close(uiId);
SAWeb.ui.isOpen(uiId);               // boolean
SAWeb.ui.toggle(uiId);               // boolean → true if it ended up open
SAWeb.ui.send(uiId, eventName, data = null);
SAWeb.on(uiId, eventName, callback);
SAWeb.onAny(uiId, callback);
SAWeb.setCursor(mode);
SAWeb.CursorMode;                    // { AUTO: -1, HIDDEN: 0, VISIBLE: 1 }
```

`onAny` receives exactly the same events as `on()`, but with the **bare name**
(`"slider"`, `"weapon:buy"`) instead of the full name:

```js
const off = SAWeb.onAny("main", (event, data) => log(event + " -> " + JSON.stringify(data)));
// "slider" -> { value: 73 }
```

The `on()` callback receives the `data` already parsed (if the payload was JSON) and as its second
argument the raw value. The facade accepts both payload shapes that appear across CLEO Redux builds
(direct payload and event object) so you do not have to guess.

### Inside the HTML (`window.SAWeb`)

| Member | Description |
|---|---|
| `emit(name, data?)` | Sends an event to native. Returns `true` if the router received the message |
| `on(name, fn)` | Subscribes a listener. Returns the unsubscribe function |
| `receive(name, data)` | Internal dispatch (called by `SAWeb.ui.send`). Returns how many listeners ran |
| `tick()` | **Called by the ASI once per second** (only if the page defines it) |
| `hasBridge` | `true` if the shim injected correctly |

---

## Events

```text
saweb:<uiId>:<eventName>
```

- `<eventName>` **cannot contain `:`** (it is the separator). Same for `uiId`.
- The `data` is serialized JSON. On the CEF side it arrives as a `CefValue`; on the CLEO side it
  arrives parsed if it is valid JSON, or as a string if it was not.

Example: the HTML emits `window.SAWeb.emit("button", { value: 42 })` on the `main` UI → the mod
listens with `on("main", "button", cb)`.

The `onAny()` aggregate is generated by the CLEO plugin **after** the event leaves the ASI queue, so
it does not load it. CLEO Redux does exact name matching and has no wildcards, so the aggregate
cannot come from the renderer: the CEF→ASI route and the public protocol stay untouched.

---

## UI lifecycle

```text
register ──► Closed ──open──► Opening ──(OnAfterCreated)──► Open
                ▲                                            │
                └────────────── close ◄── Closing ◄──────────┘

Open ──(renderer crash)──► Crashed ──open──► Opening (new browser)
```

- `open()` on an already open UI is a **no-op**.
- `close()` destroys nothing: the browser stays hidden and ready. The frame pump stays alive, it just
  stops producing frames.
- `open()` after a crash creates a new browser (the corpse is never reused).
- On open, the input state resets (previous position, accumulated wheel) and the webview takes focus.

---

## Input and cursor

With any UI open, input is routed depending on where the pointer is:

| Pointer | Destination | Keyboard |
|---|---|---|
| Inside an open UI | CEF → DOM | To the focused webview (the game does not see it) |
| Outside the UI | GTA | To the game |

With all UIs closed, everything goes to the game and the cursor is hidden.

| Gesture | Result |
|---|---|
| Moving the mouse | `mousemove` in the DOM if the pointer is over the UI |
| Left/right click | `click` / `contextmenu` |
| Drag | `mousedown` + `mousemove` with the button held → useful for `<input type="range">` |
| Wheel | `wheel` |
| Keyboard | Goes to the webview **if it has focus** (click the UI first) |

Keyboard focus is taken by clicking inside the UI and released by clicking outside or closing it.
With focus active, keys **do not** reach the game, so typing in an `<input>` does not move CJ.

### Cursor mode

**The default is `HIDDEN`, and the keyboard is tied to the same thing.** Opening a UI **does not**
take the pointer off screen **nor** keep the keyboard: you can keep playing with the panel open.
Clicking still works, because the mouse goes through the WndProc hook and not through the system
cursor.

```js
SAWeb.setCursor(SAWeb.CursorMode.VISIBLE);   //  1: cursor + keyboard for the UI
SAWeb.setCursor(SAWeb.CursorMode.HIDDEN);    //  0: cursor hidden and keyboard for the game (default)
SAWeb.setCursor(SAWeb.CursorMode.AUTO);      // -1: same, but only if some UI is open
```

They are **one** switch, not two: the cursor mode also decides whether the UI receives the keyboard.
It is deliberately not tied to mouse focus — focus is recomputed every time the pointer passes over
the UI, so if the gate were focus, the keyboard would turn itself on and off while moving the mouse.

**None of this is handled from the page**: `emit()` only reaches the event queue and the bridge
commands belong to CLEO. If a page needs to turn it on, it has to expose its own command and have
the script call it. (The example UI in this repo advertises an F12 shortcut to toggle the cursor.)

Check in the log: with the default it must report
`SAWeb cursor: flips=0 (openUis=1 mode=0 keys=0)`. With the previous default (`AUTO`) the cursor
always came out whenever a UI was open and, since the game hides it every frame, you had to fight it
frame by frame — visible in the log as high `flips`.

---

## Visual rules

- `background: transparent` on `html` and `body` to see the game behind. **This is CSS only: there
  is no need to touch the ASI.** A panel with `rgba(...)` comes out semi-transparent on its own.
- Compact panels with dark borders; avoid plain Material Design.
- `Tahoma` / `Arial` fonts, classic GTA look.
- Dark colors with accents (orange/amber/grey), black borders.
- The page stretches to the game resolution: use fluid layouts (`flex`, `grid`, `%`, `rem`), not
  fixed pixel widths.
- Avoid overlays that cover the whole center: the pointer outside the panel controls CJ again.
- Every `<input>` inside a `flex` container needs `min-width: 0`. Without it the input uses its
  intrinsic width (~20 characters) and overflows the box without warning.

```css
html, body { background: transparent; margin: 0; height: 100%; overflow: hidden; }
.panel {
  position: absolute; left: 20px; top: 20px; width: 660px; padding: 14px 18px;
  color: #f4ead5; background: rgba(10, 14, 20, 0.92); border: 2px solid #222;
  font-family: Tahoma, Arial, sans-serif;
}
```

> To test transparency without compiling anything: put `background: transparent` on any page. If you
> see the game, alpha works. That 30-second test saves you from reverse-engineering the mechanism
> from the C++.

---

## Multi-UI

Each page has its own id, browser, texture and rect:

```js
SAWeb.ui.register("inventory", "inventory/index.html");
SAWeb.ui.register("market", "market/index.html");
SAWeb.ui.open("inventory");
```

Each page lives in its own subfolder inside `modloader\SAWebUI\web\`. The path is relative to that
folder (defined by the INI's `WebRoot`). Today UIs are drawn full screen and overlap in registration
order: **the last one drawn wins the mouse hit-test**.

---

## Debugging

| Log | What to look at |
|---|---|
| `<GTA SA>\modloader\SAWebUI\SAWebUICef.log` | Runtime: CEF, render, input, cursor, bridge |
| `<GTA SA>\cleo_redux.log` | Scripts: load, command registration, events |

Check order when something does not work:

1. `SAWebUICef.log` — `SAWeb window hook installed`? `SAWeb input first event …`? `tick=alive`?
2. `cleo_redux.log` — did the script load? was the `ready` event registered?
3. On the page, `window.SAWeb.hasBridge` to rule out a shim that was not injected.
4. CEF cache if HTML changes do not show up.

### Key log lines

| Line | Meaning |
|---|---|
| `SAWeb bridge hello: ui=main {"v":2,"q":true,"e":true,"m":true}` | The shim announced itself. `q` = the router reached the renderer; `e` = installed synchronously; `m` = markers OK |
| `SAWeb bridge ready: ui=main gen=1` | The bridge became ready. `gen` counts **renderer contexts**, not UI opens |
| `SAWeb bridge down: ui=main reason=ui-closed gen=1` | Stopped being ready. Reasons: `ui-closed`, `browser-closed`, `renderer-crash`, `renderer-terminated` |
| `SAWeb window hook installed` | The WndProc got hooked; without this there is no input |
| `SAWeb input first event …` | Hit-test + mapping working |
| `tick=alive` / `tick=stopped` | The frame pump is alive or stopped (it should only stop if the browser dies) |
| `SAWeb emit: main:<event>` | An event arrived from the HTML |
| `SAWeb event queue overflow: … dropped=N` | Events were lost: the mod is not draining the queue fast enough |
| `SAWeb bridge: ignored request …` | Request from the renderer with an unknown prefix; indicates a bug in the shim |
| `SAWeb cursor hook: … showSlots=N` | If `N=0`, the game is not hiding the cursor via IAT (should not happen) |

### CEF cache

```powershell
Remove-Item -Recurse -Force '<GTA SA>\modloader\SAWebUI\SAWebUICefCache'
```

URL-based cache busting (in the runtime, `gCefUrl`): `gCefUrl = ToFileUrl(gCefWebPath) + L"?v=2";`

---

## Known limits

- `dataJson` of `SAWEB_SEND_EVENT` travels as a CLEO command string: **~255 useful characters**.
  `strncpy_s(..., _TRUNCATE)` **truncates silently** and cuts the JSON in half with no log and no
  error code.
- `uiId` and `eventName` must not contain `:`.
- The HTML→ASI event queue is capped at **256** and discards the oldest ones on overflow. Every
  discard is logged as
  `SAWeb event queue overflow: last=<event> size=256 dropped=N` (first loss, then every 16).
- The CEF view size is recomputed on resolution change and the texture is recreated.

---

## Anti-patterns

- **Defining `window.SAWeb` or stubs on the page**: the shim owns it and replaces them.
- **`window.SAWeb.tick = tick` without guarding it**: if the shim was not injected that throws
  `TypeError`, and if it runs before the init block it eats the whole render — the page goes mute
  without saying why. Put it inside an `if (window.SAWeb)`.
- **Setting an opaque background color on `html`/`body`**: it hides the game. It is not that the ASI
  lacks blending. An opaque grey looks fine in the editor and in the game is a grey screen hiding
  everything.
- Relying on `setInterval` for the main refresh: the runtime already refreshes at 60 fps; `tick` is
  for 1 Hz logic, not for repaint.
- Emitting events on every `mousemove` (floods the 256 queue and every discard gets logged).
- Assuming input works without clicking the UI first (the keyboard needs focus).
- Putting scripts in `cleo\` subfolders: they do not run on their own.
- Using D3D9 directly in the ASI: it causes visual corruption; overlays go through `CSprite2d`.

---

## Scope: runtime, not a gameplay framework

SAWeb is a web UI runtime for GTA SA. It does not know what `money`, `inventory`, `weapon`, `mission`
or `player` are, and it should not learn.

Mods keep seeing only `SAWeb.ui.*` / `SAWeb.on` / `SAWeb.onAny` / `window.SAWeb`: nothing about
CEF.

**Deliberately out of scope:** any domain API in SAWeb (money, inventory, weapons) and a v2 protocol
with large payloads — that lives in the mod, or the cheap fix when the UI that suffers from it shows
up is to log the truncation.

---

## Note about the source code

This repo contains **the compiled mod**, not the project that produces it. The C++ source (runtime,
CLEO bridge, helper, CEF SDK, tests) lives in `C:\Dev\SAWebUI` and builds to
`bin\GTA-SA\Release\SAWebUI.SA.asi`.

Bridge tests, without needing to open the game (they require Node, not GTA or CEF):

```powershell
cd C:\Dev\SAWebUI
node tests/run.js
```

They verify the shim embedded in the runtime and the `SAWeb.js` facade (contract, race, ownership,
hello, retries).

> The ASI post-build step runs `taskkill /IM gta_sa.exe`. To avoid killing the game in progress, add
> `/p:PostBuildEventUseInBuild=false` and copy the `.asi` by hand with the game closed.

---

## Credits

**Yeiko** · [github.com/YeikoD/SAWebUI](https://github.com/YeikoD/SAWebUI)
