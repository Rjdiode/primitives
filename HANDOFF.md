# Primitives — handoff

Trackpad-first drafting canvas: snap grid, rulers/guides, protractor, primitives, line/stroke between guide crossings, key-driven cross-hatch brush + eraser.

**Repo:** https://github.com/Rjdiode/primitives  
**Stack:** Vanilla HTML/CSS/JS — no build step, no framework, no ES modules (works on `file://`).

---

## Run locally

```bash
cd primitives
python3 -m http.server 8080
# open http://localhost:8080
```

Or open `index.html` directly in a browser (`<script src="app.js">`, not `type="module"`).

---

## Files

| File | Role |
|------|------|
| `index.html` | Toolbar, workspace (canvas + rulers), footer hints |
| `styles.css` | Dark drafting UI; `--ruler-size: 28px`; ruler/canvas layout |
| `app.js` | All logic (~2920 lines) |

---

## Tools & shortcuts

| Key | Tool | Interaction |
|-----|------|-------------|
| `V` | Select & move | Click shape; **drag to move** (live X/Y + ΔX/ΔY readout, snaps to guides/objects/grid); **click an already-selected shape to “pick it up”** — no-button move, type X/Y or ΔX/ΔY (`Tab` switches field), click or `Enter` to drop, `Esc` cancels. Drag marquee on empty; Shift toggles multi-select |
| `P` | Stroke | **Single click on a guide segment** — the span between the two adjacent crossings/vertices the cursor is bracketing on whichever guide it hovers; hover highlights it, click draws it |
| `L` | Line | **Two-click** crossings: click first crossing, then a second crossing on the same guide (straight segment primitive) |
| `T` | Protractor | Click grid/vertex → scroll/drag rotate (15°) → click place angled guide |
| ~~`B`~~ | ~~Brush (cross-hatch)~~ | **Disabled for now** (`HATCH_ENABLED=false`). Code intact; buttons in `#hatch-tools[hidden]`, keys `b`/`x` removed from `TOOL_KEYS`, `setTool` redirects to select, `isBrushTool()` returns false. Flip the flag + unhide to restore |
| ~~`X`~~ | ~~Eraser~~ | **Disabled for now** — see above |
| `A` | Text | **Click empty** → drops a standalone label (creates its own grid vertex on commit). **Click a shape** → attaches a label to it. Type to edit (`Shift`+`Enter` newline, `Enter` commit, `Esc` cancel/discard-if-empty). Also: **`Tab` while any object is selected** spawns an attachment on it and starts typing |
| — | Rect / Square / Ellipse / Circle | Click first corner → move to size → type exact dims (Tab switches W/H) → click or `Enter` to commit. Live W/H (S / ⌀) dimensions shown; `Esc` cancels; “from center” toggle |
| `G` `G` | Grid & units panel | Double-press `g` opens a floating popover: **unit** (px / thou / mm), **grid size** (in the active unit), **grid snap**, **object snap**. `Esc` or click-away closes; second `g g` toggles |
| `Space` + drag | Pan | Middle-click also pans |
| Pinch / scroll | Zoom | Trackpad scroll pans when not in protractor rotate |
| `Shift` + ruler click | — | Remove nearest H/V guide |
| `⌫` | — | Delete selected shapes |

**Rulers:** left = horizontal guides (`guidesH`), bottom = vertical guides (`guidesV`). Hover shows dotted preview; **click empty space places** a guide; **click on (or within `SNAP_RADIUS` of) an existing guide picks it up to edit** — it's lifted out of its array and the exact-entry buffer is seeded with its current value (`dimEntryReplace` so the first keystroke types fresh; backspace edits in place). Type a number any time a preview is showing for an exact value; `Enter` places, `Esc` cancels (and restores a lifted guide). Ruler tick labels and the dimension readout are shown in the active unit.

Every placed guide also gets a **teal position-value chip at its base on its ruler** (`drawGuideBaseLabels` → `drawRulerGuideChip`, drawn in `drawRulers`): horizontal guides → left ruler (world-Y), vertical guides → bottom ruler (world-X); the selected guide's chip turns accent. Clicking a chip is just a ruler click on that guide, so it routes through `handleRulerDown`'s edit path — pick up, retype, `Enter`.

**Protractor flow:**
1. First click: `findVertexAt()` or `addGridVertex()` (grid-snapped) → amber preview arm
2. Rotate: trackpad scroll or pointer drag; snaps to 15° steps
3. Second click: permanent purple angled guide via `placeProtractorGuide()`
4. `_protractorArmPending` blocks same pointer-down from activate + place

**Line/Stroke:** both build on crossings from `getCrossings()`.
- **Line** is the two-click flow: `handleSegmentClick` sets `segmentStart`, then the second click's point (`snapSegmentPoint` → `crossingsOnGuideFrom`) must share a guide with the first (`crossingSharesGuideWith`).
- **Stroke** is single-click-on-segment: `segmentUnderCursor(worldPt)` finds the guide the cursor is within `6/zoom` of, collects the crossings lying on that guide, sorts them by position along it, and returns the adjacent pair (`{a,b}`) bracketing the cursor — or null. Hover stores it in `state.segmentSpan` (highlighted by `drawSegmentPreview`); a click `addSegment(a,b)`s it directly. Works for H, V, and angled guides.

**Brush / Eraser (cross-hatch):**
- Paradigm: **trackpad = motion only, number keys = pen-down.** No clicking — `onPointerDown` early-returns for these tools (`isBrushTool()`). Painting/erasing happens in `handleBrushMove()` off `pointermove`, gated by `state.brushAngleKey` / `state.eraserDown`.
- Keys `1`/`2`/`3`/`4` → `HATCH_ANGLES` `0`/`45°`/`90°`/`135°`. ⚠️ Key `1` maps to angle **`0`** (falsy) — guards use `e.key in HATCH_ANGLES`, never `!HATCH_ANGLES[e.key]`.
- `stampHatch(cx, cy, ang)` fills the brush rectangle (`BRUSH_THICK` along the hatch × `BRUSH_LEN` ⟂) with marks snapped to a **per-angle lattice** keyed `angleIdx:lineIdx:cellIdx`. The lattice is intrinsic to the hatch (spacing `HATCH_SPACING`), **independent of the document grid** — that's what "not grid-locked" means here, and what keeps overlapping passes crisp + de-duped (`state.hatchKeySet`).
- `stampStroke` / `eraseStroke` interpolate along the pointer path (`BRUSH_STEP`) so fast moves leave no gaps. `eraseAt(p)` drops any mark whose midpoint is inside the `ERASER_SIZE` square.
- Marks live in `state.hatches` (`{key,x1,y1,x2,y2}`), a separate ink layer — **not** in `shapes`, so select/move/marquee ignore them; only the eraser removes them. Rendered in one batched path by `drawHatches()`. `drawBrushPreview()` draws the cursor footprint (rotated rect for brush, square for eraser).
- Verified via Playwright drive (`pointermove` + `keyboard.down/up`); see git history.

**Text annotations (`A`):**
- A text item is a **shape** (`{ type:'text', x, y, text, attachTo }`) stored in `state.shapes`, so it reuses select / move / marquee / delete for free. `(x, y)` is the box's top-left in world space; the box scales with zoom like every other primitive.
- **Two anchoring modes:** `attachTo: null` (standalone — drops its own grid vertex via `addGridVertex` on commit, satisfying "create its own vertex") vs. `attachTo: <shapeId>` (rides along when its parent moves and draws a faint dashed leader to it). Attached text travels with its parent because `beginShapeDrag` adds any text whose `attachTo` is in `selectedIds` to `dragOriginals`. Deleting a shape cascades to its attached texts.
- **Live editing:** `state.textEditing = { id, vertexAnchor }`. `handleTextKey()` runs **first** in `onKeyDown` and consumes every key (so tool-letter shortcuts go into the text, not the toolbar). Committing empty text removes the item. Clicking anywhere, or switching tools, commits.
- **Creation entry points:** text-tool click → `createStandaloneText` / `createAttachedText` / `startEditText` (edit existing); `Tab` on a selection → `createAttachedText` on the first non-text selected shape.
- Verified via Playwright drive (20 checks: all three creation paths, attached-follows-move, cascade delete, empty-discard).

---

## Core state (`app.js`)

```javascript
state = {
  tool, shapes[], selectedIds,
  guidesH[], guidesV[], guidesAngle[],
  vertices[],              // user-placed grid anchor points (protractor)
  previewGuide,            // ruler hover preview
  protractorVertex, protractorAngle, protractorActive,
  _protractorArmPending, _protractorPointer,
  segmentStart, segmentHover,
  snapGrid, snapObject, drawFromCenter,
  unit, gridPanelOpen, _lastGPress,   // active display unit + grid/units panel (g g)
  dimEntry, dimEntryReplace,          // exact ruler-guide entry; replace=seeded-on-edit
  panX, panY, zoom,
  hatches[], hatchKeySet,   // cross-hatch ink layer + lattice-key de-dupe set
  brushAngleKey, brushAngle, brushLast,   // brush pen-down state
  eraserDown, eraserLast,   // eraser pen-down state
  textEditing,              // { id, vertexAnchor } while a text item is being typed
  // drawing / marquee / pan flags...
}
```

Text items are not a separate array — they live in `shapes[]` as `{ type:'text', x, y, text, attachTo }`.

**Constants:** `GRID_SIZE=20` (mutable `let`), `MIN_GRID=2`, `RULER_SIZE=28`, `CROSSING_RADIUS=12`, `PROTRACTOR_STEP_DEG=15`, `MIN_ZOOM=0.1`, `MAX_ZOOM=8`, `PX_PER_INCH=100`, `UNITS{px,thou,mm}`, `G_DOUBLE_MS=500`.
**Brush:** `HATCH_ANGLES{1:0,2:45°,3:90°,4:135°}`, `HATCH_SPACING=6`, `HATCH_CELL=6`, `BRUSH_LEN=46` (⟂ extent), `BRUSH_THICK=20` (along-hatch), `BRUSH_STEP=5`, `ERASER_SIZE=30`.

---

## Guide & crossing math

- `getCrossings()` — deduped intersection points:
  - H × V ruler guides
  - Angled × H, angled × V, angled × angled
  - `state.vertices` (grid-dropped protractor anchors)
- Teal dots drawn at all crossings; used by protractor, line, stroke.
- `addGridVertex(worldPt)` — `snapToGrid()`, dedupe by `crossingKey`, push to `vertices`.
- Angled guide: `{ x, y, angle }` anchored at vertex.

---

## Units & dimensions

World coordinates are **pixels**; the physical scale is fixed at **`PX_PER_INCH = 100`** (100 world px = 1 inch), so units are just re-expressions of the same world length. `state.unit` ∈ `px | thou | mm`; `UNITS[unit] = { label, factor, decimals }` where `factor` is **world px per 1 display unit** (px → 1, thou → 0.1, mm → 100/25.4 ≈ 3.937).

Two conversion boundaries, both crossed by one pair of inverse helpers so a typed value round-trips back to the same world coordinate:
- **origin** — sign of the Y axis (`originCorner`; X is always rightward-positive).
- **unit** — `pxToUnit` / `unitToPx`.

| Direction | Function | Returns |
|-----------|----------|---------|
| world → display | `worldToDim(axis, worldVal)` | origin-signed, unit-scaled number |
| display → world | `dimToWorld(axis, dimVal)` | world px |
| format a display number | `formatDim(v)` | string at the unit's `decimals` |
| format a raw world length | `fmtLen(px)` = `formatDim(pxToUnit(px))` | string |

**Rule of thumb:** anything that is a *typed/shown measurement* (guide values, shape W/H/S/⌀, X/Y/Δ move readout, ruler labels) goes through these. Raw geometry (shape coords, hatch lattice, snap math, `GRID_SIZE`) stays in world px. When adding a new readout, format world px via `fmtLen`/`fmtSigned`-equivalent and append `unitLabel()`; when parsing a typed field, `unitToPx` it.

`GRID_SIZE` is now a **mutable `let`** (default 20 px, floor `MIN_GRID`), changed via `setGridSize(px, refreshGridInput?)`. The grid-size field is entered in the active unit. `syncControls(refreshGridInput=true)` is the single source-of-truth fan-out to every DOM control (toolbar + panel checkboxes, unit select, grid field, unit label) — call it after any unit/grid/snap state change. `refreshGridInput=false` only while the user is typing into the grid field (so live input isn't clobbered); a unit change always refreshes it.

**Grid panel (`g g`):** `openGridPanel` / `closeGridPanel` / `toggleGridPanel`. Double-`g` is detected in `onKeyDown` via `state._lastGPress` + `G_DOUBLE_MS`; the opening keystroke is `preventDefault`ed so it doesn't land in the auto-focused (number) grid-size field — a `type=number` input silently blanks itself on a non-numeric key. All panel `focus()` calls pass `{ preventScroll: true }`, and `#app` is `overflow:hidden`, so focusing controls can't scroll the over-wide canvas and shove the rulers off-screen.

---

## Key functions (grep targets)

| Area | Functions |
|------|-----------|
| Coords | `screenToWorld`, `worldToScreen`, `drawAreaSize`, `rawWorld{X,Y}FromClient*` (unsnapped), `world{X,Y}FromClient*` (grid-snapped) |
| Units/dims | `worldToDim`, `dimToWorld`, `formatDim`, `fmtLen`, `pxToUnit`, `unitToPx`, `unitDef`, `unitLabel`, `setUnit`, `setGridSize`, `syncControls` |
| Grid panel | `openGridPanel`, `closeGridPanel`, `toggleGridPanel`, `setSnapGrid`, `setSnapObject` |
| Guides | `addGuide`, `removeGuide`, `removeNearestGuide`, `nearestGuideValue` (ruler edit hit-test), `bindRuler`, `handleRulerDown`, `drawGuides`, `drawGuideBaseLabels` / `drawRulerGuideChip` (ruler base value chips) |
| Crossings | `getCrossings`, `nearestCrossing`, `crossingSharesGuideWith`, `crossingsOnGuideFrom`, `segmentUnderCursor` (stroke segment-click) |
| Protractor | `activateProtractor`, `placeProtractorGuide`, `setProtractorAngleFromPointer`, `handleProtractorWheel` |
| Snap | `snapToGrid`, `applySnap`, `findVertexAt`, `addGridVertex` |
| Shapes | `addSegment`, shape draw helpers, marquee select |
| Brush/Eraser | `stampHatch`, `stampStroke`, `eraseAt`, `eraseStroke`, `handleBrushMove`, `handleBrushKeyDown/Up`, `isBrushTool`, `drawHatches`, `drawBrushPreview` |
| Text | `createStandaloneText`, `createAttachedText`, `startEditText`, `commitText`, `handleTextKey`, `measureTextShape`, `drawTextShape`, `drawTextConnector` |
| Input | `onPointerDown/Move/Up`, `onWheel`, `onKeyDown`, `setTool` |

---

## Architecture notes

- **Single canvas** for grid, shapes, guides, crossings, protractor preview.
- **Rulers** are DOM overlays; guide placement uses `worldYFromClientY` / `worldXFromClientX`.
- **Toolbar** uses event delegation on `#tools` (`pointerdown` on `.tool`) — fixes `file://` + non-module script load.
- **Shape types:** `line`, `rect`, `square`, `ellipse`, `circle`, `stroke`, `text` (legacy `pencil` still in bounds code).
- **Cross-hatch ink** lives in `state.hatches`, a layer parallel to `shapes` — only the eraser touches it; not selectable/movable. **Painting is currently disabled** (`HATCH_ENABLED=false`); the layer/code remain.
- **No persistence** — refresh clears canvas state (hatches included).
- **No tests** in repo.

---

## Recent work (session)

1. Ruler/guide system replaced freehand pencil.
2. Protractor: click-activate / click-place (removed hold-`R`).
3. Angled guide crossings wired into `getCrossings()`.
4. Protractor can drop a vertex **anywhere on the snap grid** (`vertices[]` + `addGridVertex`), not only at existing crossings.
5. Cross-hatch **brush** (`B`) + **eraser** (`X`): trackpad-motion / key-pen-down model, lattice-snapped marks in `state.hatches`. Caught the falsy-`0` angle guard bug during a Playwright drive.
6. **Units (px / thou / mm)** + mutable grid, exposed in a **`g g` floating panel**; all typed/shown measurements route through `worldToDim`/`dimToWorld`/`fmtLen`. **Ruler guides are editable** — click an existing one (or its base value-chip on the ruler) to lift + retype its position. **Toolbar wraps** so right-edge controls stay reachable. **Hatch painting disabled** behind `HATCH_ENABLED`. Verified via Playwright (panel open/close, unit round-trips, grid resize, snap sync, guide place/edit/replace, shape dims in thou, ruler chips, brush inert). Caught three bugs in the drive: unit switch not refreshing the focused grid field, the opening `g` blanking the number input, and focus-scroll shoving the rulers off-screen. **Merged to `main` via PR #1** (`a89cc93`).

---

## Likely next steps

- Persist guides/shapes/vertices **and unit/grid settings** (localStorage or file export).
- Undo/redo.
- Calibratable `PX_PER_INCH` (currently fixed at 100) — e.g. a DPI field in the grid panel for bench work.
- Move/delete angled guides and grid vertices.
- Snap line/stroke endpoints to shape vertices as well as guide crossings.
- Touch / stylus polish.

---

## GitHub

- Account used for push: **Rjdiode** (CLI authenticated).
- Request was “repo on rjd”; GitHub user `rjd` exists but is not the logged-in account. Repo created as `Rjdiode/primitives`. Transfer or re-auth as `rjd` if a different owner is required.
- **PR #1** (units / grid panel / editable ruler guides / disable hatch painting) merged to `main` — merge commit `a89cc93`; feature branch `guide-units-grid-panel` deleted local + remote.
