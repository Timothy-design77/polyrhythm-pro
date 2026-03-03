# Polyrhythm Pro V12 — Architecture Design Document

**Status:** Planning  
**Last Updated:** March 2, 2026  
**Current Version:** v11.26  

---

## Design Philosophy

**Maximum user control over everything.** Every parameter adjustable, every default overridable, every automation disableable. No black boxes. If the app makes a decision, the user can see why and change it.

**Resets at every level.** Individual parameter reset. Per-block reset. Per-plan reset. Per-routine reset. Full factory reset. The user should never feel trapped by accumulated state.

---

## Navigation — 3 Tabs

```
PLAY              PRACTICE              SETTINGS
(metronome +      (plans + routines     (all config,
 live waveform)    + sessions)           sounds, profiles)
```

**PLAY:** Existing metronome view. Dial, pattern strip, waveform during recording. Receives presets from Practice system. Unchanged audio engine.

**PRACTICE:** Three sub-views via horizontal tabs at top:

```
┌─────────────────────────────────────────┐
│  PLANS  │  ROUTINES  │  SESSIONS        │
├─────────────────────────────────────────┤
│  (content for selected sub-tab)         │
└─────────────────────────────────────────┘
```

**SETTINGS:** Rebuilt with categories: Sounds & Samples, Recording, Detection, Instrument Profiles, Vibration, Data & Export. Each category collapsible. Full reset at bottom.

---

## Data Model

### PracticePlan

```javascript
PracticePlan {
  id: string,
  name: string,
  color: string,          // hex for UI accent
  icon: string,           // emoji or icon id
  description: string,    // "Single paradiddle RLRR LRLL"
  createdAt: ISO string,

  // === TARGETS ===
  startBpm: 80,
  goalBpm: 160,
  currentBpm: 112,        // auto-updated or manual

  // === DETECTION OVERRIDES (per-plan, override global) ===
  accuracyTarget: 80,     // % threshold to advance
  scoringWindow: 20,      // ±ms for THIS plan (null = use global)
  accentThreshold: 3,     // x for THIS plan (null = use global)
  flamWindow: 15,         // ms (null = use global)
  noiseFloor: 0,          // peak amplitude floor (null = use global)
  subdivision: 2,         // 1/2/3/4/6
  sensitivity: null,      // null = use global

  // === AUTO-ADVANCE ===
  autoAdvance: true,
  advanceAfterN: 3,       // consecutive sessions above target
  bpmStep: 5,             // advance by N BPM each time
  consecutiveCount: 0,    // current streak (resets on fail)
  maxBpm: null,           // optional ceiling (null = goalBpm)

  // === PRESET (what loads into metronome) ===
  preset: {
    bpm: 112,             // synced with currentBpm
    meter: '4/4',
    tsNum: 4, tsDen: 4, tsGrp: [4],
    sub: 2,
    vol: 0.8,
    tracks: [ /* track objects */ ],
    sound: 'click'
  },

  // === LINKED DATA ===
  sessionIds: [],
  progressHistory: [
    // Snapshots added after each session
    { date: ISO, bpm: 112, accuracy: 76, stdDev: 14, avgDelta: -3.2,
      scoredHits: 48, totalHits: 63 }
  ],

  // === COMPUTED (derived, not stored) ===
  // weakBeats: [3, 7]       — from per-beat analysis across sessions
  // trend: 'improving'      — from recent progressHistory
  // streakStatus: '2 of 3'  — toward next advance
}
```

### Routine

```javascript
Routine {
  id: string,
  name: string,
  icon: string,
  createdAt: ISO string,
  schedule: ['mon', 'wed', 'fri'],  // optional day tags (display only)

  blocks: [
    {
      id: string,           // unique block ID for reset targeting
      type: 'warmup' | 'drill' | 'cooldown' | 'free',
      label: string,        // custom name, e.g. "Paradiddle Drill"

      // === SOURCE ===
      planId: null | string,   // links to PracticePlan (uses its preset + currentBpm)
      presetId: null | string, // OR standalone preset (no plan tracking)

      // === DURATION (pick one, others null) ===
      durationSec: 120,        // time-based
      hitCount: null,          // hit-count-based
      measures: null,          // measure-count-based

      // === TARGETS (drill/cooldown blocks) ===
      targetAccuracy: 80,      // % to consider "passed"
      crushThreshold: 95,      // % to trigger onCrush

      // === DETECTION OVERRIDES (per-block, override plan + global) ===
      scoringWindow: null,     // null = inherit from plan or global
      accentThreshold: null,
      flamWindow: null,
      noiseFloor: null,

      // === CONDITIONAL FLOW ===
      onFail: 'repeat' | 'continue' | 'slower',
      onCrush: 'skip' | 'faster' | 'continue',
      maxRepeats: 3,          // safety limit for 'repeat'
      slowerStep: 5,          // BPM decrease on 'slower'
      fasterStep: 5,          // BPM increase on 'faster'

      // === TEMPO ===
      bpmOverride: null,      // null = use plan's currentBpm or preset bpm
      bpmMin: null,           // floor for 'slower' flow
      bpmMax: null,           // ceiling for 'faster' flow

      // === REST ===
      restSec: 10,            // rest between this block and next

      // === RECORDING ===
      autoRecord: true,       // auto-start recording for this block
      countInBars: 1,         // count-in before recording starts
    }
  ],

  // === RUN HISTORY ===
  runs: [
    {
      id: string,
      date: ISO string,
      totalDurationSec: number,
      blockResults: [
        {
          blockIdx: number,
          blockId: string,
          bpm: number,
          accuracy: number,
          hits: number,
          repeated: number,     // how many times repeated
          skipped: boolean,
          passed: boolean,
          crushed: boolean,
          avgDelta: number,
          stdDev: number
        }
      ]
    }
  ]
}
```

### Session (extended)

```javascript
Session {
  // ... all existing fields from v11.26 ...

  // === NEW LINKS ===
  planId: null | string,         // replaces projectId
  routineRunId: null | string,   // if recorded during a routine run
  routineBlockId: null | string, // which block in routine
}
```

---

## Reset System

### Hierarchy

```
Full Factory Reset
├── Reset All Plans (delete all plans + their sessions)
├── Reset All Routines (delete all routines + run history)
├── Reset All Sessions (delete all sessions + recordings from IDB)
├── Reset Settings to Defaults (all sliders, all categories)
│
├── Per-Plan Reset
│   ├── Reset Progress (currentBpm → startBpm, clear progressHistory, zero streak)
│   ├── Reset Sessions (unlink all sessions from this plan)
│   ├── Reset Detection Overrides (all plan-level overrides → null/inherit)
│   └── Delete Plan (remove plan + unlink sessions)
│
├── Per-Routine Reset
│   ├── Reset Run History (clear all past runs)
│   ├── Reset Block (individual block → default settings)
│   ├── Reset All Blocks (all blocks in routine → defaults)
│   └── Delete Routine
│
├── Per-Session Reset
│   └── Delete Session (remove session + recording from IDB)
│
└── Settings Resets
    ├── Reset Sounds & Volume
    ├── Reset Recording
    ├── Reset Detection
    ├── Reset Vibration
    └── Reset All Settings (= Restore Defaults)
```

### Block Defaults (when resetting a block)

```javascript
BLOCK_DEFAULTS = {
  type: 'drill',
  durationSec: 120,
  hitCount: null,
  measures: null,
  targetAccuracy: 80,
  crushThreshold: 95,
  scoringWindow: null,     // inherit
  accentThreshold: null,   // inherit
  flamWindow: null,         // inherit
  noiseFloor: null,         // inherit
  onFail: 'continue',
  onCrush: 'continue',
  maxRepeats: 3,
  slowerStep: 5,
  fasterStep: 5,
  bpmOverride: null,
  bpmMin: null,
  bpmMax: null,
  restSec: 10,
  autoRecord: true,
  countInBars: 1,
}
```

### Reset Confirmations

Every destructive reset shows a confirmation with exactly what will be deleted. Example:

```
Reset "Paradiddle" Plan Progress?

This will:
• Set BPM back to 80 (from 138)
• Clear 23 progress snapshots
• Reset advance streak to 0

Sessions will NOT be deleted.

[Cancel]  [Reset Progress]
```

Full factory reset requires typing "RESET" to confirm.

---

## Practice Tab — Plans View

### Plan List

```
┌──────────────────────────────────────┐
│  + NEW PLAN                    [⚙]  │
├──────────────────────────────────────┤
│  🥁 Paradiddles                      │
│  112 / 160 BPM   ████████░░░ 70%    │
│  76% acc ↑  streak: 2/3  next: 117  │
│  Weak: beat 3e (+14ms avg)           │
├──────────────────────────────────────┤
│  🎵 Jazz Comping                     │
│  95 / 130 BPM    ██████░░░░░ 50%    │
│  82% acc →  streak: 0/3             │
├──────────────────────────────────────┤
│  🔥 Double Stroke Roll               │
│  140 / 200 BPM   ████░░░░░░ 35%    │
│  68% acc ↓  streak: 0/2  stalled    │
└──────────────────────────────────────┘
```

Progress bar: `(currentBpm - startBpm) / (goalBpm - startBpm) * 100`

Trend arrows: compare last 5 sessions' accuracy. ↑ improving, → flat, ↓ declining.

### Plan Detail

Tap a plan to open detail view:

**Header:**
- Plan name, icon, color
- Current BPM (editable — manual override always available)
- Goal BPM
- Accuracy target
- "START PRACTICE" button → loads preset into PLAY, starts recording

**Progress Graph:**
- X-axis: BPM (startBpm to goalBpm)
- Y-axis: accuracy %
- Dots: each session, color-coded by accuracy
- Line: trend (rolling average)
- Horizontal line at accuracyTarget
- Vertical line at currentBpm

**Stats Summary:**
- Total sessions on this plan
- Total practice time
- Best accuracy at current BPM
- Average accuracy at current BPM
- Consistency (std dev)

**Per-Beat Analysis (aggregated):**
- Heatmap across all sessions at current BPM
- Shows which beats are consistently weak
- Color: green < 5ms avg, yellow < 15ms, red > 15ms

**Auto-Advance Settings (inline, all adjustable):**
- Auto-advance: toggle on/off
- Advance after N sessions: slider 1-10
- BPM step: slider 1-20
- Current streak: display + manual reset button

**Detection Overrides:**
- Each slider shows "Global: Xms" when set to inherit
- Override toggle per parameter
- "Reset to Global" button clears all overrides

**Session History (for this plan):**
- List of sessions linked to this plan
- Tap to open session detail with full analytics

**Danger Zone:**
- Reset Progress
- Unlink All Sessions
- Delete Plan

### Plan Creation / Edit

Form with all fields from the data model. Sound selector inline (tap to hear preview). Meter/subdivision pickers same as main metronome. Pre-populate from current metronome settings.

---

## Practice Tab — Routines View

### Routine List

```
┌──────────────────────────────────────┐
│  + NEW ROUTINE               [⚙]    │
├──────────────────────────────────────┤
│  🔥 Monday Rudiments    M W         │
│  4 blocks · ~25 min                 │
│  Last run: 2 days ago   78% avg     │
│  ▶ START                             │
├──────────────────────────────────────┤
│  🎸 Groove Thursday     Th          │
│  3 blocks · ~20 min                 │
│  Last run: 5 days ago   84% avg     │
│  ▶ START                             │
└──────────────────────────────────────┘
```

### Routine Detail / Editor

Tap routine name (not START) to edit:

```
┌──────────────────────────────────────┐
│  ← Back              Monday Rudiments│
├──────────────────────────────────────┤
│                                      │
│  BLOCK 1   WARMUP                    │
│  Singles · 80 BPM · 2 min            │
│  No scoring · Count-in: 1 bar       │
│  Rest: 10s                           │
│  [Edit] [Reset Block] [✕]           │
│                                      │
│  BLOCK 2   DRILL                     │
│  📎 Paradiddles (Plan)               │
│  Auto BPM (currently 112)            │
│  Target: 80% · Crush: 95%           │
│  Fail: repeat (max 3)               │
│  Crush: advance +5 BPM              │
│  Duration: 2 min · Rest: 10s        │
│  [Edit] [Reset Block] [✕]           │
│                                      │
│  BLOCK 3   DRILL                     │
│  📎 Jazz Comping (Plan)              │
│  Auto BPM (currently 95)             │
│  Target: 75% · Fail: slower -5      │
│  Crush: skip                         │
│  Duration: 3 min · Rest: 15s        │
│  [Edit] [Reset Block] [✕]           │
│                                      │
│  BLOCK 4   COOLDOWN                  │
│  Free play · 70 BPM · 3 min         │
│  No scoring                          │
│  [Edit] [Reset Block] [✕]           │
│                                      │
│  [+ Add Block]                       │
│  [↕ Reorder]                         │
│                                      │
├──────────────────────────────────────┤
│  ESTIMATED TIME: ~25 min             │
│  ▶ START ROUTINE                     │
├──────────────────────────────────────┤
│  RUN HISTORY                         │
│  Mar 1 — 78% avg · 24 min           │
│  Feb 27 — 72% avg · 28 min (2 rpts) │
│  Feb 25 — 81% avg · 22 min          │
├──────────────────────────────────────┤
│  [Reset Run History]                 │
│  [Reset All Blocks]                  │
│  [Delete Routine]                    │
└──────────────────────────────────────┘
```

### Block Editor (tap Edit on any block)

Full-screen or bottom-sheet editor with all block parameters:

**Type selector:** Warmup / Drill / Cooldown / Free

**Source:**
- Link to Plan (dropdown of plans)
- Link to Preset (dropdown of presets)
- Custom (configure inline)

**Duration:**
- Time-based: slider 30s - 30 min
- Hit-based: slider 10 - 500
- Measure-based: slider 4 - 200
- Toggle between modes

**Targets (drill blocks):**
- Target accuracy: slider 1-100%
- Crush threshold: slider 1-100% (must be ≥ target)

**Conditional Flow:**
- On Fail: repeat / continue / slower
  - If repeat: max repeats slider 1-10
  - If slower: BPM step slider 1-20, min BPM
- On Crush: skip / faster / continue
  - If faster: BPM step slider 1-20, max BPM

**Tempo:**
- Use plan's current BPM (if linked to plan)
- Override BPM: manual entry

**Detection Overrides (per-block):**
- Inherit from plan / Inherit from global / Custom
- If custom: all detection sliders (scoring window, accent, flam, noise floor)

**Recording:**
- Auto-record: toggle
- Count-in bars: 0-4

**Rest:**
- Rest after block: 0-120s

**[Reset Block to Defaults]** — resets all parameters to BLOCK_DEFAULTS

### Routine Runner

Activated by tapping START on a routine:

**Replaces PLAY screen temporarily. Back button exits routine (with confirmation if in progress).**

**Pre-run screen:**
```
┌──────────────────────────────────────┐
│  Monday Rudiments                    │
│  4 blocks · ~25 min est.            │
│                                      │
│  1. Warmup — Singles — 80 BPM — 2m  │
│  2. Drill — Paradiddles — 112 BPM   │
│  3. Drill — Jazz Comping — 95 BPM   │
│  4. Cooldown — Free — 70 BPM — 3m  │
│                                      │
│  [▶ BEGIN]         [Cancel]          │
└──────────────────────────────────────┘
```

**During block:**
```
┌──────────────────────────────────────┐
│  Block 2/4: DRILL · Paradiddles      │
│  ████████░░░░ 1:24 remaining         │
│                                      │
│  [normal metronome dial view]        │
│  [live waveform + onset dots]        │
│                                      │
│  Live: 74%    Target: 80%            │
│  Hits: 34/41 scored                  │
│                                      │
│  [◀ Prev]  [⏸ Pause]  [Skip ▶]     │
└──────────────────────────────────────┘
```

**Between blocks (rest screen):**
```
┌──────────────────────────────────────┐
│  Block 2 Complete                    │
│                                      │
│  Paradiddles @ 112 BPM               │
│  Accuracy: 74%   [BELOW TARGET 80%]  │
│  Action: REPEATING (attempt 2/3)     │
│                                      │
│  ────── REST ──────                  │
│         0:07                         │
│                                      │
│  Next: Paradiddles (retry) @ 112 BPM │
│                                      │
│  [Skip Rest]  [Skip Block]  [Pause]  │
└──────────────────────────────────────┘
```

OR if passed/crushed:
```
│  Accuracy: 96%   [CRUSHED! ≥95%]     │
│  Action: ADVANCING to 117 BPM        │
│                                      │
│  Next: Jazz Comping @ 95 BPM         │
```

**Post-routine summary:**
```
┌──────────────────────────────────────┐
│  ✓ Monday Rudiments Complete         │
│  Total: 24 min · Avg: 78%           │
│                                      │
│  Block 1  Warmup    —    (no score)  │
│  Block 2  Paradiddles  74%  ×2 rpts  │
│           → advanced to 117 BPM      │
│  Block 3  Jazz Comping 82%  passed   │
│  Block 4  Cooldown     —   (no score)│
│                                      │
│  vs Last Run (Mar 1):                │
│  Block 2: 74% → 74% (=) BPM 112→117↑│
│  Block 3: 78% → 82% (+4%) ↑         │
│                                      │
│  [View Sessions]  [Done]             │
└──────────────────────────────────────┘
```

---

## Practice Tab — Sessions View

Existing session list + detail, but with rebuilt chart system.

### Session Detail — Rebuilt Layout

**Layer 1: Summary Bar (sticky top)**
- Accuracy %, BPM, meter, date, plan badge, instrument badge
- Scored/total, avg delta, std dev — compact stat row
- Recording player inline (play/pause, volume, download)

**Layer 2: Chart Selector (sticky tabs)**
Horizontal scrollable tabs:

```
DISTRIBUTION | DRIFT | BEAT MAP | DYNAMICS | TEMPO | FATIGUE
```

Active tab highlighted. Swipe or tap to switch.

**Layer 3: Chart Area (selected chart, interactive)**
- Full width, 150-200px height (was 70-90)
- Pinch-to-zoom (horizontal), pan when zoomed
- Tap data point → tooltip with details
- Beat grid overlay toggle
- Scoring window markers toggle
- Instrument color coding (when profile active)

**Per-chart controls:**
- DISTRIBUTION: nothing extra (zoom is enough)
- DRIFT: toggle rolling average, tap point for detail
- BEAT MAP: subdivision selector (re-analyze), instrument toggle
- DYNAMICS: noise floor + accent threshold (draggable on chart)
- TEMPO: expected interval line, toggle absolute vs deviation view
- FATIGUE: window size selector (5/10/20 hits per bucket)

**Layer 4: Detection Filters (collapsible bottom drawer)**
- Slides up from bottom, overlays chart area
- All detection filter sliders
- Subdivision override
- Noise floor
- "Apply to Plan" / "Apply to Global" buttons

**Instrument in Charts:**
- Save instrument classification per raw onset
- BEAT MAP: color by instrument (snare=green, kick=blue, hat=gold, tom=purple)
- DYNAMICS: dot shape by instrument (circle, square, triangle, diamond)
- Summary stats: per-instrument accuracy breakdown
- Filter toggle: show/hide specific instruments

---

## Settings — Rebuilt

### Category Structure

```
SETTINGS
├── SOUNDS & SAMPLES
│   ├── Click Sound [grid with waveform preview per sample]
│   ├── Click Volume ═══════●═══ 80%
│   ├── Playback Volume ════●═══ 100%
│   └── [Reset Sounds]
│
├── RECORDING
│   ├── Click in Recording ════●══ 70%
│   ├── Mic in Recording ══●══════ 50%
│   ├── Live Boost ════●══════════ 2x
│   ├── Recording Sync ═●════════ 40ms
│   ├── Info: signal chain explanation
│   └── [Reset Recording]
│
├── DETECTION
│   ├── Sensitivity ═══●═════════ 15%
│   ├── Scoring Window ══●══════ ±20ms
│   ├── Accent Threshold ═●═════ 3x
│   ├── Flam Window ═══●════════ 15ms
│   ├── Noise Floor ●══════════ Off
│   ├── Latency Offset ●═══════ 0ms
│   ├── [CALIBRATE DELAY]
│   └── [Reset Detection]
│
├── INSTRUMENT PROFILES
│   ├── Active Profile: [None / Snare / Kick / ...]
│   ├── [Capture New Profile]
│   ├── Saved profiles with spectral fingerprint vis
│   ├── Per-instrument stats from recent sessions
│   └── [Delete All Profiles]
│
├── VIBRATION
│   ├── Intensity ═══●═══════ 100%
│   ├── Delay Offset ═●══════ 0ms
│   ├── [Test Vibration]
│   └── [Reset Vibration]
│
└── DATA & EXPORT
    ├── Export All Data (JSON)
    ├── Import Data
    ├── Clear All Sessions
    ├── Clear All Recordings (IDB)
    ├── [RESTORE DEFAULTS] (all settings → factory)
    └── [FACTORY RESET] (everything — requires typing "RESET")
```

### Settings Override Hierarchy

```
Global Settings (Settings tab)
  ↓ overridden by
Practice Plan Settings (per-plan detection overrides)
  ↓ overridden by  
Routine Block Settings (per-block detection overrides)
  ↓ overridden by
Post-Recording Re-analysis (session detail sliders)
```

Each level shows what it's inheriting from and what it's overriding. "null" = inherit from parent level.

---

## Data Migration (v11 → v12)

### Projects → Plans

```javascript
// For each existing project:
newPlan = {
  id: project.id,
  name: project.name,
  color: project.color,
  icon: '🥁',
  description: '',
  startBpm: 80,          // default, user can edit
  goalBpm: 160,          // default, user can edit
  currentBpm: /* from most recent session's BPM */ ,
  accuracyTarget: 80,
  scoringWindow: null,    // inherit global
  accentThreshold: null,
  flamWindow: null,
  noiseFloor: null,
  subdivision: null,
  autoAdvance: false,     // off until user enables
  advanceAfterN: 3,
  bpmStep: 5,
  consecutiveCount: 0,
  preset: /* from first linked preset or default */,
  sessionIds: project.sessionIds,
  progressHistory: /* build from existing sessions */,
}
```

### Setlists → Routines

```javascript
// For each existing setlist:
newRoutine = {
  id: setlist.id,
  name: setlist.name,
  icon: '🎵',
  schedule: [],
  blocks: setlist.steps.map(step => ({
    id: generateId(),
    type: 'drill',
    label: step.presetName,
    planId: null,
    presetId: step.presetId,
    durationSec: step.duration || 120,
    targetAccuracy: step.targetAccuracy || 80,
    crushThreshold: 95,
    onFail: 'continue',
    onCrush: 'continue',
    maxRepeats: 3,
    slowerStep: 5,
    fasterStep: 5,
    bpmOverride: step.bpm || null,
    restSec: 10,
    autoRecord: true,
    countInBars: 1,
    // detection overrides all null (inherit)
  })),
  runs: /* build from existing setlist run history */,
}
```

### Sessions

```javascript
// For each session with projectId:
session.planId = session.projectId;  // rename field
delete session.projectId;
```

### Migration Flag

```javascript
if (!LS.g('pp_v12_migrated')) {
  migrateProjectsToPlans();
  migrateSetlistsToRoutines();
  migrateSessionLinks();
  LS.s('pp_v12_migrated', true);
}
```

---

## Detection Override Resolution

When recording or analyzing, the app resolves detection parameters through the hierarchy:

```javascript
function resolveDetection(globalSettings, plan, block) {
  return {
    scoringWindow: block?.scoringWindow 
      ?? plan?.scoringWindow 
      ?? globalSettings.scW,
    accentThreshold: block?.accentThreshold 
      ?? plan?.accentThreshold 
      ?? globalSettings.acT,
    flamWindow: block?.flamWindow 
      ?? plan?.flamWindow 
      ?? globalSettings.fmW,
    noiseFloor: block?.noiseFloor 
      ?? plan?.noiseFloor 
      ?? 0,
    sensitivity: plan?.sensitivity 
      ?? globalSettings.sns,
  };
}
```

Session saves the RESOLVED values (what was actually used) so post-recording re-analysis initializes correctly.

---

## Build Phases

### Phase 1: Navigation + Data Migration
- 3-tab navigation (Play / Practice / Settings)
- PracticePlan data model + localStorage
- Routine data model + localStorage
- Migration code (projects → plans, setlists → routines)
- Session planId migration
- Basic plan list view (read-only, no creation yet)
- Basic routine list view (read-only)
- Session list moved under Practice > Sessions tab

### Phase 2: Routines (user priority: #2)
- Routine editor (block CRUD, reorder, reset)
- Block editor (all parameters)
- Routine runner (block-by-block execution)
- Conditional flow engine (repeat/skip/slower/faster)
- Rest screens with countdown
- Run summary + comparison to previous runs
- Auto-record per block
- Count-in per block
- Per-block detection override resolution
- Block reset + routine reset

### Phase 3: Practice Plans (user priority: #3)
- Plan creation / edit form
- Plan detail view with progress graph
- "Start Practice" → auto-load + record
- Auto-advance logic (after session save)
- Weak beat identification (aggregate per-beat analysis)
- Per-plan detection overrides
- Plan reset (progress, sessions, overrides, delete)
- Streak tracking + display

### Phase 4: Session Analytics Rebuild (user priority: #4)
- Tabbed chart selector (replaces stacked cards)
- Increased chart height (150-200px)
- Pinch-to-zoom + pan on charts
- Tap-to-tooltip on data points
- Instrument color coding in charts
- Per-instrument accuracy breakdown
- Beat grid overlay toggle
- Collapsible filter drawer (bottom sheet)

### Phase 5: Settings Rebuild (user priority: #5)
- Category-based layout with sections
- Sound preview with waveform display
- Instrument profile section
- Per-category reset buttons
- Detection visualization
- Full factory reset with confirmation
- Settings override hierarchy display

---

## File Inventory

```
index.html          — main app (single file, ~1300 lines at v11.26)
sw.js               — service worker (network-first for HTML)
manifest.json       — PWA manifest
V12-ARCHITECTURE.md — this document
```

---

## Constants Reference

### System Defaults (v11.26)

```javascript
DEFS = {
  vol: .8,
  sns: .15,
  lO: 0,
  rDl: 40,
  vbI: 1,
  vbD: 0,
  rcV: .7,
  rmV: .5,
  lBst: 2,
  pbVol: 1,
  fmW: 15,
  scW: 20,
  acT: 3
}
```

### Block Defaults

```javascript
BLOCK_DEFAULTS = {
  type: 'drill',
  durationSec: 120,
  hitCount: null,
  measures: null,
  targetAccuracy: 80,
  crushThreshold: 95,
  scoringWindow: null,
  accentThreshold: null,
  flamWindow: null,
  noiseFloor: null,
  onFail: 'continue',
  onCrush: 'continue',
  maxRepeats: 3,
  slowerStep: 5,
  fasterStep: 5,
  bpmOverride: null,
  bpmMin: null,
  bpmMax: null,
  restSec: 10,
  autoRecord: true,
  countInBars: 1,
}
```

---

## Open Questions (to resolve during build)

1. **Gig setlists vs practice routines:** Do we need a separate "gig mode" with no scoring, just click + transitions? Or is a routine with all blocks set to 'free' type sufficient?

2. **Metronome state during routine:** Does the metronome preserve its state after routine ends, or revert to what was loaded before? Probably revert.

3. **Session detail navigation from routine summary:** Tap a block result → opens session detail. Back button returns to summary? Or to sessions list?

4. **Offline support:** Current SW caches CDN assets. Do we need offline support for practice plans/routines? They're in localStorage so they work, but what about the recording IDB?

5. **Data size:** rawOnsets at 800 per session × 50 sessions = 40K objects in localStorage. May need to consider IndexedDB for sessions too at some point.
