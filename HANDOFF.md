# Primitives — handoff

Trackpad-first drafting canvas: snap grid, rulers/guides, protractor, primitives, line/stroke between guide crossings.

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
| `V` | Select | Click shape; drag marquee; Shift toggles multi-select |
| `P` | Stroke | Click two guide crossings on the same guide |
| `L` | Line | Same as stroke (straight segment primitive) |
| `T` | Protractor | Click grid/vertex → scroll/drag rotate (15°) → click place angled guide |
| — | Rect / Square / Ellipse / Circle | Click-drag; optional “from center” toggle |
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
  // drawing / marquee / pan flags...
}
```

**Constants:** `GRID_SIZE=20`, `RULER_SIZE=28`, `CROSSING_RADIUS=12`, `PROTRACTOR_STEP_DEG=15`, `MIN_ZOOM=0.1`, `MAX_ZOOM=8`.

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
| Input | `onPointerDown/Move/Up`, `onWheel`, `onKeyDown`, `setTool` |

---

## Architecture notes

- **Single canvas** for grid, shapes, guides, crossings, protractor preview.
- **Rulers** are DOM overlays; guide placement uses `worldYFromClientY` / `worldXFromClientX`.
- **Toolbar** uses event delegation on `#tools` (`pointerdown` on `.tool`) — fixes `file://` + non-module script load.
- **Shape types:** `line`, `rect`, `square`, `ellipse`, `circle`, `stroke` (legacy `pencil` still in bounds code).
- **No persistence** — refresh clears canvas state.
- **No tests** in repo.

---

## Recent work (session)

1. Ruler/guide system replaced freehand pencil.
2. Protractor: click-activate / click-place (removed hold-`R`).
3. Angled guide crossings wired into `getCrossings()`.
4. Protractor can drop a vertex **anywhere on the snap grid** (`vertices[]` + `addGridVertex`), not only at existing crossings.

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
