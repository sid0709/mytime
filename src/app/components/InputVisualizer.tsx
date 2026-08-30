import { useState, useEffect, useCallback, useRef } from "react";

import {
  getInputMonitorStatus,
  openInputMonitorSettings,
  requestInputMonitorPermission,
  subscribeToInputMonitorBatch,
} from "../api/inputMonitor";
import type { InputMonitorStatusDto } from "../types/backend";
import { hasTauriRuntime } from "../api/tauri";
import type { InputMonitorEventDto } from "../types/backend";

interface InputEvent {
  id: number;
  kind: "keyboard" | "mouse" | "scroll";
  label: string;
  timestamp: number;
}

interface KeyBinding {
  stateKey: string;
  label: string;
}

const KEY_DISPLAY_LABELS: Record<string, string> = {
  space: "Space",
  return: "Return",
  shift: "Shift",
  shift2: "Right Shift",
  control: "Ctrl",
  option: "Alt",
  option2: "Right Alt",
  command: "Meta",
  command2: "Right Meta",
  tab: "Tab",
  esc: "Esc",
  delete: "Backspace",
  nav_del: "Delete",
  caps: "Caps Lock",
  insert: "Insert",
  home: "Home",
  end: "End",
  pgup: "Page Up",
  pgdn: "Page Down",
  up: "Arrow Up",
  down: "Arrow Down",
  left: "Arrow Left",
  right: "Arrow Right",
  prtsc: "Print Screen",
  numlock: "Num Lock",
  "np/": "Numpad /",
  "np*": "Numpad *",
  "np-": "Numpad -",
  "np+": "Numpad +",
  "np.": "Numpad .",
  np_enter: "Numpad Enter",
  np0: "Numpad 0",
  np1: "Numpad 1",
  np2: "Numpad 2",
  np3: "Numpad 3",
  np4: "Numpad 4",
  np5: "Numpad 5",
  np6: "Numpad 6",
  np7: "Numpad 7",
  np8: "Numpad 8",
  np9: "Numpad 9",
};

function getDisplayLabel(stateKey: string) {
  if (KEY_DISPLAY_LABELS[stateKey]) {
    return KEY_DISPLAY_LABELS[stateKey];
  }

  if (/^F\d{1,2}$/.test(stateKey)) {
    return stateKey;
  }

  return stateKey.length === 1 ? stateKey.toUpperCase() : stateKey;
}

function createKeyBinding(stateKey: string): KeyBinding {
  return {
    stateKey,
    label: getDisplayLabel(stateKey),
  };
}

function getKeyBinding(event: KeyboardEvent): KeyBinding | null {
  switch (event.code) {
    case "Space":
      return createKeyBinding("space");
    case "Enter":
      return createKeyBinding("return");
    case "NumpadEnter":
      return createKeyBinding("np_enter");
    case "ShiftLeft":
      return createKeyBinding("shift");
    case "ShiftRight":
      return createKeyBinding("shift2");
    case "ControlLeft":
    case "ControlRight":
      return createKeyBinding("control");
    case "AltLeft":
      return createKeyBinding("option");
    case "AltRight":
      return createKeyBinding("option2");
    case "MetaLeft":
      return createKeyBinding("command");
    case "MetaRight":
      return createKeyBinding("command2");
    case "Tab":
      return createKeyBinding("tab");
    case "Escape":
      return createKeyBinding("esc");
    case "Backspace":
      return createKeyBinding("delete");
    case "Delete":
      return createKeyBinding("nav_del");
    case "CapsLock":
      return createKeyBinding("caps");
    case "Insert":
      return createKeyBinding("insert");
    case "Home":
      return createKeyBinding("home");
    case "End":
      return createKeyBinding("end");
    case "PageUp":
      return createKeyBinding("pgup");
    case "PageDown":
      return createKeyBinding("pgdn");
    case "ArrowUp":
      return createKeyBinding("up");
    case "ArrowDown":
      return createKeyBinding("down");
    case "ArrowLeft":
      return createKeyBinding("left");
    case "ArrowRight":
      return createKeyBinding("right");
    case "PrintScreen":
      return createKeyBinding("prtsc");
    case "Backquote":
      return createKeyBinding("`");
    case "Minus":
      return createKeyBinding("-");
    case "Equal":
      return createKeyBinding("=");
    case "BracketLeft":
      return createKeyBinding("[");
    case "BracketRight":
      return createKeyBinding("]");
    case "Backslash":
      return createKeyBinding("\\");
    case "Semicolon":
      return createKeyBinding(";");
    case "Quote":
      return createKeyBinding("'");
    case "Comma":
      return createKeyBinding(",");
    case "Period":
      return createKeyBinding(".");
    case "Slash":
      return createKeyBinding("/");
    case "NumLock":
      return createKeyBinding("numlock");
    case "NumpadDivide":
      return createKeyBinding("np/");
    case "NumpadMultiply":
      return createKeyBinding("np*");
    case "NumpadSubtract":
      return createKeyBinding("np-");
    case "NumpadAdd":
      return createKeyBinding("np+");
    case "NumpadDecimal":
      return createKeyBinding("np.");
    default:
      break;
  }

  if (event.code.startsWith("Key")) {
    return createKeyBinding(event.code.slice(3));
  }

  if (event.code.startsWith("Digit")) {
    return createKeyBinding(event.code.slice(5));
  }

  if (event.code.startsWith("F")) {
    return createKeyBinding(event.code);
  }

  if (event.code.startsWith("Numpad")) {
    const digit = event.code.slice("Numpad".length);
    if (/^\d$/.test(digit)) {
      return createKeyBinding(`np${digit}`);
    }
  }

  return null;
}

export function InputVisualizer() {
  const [pressedKeys, setPressedKeys] = useState<Set<string>>(new Set());
  const [mouseLeft, setMouseLeft] = useState(false);
  const [mouseRight, setMouseRight] = useState(false);
  const [scrollDir, setScrollDir] = useState<"up" | "down" | null>(null);
  const [scrollClick, setScrollClick] = useState(false);
  const [recentEvents, setRecentEvents] = useState<InputEvent[]>([]);
  const [monitorStatus, setMonitorStatus] = useState<InputMonitorStatusDto | null>(null);
  const eventIdRef = useRef(0);
  const scrollResetTimeoutRef = useRef<number | null>(null);
  const lastMoveLogAtRef = useRef(0);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

  const resetScrollIndicator = useCallback(() => {
    if (scrollResetTimeoutRef.current !== null) {
      window.clearTimeout(scrollResetTimeoutRef.current);
    }
    scrollResetTimeoutRef.current = window.setTimeout(() => {
      setScrollDir(null);
    }, 220);
  }, []);

  // Reduce a native batch to one update per piece of React state. This prevents a burst of input
  // from creating dozens of intermediate Sets/arrays that the browser will never paint.
  const processMonitorBatch = useCallback(
    (events: InputMonitorEventDto[]) => {
      if (events.length === 0) return;

      setPressedKeys((previous) => {
        let next: Set<string> | null = null;
        for (const event of events) {
          if (event.kind !== "keyboard" || !event.stateKey) continue;
          const current = next ?? previous;
          if (event.action === "press" && !current.has(event.stateKey)) {
            next ??= new Set(previous);
            next.add(event.stateKey);
          } else if (event.action === "release" && current.has(event.stateKey)) {
            next ??= new Set(previous);
            next.delete(event.stateKey);
          }
        }
        return next ?? previous;
      });

      let left: boolean | undefined;
      let right: boolean | undefined;
      let middle: boolean | undefined;
      let direction: "up" | "down" | undefined;
      for (const event of events) {
        if (event.button === "left") left = event.action === "press";
        if (event.button === "right") right = event.action === "press";
        if (event.button === "middle") middle = event.action === "press";
        if (event.direction) direction = event.direction;
      }
      if (left !== undefined) setMouseLeft(left);
      if (right !== undefined) setMouseRight(right);
      if (middle !== undefined) setScrollClick(middle);
      if (direction !== undefined) {
        setScrollDir(direction);
        resetScrollIndicator();
      }

      setRecentEvents((previous) => {
        let next = previous;
        for (const event of events) {
          const label =
            event.kind === "mouse" && event.action === "move"
              ? `Mouse Move ${Math.round(event.x ?? 0)}, ${Math.round(event.y ?? 0)}`
              : event.label;
          const mergeMove =
            event.kind === "mouse" &&
            event.action === "move" &&
            next[0]?.kind === "mouse" &&
            next[0].label.startsWith("Mouse Move ");
          const mergeScroll =
            event.kind === "scroll" &&
            event.action === "wheel" &&
            next[0]?.kind === "scroll" &&
            next[0].label.startsWith("Scroll ");

          if ((mergeMove || mergeScroll) && next[0]) {
            next = [{ ...next[0], kind: event.kind, label, timestamp: event.timestamp }, ...next.slice(1)];
          } else {
            next = [
              {
                id: ++eventIdRef.current,
                kind: event.kind,
                label,
                timestamp: event.timestamp,
              },
              ...next.slice(0, 7),
            ];
          }
        }
        return next;
      });
    },
    [resetScrollIndicator],
  );

  const processMonitorEvent = useCallback(
    (event: InputMonitorEventDto) => processMonitorBatch([event]),
    [processMonitorBatch],
  );

  useEffect(() => {
    if (!hasTauriRuntime()) {
      return;
    }

    let cancelled = false;

    let statusTimer: number | null = null;
    const pollStatus = async (requestPermission: boolean) => {
      try {
        let status = await getInputMonitorStatus();
        if (requestPermission && !status?.listenEventAccess) {
          await requestInputMonitorPermission();
          status = await getInputMonitorStatus();
        }
        if (!cancelled && status) setMonitorStatus(status);
      } finally {
        if (!cancelled) {
          statusTimer = window.setTimeout(() => void pollStatus(false), 10_000);
        }
      }
    };

    void pollStatus(true);

    return () => {
      cancelled = true;
      if (statusTimer !== null) window.clearTimeout(statusTimer);
    };
  }, []);

  const isMonitoringActive = Boolean(
    monitorStatus?.listenEventAccess &&
      (monitorStatus.tapInstalled || monitorStatus.eventsReceived > 0),
  );

  useEffect(() => {
    const clearTransientState = () => {
      setPressedKeys(new Set());
      setMouseLeft(false);
      setMouseRight(false);
      setScrollClick(false);
      setScrollDir(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const binding = getKeyBinding(event);
      if (!binding) {
        return;
      }

      if (!event.repeat) {
        processMonitorEvent({
          kind: "keyboard",
          action: "press",
          label: `Press ${binding.label}`,
          stateKey: binding.stateKey,
          timestamp: Date.now(),
        });
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const binding = getKeyBinding(event);
      if (!binding) {
        return;
      }

      processMonitorEvent({
        kind: "keyboard",
        action: "release",
        label: `Release ${binding.label}`,
        stateKey: binding.stateKey,
        timestamp: Date.now(),
      });
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button === 0) {
        processMonitorEvent({
          kind: "mouse",
          action: "press",
          label: "Left Click",
          button: "left",
          x: event.clientX,
          y: event.clientY,
          timestamp: Date.now(),
        });
      } else if (event.button === 1) {
        processMonitorEvent({
          kind: "scroll",
          action: "press",
          label: "Middle Click",
          button: "middle",
          x: event.clientX,
          y: event.clientY,
          timestamp: Date.now(),
        });
      } else if (event.button === 2) {
        processMonitorEvent({
          kind: "mouse",
          action: "press",
          label: "Right Click",
          button: "right",
          x: event.clientX,
          y: event.clientY,
          timestamp: Date.now(),
        });
      }
    };

    const handleMouseUp = (event: MouseEvent) => {
      if (event.button === 0) {
        processMonitorEvent({
          kind: "mouse",
          action: "release",
          label: "Left Release",
          button: "left",
          x: event.clientX,
          y: event.clientY,
          timestamp: Date.now(),
        });
      } else if (event.button === 1) {
        processMonitorEvent({
          kind: "scroll",
          action: "release",
          label: "Middle Release",
          button: "middle",
          x: event.clientX,
          y: event.clientY,
          timestamp: Date.now(),
        });
      } else if (event.button === 2) {
        processMonitorEvent({
          kind: "mouse",
          action: "release",
          label: "Right Release",
          button: "right",
          x: event.clientX,
          y: event.clientY,
          timestamp: Date.now(),
        });
      }
    };

    const handleWheel = (event: WheelEvent) => {
      const direction: "up" | "down" = event.deltaY < 0 ? "up" : "down";
      processMonitorEvent({
        kind: "scroll",
        action: "wheel",
        label: direction === "up" ? "Scroll Up" : "Scroll Down",
        direction,
        x: event.clientX,
        y: event.clientY,
        timestamp: Date.now(),
      });
    };

    const handleMouseMove = (event: MouseEvent) => {
      const now = Date.now();
      const previous = lastPointerRef.current;
      const movedEnough =
        !previous ||
        Math.abs(previous.x - event.clientX) + Math.abs(previous.y - event.clientY) >= 22;

      if (!movedEnough || now - lastMoveLogAtRef.current < 240) {
        return;
      }

      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      lastMoveLogAtRef.current = now;
      processMonitorEvent({
        kind: "mouse",
        action: "move",
        label: `Move ${Math.round(event.clientX)}, ${Math.round(event.clientY)}`,
        x: event.clientX,
        y: event.clientY,
        timestamp: now,
      });
    };

    let disposeGlobalListener: (() => void) | undefined;
    let cancelled = false;

    if (hasTauriRuntime()) {
      void (async () => {
        const unlisten = await subscribeToInputMonitorBatch(processMonitorBatch);
        if (cancelled) {
          unlisten();
          return;
        }
        disposeGlobalListener = unlisten;
      })();
    } else {
      window.addEventListener("keydown", handleKeyDown);
      window.addEventListener("keyup", handleKeyUp);
      window.addEventListener("mousedown", handleMouseDown);
      window.addEventListener("mouseup", handleMouseUp);
      window.addEventListener("wheel", handleWheel, { passive: true });
      window.addEventListener("mousemove", handleMouseMove, { passive: true });
      window.addEventListener("blur", clearTransientState);
    }

    return () => {
      cancelled = true;
      disposeGlobalListener?.();
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("blur", clearTransientState);
      if (scrollResetTimeoutRef.current !== null) {
        window.clearTimeout(scrollResetTimeoutRef.current);
      }
    };
  }, [processMonitorBatch]);

  const isKeyPressed = (key: string) => {
    return pressedKeys.has(key);
  };

  const handlePreventContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
  }, []);

  // --- Geometry constants ---
  const U = 30;    // 1u key width in px
  const G = 2;     // gap between keys
  const P = 8;     // body padding
  const KH = 24;   // key height
  const FKH = 16;  // function-row key height
  const RG = 2;    // row gap
  const HKH = 11;  // half-height arrow key
  const SEC = G;   // section gap = same as key gap per user request
  const NAV_NUM_GAP = 8; // gap between nav cluster and numpad

  // Helper: pixel width from unit width
  const pw = (u: number) => u * U + (u > 1 ? (u - 1) * G : 0);

  // Main keyboard = 15u wide (standard ANSI)
  const MAIN_W = pw(15);
  const NAV_W = U;                   // nav cluster = 1u column
  const NUM_W = pw(4);               // numpad = 4u wide
  const totalW = P + MAIN_W + SEC + NAV_W + NAV_NUM_GAP + NUM_W + P;

  // Y positions
  const fnY = P;
  const r1Y = fnY + FKH + RG + 4;   // extra gap after fn row
  const r2Y = r1Y + KH + RG;
  const r3Y = r2Y + KH + RG;
  const r4Y = r3Y + KH + RG;
  const r5Y = r4Y + KH + RG;
  const totalH = r5Y + KH + P;

  // Section X offsets
  const navX = P + MAIN_W + SEC;
  const numX = navX + NAV_W + NAV_NUM_GAP;

  // --- Render helpers ---
  const renderKey = (
    x: number, y: number, w: number, h: number,
    label: string, keyId: string,
    opts?: { sub?: string; fontSize?: number }
  ) => {
    const pressed = isKeyPressed(keyId);
    const width = pw(w);
    const fs = opts?.fontSize ?? (label.length > 5 ? 5 : label.length > 3 ? 5.5 : label.length > 1 ? 6.5 : 8);
    return (
      <g key={keyId + "-" + x + "-" + y}>
        <rect x={x} y={y} width={width} height={h} rx="3.5"
          fill={pressed ? "#6366f1" : "#f5f5f7"}
          stroke={pressed ? "#818cf8" : "#d1d1d6"} strokeWidth="0.6"
          style={{ transition: "fill 0.08s, stroke 0.08s" }} />
        {opts?.sub ? (
          <>
            <text x={x + width / 2} y={y + h * 0.32} textAnchor="middle" dominantBaseline="middle"
              fill={pressed ? "#c7d2fe" : "#86868b"} fontSize={5}
              fontFamily="system-ui, sans-serif" style={{ pointerEvents: "none" }}>
              {opts.sub}
            </text>
            <text x={x + width / 2} y={y + h * 0.72} textAnchor="middle" dominantBaseline="middle"
              fill={pressed ? "#fff" : "#1d1d1f"} fontSize={7}
              fontFamily="system-ui, sans-serif" style={{ pointerEvents: "none" }}>
              {label}
            </text>
          </>
        ) : (
          <text x={x + width / 2} y={y + h / 2 + 0.5} textAnchor="middle" dominantBaseline="middle"
            fill={pressed ? "#fff" : "#1d1d1f"} fontSize={fs}
            fontFamily="system-ui, sans-serif" style={{ pointerEvents: "none" }}>
            {label}
          </text>
        )}
      </g>
    );
  };

  const layoutRow = (
    keys: { id: string; label: string; w: number; sub?: string; fontSize?: number }[],
    startX: number, y: number, h: number
  ) => {
    let x = startX;
    return keys.map((k) => {
      const el = renderKey(x, y, k.w, h, k.label, k.id, { sub: k.sub, fontSize: k.fontSize });
      x += pw(k.w) + G;
      return el;
    });
  };

  // === ROW DEFINITIONS ===

  // Function row: esc(1.5) + F1-F12(12×1) + PrtSc(1.5) = 15u
  const fnRowKeys = [
    { id: "esc", label: "esc", w: 1.5, fontSize: 5.5 },
    { id: "F1", label: "F1", w: 1 }, { id: "F2", label: "F2", w: 1 },
    { id: "F3", label: "F3", w: 1 }, { id: "F4", label: "F4", w: 1 },
    { id: "F5", label: "F5", w: 1 }, { id: "F6", label: "F6", w: 1 },
    { id: "F7", label: "F7", w: 1 }, { id: "F8", label: "F8", w: 1 },
    { id: "F9", label: "F9", w: 1 }, { id: "F10", label: "F10", w: 1, fontSize: 5 },
    { id: "F11", label: "F11", w: 1, fontSize: 5 }, { id: "F12", label: "F12", w: 1, fontSize: 5 },
    { id: "prtsc", label: "PrtSc", w: 1.5, fontSize: 4.5 },
  ];

  // Number row: `(1) + 1-0(10) + -(1) + =(1) + delete/backspace(2) = 15u
  const numRowKeys = [
    { id: "`", label: "`", w: 1, sub: "~" },
    { id: "1", label: "1", w: 1, sub: "!" },
    { id: "2", label: "2", w: 1, sub: "@" },
    { id: "3", label: "3", w: 1, sub: "#" },
    { id: "4", label: "4", w: 1, sub: "$" },
    { id: "5", label: "5", w: 1, sub: "%" },
    { id: "6", label: "6", w: 1, sub: "^" },
    { id: "7", label: "7", w: 1, sub: "&" },
    { id: "8", label: "8", w: 1, sub: "*" },
    { id: "9", label: "9", w: 1, sub: "(" },
    { id: "0", label: "0", w: 1, sub: ")" },
    { id: "-", label: "-", w: 1, sub: "_" },
    { id: "=", label: "=", w: 1, sub: "+" },
    { id: "delete", label: "delete", w: 2, fontSize: 5.5 },
  ];

  // Tab row: tab(1.5) + 12 letter/symbol keys(12) + \(1.5) = 15u
  const tabRowKeys = [
    { id: "tab", label: "tab", w: 1.5, fontSize: 5.5 },
    { id: "Q", label: "Q", w: 1 }, { id: "W", label: "W", w: 1 },
    { id: "E", label: "E", w: 1 }, { id: "R", label: "R", w: 1 },
    { id: "T", label: "T", w: 1 }, { id: "Y", label: "Y", w: 1 },
    { id: "U", label: "U", w: 1 }, { id: "I", label: "I", w: 1 },
    { id: "O", label: "O", w: 1 }, { id: "P", label: "P", w: 1 },
    { id: "[", label: "[", w: 1 }, { id: "]", label: "]", w: 1 },
    { id: "\\", label: "\\", w: 1.5 },
  ];

  // Home row: caps(1.75) + A-'(11) + return(2.25) = 15u
  const homeRowKeys = [
    { id: "caps", label: "caps lock", w: 1.75, fontSize: 4.5 },
    { id: "A", label: "A", w: 1 }, { id: "S", label: "S", w: 1 },
    { id: "D", label: "D", w: 1 }, { id: "F", label: "F", w: 1 },
    { id: "G", label: "G", w: 1 }, { id: "H", label: "H", w: 1 },
    { id: "J", label: "J", w: 1 }, { id: "K", label: "K", w: 1 },
    { id: "L", label: "L", w: 1 }, { id: ";", label: ";", w: 1 },
    { id: "'", label: "'", w: 1 },
    { id: "return", label: "return", w: 2.25, fontSize: 5.5 },
  ];

  // Shift row: shift(2.25) + Z-/(10) + shift(2.75) = 15u
  const shiftRowKeys = [
    { id: "shift", label: "shift", w: 2.25, fontSize: 5.5 },
    { id: "Z", label: "Z", w: 1 }, { id: "X", label: "X", w: 1 },
    { id: "C", label: "C", w: 1 }, { id: "V", label: "V", w: 1 },
    { id: "B", label: "B", w: 1 }, { id: "N", label: "N", w: 1 },
    { id: "M", label: "M", w: 1 }, { id: ",", label: ",", w: 1 },
    { id: ".", label: ".", w: 1 }, { id: "/", label: "/", w: 1 },
    { id: "shift2", label: "shift", w: 2.75, fontSize: 5.5 },
  ];

  // Bottom row + arrows
  const bottomMainKeys = [
    { id: "fn", label: "fn", w: 1, fontSize: 6 },
    { id: "control", label: "ctrl", w: 1, fontSize: 5 },
    { id: "option", label: "opt", w: 1, fontSize: 5 },
    { id: "command", label: "⌘", w: 1.25, fontSize: 8 },
    { id: "space", label: "", w: 5.5 },
    { id: "command2", label: "⌘", w: 1.25, fontSize: 8 },
    { id: "option2", label: "alt", w: 1, fontSize: 5.5 },
  ];

  // Arrow keys positioning (last 3u of main keyboard)
  const arrowBlockRight = P + MAIN_W;
  const arrowBlockLeft = arrowBlockRight - (3 * U + 2 * G);
  const arrowUpY = r5Y;
  const arrowDownY = r5Y + HKH + 1;

  // Nav cluster keys
  const navClusterKeys = [
    { id: "insert", label: "ins", y: fnY, h: FKH, fontSize: 5 },
    { id: "nav_del", label: "del", y: r1Y, h: KH, fontSize: 5.5 },
    { id: "home", label: "home", y: r2Y, h: KH, fontSize: 4.5 },
    { id: "end", label: "end", y: r3Y, h: KH, fontSize: 5 },
    { id: "pgup", label: "pg↑", y: r4Y, h: KH, fontSize: 4.5 },
    { id: "pgdn", label: "pg↓", y: r5Y, h: KH, fontSize: 4.5 },
  ];

  // Numpad rows
  const npR0 = [
    { id: "numlock", label: "num", w: 1, fontSize: 5 },
    { id: "np/", label: "/", w: 1 },
    { id: "np*", label: "*", w: 1 },
    { id: "np-", label: "-", w: 1 },
  ];
  const npR1 = [
    { id: "np7", label: "7", w: 1 },
    { id: "np8", label: "8", w: 1 },
    { id: "np9", label: "9", w: 1 },
  ];
  const npR2 = [
    { id: "np4", label: "4", w: 1 },
    { id: "np5", label: "5", w: 1 },
    { id: "np6", label: "6", w: 1 },
  ];
  const npR3 = [
    { id: "np1", label: "1", w: 1 },
    { id: "np2", label: "2", w: 1 },
    { id: "np3", label: "3", w: 1 },
  ];

  return (
    <div
      className="bg-card rounded-2xl border border-border p-3 sm:p-5 flex flex-col h-full"
      onContextMenu={handlePreventContextMenu}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-foreground">Input Monitor</h3>
          <p className="text-muted-foreground text-xs mt-1">System-wide keyboard and mouse activity</p>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className={`w-2 h-2 rounded-full ${
              isMonitoringActive ? "bg-emerald-400 animate-pulse" : "bg-amber-400"
            }`}
          />
          <span
            className={`text-xs ${isMonitoringActive ? "text-emerald-400" : "text-amber-400"}`}
          >
            {isMonitoringActive ? "Live" : "Permission needed"}
          </span>
        </div>
      </div>

      {monitorStatus?.remoteSessionActive && (
        <div className="mb-3 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-100">
          <p className="font-medium text-sky-200">Remote session — input not counted</p>
          <p className="mt-1 text-sky-100/90">{monitorStatus.message}</p>
        </div>
      )}
      {monitorStatus && !monitorStatus.listenEventAccess && (
        <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          <p className="font-medium text-amber-200">Input Monitoring required</p>
          <p className="mt-1 text-amber-100/90 whitespace-pre-wrap">{monitorStatus.message}</p>
          <p className="mt-1 text-[10px] text-amber-200/70 break-all">
            {monitorStatus.executablePath}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md bg-amber-500/20 px-2 py-1 text-[11px] text-amber-100 hover:bg-amber-500/30"
              onClick={() => void requestInputMonitorPermission()}
            >
              Request permission
            </button>
            <button
              type="button"
              className="rounded-md bg-amber-500/20 px-2 py-1 text-[11px] text-amber-100 hover:bg-amber-500/30"
              onClick={() => void openInputMonitorSettings()}
            >
              Open System Settings
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col gap-3 min-h-0">
        {/* Keyboard SVG */}
        <div className="flex items-center justify-center min-h-0 overflow-x-auto">
          <svg viewBox={`0 0 ${totalW} ${totalH}`} className="w-full h-auto" style={{ maxHeight: 200, minWidth: 400 }}>
            <defs>
              <linearGradient id="iv-kb-body" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#c8c8cc" />
                <stop offset="100%" stopColor="#b0b0b5" />
              </linearGradient>
            </defs>

            {/* Keyboard body */}
            <rect x="0" y="0" width={totalW} height={totalH} rx="10" ry="10"
              fill="url(#iv-kb-body)" stroke="#a0a0a5" strokeWidth="0.8" />

            {/* === MAIN SECTION === */}
            {layoutRow(fnRowKeys, P, fnY, FKH)}
            {layoutRow(numRowKeys, P, r1Y, KH)}
            {layoutRow(tabRowKeys, P, r2Y, KH)}
            {layoutRow(homeRowKeys, P, r3Y, KH)}
            {layoutRow(shiftRowKeys, P, r4Y, KH)}
            {layoutRow(bottomMainKeys, P, r5Y, KH)}

            {/* Arrow keys — half-height, bottom-right of main section */}
            {renderKey(arrowBlockLeft + pw(1) + G, arrowUpY, 1, HKH, "↑", "up", { fontSize: 7 })}
            {renderKey(arrowBlockLeft, arrowDownY, 1, HKH, "←", "left", { fontSize: 7 })}
            {renderKey(arrowBlockLeft + pw(1) + G, arrowDownY, 1, HKH, "↓", "down", { fontSize: 7 })}
            {renderKey(arrowBlockLeft + 2 * (pw(1) + G), arrowDownY, 1, HKH, "→", "right", { fontSize: 7 })}

            {/* === NAV CLUSTER (single column, insert above del) === */}
            {navClusterKeys.map((k) =>
              renderKey(navX, k.y, 1, k.h, k.label, k.id, { fontSize: k.fontSize })
            )}

            {/* === NUMPAD === */}
            {layoutRow(npR0, numX, r1Y, KH)}
            {layoutRow(npR1, numX, r2Y, KH)}
            {renderKey(numX + 3 * (pw(1) + G), r2Y, 1, KH * 2 + RG, "+", "np+", { fontSize: 8 })}
            {layoutRow(npR2, numX, r3Y, KH)}
            {layoutRow(npR3, numX, r4Y, KH)}
            {renderKey(numX + 3 * (pw(1) + G), r4Y, 1, KH * 2 + RG, "⏎", "np_enter", { fontSize: 8 })}
            {renderKey(numX, r5Y, 2, KH, "0", "np0")}
            {renderKey(numX + pw(2) + G, r5Y, 1, KH, ".", "np.", { fontSize: 8 })}
          </svg>
        </div>

        {/* Bottom row: Mouse (1/3) + Event Log (2/3) — aligned to keyboard width */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-10 items-center shrink-0 mt-1">
          {/* Mouse SVG — 1/3 width on sm+, full on mobile */}
          <div className="flex items-center justify-center">
            <svg viewBox="0 0 100 120" className="w-full h-auto" style={{ maxHeight: 100 }}>
              <defs>
                <linearGradient id="iv-mouse-bg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--surface-mid)" />
                  <stop offset="100%" stopColor="var(--surface-dark)" />
                </linearGradient>
                <filter id="iv-click-glow">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <path d="M 18 40 Q 18 8 50 8 Q 82 8 82 40 L 82 85 Q 82 114 50 114 Q 18 114 18 85 Z"
                fill="url(#iv-mouse-bg)" stroke="var(--surface-stroke)" strokeWidth="1.2" />
              <line x1="50" y1="10" x2="50" y2="50" stroke="var(--surface-stroke)" strokeWidth="0.8" />
              <path d="M 20 40 L 20 18 Q 20 10 35 10 L 49 10 L 49 50 L 20 50 Z"
                fill={mouseLeft ? "#6366f1" : "transparent"}
                stroke={mouseLeft ? "#818cf8" : "transparent"} strokeWidth="0.5"
                filter={mouseLeft ? "url(#iv-click-glow)" : undefined}
                style={{ transition: "fill 0.06s" }} />
              <text x="34" y="34" textAnchor="middle" fill={mouseLeft ? "#fff" : "var(--muted-foreground)"}
                fontSize="8" fontFamily="monospace">L</text>
              <path d="M 51 10 L 65 10 Q 80 10 80 18 L 80 50 L 51 50 Z"
                fill={mouseRight ? "#6366f1" : "transparent"}
                stroke={mouseRight ? "#818cf8" : "transparent"} strokeWidth="0.5"
                filter={mouseRight ? "url(#iv-click-glow)" : undefined}
                style={{ transition: "fill 0.06s" }} />
              <text x="65" y="34" textAnchor="middle" fill={mouseRight ? "#fff" : "var(--muted-foreground)"}
                fontSize="8" fontFamily="monospace">R</text>
              <rect x="43" y="18" width="14" height="22" rx="7"
                fill={scrollClick ? "#6366f1" : "var(--surface-darker)"}
                stroke={scrollDir ? "#22d3ee" : scrollClick ? "#818cf8" : "var(--surface-stroke)"}
                strokeWidth="1"
                filter={scrollDir || scrollClick ? "url(#iv-click-glow)" : undefined}
                style={{ transition: "fill 0.08s, stroke 0.08s" }} />
              {scrollDir === "up" && (
                <polygon points="50,12 47,17 53,17" fill="#22d3ee" filter="url(#iv-click-glow)">
                  <animate attributeName="opacity" values="1;0" dur="0.3s" fill="freeze" />
                </polygon>
              )}
              {scrollDir === "down" && (
                <polygon points="50,46 47,41 53,41" fill="#22d3ee" filter="url(#iv-click-glow)">
                  <animate attributeName="opacity" values="1;0" dur="0.3s" fill="freeze" />
                </polygon>
              )}
              {[23, 27, 31, 35].map((y) => (
                <line key={y} x1="47" y1={y} x2="53" y2={y}
                  stroke={scrollDir ? "#22d3ee" : "var(--surface-stroke)"} strokeWidth="0.6"
                  style={{ transition: "stroke 0.1s" }} />
              ))}
            </svg>
          </div>

          {/* Event log — 2/3 width on sm+, full on mobile */}
          <div className="sm:col-span-2 space-y-1.5 overflow-hidden">
            {recentEvents.length === 0 && (
              <div className="text-xs text-muted-foreground px-3 py-2 rounded-lg bg-secondary/20">
                Use the system normally and this monitor will show global keyboard, mouse, and wheel events here.
              </div>
            )}
            {recentEvents.slice(0, 6).map((evt, i) => (
              <div key={evt.id}
                className="flex items-center gap-3 text-xs px-3 py-1.5 rounded-lg bg-secondary/30"
                style={{ opacity: 1 - i * 0.12 }}>
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  evt.kind === "keyboard"
                    ? "bg-chart-2"
                    : evt.kind === "scroll"
                    ? "bg-cyan-400"
                    : "bg-primary"
                }`} />
                <span className="text-foreground truncate">{evt.label}</span>
                <span className="text-muted-foreground/60 ml-auto tabular-nums shrink-0">
                  {new Date(evt.timestamp).toLocaleTimeString([], {
                    hour: "2-digit", minute: "2-digit", second: "2-digit",
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
