const API_VERSION = 1;

function call(command, args) {
  return native(command, ...args) === 1;
}

export function register(uiId, url = "") {
  return call("SAWEB_REGISTER_UI", [uiId, url]);
}

export function open(uiId) {
  return call("SAWEB_OPEN_UI", [uiId]);
}

export function close(uiId) {
  return call("SAWEB_CLOSE_UI", [uiId]);
}

export function toggle(uiId) {
  return call("SAWEB_TOGGLE_UI", [uiId]);
}

export function isOpen(uiId) {
  return native("SAWEB_IS_UI_OPEN", uiId) === 1;
}

export function send(uiId, eventName, data = null) {
  return call("SAWEB_SEND_EVENT", [uiId, eventName, JSON.stringify(data)]);
}

export const CursorMode = {
  AUTO: -1,
  HIDDEN: 0,
  VISIBLE: 1,
};

export function setCursor(mode = CursorMode.AUTO) {
  return native("SAWEB_SET_CURSOR", mode) === 1;
}

function parseData(data) {
  if (typeof data !== "string") {
    return data;
  }
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

// CLEO Redux documents the listener as receiving the payload directly, but
// some builds hand over an event object. Accept both instead of guessing.
function unpack(arg) {
  if (arg && typeof arg === "object" && "data" in arg) {
    return { name: arg.name, data: parseData(arg.data) };
  }
  return { name: undefined, data: parseData(arg) };
}

// Always returns an idempotent unsubscribe function, never undefined, so
// on() has the same contract on both sides of the bridge.
function subscribe(eventName, handler) {
  let live = true;
  const remove = addEventListener(eventName, (arg) => {
    if (live) {
      handler(arg);
    }
  });
  return () => {
    if (!live) {
      return false;
    }
    live = false;
    if (typeof remove === "function") {
      try {
        remove();
      } catch {
        // engine does not expose removal: the flag above already stops calls
      }
    }
    return true;
  };
}

export function on(uiId, eventName, callback) {
  return subscribe(`saweb:${uiId}:${eventName}`, (arg) => {
    const payload = unpack(arg);
    callback(payload.data, arg);
  });
}

// The aggregate is dispatched by the CLEO plugin as saweb:<uiId> with
// {"name":...,"data":...}, because CLEO Redux matches event names exactly and
// has no wildcard. Receives the bare event name: ("slider", { value: 50 }).
//
// unpack() matters here: the engine hands over {name, data} where name is the
// CLEO event name (saweb:<uiId>), not the page's event name. Reading .name
// straight off the argument would yield "saweb:main" instead of "slider".
export function onAny(uiId, callback) {
  return subscribe(`saweb:${uiId}`, (arg) => {
    const outer = unpack(arg);
    const parsed = parseData(outer.data);
    if (parsed && typeof parsed === "object" && "name" in parsed) {
      callback(parsed.name, parseData(parsed.data), arg);
      return;
    }
    callback(undefined, parsed, arg);
  });
}

export const ui = {
  register,
  open,
  close,
  toggle,
  isOpen,
  send,
  on,
  onAny,
};

export default {
  version: API_VERSION,
  ui,
  on,
  onAny,
  setCursor,
  CursorMode,
};
