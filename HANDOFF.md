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
| `app.js` | All logic (~1425 lines) |

---

## Tools & shortcuts

| Key | Tool | Interaction |
|-----|------|-------------|
| `V` | Select & move | Click shape; **drag to move** (live X/Y + ΔX/ΔY readout, snaps to guides/objects/grid); **click an already-selected shape to “pick it up”** — no-button move, type X/Y or ΔX/ΔY (`Tab` switches field), click or `Enter` to drop, `Esc` cancels. Drag marquee on empty; Shift toggles multi-select |
| `P` | Stroke | Click two guide crossings on the same guide |
| `L` | Line | Same as stroke (straight segment primitive) |
| `T` | Protractor | Click grid/vertex → scroll/drag rotate (15°) → click place angled guide |
| `B` | Brush (cross-hatch) | Trackpad moves the brush; **hold `1`/`2`/`3`/`4`** to ink hatches at 0°/45°/90°/135° (the held key is pen-down). Release to lift. No clicking. Rectangular brush oriented ⟂ to the hatch. Not grid-locked |
| `X` | Eraser | Trackpad moves it; **hold any of `1`–`4`** and move to wipe hatch marks under a square footprint. Not grid-locked |
| — | Rect / Square / Ellipse / Circle | Click first corner → move to size → type exact dims (Tab switches W/H) → click or `Enter` to commit. Live W/H (S / ⌀) dimensions shown; `Esc` cancels; “from center” toggle |
| `Space` + drag | Pan | Middle-click also pans |
| Pinch / scroll | Zoom | Trackpad scroll pans when not in protractor rotate |
| `Shift` + ruler click | — | Remove nearest H/V guide |
| `⌫` | — | Delete selected shapes |

**Rulers:** left = horizontal guides (`guidesH`), bottom = vertical guides (`guidesV`). Hover shows dotted preview; click places.

**Protractor flow:**
1. First click: `findVertexAt()` or `addGridVertex()` (grid-snapped) → amber preview arm
2. Rotate: trackpad scroll or pointer drag; snaps to 15° steps
3. Second click: permanent purple angled guide via `placeProtractorGuide()`
4. `_protractorArmPending` blocks same pointer-down from activate + place

**Line/Stroke:** require crossings from `getCrossings()`; second point must share a guide with first (`crossingSharesGuideWith`).

**Brush / Eraser (cross-hatch):**
- Paradigm: **trackpad = motion only, number keys = pen-down.** No clicking — `onPointerDown` early-returns for these tools (`isBrushTool()`). Painting/erasing happens in `handleBrushMove()` off `pointermove`, gated by `state.brushAngleKey` / `state.eraserDown`.
- Keys `1`/`2`/`3`/`4` → `HATCH_ANGLES` `0`/`45°`/`90°`/`135°`. ⚠️ Key `1` maps to angle **`0`** (falsy) — guards use `e.key in HATCH_ANGLES`, never `!HATCH_ANGLES[e.key]`.
- `stampHatch(cx, cy, ang)` fills the brush rectangle (`BRUSH_THICK` along the hatch × `BRUSH_LEN` ⟂) with marks snapped to a **per-angle lattice** keyed `angleIdx:lineIdx:cellIdx`. The lattice is intrinsic to the hatch (spacing `HATCH_SPACING`), **independent of the document grid** — that's what "not grid-locked" means here, and what keeps overlapping passes crisp + de-duped (`state.hatchKeySet`).
- `stampStroke` / `eraseStroke` interpolate along the pointer path (`BRUSH_STEP`) so fast moves leave no gaps. `eraseAt(p)` drops any mark whose midpoint is inside the `ERASER_SIZE` square.
- Marks live in `state.hatches` (`{key,x1,y1,x2,y2}`), a separate ink layer — **not** in `shapes`, so select/move/marquee ignore them; only the eraser removes them. Rendered in one batched path by `drawHatches()`. `drawBrushPreview()` draws the cursor footprint (rotated rect for brush, square for eraser).
- Verified via Playwright drive (`pointermove` + `keyboard.down/up`); see git history.

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
  panX, panY, zoom,
  hatches[], hatchKeySet,   // cross-hatch ink layer + lattice-key de-dupe set
  brushAngleKey, brushAngle, brushLast,   // brush pen-down state
  eraserDown, eraserLast,   // eraser pen-down state
  // drawing / marquee / pan flags...
}
```

**Constants:** `GRID_SIZE=20`, `RULER_SIZE=28`, `CROSSING_RADIUS=12`, `PROTRACTOR_STEP_DEG=15`, `MIN_ZOOM=0.1`, `MAX_ZOOM=8`.
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

## Key functions (grep targets)

| Area | Functions |
|------|-----------|
| Coords | `screenToWorld`, `worldToScreen`, `drawAreaSize` |
| Guides | `addGuide`, `removeGuide`, `bindRuler`, `drawGuides` |
| Crossings | `getCrossings`, `nearestCrossing`, `crossingSharesGuideWith`, `crossingsOnGuideFrom` |
| Protractor | `activateProtractor`, `placeProtractorGuide`, `setProtractorAngleFromPointer`, `handleProtractorWheel` |
| Snap | `snapToGrid`, `applySnap`, `findVertexAt`, `addGridVertex` |
| Shapes | `addSegment`, shape draw helpers, marquee select |
| Brush/Eraser | `stampHatch`, `stampStroke`, `eraseAt`, `eraseStroke`, `handleBrushMove`, `handleBrushKeyDown/Up`, `isBrushTool`, `drawHatches`, `drawBrushPreview` |
| Input | `onPointerDown/Move/Up`, `onWheel`, `onKeyDown`, `setTool` |

---

## Architecture notes

- **Single canvas** for grid, shapes, guides, crossings, protractor preview.
- **Rulers** are DOM overlays; guide placement uses `worldYFromClientY` / `worldXFromClientX`.
- **Toolbar** uses event delegation on `#tools` (`pointerdown` on `.tool`) — fixes `file://` + non-module script load.
- **Shape types:** `line`, `rect`, `square`, `ellipse`, `circle`, `stroke` (legacy `pencil` still in bounds code).
- **Cross-hatch ink** lives in `state.hatches`, a layer parallel to `shapes` — only the eraser touches it; not selectable/movable.
- **No persistence** — refresh clears canvas state (hatches included).
- **No tests** in repo.

---

## Recent work (session)

1. Ruler/guide system replaced freehand pencil.
2. Protractor: click-activate / click-place (removed hold-`R`).
3. Angled guide crossings wired into `getCrossings()`.
4. Protractor can drop a vertex **anywhere on the snap grid** (`vertices[]` + `addGridVertex`), not only at existing crossings.
5. Cross-hatch **brush** (`B`) + **eraser** (`X`): trackpad-motion / key-pen-down model, lattice-snapped marks in `state.hatches`. Caught the falsy-`0` angle guard bug during a Playwright drive.

---

## Likely next steps

- Persist guides/shapes/vertices (localStorage or file export).
- Undo/redo.
- Move/delete angled guides and grid vertices.
- Snap line/stroke endpoints to shape vertices as well as guide crossings.
- Touch / stylus polish.

---

## GitHub

- Account used for push: **Rjdiode** (CLI authenticated).
- Request was “repo on rjd”; GitHub user `rjd` exists but is not the logged-in account. Repo created as `Rjdiode/primitives`. Transfer or re-auth as `rjd` if a different owner is required.
