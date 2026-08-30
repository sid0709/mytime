# Input integrity: what we built and why

This note is a map of the anti-fake-activity work: the problems we set out to solve, what each layer does, and what we deliberately left out.

MyTime still measures **presence** the same way (any accepted hardware input plus a 30-second grace period). The new work is about **not counting** input that is not local physical work, and about **not treating** high-volume one-channel activity as high-intensity work.

## The problems

1. **Software-injected keys and mouse** (SendInput, `keybd_event`, `mouse_event`, macros, on-screen keyboards) should not inflate activity. Language of the injector does not matter.
2. **Remoting into this machine** (for example controlling comB from comA) should not raise comB’s activity. The person is working on the other computer.
3. We must not maintain a list of remote-product names (TeamViewer, AnyDesk, RustDesk, and so on). Product names change; enumerators and OS session flags do not.
4. **Monotonous real hardware** (all-scroll, keys-only, mouse-jiggle) is still presence, but it should not look like peak density on heatmaps, the correlator, and the pulse strip.
5. Those two layers were easy to miss in the UI (Help, tooltips, a banner on the Input Visualizer). The board needed a first-class view of “is this local hardware?” and “is this varied work?”.

## How the layers relate

```text
OS event
  → Layer 1a: is this hardware, or injected software?
  → Layer 1b: is this machine in a remote / virtual-HID session?
       rejected → never counted (no counters, sessions, SQLite, or UI)
       accepted → presence (active time) + volume
                    → Layer 2: quality of the action mix
                    → intensity = volume × quality
```

Active **time** stays presence-based. The Focus Correlator, live pulse, and Detection board plot **density** (mean of 1-second quality percents, including below 25%). STATUS and the weekly heatmap still treat below 25% as inactive.

---

## Layer 1a — reject injected input

**Purpose:** do not count fake activity generated in user space.

**Where:** existing origin classifier, applied in the Windows and macOS hooks before any event is built.

| Platform | What we trust |
|---|---|
| Windows | Reject `LLKHF_INJECTED` / `LLKHF_LOWER_IL_INJECTED` and `LLMHF_INJECTED` / `LLMHF_LOWER_IL_INJECTED`. Same helper and in-process fallback. |
| macOS | Accept only HID-system source state with a non-positive source PID. |

**Code:** `src-tauri/src/input_monitor/origin.rs`, `windows.rs`, `macos.rs`.

This layer was already the product boundary; we kept it and wired Layer 1b next to it rather than replacing it.

---

## Layer 1b — ignore remote / virtual-HID sessions

**Purpose:** when someone is remoted *into* this machine, that input must not count here. Detect the *session and device class*, never a product `.exe` name or a config file of names.

**Where:** `src-tauri/src/input_monitor/remote.rs`.

A background poller (session flags ~500 ms, HID class ~2 s on Windows) writes one atomic. **Hook callbacks only read the atomic** so classification stays off the hot path.

**Windows** — the gate turns **on** if any of:

- OS remote session (`SM_REMOTESESSION` / `SM_REMOTECONTROL`).
- RDP-style HID enumerators (`RDP_MOU`, `RDP_KBD`, `TERMINPUT`).
- Only software/virtual HID is present (no physical USB/BTH/I2C/SPI/ACPI/`HID#VID_`).

A leftover mirror display adapter, including together with a ROOT-enumerated software HID, does **not** block when a physical keyboard or mouse is present.

**macOS** — session-flag only: `kCGSSessionOnConsoleKey == false` (a remote user in a separate login session). HID enumerator / virtual-HID / RDP-style classification is not used. Screen Sharing the **active console** is not detected.

While gated, we **fail closed**: no input is counted.

Diagnostics on `InputMonitorStatusDto`: `remoteSessionActive`, `rejectedInjected`, `rejectedRemote`. On macOS and the Windows in-process fallback, those counters increment in-process. On the normal Windows helper path they are forwarded from the helper over the existing UDP socket (~1s).

### Known limits (out of scope on purpose)

- RDP Wrapper (console + RDP at once can still look local).
- Remote tools that inject through the **physical** HID stack (filter drivers).
- USB HID gadgets that enumerate as real USB.
- Windows: a remote that leaves a physical HID visible and only adds a mirror adapter plus ROOT HID looks local unless `session_remote` or an RDP enumerator is set.
- macOS: Screen Sharing the active console session is not a Layer 1b signal.
- Kernel drivers, Arduino HID, binary or database tampering.

---

## Layer 2 — work quality vs one-channel volume

**Purpose:** distinguish *busy* from *varied*. All-scroll, keys-only, or mouse-jiggle minutes keep high **volume** but score low **quality**, so density on the correlator, Detection board, and pulse stays low.

**Where:** `src-tauri/src/input_complexity.rs`, persisted on `input_minutes` (schema v5: `diversity_centi`, `timing_centi`, `quality_centi`). JSON DTOs expose `diversity` / `timing` / `quality` in 0–1 (`null` when the minute is too sparse).

**How a minute is scored**

- Action symbols: `{Key, Click, Move, Scroll, FocusSwitch}` (presses and wheels; releases are not symbols).
- **Diversity:** LZ76 entropy rate `c(n)·log_5(n)/n` of that sequence (`A = 5` action types), so mixed work can approach 1.
- **Timing:** Bandt–Pompe permutation entropy (`n=3`) on the dominant class if it is ≥70% of the minute and there are enough intervals; otherwise timing = 1.
- **Type-sequence quality:** `0.65 * diversity + 0.35 * timing`.
- Sparse minutes (&lt;12 symbols) omit quality; scoring treats `null` as **1.0** so we do not punish light real work.

**Mouse-movement dynamics.** When a window is almost all `Move` symbols (`move_fraction ≥ 0.70`) the type sequence carries no information, so quality comes from the *geometry* of the cursor path instead (`Move` symbols now carry `(x, y)`; needs ≥ 11 positioned samples):

```
Q_mouse = V^0.35 · B^0.25 · T^0.25 · S^0.15      (weighted geometric mean, each term in [ε, 1])

V  vigor       1 / (1 + (v0 / p75_speed)^k)        slow jiggle → 0     (v0 = 0.08 px/ms, k = 1.6)
B  burstiness  1 − exp(−λ · Var(ln step_speed))    constant speed → 0  (λ = 1, speed floored at 0.005 px/ms)
T  turning     1 − ‖Σ w·e^{iΔθ}‖ / Σ w             constant curvature → 0   (w = √(dᵢ·dᵢ₋₁), Δθ = heading change)
S  spread      tanh(radius_of_gyration / 60px)     tiny area → 0
```

The geometric mean means any single tell (slow, flat-speed, predictable curvature, tiny area) collapses the score. Straight and circular auto-movers score ~0 despite covering ground (B, T = 0). Smooth slow small-area movement ≈ 0.03; point-to-point web browsing ≈ 0.64; gaming-style motion ≈ 0.88. `Q_mouse` is cross-faded into the type-sequence quality by `smoothstep(0.70, 0.92, move_fraction)`, so a mixed minute is unaffected. Mixed keyboard/scroll/type-switching behaviour keeps the old formula.

A ring buffer of 2048 symbols overwrites oldest. The 30-second grace bump that marks a later minute active is **not** fed as extra mouse-move symbols.

**Intensity:** `volume × mixed quality`, with a 3-minute rolling mean of quality in the UI so the 70% cutoff does not flicker. Mixed quality scales entropy by **hands-on share** (key+click volume vs scroll/move). Below `QUALITY_HANDS_ON_THRESHOLD` in `.env` (default 0.25) a minute is treated as browsing/feeds and lands near `QUALITY_BROWSING_TARGET` (default 0.45). Gaming and typing sit above the threshold and stay near 100%. Volume formula is unchanged (`keys*12 + clicks*10 + scrolls*8 + moves*3`, cap 250).

Rust and TypeScript share a fixture (`expected: 94` for 10/2/4/5 at quality 0.5) in `activity_score.rs` and `src/app/constants/activityScore.ts`.

**Limitation:** a metronomic mix of two types (key, click, key, click) still looks diverse. Layer 2 is for monotonous human behavior, not adversarial bots.

---

## Frontend Detection board

**Purpose:** make Layer 1 and Layer 2 visible on the boards people actually use, without a new API or a fourth vanity metric that replaces Idle Periods / Active Time.

**Where:** `src/app/components/DetectionBoard.tsx` consumes a process-wide snapshot from `src/app/qualityLiveStore.ts` (started in `App.tsx`). Origin still uses `useInputMonitorStatus`. Today totals use `workQualitySummary` in `activityScore.ts`.

Mounted:

- **Dashboard** — under Live Pulse, above the three stat cards.
- **Activity** — same component above the four stat cards.

The board shows:

- Layer 1: Hardware / Remote — not counted / Permission needed; injected and remote discard counts; gated `message`.
- Layer 2: **live** density is LZ76 + permutation entropy of the last `QUALITY_LIVE_WINDOW_MS` of action symbols on each active second (idle = 0). It is not mixed-quality’s 0 / 45 / 100 plateaus. The headline is the mean of those samples; **Refresh** flushes the sidecar.

Copy stays plain (“Hardware-only input”, “Varied work vs one-channel activity”). LZ76 / PE jargon stays in Help.

The Input Visualizer **remote banner** remains a local warning on that widget only.

Help: Dashboard “Detection Board” card plus the Activity hardware-policy and work-quality articles (sidecar, Layer 1 session gate, 25% persist skip).

---

## Live sidecar and persist gates

**Why a backend store:** `DashboardView` unmounts on sidebar navigation. A per-card batch subscription died with the card, so the 20s strip reset. Quality now lives in Rust for the process lifetime; the WebView only reads `quality-live://tick`.

**Sidecar (not SQLite):** `{app_data}/quality-live/quality-YYYY-MM-DD.bin` is 86_400 `u8` percents. RAM holds today; flush every 30s, on Refresh, and on quit. Files older than 7 days are deleted on startup. The weekly heatmap and the STATUS track after the collector starts use this file: seconds below `QUALITY_PERSIST_MIN` are not counted as active.

**Layer 1 session leak:** the 2s foreground-window poller used to `persist_checkpoint` sessions with zero accepted input (Activity Tracker app bars during remote). `record_snapshot` now queues sessions only when hardware was accepted in the last 30s. Unpersistable RAM windows stay for live UI.

**Layer 2b `skipActivityPersist`:** after each closed 30s slot, if the mean of those 30 one-second LZ76 percents is below `QUALITY_PERSIST_MIN` (default 0.25), activity SQLite writes for that window are skipped. The first incomplete slot of a run is allowed so startup typing is not lost. Monotone scroll often scores well below the old 45% browsing floor, so those slots skip persist; mixed work still persists. Live board and sidecar still record the raw percents.

---

## What we did not do

- No new backend fields beyond status counters and per-minute quality.
- No per-second SQLite inserts, localStorage, or JSON append logs.
- No separate Detection page.
- Active Time is still presence; we did not replace it with quality-weighted time.
- No hardcoded or configurable list of remote-product names.

## Where to look

| Concern | Location |
|---|---|
| Injected-input flags | `src-tauri/src/input_monitor/origin.rs` |
| Remote / HID gate | `src-tauri/src/input_monitor/remote.rs` |
| Quality math | `src-tauri/src/input_complexity.rs` |
| Volume × quality | `src-tauri/src/activity_score.rs`, `src/app/constants/activityScore.ts` |
| Persistence | `input_minutes` in `src-tauri/src/db.rs` (schema v5) |
| Live quality sidecar | `src-tauri/src/quality_live.rs`, `{app_data}/quality-live/` |
| Status DTO | `get_input_monitor_status` → `InputMonitorStatusDto` |
| Detection UI | `src/app/components/DetectionBoard.tsx`, `src/app/qualityLiveStore.ts` |
| User-facing policy | Help → Hardware-Only Input Policy, Work quality vs presence |
