// ─── Config ───────────────────────────────────────────────────────────────────
let GRID_SIZE = 20;           // grid pitch in world px — mutable via the grid panel (g g)
const MIN_GRID = 2;           // smallest allowed grid pitch (world px)
const RULER_SIZE = 28;

// ─── Units ──────────────────────────────────────────────────────────────────────
// World coordinates are pixels. 100 world px = 1 inch defines the physical scale, so
// imperial (thous = 0.001 in) and metric (mm) just re-express the same world length.
// `factor` is world px per 1 display unit; `decimals` controls display precision.
const PX_PER_INCH = 100;
const UNITS = {
  px:   { label: 'px',   factor: 1,                   decimals: 2 },
  thou: { label: 'thou', factor: PX_PER_INCH / 1000,  decimals: 0 },
  mm:   { label: 'mm',   factor: PX_PER_INCH / 25.4,  decimals: 2 },
};
const G_DOUBLE_MS = 500;      // window for the g-g double-press to open the grid panel
const SNAP_RADIUS = 10;
const CROSSING_RADIUS = 12;
const PROTRACTOR_STEP_DEG = 15;
const PROTRACTOR_STEP = (PROTRACTOR_STEP_DEG * Math.PI) / 180;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const DIM_ARROW = 9;          // arrowhead length, screen px
const DIM_LABEL_OFFSET = 12;  // label offset off the dimension line, screen px

// ─── Brush / cross-hatch ────────────────────────────────────────────────────────
// Hatch painting (brush + eraser) is disabled for now. Flip to true to restore the
// tools, their toolbar buttons (#hatch-tools), and the 'b'/'x' shortcuts.
const HATCH_ENABLED = false;
// Hatch keys pick the angle of the parallel lines; the brush rectangle is oriented
// perpendicular to them. Marks live on a per-angle lattice (intrinsic to the hatch,
// independent of the document grid) so repeated passes stay clean and de-duplicate.
const HATCH_ANGLES = { '1': 0, '2': Math.PI / 4, '3': Math.PI / 2, '4': (3 * Math.PI) / 4 };
const HATCH_ANGLE_IDX = { '1': 0, '2': 1, '3': 2, '4': 3 };
const HATCH_SPACING = 6;   // gap between parallel hatch lines (world px)
const HATCH_CELL = 6;      // length of one deposited mark along the line (world px)
const BRUSH_LEN = 46;      // brush extent perpendicular to the hatch (across the lines)
const BRUSH_THICK = 20;    // brush extent along the hatch (length laid down per stamp)
const BRUSH_STEP = 5;      // path interpolation step while dragging (world px)
const ERASER_SIZE = 30;    // eraser square footprint (world px)

// ─── Text annotations ───────────────────────────────────────────────────────────
const TEXT_SIZE = 14;   // font size (world px)
const TEXT_LINE = 18;   // line height (world px)
const TEXT_PAD = 5;     // padding inside the text box (world px)
const TEXT_FONT = 'IBM Plex Mono, monospace';

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  tool: 'select',
  shapes: [],
  selectedIds: new Set(),
  selectedGuide: null,       // { type:'h'|'v', value } | { type:'angle'|'vertex', ref }
  textEditing: null,         // { id, vertexAnchor } while a text item is being edited
  isDraggingShapes: false,
  isDraggingGuide: false,
  isCarrying: false,         // no-button "pick up" move (after clicking a selected shape)
  dragAnchor: null,          // world point where a drag began (pickup grab point)
  dragOriginals: null,       // Map<shapeId, geom> snapshot for shape moves
  dragGuideOrig: null,       // original guide value / anchor for cancel + delta
  dragSnapTarget: null,      // world point the moving selection snapped to (for feedback)
  movePrimaryId: null,       // shape whose X/Y is shown in the move readout
  moveEntry: null,           // { active, typed: { x|y|dx|dy: string } } during carry typing
  moveOffset: null,          // { dx, dy } current move offset (for readout)
  guidesH: [],
  guidesV: [],
  guidesAngle: [],
  vertices: [],
  previewGuide: null,
  protractorVertex: null,
  protractorAngle: null,
  protractorActive: false,
  _protractorArmPending: false,
  _protractorPointer: null,
  segmentStart: null,
  segmentHover: null,
  segmentSpan: null,         // stroke tool: guide segment under cursor {a,b} (single-click create)
  snapGrid: true,
  snapObject: true,
  drawFromCenter: false,
  unit: 'px',                // active display unit: 'px' | 'thou' | 'mm'
  gridPanelOpen: false,      // grid/snap popover visibility (g g)
  _lastGPress: -1,           // timestamp of last bare 'g' keydown (double-press detect)
  originCorner: 'top-left',  // 'top-left' | 'bottom-left' — dimension reference corner
  dimEntry: null,            // raw typed string while entering an exact guide dimension
  dimEntryReplace: false,    // true when dimEntry is seeded (guide edit) — first keystroke replaces
  panX: 0,
  panY: 0,
  zoom: 1,
  isDrawing: false,          // placing a primitive (click-move-click), awaiting commit
  isPanning: false,
  isMarquee: false,
  drawStart: null,
  drawCurrent: null,
  drawEntry: null,           // { active: fieldIndex, typed: { w|h|s|d: string } } during placement
  marqueeStart: null,
  marqueeCurrent: null,
  spaceHeld: false,
  activeSnap: null,
  _hoverWorld: null,
  hatches: [],               // deposited hatch marks: { key, x1, y1, x2, y2 }
  hatchKeySet: new Set(),    // lattice keys present in hatches (fast de-dupe)
  brushAngleKey: null,       // '1'..'4' while a hatch key is held (pen down), else null
  brushAngle: 0,             // last chosen hatch angle (radians) — drives the preview
  brushLast: null,           // last brush world point, for path interpolation
  eraserDown: false,         // true while an erase key is held
  eraserLast: null,          // last eraser world point, for path interpolation
};

// ─── DOM ──────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const workspace = document.getElementById('workspace');
const rulerV = document.getElementById('ruler-v');
const rulerH = document.getElementById('ruler-h');
const crosshair = document.getElementById('crosshair');
const snapIndicator = document.getElementById('snap-indicator');
const statusEl = document.getElementById('status');
const snapGridToggle = document.getElementById('snap-grid');
const snapObjectToggle = document.getElementById('snap-object');
const drawCenterToggle = document.getElementById('draw-center');
const gridPanel = document.getElementById('grid-panel');
const unitSelect = document.getElementById('unit-select');
const gridSizeInput = document.getElementById('grid-size-input');
const gridSizeUnit = document.getElementById('grid-size-unit');
const panelSnapGrid = document.getElementById('panel-snap-grid');
const panelSnapObject = document.getElementById('panel-snap-object');
const unitLabelBtn = document.getElementById('unit-label');
const undoBtn = document.getElementById('undo-btn');
const redoBtn = document.getElementById('redo-btn');
const saveBtn = document.getElementById('save-btn');
const openBtn = document.getElementById('open-btn');
const fileInput = document.getElementById('file-input');

let nextId = 1;

// ─── History (undo/redo) ──────────────────────────────────────────────────────
// Snapshot-based: each committed document change pushes the prior snapshot onto
// `past`. recordHistory() diffs against the current snapshot, so it's a no-op when
// nothing actually changed — safe to call liberally at commit points.
const history = { past: [], future: [], present: null, limit: 200 };
const STORAGE_KEY = 'primitives.doc.v1';

// The undoable / persisted document (geometry + ink). Settings/view ride along in
// the saved file but are not part of the undo snapshot.
function docData() {
  return {
    shapes: state.shapes,
    guidesH: state.guidesH,
    guidesV: state.guidesV,
    guidesAngle: state.guidesAngle,
    vertices: state.vertices,
    hatches: state.hatches,
    nextId,
  };
}

function docSnapshot() { return JSON.stringify(docData()); }

function maxShapeId() {
  return state.shapes.reduce((m, s) => Math.max(m, s.id || 0), 0);
}

function loadDocData(d) {
  state.shapes = d.shapes || [];
  state.guidesH = d.guidesH || [];
  state.guidesV = d.guidesV || [];
  state.guidesAngle = d.guidesAngle || [];
  state.vertices = d.vertices || [];
  state.hatches = d.hatches || [];
  state.hatchKeySet = new Set(state.hatches.map(h => h.key));
  nextId = Number.isFinite(d.nextId) ? d.nextId : maxShapeId() + 1;
  // Drop transient interaction state that may reference vanished ids.
  state.selectedIds = new Set();
  state.selectedGuide = null;
  state.segmentStart = state.segmentHover = state.segmentSpan = null;
  state.textEditing = null;
  state.isDrawing = state.isCarrying = state.isDraggingShapes = state.isDraggingGuide = false;
}

function initHistory() {
  history.past = [];
  history.future = [];
  history.present = docSnapshot();
  updateHistoryButtons();
}

function recordHistory() {
  const snap = docSnapshot();
  if (snap === history.present) return;          // nothing changed
  if (history.present !== null) history.past.push(history.present);
  if (history.past.length > history.limit) history.past.shift();
  history.present = snap;
  history.future = [];
  autosave();
  updateHistoryButtons();
}

function undo() {
  if (!history.past.length) return;
  history.future.push(history.present);
  history.present = history.past.pop();
  loadDocData(JSON.parse(history.present));
  afterHistoryRestore();
}

function redo() {
  if (!history.future.length) return;
  history.past.push(history.present);
  history.present = history.future.pop();
  loadDocData(JSON.parse(history.present));
  afterHistoryRestore();
}

function afterHistoryRestore() {
  autosave();
  updateHistoryButtons();
  snapIndicator.hidden = true;
  updateStatus();
  render();
}

function updateHistoryButtons() {
  if (undoBtn) undoBtn.disabled = history.past.length === 0;
  if (redoBtn) redoBtn.disabled = history.future.length === 0;
}

// ─── Save / load (file + localStorage) ────────────────────────────────────────
function clampZoom(z) { return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z)); }

function serializeDocument() {
  return {
    type: 'primitives-document',
    version: 1,
    ...docData(),
    settings: {
      unit: state.unit,
      gridSize: GRID_SIZE,
      snapGrid: state.snapGrid,
      snapObject: state.snapObject,
      originCorner: state.originCorner,
    },
    view: { panX: state.panX, panY: state.panY, zoom: state.zoom },
  };
}

function applyDocument(doc, { restoreView = true } = {}) {
  loadDocData(doc);
  const s = doc.settings || {};
  if (s.unit && UNITS[s.unit]) state.unit = s.unit;
  if (Number.isFinite(s.gridSize)) GRID_SIZE = Math.max(MIN_GRID, s.gridSize);
  if (typeof s.snapGrid === 'boolean') state.snapGrid = s.snapGrid;
  if (typeof s.snapObject === 'boolean') state.snapObject = s.snapObject;
  if (s.originCorner) state.originCorner = s.originCorner;
  if (restoreView && doc.view) {
    if (Number.isFinite(doc.view.panX)) state.panX = doc.view.panX;
    if (Number.isFinite(doc.view.panY)) state.panY = doc.view.panY;
    if (Number.isFinite(doc.view.zoom)) state.zoom = clampZoom(doc.view.zoom);
  }
  const lbl = document.getElementById('origin-label');
  if (lbl) lbl.textContent = `Origin: ${state.originCorner === 'bottom-left' ? 'bottom-left' : 'top-left'}`;
  syncControls();
}

function autosave() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeDocument())); } catch (e) { /* quota/full */ }
}

function restoreAutosave() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    applyDocument(JSON.parse(raw));
    return true;
  } catch (e) { return false; }
}

function fileStamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function saveToFile() {
  const json = JSON.stringify(serializeDocument(), null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `primitives-${fileStamp()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  flashStatus('Saved to file');
}

function openFileDialog() {
  if (fileInput) fileInput.click();
}

function loadFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const doc = JSON.parse(reader.result);
      if (!doc || (!doc.shapes && !doc.guidesH && !doc.guidesV)) throw new Error('not a document');
      applyDocument(doc);
      initHistory();
      updateStatus();
      render();
      flashStatus(`Loaded ${file.name}`);
    } catch (err) {
      flashStatus('Load failed — not a Primitives file');
    }
  };
  reader.readAsText(file);
}

let _flashTimer = null;
function flashStatus(msg) {
  statusEl.textContent = msg;
  if (_flashTimer) clearTimeout(_flashTimer);
  _flashTimer = setTimeout(() => { _flashTimer = null; updateStatus(); }, 1800);
}

// ─── Coordinates ──────────────────────────────────────────────────────────────
function drawAreaSize() {
  const dpr = window.devicePixelRatio || 1;
  return {
    w: canvas.width / dpr - RULER_SIZE,
    h: canvas.height / dpr - RULER_SIZE,
  };
}

function screenToWorld(sx, sy) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (sx - rect.left - RULER_SIZE - state.panX) / state.zoom,
    y: (sy - rect.top - state.panY) / state.zoom,
  };
}

function worldToScreen(wx, wy) {
  return {
    x: wx * state.zoom + state.panX + RULER_SIZE,
    y: wy * state.zoom + state.panY,
  };
}

function getViewBounds() {
  const { w, h } = drawAreaSize();
  return {
    left: -state.panX / state.zoom,
    top: -state.panY / state.zoom,
    right: (w - state.panX) / state.zoom,
    bottom: (h - state.panY) / state.zoom,
  };
}

function snapGuideValue(v) {
  return Math.round(v / GRID_SIZE) * GRID_SIZE;
}

function rawWorldYFromClientY(clientY) {
  const rect = canvas.getBoundingClientRect();
  return (clientY - rect.top - state.panY) / state.zoom;
}

function rawWorldXFromClientX(clientX) {
  const rect = canvas.getBoundingClientRect();
  return (clientX - rect.left - RULER_SIZE - state.panX) / state.zoom;
}

function worldYFromClientY(clientY) {
  return snapGuideValue(rawWorldYFromClientY(clientY));
}

function worldXFromClientX(clientX) {
  return snapGuideValue(rawWorldXFromClientX(clientX));
}

// ─── Guides & crossings ───────────────────────────────────────────────────────
function crossingKey(x, y) {
  return `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`;
}

function addCrossing(pts, seen, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const key = crossingKey(x, y);
  if (seen.has(key)) return;
  seen.add(key);
  pts.push({ x, y });
}

function intersectAngledWithHorizontal(x0, y0, angle, yLine) {
  const dy = Math.sin(angle);
  if (Math.abs(dy) < 1e-9) return null;
  const t = (yLine - y0) / dy;
  return { x: x0 + t * Math.cos(angle), y: yLine };
}

function intersectAngledWithVertical(x0, y0, angle, xLine) {
  const dx = Math.cos(angle);
  if (Math.abs(dx) < 1e-9) return null;
  const t = (xLine - x0) / dx;
  return { x: xLine, y: y0 + t * Math.sin(angle) };
}

function intersectAngledGuides(a, b) {
  const dx1 = Math.cos(a.angle);
  const dy1 = Math.sin(a.angle);
  const dx2 = Math.cos(b.angle);
  const dy2 = Math.sin(b.angle);
  const det = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(det) < 1e-9) return null;
  const t = ((b.x - a.x) * dy2 - (b.y - a.y) * dx2) / det;
  return { x: a.x + t * dx1, y: a.y + t * dy1 };
}

function pointOnAngledGuide(px, py, gx, gy, angle) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const cross = (px - gx) * dy - (py - gy) * dx;
  return Math.abs(cross) < 0.5 / state.zoom;
}

function getCrossings() {
  const pts = [];
  const seen = new Set();

  for (const x of state.guidesV) {
    for (const y of state.guidesH) addCrossing(pts, seen, x, y);
  }

  for (const ag of state.guidesAngle) {
    for (const y of state.guidesH) {
      const p = intersectAngledWithHorizontal(ag.x, ag.y, ag.angle, y);
      if (p) addCrossing(pts, seen, p.x, p.y);
    }
    for (const x of state.guidesV) {
      const p = intersectAngledWithVertical(ag.x, ag.y, ag.angle, x);
      if (p) addCrossing(pts, seen, p.x, p.y);
    }
  }

  for (let i = 0; i < state.guidesAngle.length; i++) {
    for (let j = i + 1; j < state.guidesAngle.length; j++) {
      const p = intersectAngledGuides(state.guidesAngle[i], state.guidesAngle[j]);
      if (p) addCrossing(pts, seen, p.x, p.y);
    }
  }

  for (const v of state.vertices) addCrossing(pts, seen, v.x, v.y);

  return pts;
}

function addGridVertex(worldPt) {
  const snapped = snapToGrid(worldPt);
  const key = crossingKey(snapped.x, snapped.y);
  for (const v of state.vertices) {
    if (crossingKey(v.x, v.y) === key) return v;
  }
  const vertex = { x: snapped.x, y: snapped.y };
  state.vertices.push(vertex);
  return vertex;
}

function addGuide(axis, value) {
  const arr = axis === 'h' ? state.guidesH : state.guidesV;
  if (!arr.includes(value)) {
    arr.push(value);
    arr.sort((a, b) => a - b);
  }
}

function removeGuide(axis, value) {
  const arr = axis === 'h' ? state.guidesH : state.guidesV;
  const idx = arr.indexOf(value);
  if (idx !== -1) arr.splice(idx, 1);
}

function removeNearestGuide(axis, value) {
  const arr = axis === 'h' ? state.guidesH : state.guidesV;
  if (!arr.length) return;
  let best = arr[0];
  let bestDist = Math.abs(best - value);
  for (const v of arr) {
    const d = Math.abs(v - value);
    if (d < bestDist) { best = v; bestDist = d; }
  }
  if (bestDist <= GRID_SIZE / 2) removeGuide(axis, best);
}

// Nearest existing guide value within `tol` world px of a raw ruler position, or null.
function nearestGuideValue(axis, value, tol) {
  const arr = axis === 'h' ? state.guidesH : state.guidesV;
  let best = null, bestDist = tol;
  for (const v of arr) {
    const d = Math.abs(v - value);
    if (d <= bestDist) { bestDist = d; best = v; }
  }
  return best;
}

function nearestCrossing(worldPt) {
  const crossings = getCrossings();
  if (!crossings.length) return null;
  const r = CROSSING_RADIUS / state.zoom;
  let best = null;
  let bestDist = r;
  for (const c of crossings) {
    const d = Math.hypot(c.x - worldPt.x, c.y - worldPt.y);
    if (d < bestDist) { best = c; bestDist = d; }
  }
  return best;
}

function crossingSharesGuideWith(a, b) {
  const tol = 0.5 / state.zoom;
  if (Math.abs(a.y - b.y) < tol) return true;
  if (Math.abs(a.x - b.x) < tol) return true;
  for (const ag of state.guidesAngle) {
    if (pointOnAngledGuide(a.x, a.y, ag.x, ag.y, ag.angle) &&
        pointOnAngledGuide(b.x, b.y, ag.x, ag.y, ag.angle)) {
      return true;
    }
  }
  return false;
}

function crossingsOnGuideFrom(start, worldPt) {
  const crossings = getCrossings();
  const onGuide = crossings.filter(c =>
    !(Math.abs(c.x - start.x) < 0.01 && Math.abs(c.y - start.y) < 0.01) &&
    crossingSharesGuideWith(start, c)
  );
  if (!onGuide.length) return null;

  const r = CROSSING_RADIUS / state.zoom;
  let best = null;
  let bestDist = r;
  for (const c of onGuide) {
    const d = Math.hypot(c.x - worldPt.x, c.y - worldPt.y);
    if (d < bestDist) { best = c; bestDist = d; }
  }
  return best;
}

function snapSegmentPoint(worldPt) {
  if (state.segmentStart) return crossingsOnGuideFrom(state.segmentStart, worldPt);
  return nearestCrossing(worldPt);
}

// Stroke tool: the guide segment under the cursor — the span between the two adjacent
// crossings/vertices on whichever guide the cursor is hovering, that bracket it.
// Returns { a, b } (world points) or null. One click on this span makes a stroke.
function segmentUnderCursor(worldPt) {
  const tol = 6 / state.zoom;        // how close to the guide line counts as "on" it
  const onTol = 0.5 / state.zoom;    // crossing-belongs-to-guide / bracket epsilon
  const crossings = getCrossings();
  let best = null;

  const tryGuide = (dist, paramFn, members) => {
    if (dist > tol || members.length < 2) return;
    const sorted = members.map(c => ({ c, t: paramFn(c) })).sort((p, q) => p.t - q.t);
    const pt = paramFn(worldPt);
    for (let i = 0; i < sorted.length - 1; i++) {
      if (pt >= sorted[i].t - onTol && pt <= sorted[i + 1].t + onTol) {
        if (sorted[i + 1].t - sorted[i].t < onTol) break; // degenerate (coincident)
        if (!best || dist < best.dist) best = { a: sorted[i].c, b: sorted[i + 1].c, dist };
        break;
      }
    }
  };

  for (const gy of state.guidesH) {
    tryGuide(Math.abs(worldPt.y - gy), c => c.x, crossings.filter(c => Math.abs(c.y - gy) < onTol));
  }
  for (const gx of state.guidesV) {
    tryGuide(Math.abs(worldPt.x - gx), c => c.y, crossings.filter(c => Math.abs(c.x - gx) < onTol));
  }
  for (const ag of state.guidesAngle) {
    const cos = Math.cos(ag.angle), sin = Math.sin(ag.angle);
    tryGuide(distToAngledGuide(worldPt.x, worldPt.y, ag), c => c.x * cos + c.y * sin,
      crossings.filter(c => pointOnAngledGuide(c.x, c.y, ag.x, ag.y, ag.angle)));
  }

  return best ? { a: best.a, b: best.b } : null;
}

function isSegmentTool() {
  return state.tool === 'line' || state.tool === 'stroke';
}

function snapAngle15(angle) {
  return Math.round(angle / PROTRACTOR_STEP) * PROTRACTOR_STEP;
}

function findVertexAt(wx, wy) {
  const r = CROSSING_RADIUS / state.zoom;
  for (const c of getCrossings()) {
    if (Math.hypot(c.x - wx, c.y - wy) < r) return { x: c.x, y: c.y };
  }
  for (const shape of state.shapes) {
    for (const sp of getShapeSnapPoints(shape)) {
      if (sp.kind === 'vertex' && Math.hypot(sp.x - wx, sp.y - wy) < r) {
        return { x: sp.x, y: sp.y };
      }
    }
  }
  return null;
}

function angularGuideEndpoints(x, y, angle) {
  const view = getViewBounds();
  const diag = Math.hypot(view.right - view.left, view.bottom - view.top) * 2;
  return {
    x1: x - Math.cos(angle) * diag,
    y1: y - Math.sin(angle) * diag,
    x2: x + Math.cos(angle) * diag,
    y2: y + Math.sin(angle) * diag,
  };
}

function drawAngularGuide(x, y, angle, preview = false, selected = false) {
  const { x1, y1, x2, y2 } = angularGuideEndpoints(x, y, angle);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = preview ? 'rgba(240, 160, 48, 0.9)'
    : selected ? 'rgba(214, 176, 255, 0.95)' : 'rgba(186, 130, 255, 0.6)';
  ctx.lineWidth = (preview ? 2 : selected ? 2.25 : 1.25) / state.zoom;
  ctx.setLineDash(preview ? [4 / state.zoom, 8 / state.zoom] : selected ? [] : [5 / state.zoom, 9 / state.zoom]);
  ctx.stroke();
  ctx.setLineDash([]);

  if (preview) {
    const len = 28 / state.zoom;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.strokeStyle = '#f0a030';
    ctx.lineWidth = 2.5 / state.zoom;
    ctx.setLineDash([]);
    ctx.stroke();
  }
}

function wheelDeltaPixels(e) {
  let dx = e.deltaX;
  let dy = e.deltaY;
  if (e.deltaMode === 1) { dx *= 16; dy *= 16; }
  else if (e.deltaMode === 2) { dx *= 800; dy *= 800; }
  return Math.abs(dx) >= Math.abs(dy) ? dx : dy;
}

function setProtractorAngleFromPointer(wx, wy) {
  if (!state.protractorVertex) return;
  const dx = wx - state.protractorVertex.x;
  const dy = wy - state.protractorVertex.y;
  if (Math.hypot(dx, dy) < 4 / state.zoom) return;
  state.protractorAngle = snapAngle15(Math.atan2(dy, dx));
}

function nudgeProtractorAngle(delta) {
  if (Math.abs(delta) < 0.01) return false;
  const base = state.protractorAngle ?? 0;
  state.protractorAngle = snapAngle15(base + Math.sign(delta) * PROTRACTOR_STEP);
  return true;
}

function handleProtractorWheel(e) {
  if (state.tool !== 'protractor' || !state.protractorActive || state.spaceHeld || !state.protractorVertex) {
    return false;
  }
  const delta = wheelDeltaPixels(e);
  if (!nudgeProtractorAngle(delta)) return false;
  e.preventDefault();
  e.stopPropagation();
  updateStatus();
  render();
  return true;
}

function dropProtractorGuide() {
  if (!state.protractorVertex || state.protractorAngle === null) return;
  state.guidesAngle.push({
    id: nextId++,
    x: state.protractorVertex.x,
    y: state.protractorVertex.y,
    angle: state.protractorAngle,
  });
}

function resetProtractor() {
  state.protractorVertex = null;
  state.protractorAngle = null;
  state.protractorActive = false;
  state._protractorArmPending = false;
  state._protractorPointer = null;
}

function activateProtractor(vertex, pointer) {
  state.protractorVertex = vertex;
  state.protractorAngle = 0;
  state.protractorActive = true;
  state._protractorArmPending = true;
  workspace.focus();
  if (pointer) setProtractorAngleFromPointer(pointer.x, pointer.y);
}

function placeProtractorGuide() {
  if (!state.protractorActive || !state.protractorVertex) {
    resetProtractor();
    return;
  }
  if (state.protractorAngle === null) state.protractorAngle = 0;
  dropProtractorGuide();
  resetProtractor();
  recordHistory();
}

// ─── Dimensions ───────────────────────────────────────────────────────────────
// Two boundaries are crossed when showing a measurement: origin (sign of the Y axis)
// and unit (world px ⟷ display unit). worldToDim/dimToWorld handle both and are exact
// inverses, so a typed value round-trips back to the same world coordinate.
// X is always measured rightward from the left edge (both origin corners are "left"),
// so the origin swap only flips the sign of the Y measurement.
function unitDef() { return UNITS[state.unit] || UNITS.px; }
function unitLabel() { return unitDef().label; }
function pxToUnit(px) { return px / unitDef().factor; }
function unitToPx(v) { return v * unitDef().factor; }

function worldToDim(axis, worldVal) {
  const signed = axis === 'v' ? worldVal : (state.originCorner === 'bottom-left' ? -worldVal : worldVal);
  return pxToUnit(signed);
}

function dimToWorld(axis, dimVal) {
  const px = unitToPx(dimVal);
  if (axis === 'v') return px;
  return state.originCorner === 'bottom-left' ? -px : px;
}

// Formats a number already expressed in display units (no unit suffix).
function formatDim(v) {
  const d = unitDef().decimals;
  const p = Math.pow(10, d);
  return String(Math.round(v * p) / p);
}

// Convenience: format a raw world-px length into the active display unit.
function fmtLen(px) { return formatDim(pxToUnit(px)); }

function setOrigin(corner) {
  state.originCorner = corner;
  const lbl = document.getElementById('origin-label');
  if (lbl) lbl.textContent = `Origin: ${corner === 'bottom-left' ? 'bottom-left' : 'top-left'}`;
  autosave();
  updateStatus();
  render();
}

function toggleOrigin() {
  setOrigin(state.originCorner === 'top-left' ? 'bottom-left' : 'top-left');
}

// ─── Units, grid & snap controls ─────────────────────────────────────────────────
// One source of truth in state; syncControls() pushes it to every DOM control so the
// toolbar toggles and the grid panel never drift apart.
function syncControls(refreshGridInput = true) {
  if (snapGridToggle) snapGridToggle.checked = state.snapGrid;
  if (snapObjectToggle) snapObjectToggle.checked = state.snapObject;
  if (panelSnapGrid) panelSnapGrid.checked = state.snapGrid;
  if (panelSnapObject) panelSnapObject.checked = state.snapObject;
  if (unitSelect) unitSelect.value = state.unit;
  if (gridSizeUnit) gridSizeUnit.textContent = unitLabel();
  if (unitLabelBtn) unitLabelBtn.textContent = `Grid · ${unitLabel()}`;
  // Skip the field only when the user is actively typing into it (refreshGridInput
  // false); a unit change must rewrite it even while focused, since its value changed.
  if (gridSizeInput && refreshGridInput) {
    gridSizeInput.value = formatDim(pxToUnit(GRID_SIZE));
  }
}

function setUnit(u) {
  if (!UNITS[u]) return;
  state.unit = u;
  syncControls();
  autosave();
  updateStatus();
  render();
}

function setGridSize(px, refreshGridInput = true) {
  if (!Number.isFinite(px)) return;
  GRID_SIZE = Math.max(MIN_GRID, px);
  syncControls(refreshGridInput);
  autosave();
  render();
}

function setSnapGrid(v) { state.snapGrid = v; syncControls(); autosave(); render(); }
function setSnapObject(v) { state.snapObject = v; syncControls(); autosave(); render(); }

function openGridPanel() {
  state.gridPanelOpen = true;
  if (gridPanel) gridPanel.hidden = false;
  syncControls();
  if (gridSizeInput) { gridSizeInput.focus({ preventScroll: true }); gridSizeInput.select(); }
}

function closeGridPanel() {
  state.gridPanelOpen = false;
  if (gridPanel) gridPanel.hidden = true;
}

function toggleGridPanel() {
  state.gridPanelOpen ? closeGridPanel() : openGridPanel();
}

// Exact dimension entry — active whenever a ruler preview guide is showing.
function applyDimEntry() {
  if (!state.previewGuide) return;
  const n = parseFloat(state.dimEntry);
  if (Number.isFinite(n)) {
    state.previewGuide.value = dimToWorld(state.previewGuide.axis, n);
  }
  updateStatus();
  render();
}

function appendDim(ch) {
  let s = state.dimEntry ?? '';
  if (state.dimEntryReplace) { s = ''; state.dimEntryReplace = false; } // seeded value: type fresh
  if (ch === '-') s = s.startsWith('-') ? s.slice(1) : '-' + s; // toggle sign
  else if (ch === '.' && s.includes('.')) return;               // one decimal point
  else s += ch;
  state.dimEntry = s;
  applyDimEntry();
}

function backspaceDim() {
  if (state.dimEntry === null) return;
  state.dimEntryReplace = false; // start editing the seeded value in place
  state.dimEntry = state.dimEntry.slice(0, -1) || null;
  applyDimEntry();
}

function commitDim() {
  if (!state.previewGuide) return;
  addGuide(state.previewGuide.axis, state.previewGuide.value); // exact, not grid-snapped
  state.dimEntry = null;
  state.dimEntryReplace = false;
  recordHistory();
  updateStatus();
  render();
}

function cancelDim() {
  // Editing an existing guide that was lifted out on pickup: restore it on cancel.
  if (state.dimEntryReplace && state.previewGuide) {
    addGuide(state.previewGuide.axis, state.previewGuide.value);
  }
  state.dimEntry = null;
  state.dimEntryReplace = false;
  recordHistory();   // no-op when the guide was simply restored to where it was
  updateStatus();
  render();
}

// Returns true if the key was consumed by dimension entry.
function handleDimKey(e) {
  const k = e.key;
  if (k >= '0' && k <= '9') { appendDim(k); e.preventDefault(); return true; }
  if (k === '.') { appendDim('.'); e.preventDefault(); return true; }
  if (k === '-') { appendDim('-'); e.preventDefault(); return true; }
  if (k === 'Backspace') { backspaceDim(); e.preventDefault(); return true; }
  if (k === 'Enter') { commitDim(); e.preventDefault(); return true; }
  if (k === 'Escape' && state.dimEntry !== null) { cancelDim(); e.preventDefault(); return true; }
  if (state.dimEntry !== null) { e.preventDefault(); return true; } // swallow stray keys mid-entry
  return false;
}

function drawArrowhead(x, y, ang) {
  const s = DIM_ARROW;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - s * Math.cos(ang - 0.4), y - s * Math.sin(ang - 0.4));
  ctx.lineTo(x - s * Math.cos(ang + 0.4), y - s * Math.sin(ang + 0.4));
  ctx.closePath();
  ctx.fill();
}

function drawDimLabel(cx, cy, axis, text) {
  ctx.font = '11px IBM Plex Mono, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width;
  let lx = cx, ly = cy;
  if (axis === 'h') lx = cx + DIM_LABEL_OFFSET + tw / 2; // vertical leader → label to the right
  else ly = cy - DIM_LABEL_OFFSET;                        // horizontal leader → label above
  const padX = 5, padY = 3;
  ctx.fillStyle = 'rgba(14, 15, 17, 0.9)';
  ctx.fillRect(lx - tw / 2 - padX, ly - 7 - padY, tw + padX * 2, 14 + padY * 2);
  ctx.fillStyle = '#f0a030';
  ctx.fillText(text, lx, ly);
}

// Draws the linear dimension from the origin to the guide being set. Screen space,
// clipped to the draw area, so arrows/text stay a constant size at any zoom.
function drawDimensions() {
  if (!state.previewGuide) return;
  const dpr = window.devicePixelRatio || 1;
  const { w, h } = drawAreaSize();
  const { axis, value } = state.previewGuide;

  const origin = worldToScreen(0, 0);
  const guidePt = axis === 'h' ? worldToScreen(0, value) : worldToScreen(value, 0);

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.beginPath();
  ctx.rect(RULER_SIZE, 0, w, h);
  ctx.clip();

  const { x: ax, y: ay } = origin;
  const { x: bx, y: by } = guidePt;
  const len = Math.hypot(bx - ax, by - ay);

  ctx.strokeStyle = 'rgba(240, 160, 48, 0.95)';
  ctx.fillStyle = 'rgba(240, 160, 48, 0.95)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);

  if (len > 1) {
    const ang = Math.atan2(by - ay, bx - ax);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    drawArrowhead(bx, by, ang);            // points away from origin
    drawArrowhead(ax, ay, ang + Math.PI);  // points away from guide
  }

  // origin marker
  ctx.beginPath();
  ctx.arc(ax, ay, 3, 0, Math.PI * 2);
  ctx.fill();

  const dimVal = state.dimEntry !== null ? (state.dimEntry || '0') : formatDim(worldToDim(axis, value));
  drawDimLabel((ax + bx) / 2, (ay + by) / 2, axis, `${dimVal} ${unitLabel()}`);

  ctx.restore();
}

// ─── Snap ─────────────────────────────────────────────────────────────────────
function snapToGrid(p) {
  return {
    x: Math.round(p.x / GRID_SIZE) * GRID_SIZE,
    y: Math.round(p.y / GRID_SIZE) * GRID_SIZE,
  };
}

function getShapeBounds(shape) {
  const { type, x, y, x2, y2, points } = shape;

  if ((type === 'stroke' || type === 'pencil') && points?.length) {
    let minX = points[0].x, maxX = points[0].x;
    let minY = points[0].y, maxY = points[0].y;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    return { left: minX, top: minY, right: maxX, bottom: maxY };
  }

  if (type === 'text') {
    const m = measureTextShape(shape);
    return { left: x, top: y, right: x + m.w + TEXT_PAD * 2, bottom: y + m.h + TEXT_PAD * 2 };
  }

  return {
    left: Math.min(x, x2),
    top: Math.min(y, y2),
    right: Math.max(x, x2),
    bottom: Math.max(y, y2),
  };
}

function getShapeSnapPoints(shape) {
  const pts = [];
  const { type, x, y, x2, y2, points } = shape;

  if (type === 'text') {
    const b = getShapeBounds(shape);
    pts.push({ x, y, kind: 'vertex' });
    pts.push({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2, kind: 'center' });
    return pts;
  }

  if ((type === 'stroke' || type === 'pencil') && points?.length) {
    pts.push({ x: points[0].x, y: points[0].y, kind: 'vertex' });
    pts.push({ x: points[points.length - 1].x, y: points[points.length - 1].y, kind: 'vertex' });
    const b = getShapeBounds(shape);
    pts.push({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2, kind: 'center' });
    return pts;
  }

  if (type === 'line') {
    pts.push({ x, y, kind: 'vertex' });
    pts.push({ x: x2, y: y2, kind: 'vertex' });
    pts.push({ x: (x + x2) / 2, y: (y + y2) / 2, kind: 'center' });
    return pts;
  }

  const b = getShapeBounds(shape);
  const cx = (b.left + b.right) / 2;
  const cy = (b.top + b.bottom) / 2;
  const w = b.right - b.left;
  const h = b.bottom - b.top;

  pts.push({ x: cx, y: cy, kind: 'center' });

  if (type === 'rect' || type === 'square') {
    pts.push({ x: b.left, y: b.top, kind: 'vertex' });
    pts.push({ x: b.right, y: b.top, kind: 'vertex' });
    pts.push({ x: b.right, y: b.bottom, kind: 'vertex' });
    pts.push({ x: b.left, y: b.bottom, kind: 'vertex' });
    pts.push({ x: cx, y: b.top, kind: 'edge' });
    pts.push({ x: b.right, y: cy, kind: 'edge' });
    pts.push({ x: cx, y: b.bottom, kind: 'edge' });
    pts.push({ x: b.left, y: cy, kind: 'edge' });
  } else if (type === 'ellipse' || type === 'circle') {
    const rx = w / 2;
    const ry = h / 2;
    pts.push({ x: cx, y: cy - ry, kind: 'edge' });
    pts.push({ x: cx + rx, y: cy, kind: 'edge' });
    pts.push({ x: cx, y: cy + ry, kind: 'edge' });
    pts.push({ x: cx - rx, y: cy, kind: 'edge' });
    pts.push({ x: b.left, y: b.top, kind: 'vertex' });
    pts.push({ x: b.right, y: b.top, kind: 'vertex' });
    pts.push({ x: b.right, y: b.bottom, kind: 'vertex' });
    pts.push({ x: b.left, y: b.bottom, kind: 'vertex' });
  }

  return pts;
}

function findObjectSnap(worldPt, excludeIds = null) {
  let best = null;
  let bestDist = SNAP_RADIUS / state.zoom;

  for (const shape of state.shapes) {
    if (excludeIds?.has(shape.id)) continue;
    for (const sp of getShapeSnapPoints(shape)) {
      const dist = Math.hypot(sp.x - worldPt.x, sp.y - worldPt.y);
      if (dist < bestDist) { bestDist = dist; best = { x: sp.x, y: sp.y, kind: sp.kind }; }
    }
  }
  return best;
}

function applySnap(worldPt, opts = {}) {
  const useGrid = opts.grid ?? state.snapGrid;
  const useObject = opts.object ?? state.snapObject;
  let pt = { ...worldPt };
  let snap = null;

  if (useObject) {
    const objSnap = findObjectSnap(pt);
    if (objSnap) { pt = { x: objSnap.x, y: objSnap.y }; snap = objSnap; }
  }

  if (useGrid && !snap) {
    pt = snapToGrid(pt);
    snap = { x: pt.x, y: pt.y, kind: 'grid' };
  }

  return { pt, snap };
}

// ─── Shape helpers ────────────────────────────────────────────────────────────
// Editable dimension fields per drawing tool (Tab cycles, typing locks them).
function drawFields() {
  switch (state.tool) {
    case 'rect':
    case 'ellipse': return ['w', 'h'];
    case 'square': return ['s'];
    case 'circle': return ['d'];
    default: return [];
  }
}

function drawLockedValues() {
  const v = {};
  const typed = state.drawEntry?.typed || {};
  for (const k in typed) { const n = parseFloat(typed[k]); if (Number.isFinite(n)) v[k] = unitToPx(n); }
  return v;
}

// Final box for the box/ellipse primitives, honoring locked dims, shift (equal
// sides), and the from-center anchor. Typed values are full dimensions.
function previewBox() {
  const s = state.drawStart, c = state.drawCurrent;
  if (!s || !c) return null;
  const v = drawLockedValues();
  const tool = state.tool;
  const fromC = state.drawFromCenter;
  const equal = tool === 'square' || tool === 'circle' || ((tool === 'rect' || tool === 'ellipse') && state._shiftHeld);
  const dx = c.x - s.x, dy = c.y - s.y;
  const sx = Math.sign(dx) || 1, sy = Math.sign(dy) || 1;
  const mag = fromC ? 2 : 1; // pointer defines a half-extent when drawing from center

  let W, H;
  if (equal) {
    let size = v.s ?? v.d ?? v.w ?? v.h;
    if (size == null) size = mag * Math.max(Math.abs(dx), Math.abs(dy));
    W = size; H = size;
  } else {
    W = v.w != null ? v.w : mag * Math.abs(dx);
    H = v.h != null ? v.h : mag * Math.abs(dy);
  }

  if (fromC) return { x: s.x - W / 2, y: s.y - H / 2, x2: s.x + W / 2, y2: s.y + H / 2 };
  return { x: s.x, y: s.y, x2: s.x + sx * W, y2: s.y + sy * H };
}

function pointToSegmentDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function hitTest(shape, wx, wy) {
  const tol = 6 / state.zoom;
  const { type, x, y, x2, y2, points } = shape;

  if ((type === 'stroke' || type === 'pencil') && points?.length > 1) {
    for (let i = 1; i < points.length; i++) {
      if (pointToSegmentDist(wx, wy, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y) < tol) return true;
    }
    return false;
  }

  if (type === 'line') return pointToSegmentDist(wx, wy, x, y, x2, y2) < tol;

  if (type === 'text') {
    const tb = getShapeBounds(shape);
    return wx >= tb.left - tol && wx <= tb.right + tol && wy >= tb.top - tol && wy <= tb.bottom + tol;
  }

  const b = getShapeBounds(shape);

  if (type === 'rect' || type === 'square') {
    const onEdge =
      (Math.abs(wx - b.left) < tol || Math.abs(wx - b.right) < tol) && wy >= b.top - tol && wy <= b.bottom + tol ||
      (Math.abs(wy - b.top) < tol || Math.abs(wy - b.bottom) < tol) && wx >= b.left - tol && wx <= b.right + tol;
    return onEdge || (wx >= b.left && wx <= b.right && wy >= b.top && wy <= b.bottom);
  }

  const cx = (b.left + b.right) / 2;
  const cy = (b.top + b.bottom) / 2;
  const rx = (b.right - b.left) / 2;
  const ry = (b.bottom - b.top) / 2;
  if (rx < 1 || ry < 1) return false;

  const nx = (wx - cx) / rx;
  const ny = (wy - cy) / ry;
  const dist = nx * nx + ny * ny;

  if (type === 'circle') {
    const r = Math.min(rx, ry);
    const nd = Math.hypot(wx - cx, wy - cy);
    return Math.abs(nd - r) < tol || nd < r;
  }

  return Math.abs(dist - 1) < tol / Math.min(rx, ry) || dist < 1;
}

function shapeIntersectsRect(shape, left, top, right, bottom) {
  const b = getShapeBounds(shape);
  return b.left <= right && b.right >= left && b.top <= bottom && b.bottom >= top;
}

function findShapeAt(wx, wy) {
  for (let i = state.shapes.length - 1; i >= 0; i--) {
    if (hitTest(state.shapes[i], wx, wy)) return state.shapes[i];
  }
  return null;
}

function addSegment(a, b) {
  if (a.x === b.x && a.y === b.y) return;
  const shape = state.tool === 'stroke'
    ? { id: nextId++, type: 'stroke', points: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }] }
    : { id: nextId++, type: 'line', x: a.x, y: a.y, x2: b.x, y2: b.y };
  state.shapes.push(shape);
  state.selectedIds = new Set([shape.id]);
  recordHistory();
}

// ─── Selection & move ─────────────────────────────────────────────────────────
function snapMovePoint(p) {
  return state.snapGrid ? snapToGrid(p) : { x: p.x, y: p.y };
}

function distToAngledGuide(wx, wy, g) {
  return Math.abs((wx - g.x) * Math.sin(g.angle) - (wy - g.y) * Math.cos(g.angle));
}

// Returns the topmost guide-like entity under the point, or null.
// Priority: point handles (vertices, angled anchors) before lines.
function hitTestGuide(wx, wy) {
  const lineTol = 6 / state.zoom;
  const ptTol = CROSSING_RADIUS / state.zoom;
  for (const v of state.vertices) {
    if (Math.hypot(v.x - wx, v.y - wy) < ptTol) return { type: 'vertex', ref: v };
  }
  for (const g of state.guidesAngle) {
    if (Math.hypot(g.x - wx, g.y - wy) < ptTol) return { type: 'angle', ref: g };
  }
  for (const g of state.guidesAngle) {
    if (distToAngledGuide(wx, wy, g) < lineTol) return { type: 'angle', ref: g };
  }
  for (const y of state.guidesH) {
    if (Math.abs(wy - y) < lineTol) return { type: 'h', value: y };
  }
  for (const x of state.guidesV) {
    if (Math.abs(wx - x) < lineTol) return { type: 'v', value: x };
  }
  return null;
}

function deleteSelectedGuide() {
  const g = state.selectedGuide;
  if (!g) return false;
  if (g.type === 'h') removeGuide('h', g.value);
  else if (g.type === 'v') removeGuide('v', g.value);
  else if (g.type === 'angle') state.guidesAngle = state.guidesAngle.filter(x => x !== g.ref);
  else if (g.type === 'vertex') state.vertices = state.vertices.filter(x => x !== g.ref);
  state.selectedGuide = null;
  return true;
}

function cloneGeom(s) {
  if (s.points) return { points: s.points.map(p => ({ x: p.x, y: p.y })) };
  if (s.type === 'text') return { x: s.x, y: s.y };
  return { x: s.x, y: s.y, x2: s.x2, y2: s.y2 };
}

function translateShapeFrom(shape, orig, dx, dy) {
  if (orig.points) {
    shape.points = orig.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
  } else {
    shape.x = orig.x + dx; shape.y = orig.y + dy;
    if (orig.x2 !== undefined) { shape.x2 = orig.x2 + dx; shape.y2 = orig.y2 + dy; }
  }
}

function beginShapeDrag(raw, primaryId, pointerId) {
  snapIndicator.hidden = true;
  crosshair.hidden = true;
  state.isDraggingShapes = true;
  state.dragAnchor = { x: raw.x, y: raw.y }; // raw (unsnapped) — snapping happens per snap-point
  state.dragSnapTarget = null;
  state.movePrimaryId = primaryId;
  state.moveEntry = null;
  state.moveOffset = { dx: 0, dy: 0 };
  state._moveRaw = { x: raw.x, y: raw.y };
  state.dragOriginals = new Map();
  for (const s of state.shapes) {
    if (state.selectedIds.has(s.id)) state.dragOriginals.set(s.id, cloneGeom(s));
  }
  // Attached text travels with its parent shape even when not itself selected.
  for (const s of state.shapes) {
    if (s.type === 'text' && s.attachTo != null &&
        state.selectedIds.has(s.attachTo) && !state.dragOriginals.has(s.id)) {
      state.dragOriginals.set(s.id, cloneGeom(s));
    }
  }
  canvas.setPointerCapture(pointerId);
}

// Snap points of the moving selection, evaluated at a tentative (dx,dy) offset.
function movingSnapPoints(dx, dy) {
  const pts = [];
  for (const s of state.shapes) {
    const orig = state.dragOriginals.get(s.id);
    if (!orig) continue;
    const moved = orig.points
      ? { type: s.type, points: orig.points.map(p => ({ x: p.x + dx, y: p.y + dy })) }
      : { type: s.type, x: orig.x + dx, y: orig.y + dy, x2: orig.x2 + dx, y2: orig.y2 + dy };
    for (const sp of getShapeSnapPoints(moved)) pts.push(sp);
  }
  return pts;
}

function nonSelectedObjectPoints() {
  const pts = [];
  for (const s of state.shapes) {
    if (state.selectedIds.has(s.id)) continue;
    for (const sp of getShapeSnapPoints(s)) pts.push({ x: sp.x, y: sp.y });
  }
  return pts;
}

function allObjectPoints() {
  const pts = [];
  for (const s of state.shapes) {
    for (const sp of getShapeSnapPoints(s)) pts.push({ x: sp.x, y: sp.y });
  }
  return pts;
}

// Guide crossings usable as snap targets, with the dragged guide excluded so it
// never snaps to its own intersections. (H/V guides are already lifted from their
// arrays during a drag; vertices/angled guides are detached here temporarily.)
function guideSnapTargets() {
  const g = state.selectedGuide;
  let restore = null;
  if (g && g.type === 'vertex') {
    const i = state.vertices.indexOf(g.ref);
    if (i !== -1) { state.vertices.splice(i, 1); restore = () => state.vertices.splice(i, 0, g.ref); }
  } else if (g && g.type === 'angle') {
    const i = state.guidesAngle.indexOf(g.ref);
    if (i !== -1) { state.guidesAngle.splice(i, 1); restore = () => state.guidesAngle.splice(i, 0, g.ref); }
  }
  const crossings = getCrossings();
  if (restore) restore();
  return crossings;
}

// Projects a point perpendicularly onto the nearest guide line (H/V/angled),
// excluding the dragged angled guide. Returns the on-line point or null.
function snapPointOntoGuideLine(pt, R) {
  let best = null, cost = R;
  const g = state.selectedGuide;
  for (const y of state.guidesH) { const d = Math.abs(pt.y - y); if (d < cost) { cost = d; best = { x: pt.x, y }; } }
  for (const x of state.guidesV) { const d = Math.abs(pt.x - x); if (d < cost) { cost = d; best = { x, y: pt.y }; } }
  for (const ag of state.guidesAngle) {
    if (g && g.type === 'angle' && ag === g.ref) continue;
    const s = (pt.x - ag.x) * Math.sin(ag.angle) - (pt.y - ag.y) * Math.cos(ag.angle);
    if (Math.abs(s) < cost) { cost = Math.abs(s); best = { x: pt.x - s * Math.sin(ag.angle), y: pt.y + s * Math.cos(ag.angle) }; }
  }
  return best;
}

// 1-DOF: snap an H/V guide's value to an object snap point, a guide crossing, or a
// parallel guide on that axis, else grid. Returns value + matched point (feedback).
function snapGuideAxis(axis, value) {
  const R = SNAP_RADIUS / state.zoom;
  const coord = (p) => axis === 'h' ? p.y : p.x;
  let best = null, cost = R, marker = null;
  for (const p of allObjectPoints().concat(guideSnapTargets())) {
    const c = Math.abs(coord(p) - value);
    if (c < cost) { cost = c; best = coord(p); marker = p; }
  }
  for (const gv of (axis === 'h' ? state.guidesH : state.guidesV)) {
    const c = Math.abs(gv - value);
    if (c < cost) { cost = c; best = gv; marker = null; }
  }
  if (best !== null) return { value: best, marker };
  if (state.snapGrid) return { value: Math.round(value / GRID_SIZE) * GRID_SIZE, marker: null };
  return { value, marker: null };
}

// 2-DOF: snap a guide anchor / vertex onto an object snap point or guide crossing,
// then onto a guide line, else grid.
function snapGuidePoint(pt) {
  const R = SNAP_RADIUS / state.zoom;
  let best = null, cost = R;
  for (const t of allObjectPoints().concat(guideSnapTargets())) {
    const c = Math.hypot(t.x - pt.x, t.y - pt.y);
    if (c < cost) { cost = c; best = { x: t.x, y: t.y }; }
  }
  if (best) return { x: best.x, y: best.y, marker: best };
  const onLine = snapPointOntoGuideLine(pt, R);
  if (onLine) return { x: onLine.x, y: onLine.y, marker: null };
  if (state.snapGrid) { const g = snapToGrid(pt); return { x: g.x, y: g.y, marker: null }; }
  return { x: pt.x, y: pt.y, marker: null };
}

// Adjusts a raw (dx0,dy0) move offset so a moving snap point lands on a guide
// crossing, guide line, or another object's snap point. Falls back to grid.
function snapMoveDelta(dx0, dy0) {
  const R = SNAP_RADIUS / state.zoom;
  const pts = movingSnapPoints(dx0, dy0);

  // 1. Two-DOF targets: crossings, other objects' points, and angled-guide lines.
  const fullTargets = getCrossings().concat(nonSelectedObjectPoints());
  let best2D = null, cost2D = R, target = null;
  for (const m of pts) {
    for (const t of fullTargets) {
      const c = Math.hypot(t.x - m.x, t.y - m.y);
      if (c < cost2D) { cost2D = c; best2D = { cx: t.x - m.x, cy: t.y - m.y }; target = { x: t.x, y: t.y }; }
    }
    for (const g of state.guidesAngle) {
      const s = (m.x - g.x) * Math.sin(g.angle) - (m.y - g.y) * Math.cos(g.angle);
      if (Math.abs(s) < cost2D) {
        cost2D = Math.abs(s);
        best2D = { cx: -s * Math.sin(g.angle), cy: s * Math.cos(g.angle) };
        target = { x: m.x - s * Math.sin(g.angle), y: m.y + s * Math.cos(g.angle) };
      }
    }
  }
  if (best2D) return { dx: dx0 + best2D.cx, dy: dy0 + best2D.cy, target };

  // 2. Independent per-axis snap: V guides / grid for x, H guides / grid for y.
  let bestX = null, costX = R, bestY = null, costY = R;
  for (const m of pts) {
    for (const gx of state.guidesV) { const c = Math.abs(gx - m.x); if (c < costX) { costX = c; bestX = gx - m.x; } }
    for (const gy of state.guidesH) { const c = Math.abs(gy - m.y); if (c < costY) { costY = c; bestY = gy - m.y; } }
    if (state.snapGrid) {
      const gx = Math.round(m.x / GRID_SIZE) * GRID_SIZE; const cx = Math.abs(gx - m.x);
      if (cx < costX) { costX = cx; bestX = gx - m.x; }
      const gy = Math.round(m.y / GRID_SIZE) * GRID_SIZE; const cy = Math.abs(gy - m.y);
      if (cy < costY) { costY = cy; bestY = gy - m.y; }
    }
  }
  return { dx: dx0 + (bestX ?? 0), dy: dy0 + (bestY ?? 0), target: null };
}

// Bounding box of the primary shape's original (pre-move) geometry.
function moveOrigBbox() {
  const g = state.dragOriginals?.get(state.movePrimaryId);
  if (!g) return null;
  if (g.points) {
    let l = g.points[0].x, r = l, t = g.points[0].y, b = t;
    for (const p of g.points) { l = Math.min(l, p.x); r = Math.max(r, p.x); t = Math.min(t, p.y); b = Math.max(b, p.y); }
    return { left: l, top: t, bottom: b };
  }
  return { left: Math.min(g.x, g.x2), top: Math.min(g.y, g.y2), bottom: Math.max(g.y, g.y2) };
}

// Resolves typed X/Y/ΔX/ΔY entries into a locked world offset per axis (or null).
function resolveMoveLocks() {
  const t = state.moveEntry?.typed || {};
  const bb = moveOrigBbox();
  const topLeft = state.originCorner === 'top-left';
  const num = (s) => { const n = parseFloat(s); return Number.isFinite(n) ? n : null; };
  let dx = null, dy = null;
  if (t.dx) { const n = num(t.dx); if (n !== null) dx = unitToPx(n); }
  else if (t.x && bb) { const n = num(t.x); if (n !== null) dx = unitToPx(n) - bb.left; }
  if (t.dy) { const n = num(t.dy); if (n !== null) dy = unitToPx(topLeft ? n : -n); }
  else if (t.y && bb) { const n = num(t.y); if (n !== null) dy = dimToWorld('h', n) - (topLeft ? bb.top : bb.bottom); }
  return { dx, dy };
}

// Computes and applies the current move offset (pointer + snapping, with typed
// axes locked), translating every selected shape and updating the readout.
function applyMove() {
  const raw = state._moveRaw;
  const dx0 = raw ? raw.x - state.dragAnchor.x : 0;
  const dy0 = raw ? raw.y - state.dragAnchor.y : 0;
  const locks = resolveMoveLocks();

  let dx, dy, target = null;
  if (locks.dx !== null && locks.dy !== null) {
    dx = locks.dx; dy = locks.dy;
  } else {
    const snapped = snapMoveDelta(dx0, dy0);
    dx = locks.dx !== null ? locks.dx : snapped.dx;
    dy = locks.dy !== null ? locks.dy : snapped.dy;
    if (locks.dx === null && locks.dy === null) target = snapped.target;
  }

  state.moveOffset = { dx, dy };
  state.dragSnapTarget = target;
  for (const s of state.shapes) {
    const orig = state.dragOriginals.get(s.id);
    if (orig) translateShapeFrom(s, orig, dx, dy);
  }
}

function updateShapeMove(raw) {
  if (raw) state._moveRaw = { x: raw.x, y: raw.y };
  applyMove();
}

function restoreShapeDrag() {
  if (!state.dragOriginals) return;
  for (const s of state.shapes) {
    const orig = state.dragOriginals.get(s.id);
    if (orig) translateShapeFrom(s, orig, 0, 0);
  }
}

function endShapeDrag() {
  state.isDraggingShapes = false;
  state.isCarrying = false;
  state.dragOriginals = null;
  state.dragAnchor = null;
  state.dragSnapTarget = null;
  state.movePrimaryId = null;
  state.moveEntry = null;
  state.moveOffset = null;
  state._moveRaw = null;
}

function commitMove() {
  endShapeDrag();
  snapIndicator.hidden = true;
  recordHistory();   // no-op if the selection didn't actually move (e.g. cancelMove)
  updateStatus();
  render();
}

function cancelMove() {
  restoreShapeDrag();
  commitMove();
}

const MOVE_FIELDS = ['x', 'y', 'dx', 'dy'];
const MOVE_PAIR = { x: 'dx', dx: 'x', y: 'dy', dy: 'y' };

// Typed X/Y/ΔX/ΔY entry while carrying. Returns true if the key was consumed.
function handleMoveKey(e) {
  if (!state.moveEntry) state.moveEntry = { active: 0, typed: {} };
  const key = MOVE_FIELDS[state.moveEntry.active];
  const cur = state.moveEntry.typed[key] ?? '';
  const k = e.key;

  if (k === 'Enter') { e.preventDefault(); commitMove(); return true; }
  if (k === 'Escape') { e.preventDefault(); cancelMove(); return true; }
  if (k === 'Tab') { state.moveEntry.active = (state.moveEntry.active + 1) % MOVE_FIELDS.length; e.preventDefault(); updateStatus(); render(); return true; }

  if (k >= '0' && k <= '9') state.moveEntry.typed[key] = cur + k;
  else if (k === '.') { if (cur.includes('.')) return true; state.moveEntry.typed[key] = cur + '.'; }
  else if (k === '-') state.moveEntry.typed[key] = cur.startsWith('-') ? cur.slice(1) : '-' + cur;
  else if (k === 'Backspace') state.moveEntry.typed[key] = cur.slice(0, -1);
  else return false;

  delete state.moveEntry.typed[MOVE_PAIR[key]]; // X and ΔX (Y and ΔY) drive the same axis
  e.preventDefault();
  applyMove();
  updateStatus();
  render();
  return true;
}

// Current readout values: absolute X/Y of the primary shape's origin-corner plus
// the move deltas, all in the active origin convention.
function moveReadout() {
  const bb = moveOrigBbox();
  if (!bb) return null;
  const off = state.moveOffset || { dx: 0, dy: 0 };
  const topLeft = state.originCorner === 'top-left';
  return {
    x: pxToUnit(bb.left + off.dx),
    y: worldToDim('h', (topLeft ? bb.top : bb.bottom) + off.dy),
    dx: pxToUnit(off.dx),
    dy: pxToUnit(topLeft ? off.dy : -off.dy),
  };
}

function beginGuideDrag(guide, raw, pointerId) {
  snapIndicator.hidden = true;
  crosshair.hidden = true;
  state.isDraggingGuide = true;
  state.selectedGuide = guide;
  state.dragSnapTarget = null;
  if (guide.type === 'h' || guide.type === 'v') {
    // Lift the line out of its array so the live dimension preview is the only copy.
    state.dragGuideOrig = guide.value;
    removeGuide(guide.type, guide.value);
    state.previewGuide = { axis: guide.type, value: guide.value };
  } else {
    state.dragGuideOrig = { x: guide.ref.x, y: guide.ref.y };
    state.dragAnchor = { x: raw.x, y: raw.y }; // raw — object/grid snap applied per move
  }
  canvas.setPointerCapture(pointerId);
}

function updateGuideDrag(raw) {
  const g = state.selectedGuide;
  if (g.type === 'h' || g.type === 'v') {
    const { value, marker } = snapGuideAxis(g.type, g.type === 'h' ? raw.y : raw.x);
    g.value = value;
    state.previewGuide = { axis: g.type, value };
    state.dragSnapTarget = marker;
  } else {
    const base = {
      x: state.dragGuideOrig.x + (raw.x - state.dragAnchor.x),
      y: state.dragGuideOrig.y + (raw.y - state.dragAnchor.y),
    };
    const { x, y, marker } = snapGuidePoint(base);
    g.ref.x = x;
    g.ref.y = y;
    state.dragSnapTarget = marker;
  }
}

function finishGuideDrag(commit = true) {
  const g = state.selectedGuide;
  if (g && (g.type === 'h' || g.type === 'v')) {
    const value = commit ? g.value : state.dragGuideOrig;
    addGuide(g.type, value);
    g.value = value;
    state.previewGuide = null;
  } else if (g && !commit) {
    g.ref.x = state.dragGuideOrig.x;
    g.ref.y = state.dragGuideOrig.y;
  }
  state.isDraggingGuide = false;
  state.dragGuideOrig = null;
  state.dragAnchor = null;
  state.dragSnapTarget = null;
  recordHistory();   // no-op on cancel (guide restored to its original spot)
}

// ─── Rendering ────────────────────────────────────────────────────────────────
function drawGrid() {
  const view = getViewBounds();
  const gridScreen = GRID_SIZE * state.zoom;
  if (gridScreen < 4) return;

  const startX = Math.floor(view.left / GRID_SIZE) * GRID_SIZE;
  const startY = Math.floor(view.top / GRID_SIZE) * GRID_SIZE;
  const endX = view.right + GRID_SIZE;
  const endY = view.bottom + GRID_SIZE;
  const majorEvery = 5;

  ctx.lineWidth = 1 / state.zoom;

  for (let x = startX; x <= endX; x += GRID_SIZE) {
    const idx = Math.round(x / GRID_SIZE);
    ctx.strokeStyle = idx % majorEvery === 0 ? 'rgba(240, 160, 48, 0.12)' : 'rgba(255, 255, 255, 0.04)';
    ctx.beginPath();
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
    ctx.stroke();
  }

  for (let y = startY; y <= endY; y += GRID_SIZE) {
    const idx = Math.round(y / GRID_SIZE);
    ctx.strokeStyle = idx % majorEvery === 0 ? 'rgba(240, 160, 48, 0.12)' : 'rgba(255, 255, 255, 0.04)';
    ctx.beginPath();
    ctx.moveTo(startX, y);
    ctx.lineTo(endX, y);
    ctx.stroke();
  }
}

function drawGuideLine(axis, value, preview = false, selected = false) {
  const view = getViewBounds();
  ctx.beginPath();
  if (axis === 'h') {
    ctx.moveTo(view.left, value);
    ctx.lineTo(view.right, value);
  } else {
    ctx.moveTo(value, view.top);
    ctx.lineTo(value, view.bottom);
  }
  ctx.strokeStyle = preview ? 'rgba(240, 160, 48, 0.75)'
    : selected ? 'rgba(130, 240, 230, 0.95)' : 'rgba(78, 205, 196, 0.5)';
  ctx.lineWidth = (preview ? 1.5 : selected ? 2.25 : 1) / state.zoom;
  ctx.setLineDash(preview ? [10 / state.zoom, 7 / state.zoom] : selected ? [] : [6 / state.zoom, 5 / state.zoom]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawGuides() {
  for (const y of state.guidesH) drawGuideLine('h', y);
  for (const x of state.guidesV) drawGuideLine('v', x);
  if (state.previewGuide) drawGuideLine(state.previewGuide.axis, state.previewGuide.value, true);

  for (const g of state.guidesAngle) drawAngularGuide(g.x, g.y, g.angle);

  const sg = state.selectedGuide;
  if (sg && !state.isDraggingGuide) {
    if (sg.type === 'h') drawGuideLine('h', sg.value, false, true);
    else if (sg.type === 'v') drawGuideLine('v', sg.value, false, true);
    else if (sg.type === 'angle') drawAngularGuide(sg.ref.x, sg.ref.y, sg.ref.angle, false, true);
  }

  if (state.protractorActive && state.protractorVertex) {
    drawAngularGuide(
      state.protractorVertex.x,
      state.protractorVertex.y,
      state.protractorAngle ?? 0,
      true,
    );
  }

  const crossings = getCrossings();
  const r = 4 / state.zoom;

  for (const c of crossings) {
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(78, 205, 196, 0.35)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(78, 205, 196, 0.8)';
    ctx.lineWidth = 1 / state.zoom;
    ctx.stroke();
  }

  if (sg && (sg.type === 'vertex' || sg.type === 'angle')) {
    ctx.beginPath();
    ctx.arc(sg.ref.x, sg.ref.y, r + 3 / state.zoom, 0, Math.PI * 2);
    ctx.strokeStyle = sg.type === 'angle' ? '#d6b0ff' : '#82e6e6';
    ctx.lineWidth = 2 / state.zoom;
    ctx.stroke();
  }

  if (state.protractorVertex) {
    const v = state.protractorVertex;
    ctx.beginPath();
    ctx.arc(v.x, v.y, r + 2 / state.zoom, 0, Math.PI * 2);
    ctx.strokeStyle = state.protractorActive ? '#f0a030' : '#ba82ff';
    ctx.lineWidth = 2 / state.zoom;
    ctx.stroke();
  }

  if (state.segmentStart) {
    ctx.beginPath();
    ctx.arc(state.segmentStart.x, state.segmentStart.y, r + 2 / state.zoom, 0, Math.PI * 2);
    ctx.strokeStyle = '#f0a030';
    ctx.lineWidth = 2 / state.zoom;
    ctx.stroke();
  }
}

function drawSegmentPreview() {
  // Stroke tool: solid highlight of the guide segment under the cursor, with end dots.
  if (state.segmentSpan) {
    const { a, b } = state.segmentSpan;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = 'rgba(240, 160, 48, 0.9)';
    ctx.lineWidth = 3 / state.zoom;
    ctx.lineCap = 'round';
    ctx.setLineDash([]);
    ctx.stroke();
    for (const p of [a, b]) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4 / state.zoom, 0, Math.PI * 2);
      ctx.fillStyle = '#f0a030';
      ctx.fill();
    }
  }

  if (!state.segmentStart || !state.segmentHover) return;
  const a = state.segmentStart;
  const b = state.segmentHover;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = 'rgba(240, 160, 48, 0.7)';
  ctx.lineWidth = 2 / state.zoom;
  ctx.setLineDash([6 / state.zoom, 4 / state.zoom]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawShape(shape, isPreview = false, isSelected = false) {
  const { type, x, y, x2, y2, points } = shape;

  if (type === 'text') { drawTextShape(shape, isSelected); return; }

  ctx.lineWidth = (isSelected ? 2 : 1.5) / state.zoom;
  ctx.strokeStyle = isSelected ? '#f0a030' : isPreview ? 'rgba(240, 160, 48, 0.7)' : '#e8eaed';
  ctx.fillStyle = isSelected ? 'rgba(240, 160, 48, 0.08)' : 'rgba(232, 234, 237, 0.04)';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if ((type === 'stroke' || type === 'pencil') && points?.length > 1) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
    return;
  }

  if (type === 'line') {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    return;
  }

  const b = getShapeBounds(shape);
  const w = b.right - b.left;
  const h = b.bottom - b.top;

  if (type === 'rect' || type === 'square') {
    ctx.fillRect(b.left, b.top, w, h);
    ctx.strokeRect(b.left, b.top, w, h);
  } else if (type === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(b.left + w / 2, b.top + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (type === 'circle') {
    const r = Math.min(w, h) / 2;
    ctx.beginPath();
    ctx.arc(b.left + w / 2, b.top + h / 2, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function drawHatches() {
  if (!state.hatches.length) return;
  ctx.strokeStyle = '#e8eaed';
  ctx.lineWidth = 1.4 / state.zoom;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const h of state.hatches) {
    ctx.moveTo(h.x1, h.y1);
    ctx.lineTo(h.x2, h.y2);
  }
  ctx.stroke();
}

// Footprint that follows the cursor: rotated rectangle (brush, ⟂ to the hatch) or
// square (eraser). Brightens while the pen/eraser is pressed.
function drawBrushPreview() {
  if (!isBrushTool()) return;
  const c = state._hoverWorld;
  if (!c) return;
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.lineWidth = 1 / state.zoom;
  ctx.setLineDash([4 / state.zoom, 3 / state.zoom]);
  if (state.tool === 'brush') {
    const ang = state.brushAngleKey ? HATCH_ANGLES[state.brushAngleKey] : state.brushAngle;
    ctx.rotate(ang);
    ctx.strokeStyle = state.brushAngleKey ? '#f0a030' : 'rgba(240, 160, 48, 0.55)';
    ctx.strokeRect(-BRUSH_THICK / 2, -BRUSH_LEN / 2, BRUSH_THICK, BRUSH_LEN);
  } else {
    ctx.strokeStyle = state.eraserDown ? '#ff6b6b' : 'rgba(255, 107, 107, 0.55)';
    ctx.strokeRect(-ERASER_SIZE / 2, -ERASER_SIZE / 2, ERASER_SIZE, ERASER_SIZE);
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function drawSnapPoint(sp, alpha = 1) {
  const r = 3.5 / state.zoom;
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
  const colors = { center: '#4ecdc4', vertex: '#f0a030', edge: '#7a8194', grid: '#4ecdc4' };
  ctx.fillStyle = colors[sp.kind] || '#7a8194';
  ctx.globalAlpha = alpha;
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawSnapPoints(shape) {
  if (!state.snapObject) return;
  for (const sp of getShapeSnapPoints(shape)) drawSnapPoint(sp);
}

function drawMarquee() {
  if (!state.isMarquee || !state.marqueeStart || !state.marqueeCurrent) return;
  const left = Math.min(state.marqueeStart.x, state.marqueeCurrent.x);
  const top = Math.min(state.marqueeStart.y, state.marqueeCurrent.y);
  const w = Math.abs(state.marqueeCurrent.x - state.marqueeStart.x);
  const h = Math.abs(state.marqueeCurrent.y - state.marqueeStart.y);
  ctx.fillStyle = 'rgba(240, 160, 48, 0.08)';
  ctx.strokeStyle = 'rgba(240, 160, 48, 0.7)';
  ctx.lineWidth = 1 / state.zoom;
  ctx.setLineDash([6 / state.zoom, 4 / state.zoom]);
  ctx.fillRect(left, top, w, h);
  ctx.strokeRect(left, top, w, h);
  ctx.setLineDash([]);
}

function drawRulers() {
  const dpr = window.devicePixelRatio || 1;
  const fullW = canvas.width / dpr;
  const fullH = canvas.height / dpr;
  const { w, h } = drawAreaSize();
  const tickStep = GRID_SIZE * state.zoom;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = '#16181c';
  ctx.fillRect(0, 0, RULER_SIZE, fullH - RULER_SIZE);
  ctx.fillRect(RULER_SIZE, fullH - RULER_SIZE, fullW - RULER_SIZE, RULER_SIZE);
  ctx.fillRect(0, fullH - RULER_SIZE, RULER_SIZE, RULER_SIZE);

  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.moveTo(RULER_SIZE, 0);
  ctx.lineTo(RULER_SIZE, fullH - RULER_SIZE);
  ctx.moveTo(0, fullH - RULER_SIZE);
  ctx.lineTo(fullW, fullH - RULER_SIZE);
  ctx.stroke();

  if (tickStep < 5) { ctx.restore(); return; }

  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.fillStyle = 'rgba(122, 129, 148, 0.75)';
  ctx.font = '9px IBM Plex Mono, monospace';

  const view = getViewBounds();
  const startY = Math.floor(view.top / GRID_SIZE) * GRID_SIZE;
  for (let y = startY; y <= view.bottom; y += GRID_SIZE) {
    const sy = y * state.zoom + state.panY;
    if (sy < 0 || sy > h) continue;
    ctx.beginPath();
    ctx.moveTo(RULER_SIZE - 8, sy);
    ctx.lineTo(RULER_SIZE - 2, sy);
    ctx.stroke();
    if (tickStep >= 10 && y % (GRID_SIZE * 5) === 0) {
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(formatDim(worldToDim('h', y)), RULER_SIZE - 10, sy);
    }
  }

  const startX = Math.floor(view.left / GRID_SIZE) * GRID_SIZE;
  for (let x = startX; x <= view.right; x += GRID_SIZE) {
    const sx = x * state.zoom + state.panX + RULER_SIZE;
    if (sx < RULER_SIZE || sx > fullW) continue;
    const by = fullH - RULER_SIZE;
    ctx.beginPath();
    ctx.moveTo(sx, by + 4);
    ctx.lineTo(sx, by + 10);
    ctx.stroke();
    if (tickStep >= 10 && x % (GRID_SIZE * 5) === 0) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(formatDim(worldToDim('v', x)), sx, by + 12);
    }
  }

  drawGuideBaseLabels(fullW, fullH);

  if (state.previewGuide) {
    ctx.strokeStyle = 'rgba(240, 160, 48, 0.95)';
    ctx.lineWidth = 2;
    if (state.previewGuide.axis === 'h') {
      const sy = state.previewGuide.value * state.zoom + state.panY;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(RULER_SIZE, sy);
      ctx.stroke();
    } else {
      const sx = state.previewGuide.value * state.zoom + state.panX + RULER_SIZE;
      ctx.beginPath();
      ctx.moveTo(sx, fullH - RULER_SIZE);
      ctx.lineTo(sx, fullH);
      ctx.stroke();
    }
  }

  ctx.restore();
}

// Position-value chips at each guide's base on its ruler. Clicking one is just a
// ruler click on that guide, so it routes through handleRulerDown's edit path.
function drawGuideBaseLabels(fullW, fullH) {
  const sel = state.selectedGuide;
  ctx.font = '9px IBM Plex Mono, monospace';
  const bottom = fullH - RULER_SIZE;

  // Horizontal guides → left ruler, labelled by their world-Y position.
  for (const yv of state.guidesH) {
    const sy = yv * state.zoom + state.panY;
    if (sy < 6 || sy > bottom - 6) continue;
    const active = sel && sel.type === 'h' && sel.value === yv;
    drawRulerGuideChip('h', RULER_SIZE, sy, formatDim(worldToDim('h', yv)), active);
  }
  // Vertical guides → bottom ruler, labelled by their world-X position.
  for (const xv of state.guidesV) {
    const sx = xv * state.zoom + state.panX + RULER_SIZE;
    if (sx < RULER_SIZE + 6 || sx > fullW - 6) continue;
    const active = sel && sel.type === 'v' && sel.value === xv;
    drawRulerGuideChip('v', sx, bottom, formatDim(worldToDim('v', xv)), active);
  }
}

function drawRulerGuideChip(axis, x, y, text, active) {
  const tw = ctx.measureText(text).width;
  const padX = 3, hChip = 12;
  ctx.fillStyle = active ? 'rgba(240, 160, 48, 0.95)' : 'rgba(78, 205, 196, 0.92)';
  if (axis === 'h') {
    // Right-aligned against the ruler/canvas seam on the vertical ruler.
    const right = x - 1;
    ctx.fillRect(right - tw - padX * 2, y - hChip / 2, tw + padX * 2, hChip);
    ctx.fillStyle = '#0e0f11';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, right - padX, y + 0.5);
  } else {
    // Top-aligned against the ruler/canvas seam on the bottom ruler.
    ctx.fillRect(x - tw / 2 - padX, y + 1, tw + padX * 2, hChip);
    ctx.fillStyle = '#0e0f11';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 1 + hChip / 2 + 0.5);
  }
}

function render() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0e0f11';
  ctx.fillRect(RULER_SIZE, 0, drawAreaSize().w, drawAreaSize().h);

  ctx.save();
  ctx.beginPath();
  ctx.rect(RULER_SIZE, 0, drawAreaSize().w, drawAreaSize().h);
  ctx.clip();
  ctx.translate(RULER_SIZE + state.panX, state.panY);
  ctx.scale(state.zoom, state.zoom);

  drawGrid();
  drawGuides();

  drawHatches();

  for (const shape of state.shapes) {
    const selected = state.selectedIds.has(shape.id);
    drawShape(shape, false, selected);
    if (selected) drawSnapPoints(shape);
  }

  drawBrushPreview();

  if ((state.isDraggingShapes || state.isDraggingGuide || state.isCarrying) && state.dragSnapTarget) {
    const t = state.dragSnapTarget;
    ctx.beginPath();
    ctx.arc(t.x, t.y, 5.5 / state.zoom, 0, Math.PI * 2);
    ctx.strokeStyle = '#f0a030';
    ctx.lineWidth = 2 / state.zoom;
    ctx.stroke();
  }

  if (state.isDrawing && state.drawStart && state.drawCurrent) {
    const preview = buildPreviewShape();
    if (preview) drawShape(preview, true);
  }

  drawSegmentPreview();
  drawMarquee();
  ctx.restore();

  drawDimensions();
  drawPlacementDimensions();
  drawMoveReadout();
  drawRulers();
}

function buildPreviewShape() {
  const box = previewBox();
  if (!box) return null;
  const type = ['rect', 'square', 'ellipse', 'circle'].includes(state.tool) ? state.tool : 'rect';
  return { type, ...box };
}

function finalizeShape() {
  const preview = buildPreviewShape();
  if (!preview) return false;
  const { x, y, x2, y2 } = preview;
  const minSize = 2 / state.zoom;
  if (Math.abs(x2 - x) < minSize && Math.abs(y2 - y) < minSize) return false;
  const shape = { id: nextId++, ...preview };
  state.shapes.push(shape);
  state.selectedIds = new Set([shape.id]);
  recordHistory();
  return true;
}

function startPlacement(pt) {
  state.isDrawing = true;
  state.drawStart = pt;
  state.drawCurrent = pt;
  state.drawEntry = null;
  updateStatus();
  render();
}

function commitDraw() {
  finalizeShape();
  state.isDrawing = false;
  state.drawStart = null;
  state.drawCurrent = null;
  state.drawEntry = null;
  snapIndicator.hidden = true;
  updateStatus();
  render();
}

function cancelPlacement() {
  state.isDrawing = false;
  state.drawStart = null;
  state.drawCurrent = null;
  state.drawEntry = null;
}

// Typed dimension entry during placement. Returns true if the key was consumed.
function handleDrawDimKey(e) {
  const fields = drawFields();
  if (!fields.length) return false;
  if (!state.drawEntry) state.drawEntry = { active: 0, typed: {} };
  const key = fields[state.drawEntry.active] ?? fields[0];
  const cur = state.drawEntry.typed[key] ?? '';
  const k = e.key;

  if (k >= '0' && k <= '9') { state.drawEntry.typed[key] = cur + k; }
  else if (k === '.') { if (!cur.includes('.')) state.drawEntry.typed[key] = cur + '.'; }
  else if (k === 'Backspace') { state.drawEntry.typed[key] = cur.slice(0, -1); }
  else if (k === 'Tab') { state.drawEntry.active = (state.drawEntry.active + 1) % fields.length; }
  else if (k === 'Enter') { e.preventDefault(); commitDraw(); return true; }
  else return false;

  e.preventDefault();
  updateStatus();
  render();
  return true;
}

const FIELD_LABEL = { w: 'W', h: 'H', s: 'S', d: '⌀' };

function fieldText(key, value) {
  const fields = drawFields();
  const active = fields[state.drawEntry?.active ?? 0] === key;
  const typed = state.drawEntry?.typed?.[key] ?? '';
  const shown = typed !== '' ? typed : fmtLen(value);
  return { shown, active };
}

function drawDimLineScreen(ax, ay, bx, by) {
  if (Math.hypot(bx - ax, by - ay) < 1) return;
  ctx.strokeStyle = 'rgba(240, 160, 48, 0.9)';
  ctx.fillStyle = 'rgba(240, 160, 48, 0.9)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  const ang = Math.atan2(by - ay, bx - ax);
  drawArrowhead(bx, by, ang);
  drawArrowhead(ax, ay, ang + Math.PI);
}

function drawDimChip(cx, cy, key, ft) {
  const text = `${FIELD_LABEL[key]} ${ft.shown}${ft.active ? '█' : ''}`;
  ctx.font = '11px IBM Plex Mono, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = ft.active ? 'rgba(240, 160, 48, 0.95)' : 'rgba(14, 15, 17, 0.92)';
  ctx.fillRect(cx - tw / 2 - 6, cy - 9, tw + 12, 18);
  ctx.fillStyle = ft.active ? '#0e0f11' : '#f0a030';
  ctx.fillText(text, cx, cy);
}

// Live W/H (or S / diameter) dimension annotations while a primitive is placed.
function drawPlacementDimensions() {
  if (!state.isDrawing || !state.drawStart || !state.drawCurrent) return;
  const p = buildPreviewShape();
  if (!p) return;
  const dpr = window.devicePixelRatio || 1;
  const { w: areaW, h: areaH } = drawAreaSize();
  const left = worldToScreen(Math.min(p.x, p.x2), 0).x;
  const right = worldToScreen(Math.max(p.x, p.x2), 0).x;
  const top = worldToScreen(0, Math.min(p.y, p.y2)).y;
  const bottom = worldToScreen(0, Math.max(p.y, p.y2)).y;
  const W = Math.abs(p.x2 - p.x), H = Math.abs(p.y2 - p.y);
  const fields = drawFields();
  const off = 20;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.beginPath();
  ctx.rect(RULER_SIZE, 0, areaW, areaH);
  ctx.clip();

  // Width / size / diameter along the bottom
  const widthKey = fields.includes('w') ? 'w' : fields.includes('s') ? 's' : 'd';
  const widthVal = widthKey === 'd' ? Math.min(W, H) : W;
  const yb = bottom + off;
  drawDimLineScreen(left, yb, right, yb);
  drawDimChip((left + right) / 2, yb, widthKey, fieldText(widthKey, widthVal));

  // Height to the right (rect / ellipse only)
  if (fields.includes('h')) {
    const xr = right + off;
    drawDimLineScreen(xr, top, xr, bottom);
    drawDimChip(xr, (top + bottom) / 2, 'h', fieldText('h', H));
  }

  ctx.restore();
}

function signFmt(v) {
  return (v >= 0 ? '+' : '') + formatDim(v);
}

function drawValueChip(x, y, cell) {
  const tw = ctx.measureText(cell.text).width;
  ctx.fillStyle = cell.active ? 'rgba(240, 160, 48, 0.95)' : 'rgba(14, 15, 17, 0.92)';
  ctx.fillRect(x - 4, y - 9, tw + 8, 18);
  ctx.fillStyle = cell.active ? '#0e0f11' : '#f0a030';
  ctx.fillText(cell.text, x, y);
}

// X/Y position + ΔX/ΔY deltas of the moving object, near its top-left corner.
function drawMoveReadout() {
  if (!state.isDraggingShapes && !state.isCarrying) return;
  const r = moveReadout();
  const shape = state.shapes.find(s => s.id === state.movePrimaryId);
  if (!r || !shape) return;
  const b = getShapeBounds(shape);
  const tl = worldToScreen(b.left, b.top);
  const dpr = window.devicePixelRatio || 1;
  const { w: areaW, h: areaH } = drawAreaSize();

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.beginPath();
  ctx.rect(RULER_SIZE, 0, areaW, areaH);
  ctx.clip();
  ctx.font = '11px IBM Plex Mono, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  const activeKey = state.isCarrying ? MOVE_FIELDS[state.moveEntry?.active ?? 0] : null;
  const typed = state.moveEntry?.typed || {};
  const cell = (key, label, value, signed) => {
    const t = typed[key];
    const shown = (t != null && t !== '') ? t : (signed ? signFmt(value) : formatDim(value));
    return { text: `${label} ${shown}${key === activeKey ? '█' : ''}`, active: key === activeKey };
  };
  const cells = [cell('x', 'X', r.x, false), cell('y', 'Y', r.y, false),
    cell('dx', 'ΔX', r.dx, true), cell('dy', 'ΔY', r.dy, true)];

  const lh = 18, gap = 8;
  const colW = Math.max(ctx.measureText(cells[0].text).width, ctx.measureText(cells[2].text).width) + 8 + gap;
  const col0 = Math.max(RULER_SIZE + 4, tl.x);
  const rowTop = Math.max(lh + 4, tl.y - 10 - lh - 4 - lh);
  const rowBot = rowTop + lh + 4;
  drawValueChip(col0, rowTop, cells[0]);
  drawValueChip(col0 + colW, rowTop, cells[1]);
  drawValueChip(col0, rowBot, cells[2]);
  drawValueChip(col0 + colW, rowBot, cells[3]);

  ctx.restore();
}

function finalizeMarquee() {
  if (!state.marqueeStart || !state.marqueeCurrent) return;
  const left = Math.min(state.marqueeStart.x, state.marqueeCurrent.x);
  const top = Math.min(state.marqueeStart.y, state.marqueeCurrent.y);
  const right = Math.max(state.marqueeStart.x, state.marqueeCurrent.x);
  const bottom = Math.max(state.marqueeStart.y, state.marqueeCurrent.y);
  if (Math.abs(right - left) < 3 / state.zoom && Math.abs(bottom - top) < 3 / state.zoom) {
    if (!state._shiftHeld) state.selectedIds.clear();
    return;
  }
  const hits = new Set();
  for (const shape of state.shapes) {
    if (shapeIntersectsRect(shape, left, top, right, bottom)) hits.add(shape.id);
  }
  state.selectedIds = state._shiftHeld ? new Set([...state.selectedIds, ...hits]) : hits;
}

// ─── UI ───────────────────────────────────────────────────────────────────────
function setTool(tool) {
  if (!HATCH_ENABLED && (tool === 'brush' || tool === 'eraser')) tool = 'select';
  if (state.textEditing) commitText();
  if (tool !== 'protractor') resetProtractor();
  state.segmentStart = null;
  state.segmentHover = null;
  state.segmentSpan = null;
  state.selectedGuide = null;
  cancelPlacement();
  endShapeDrag();
  state.isDraggingGuide = false;
  state.brushAngleKey = null;
  state.brushLast = null;
  state.eraserDown = false;
  state.eraserLast = null;
  workspace.style.cursor = (tool === 'brush' || tool === 'eraser') ? 'none' : (tool === 'text' ? 'text' : '');
  state.tool = tool;
  document.querySelectorAll('.tool').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });
  workspace.classList.toggle('selecting', tool === 'select');
  if (tool === 'protractor') workspace.focus();
  updateStatus();
  render();
}

function updateStatus() {
  if (state.textEditing) {
    statusEl.textContent = 'Type · Enter commit · Shift+Enter newline · Esc cancel';
    return;
  }
  if (state.isDraggingShapes || state.isCarrying) {
    const r = moveReadout();
    if (r) {
      let s = `X ${formatDim(r.x)} · Y ${formatDim(r.y)} · ΔX ${signFmt(r.dx)} · ΔY ${signFmt(r.dy)} ${unitLabel()}`;
      if (state.isCarrying) s += ' · type / Tab · click or Enter';
      statusEl.textContent = s;
      return;
    }
  }
  if (state.previewGuide) {
    const { axis, value } = state.previewGuide;
    const dim = formatDim(worldToDim(axis, value));
    if (state.dimEntry !== null) {
      statusEl.textContent = `${state.dimEntry || '0'} ${unitLabel()} · Enter to place`;
    } else {
      statusEl.textContent = `${axis === 'h' ? 'Y' : 'X'} ${dim} ${unitLabel()} · type for exact`;
    }
    return;
  }
  if (state.isDrawing) {
    const p = buildPreviewShape();
    if (p) {
      const W = Math.abs(p.x2 - p.x), H = Math.abs(p.y2 - p.y);
      const fields = drawFields();
      const parts = fields.map(k => k === 'd'
        ? `⌀ ${fmtLen(Math.min(W, H))}`
        : `${FIELD_LABEL[k]} ${fmtLen(k === 'h' ? H : W)}`);
      statusEl.textContent = `${parts.join(' · ')} ${unitLabel()} · type / Tab · click or Enter`;
      return;
    }
  }
  if (state.tool === 'protractor') {
    if (state.protractorActive) {
      const deg = Math.round(((state.protractorAngle ?? 0) * 180) / Math.PI);
      statusEl.textContent = `${deg}° · scroll or drag · click to place`;
    } else {
      statusEl.textContent = 'Protractor · click grid or vertex';
    }
    return;
  }
  if (state.tool === 'brush') {
    if (state.brushAngleKey) {
      const deg = Math.round((HATCH_ANGLES[state.brushAngleKey] * 180) / Math.PI);
      statusEl.textContent = `Hatch ${deg}° · move to paint · release to lift`;
    } else {
      statusEl.textContent = 'Brush · hold 1 / 2 / 3 / 4 to hatch · trackpad moves';
    }
    return;
  }
  if (state.tool === 'eraser') {
    statusEl.textContent = state.eraserDown
      ? 'Erasing · move to wipe hatches'
      : 'Eraser · hold 1–4 and move to wipe hatches';
    return;
  }
  if (isSegmentTool()) {
    if (!getCrossings().length) {
      statusEl.textContent = 'Place guides first';
    } else if (state.tool === 'stroke') {
      statusEl.textContent = state.segmentSpan
        ? 'Stroke · click to draw this segment'
        : 'Stroke · click a guide segment between two crossings';
    } else if (state.segmentStart) {
      statusEl.textContent = 'Click second crossing';
    } else {
      statusEl.textContent = `${state.tool} · click two crossings`;
    }
    return;
  }
  if (state.tool === 'text') {
    statusEl.textContent = 'Text · click empty to place · click a shape to attach · Tab on a selection';
    return;
  }
  statusEl.textContent = state.tool.charAt(0).toUpperCase() + state.tool.slice(1);
}

function updateCrossingOverlay(crossing) {
  if (!crossing) { snapIndicator.hidden = true; return; }
  const s = worldToScreen(crossing.x, crossing.y);
  snapIndicator.style.left = `${s.x - RULER_SIZE}px`;
  snapIndicator.style.top = `${s.y}px`;
  snapIndicator.hidden = false;
}

function updateOverlays(clientX, clientY, snap) {
  if (snap) {
    const sx = snap.x * state.zoom + state.panX;
    const sy = snap.y * state.zoom + state.panY;
    snapIndicator.style.left = `${sx}px`;
    snapIndicator.style.top = `${sy}px`;
    snapIndicator.hidden = false;
    statusEl.textContent = `Snap · ${snap.kind === 'grid' ? 'grid' : snap.kind}`;
  } else if (!isSegmentTool()) {
    snapIndicator.hidden = true;
    if (!state.isDrawing && !state.isMarquee) updateStatus();
  }

  if (state.tool !== 'select' && state.tool !== 'text' && !state.isPanning && !isSegmentTool()) {
    const rect = canvas.getBoundingClientRect();
    crosshair.style.left = `${clientX - rect.left - RULER_SIZE}px`;
    crosshair.style.top = `${clientY - rect.top}px`;
    crosshair.hidden = false;
  } else {
    crosshair.hidden = true;
  }
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const rect = workspace.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  render();
}

// ─── Ruler input ──────────────────────────────────────────────────────────────
function handleRulerMove(axis, clientPos, shiftKey) {
  // While typing an exact dimension on this axis, freeze pointer tracking.
  if (state.dimEntry !== null && state.previewGuide?.axis === axis) {
    updateStatus();
    return;
  }
  const value = axis === 'h' ? worldYFromClientY(clientPos) : worldXFromClientX(clientPos);
  state.previewGuide = { axis, value };
  updateStatus();
  render();
}

function handleRulerDown(axis, clientPos, shiftKey) {
  state.dimEntry = null;
  state.dimEntryReplace = false;
  const raw = axis === 'h' ? rawWorldYFromClientY(clientPos) : rawWorldXFromClientX(clientPos);

  if (shiftKey) {
    removeNearestGuide(axis, raw);
    state.previewGuide = { axis, value: snapGuideValue(raw) };
    recordHistory();
    updateStatus();
    render();
    return;
  }

  // Clicking on (or very near) an existing guide picks it up for editing: lift it out
  // and seed the exact-entry buffer with its current value so it can be retyped.
  const hit = nearestGuideValue(axis, raw, SNAP_RADIUS / state.zoom);
  if (hit !== null) {
    removeGuide(axis, hit);
    state.previewGuide = { axis, value: hit };
    state.dimEntry = formatDim(worldToDim(axis, hit));
    state.dimEntryReplace = true; // show current value; first keystroke types fresh
    updateStatus();
    render();
    return;
  }

  const value = snapGuideValue(raw);
  addGuide(axis, value);
  state.previewGuide = { axis, value };
  recordHistory();
  updateStatus();
  render();
}

function handleRulerLeave() {
  if (state.dimEntry !== null) return; // keep the preview alive so Enter can still place it
  state.previewGuide = null;
  updateStatus();
  render();
}

function bindRuler(el, axis) {
  el.addEventListener('pointermove', (e) => {
    handleRulerMove(axis, axis === 'h' ? e.clientY : e.clientX, e.shiftKey);
  });
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handleRulerDown(axis, axis === 'h' ? e.clientY : e.clientX, e.shiftKey);
  });
  el.addEventListener('pointerleave', handleRulerLeave);
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (state.dimEntry !== null && state.previewGuide?.axis === axis) return; // frozen while typing
    const rawDelta = axis === 'h' ? e.deltaY : (e.deltaX !== 0 ? e.deltaX : e.deltaY);
    const delta = rawDelta / state.zoom;
    const current = state.previewGuide?.axis === axis
      ? state.previewGuide.value
      : (axis === 'h' ? worldYFromClientY(e.clientY) : worldXFromClientX(e.clientX));
    const next = snapGuideValue(current + delta);
    state.previewGuide = { axis, value: next };
    if (e.ctrlKey || e.metaKey) addGuide(axis, next);
    updateStatus();
    render();
  }, { passive: false });
}

// ─── Canvas input ─────────────────────────────────────────────────────────────
function getPointerPos(e) {
  return screenToWorld(e.clientX, e.clientY);
}

// ─── Brush / cross-hatch ────────────────────────────────────────────────────────
// Stamp one brush footprint at (cx, cy): fill the rectangle (perpendicular to the
// hatch) with parallel marks snapped to the angle's lattice, de-duped via hatchKeySet.
function stampHatch(cx, cy, ang) {
  const ux = Math.cos(ang), uy = Math.sin(ang);   // along the hatch line
  const nx = -Math.sin(ang), ny = Math.cos(ang);  // perpendicular (across lines)
  const along0 = cx * ux + cy * uy;
  const off0 = cx * nx + cy * ny;
  const aIdx = HATCH_ANGLE_IDX[brushKeyFor(ang)] ?? 0;
  const liMin = Math.round((off0 - BRUSH_LEN / 2) / HATCH_SPACING);
  const liMax = Math.round((off0 + BRUSH_LEN / 2) / HATCH_SPACING);
  const ciMin = Math.round((along0 - BRUSH_THICK / 2) / HATCH_CELL);
  const ciMax = Math.round((along0 + BRUSH_THICK / 2) / HATCH_CELL);
  const hx = (HATCH_CELL / 2) * ux, hy = (HATCH_CELL / 2) * uy;
  for (let li = liMin; li <= liMax; li++) {
    const off = li * HATCH_SPACING;
    for (let ci = ciMin; ci <= ciMax; ci++) {
      const key = `${aIdx}:${li}:${ci}`;
      if (state.hatchKeySet.has(key)) continue;
      const along = ci * HATCH_CELL;
      const ctrx = along * ux + off * nx;
      const ctry = along * uy + off * ny;
      state.hatchKeySet.add(key);
      state.hatches.push({ key, x1: ctrx - hx, y1: ctry - hy, x2: ctrx + hx, y2: ctry + hy });
    }
  }
}

function brushKeyFor(ang) {
  for (const k in HATCH_ANGLES) if (HATCH_ANGLES[k] === ang) return k;
  return '1';
}

// Stamp continuously along the pointer path so fast trackpad moves leave no gaps.
function stampStroke(from, to, ang) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / BRUSH_STEP));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    stampHatch(from.x + dx * t, from.y + dy * t, ang);
  }
}

// Remove every hatch mark whose midpoint falls inside the eraser square at p.
function eraseAt(p) {
  const r = ERASER_SIZE / 2;
  state.hatches = state.hatches.filter(h => {
    const mx = (h.x1 + h.x2) / 2, my = (h.y1 + h.y2) / 2;
    const hit = Math.abs(mx - p.x) <= r && Math.abs(my - p.y) <= r;
    if (hit) state.hatchKeySet.delete(h.key);
    return !hit;
  });
}

function eraseStroke(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / BRUSH_STEP));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    eraseAt({ x: from.x + dx * t, y: from.y + dy * t });
  }
}

// Pointer hover while the brush/eraser is active. The trackpad only moves the tool;
// painting happens only while a key is held (brushAngleKey / eraserDown).
function handleBrushMove(raw) {
  state._hoverWorld = raw;
  if (state.tool === 'brush' && state.brushAngleKey) {
    stampStroke(state.brushLast || raw, raw, HATCH_ANGLES[state.brushAngleKey]);
    state.brushLast = raw;
  } else if (state.tool === 'eraser' && state.eraserDown) {
    eraseStroke(state.eraserLast || raw, raw);
    state.eraserLast = raw;
  }
  crosshair.hidden = true;
  snapIndicator.hidden = true;
  updateStatus();
  render();
}

// Key down for 1–4 while the brush/eraser tool is active: press the pen to paper.
function handleBrushKeyDown(e) {
  if (!(e.key in HATCH_ANGLES)) return false;   // note: key '1' maps to angle 0 (falsy)
  if (e.repeat) return true;
  const c = state._hoverWorld;
  if (state.tool === 'brush') {
    state.brushAngleKey = e.key;
    state.brushAngle = HATCH_ANGLES[e.key];
    if (c) { state.brushLast = c; stampHatch(c.x, c.y, HATCH_ANGLES[e.key]); }
  } else {
    state.eraserDown = true;
    if (c) { state.eraserLast = c; eraseAt(c); }
  }
  updateStatus();
  render();
  return true;
}

function handleBrushKeyUp(e) {
  if (!(e.key in HATCH_ANGLES)) return;
  if (state.tool === 'brush' && state.brushAngleKey === e.key) {
    state.brushAngleKey = null;
    state.brushLast = null;
    updateStatus();
    render();
  } else if (state.tool === 'eraser') {
    state.eraserDown = false;
    state.eraserLast = null;
    updateStatus();
    render();
  }
}

function isBrushTool() {
  return HATCH_ENABLED && (state.tool === 'brush' || state.tool === 'eraser');
}

// ─── Text annotations ─────────────────────────────────────────────────────────
// A text item is a shape ({ type:'text', x, y, text, attachTo }) so it reuses
// select / move / marquee / delete. (x, y) is the box's top-left in world space.
// When attachTo is set, the text rides along whenever its parent shape is moved
// (see beginShapeDrag) and draws a faint leader to it.
function textLines(shape) {
  return String(shape.text ?? '').split('\n');
}

function measureTextShape(shape) {
  ctx.font = `${TEXT_SIZE}px ${TEXT_FONT}`;
  const lines = textLines(shape);
  let maxW = TEXT_SIZE * 0.6; // keep an empty box clickable
  for (const ln of lines) maxW = Math.max(maxW, ctx.measureText(ln).width);
  return { w: maxW, h: Math.max(1, lines.length) * TEXT_LINE, lines };
}

function drawTextConnector(shape) {
  const parent = state.shapes.find(s => s.id === shape.attachTo);
  if (!parent) return;
  const pb = getShapeBounds(parent);
  const tb = getShapeBounds(shape);
  ctx.beginPath();
  ctx.moveTo((tb.left + tb.right) / 2, (tb.top + tb.bottom) / 2);
  ctx.lineTo((pb.left + pb.right) / 2, (pb.top + pb.bottom) / 2);
  ctx.strokeStyle = 'rgba(240, 160, 48, 0.3)';
  ctx.lineWidth = 1 / state.zoom;
  ctx.setLineDash([3 / state.zoom, 3 / state.zoom]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawTextShape(shape, isSelected) {
  const editing = state.textEditing?.id === shape.id;
  if (shape.attachTo != null) drawTextConnector(shape);

  const m = measureTextShape(shape);
  const boxW = m.w + TEXT_PAD * 2, boxH = m.h + TEXT_PAD * 2;

  ctx.fillStyle = editing ? 'rgba(240, 160, 48, 0.12)' : 'rgba(14, 15, 17, 0.55)';
  ctx.fillRect(shape.x, shape.y, boxW, boxH);

  if (isSelected || editing) {
    ctx.strokeStyle = editing ? '#f0a030' : 'rgba(240, 160, 48, 0.7)';
    ctx.lineWidth = 1 / state.zoom;
    ctx.setLineDash(editing ? [4 / state.zoom, 3 / state.zoom] : []);
    ctx.strokeRect(shape.x, shape.y, boxW, boxH);
    ctx.setLineDash([]);
  }

  ctx.font = `${TEXT_SIZE}px ${TEXT_FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = (isSelected || editing) ? '#f0a030' : '#e8eaed';
  for (let i = 0; i < m.lines.length; i++) {
    ctx.fillText(m.lines[i], shape.x + TEXT_PAD, shape.y + TEXT_PAD + i * TEXT_LINE);
  }

  if (editing) {
    const last = m.lines[m.lines.length - 1] ?? '';
    const cx = shape.x + TEXT_PAD + ctx.measureText(last).width;
    const cy = shape.y + TEXT_PAD + (m.lines.length - 1) * TEXT_LINE;
    ctx.fillStyle = '#f0a030';
    ctx.fillRect(cx + 1, cy, Math.max(1.5 / state.zoom, 1), TEXT_SIZE);
  }
}

// Standalone text drops its own grid vertex (on commit); attached text links to a shape.
function createStandaloneText(pt) {
  const shape = { id: nextId++, type: 'text', x: pt.x, y: pt.y, text: '', attachTo: null };
  state.shapes.push(shape);
  state.selectedIds = new Set([shape.id]);
  state.selectedGuide = null;
  state.textEditing = { id: shape.id, vertexAnchor: { x: pt.x, y: pt.y } };
  workspace.focus();
  updateStatus();
  render();
}

function createAttachedText(parent, pt) {
  const b = getShapeBounds(parent);
  const anchor = pt ?? { x: b.left, y: b.top - (TEXT_LINE + TEXT_PAD * 2) - 6 };
  const shape = { id: nextId++, type: 'text', x: anchor.x, y: anchor.y, text: '', attachTo: parent.id };
  state.shapes.push(shape);
  state.selectedIds = new Set([shape.id]);
  state.selectedGuide = null;
  state.textEditing = { id: shape.id, vertexAnchor: null };
  workspace.focus();
  updateStatus();
  render();
}

function startEditText(id) {
  state.selectedIds = new Set([id]);
  state.selectedGuide = null;
  state.textEditing = { id, vertexAnchor: null };
  workspace.focus();
  updateStatus();
  render();
}

function commitText() {
  const ed = state.textEditing;
  if (!ed) return;
  state.textEditing = null;
  const t = state.shapes.find(s => s.id === ed.id);
  if (t) {
    if (String(t.text).trim() === '') {
      state.shapes = state.shapes.filter(s => s.id !== t.id); // drop empty text
      state.selectedIds.delete(t.id);
    } else if (ed.vertexAnchor) {
      addGridVertex(ed.vertexAnchor); // standalone text creates its own vertex
    }
  }
  recordHistory();   // no-op if an empty text was created then discarded
  updateStatus();
  render();
}

// Typed entry while a text item is being edited. Returns true if the key was consumed.
function handleTextKey(e) {
  const t = state.shapes.find(s => s.id === state.textEditing.id);
  if (!t) { state.textEditing = null; return false; }
  const k = e.key;
  if (k === 'Escape') { e.preventDefault(); commitText(); return true; }
  if (k === 'Enter') {
    e.preventDefault();
    if (e.shiftKey) { t.text += '\n'; render(); }
    else commitText();
    return true;
  }
  if (k === 'Backspace') {
    e.preventDefault();
    t.text = String(t.text).slice(0, -1);
    updateStatus(); render();
    return true;
  }
  if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    t.text += k;
    updateStatus(); render();
    return true;
  }
  // Swallow everything else (arrows, Tab, function keys) so it can't leak to tools.
  if (!['Shift', 'Control', 'Alt', 'Meta'].includes(k)) e.preventDefault();
  return true;
}

function handleSegmentClick(crossing) {
  if (!crossing) return;
  if (!state.segmentStart) {
    state.segmentStart = crossing;
    state.segmentHover = null;
    updateCrossingOverlay(crossing);
    updateStatus();
    render();
    return;
  }
  addSegment(state.segmentStart, crossing);
  state.segmentStart = null;
  state.segmentHover = null;
  snapIndicator.hidden = true;
  updateStatus();
  render();
}

function onPointerDown(e) {
  if (e.button === 1 || (e.button === 0 && state.spaceHeld)) {
    state.isPanning = true;
    state._panStart = { x: e.clientX, y: e.clientY, panX: state.panX, panY: state.panY };
    workspace.classList.add('panning');
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  if (e.button !== 0) return;

  const raw = getPointerPos(e);

  // Clicking anywhere finalizes an in-progress text edit first.
  if (state.textEditing) commitText();

  // A click while carrying drops the object at the (possibly typed) position.
  if (state.isCarrying) {
    updateShapeMove(raw);
    commitMove();
    return;
  }

  // Brush/eraser ignore clicks entirely — the trackpad moves them, keys deposit.
  if (isBrushTool()) return;

  if (isSegmentTool()) {
    // Stroke: one click on a guide segment (between two adjacent crossings) makes it.
    if (state.tool === 'stroke') {
      const seg = segmentUnderCursor(raw);
      if (seg) {
        addSegment(seg.a, seg.b);
        state.segmentSpan = null;
        snapIndicator.hidden = true;
        updateStatus();
        render();
      }
      return;
    }
    handleSegmentClick(snapSegmentPoint(raw));
    return;
  }

  if (state.tool === 'protractor') {
    if (state.protractorActive) {
      if (state._protractorArmPending) return;
      placeProtractorGuide();
      snapIndicator.hidden = true;
      updateStatus();
      render();
      return;
    }
    const vertex = findVertexAt(raw.x, raw.y) ?? addGridVertex(raw);
    activateProtractor(vertex, raw);
    updateCrossingOverlay(vertex);
    recordHistory();   // records only when a new grid vertex was actually dropped
    updateStatus();
    render();
    return;
  }

  if (state.tool === 'text') {
    const hit = findShapeAt(raw.x, raw.y);
    if (hit && hit.type === 'text') { startEditText(hit.id); return; }
    const { pt } = applySnap(raw);
    if (hit) createAttachedText(hit, pt); // click a shape → attach
    else createStandaloneText(pt);        // click empty → own vertex
    return;
  }

  const { pt, snap } = applySnap(raw);
  state.activeSnap = snap;

  if (state.tool === 'select') {
    const hit = findShapeAt(raw.x, raw.y);
    if (hit) {
      if (state._shiftHeld) {
        if (state.selectedIds.has(hit.id)) state.selectedIds.delete(hit.id);
        else state.selectedIds.add(hit.id);
      } else {
        // Clicking an already-selected shape (no drag) will "pick it up" for typed
        // entry; otherwise this is a normal select + drag.
        state._movePickupEligible = state.selectedIds.has(hit.id);
        state._moveDownClient = { x: e.clientX, y: e.clientY };
        if (!state.selectedIds.has(hit.id)) state.selectedIds = new Set([hit.id]);
        state.selectedGuide = null;
        beginShapeDrag(raw, hit.id, e.pointerId);
      }
      render();
      return;
    }

    const hitGuide = hitTestGuide(raw.x, raw.y);
    if (hitGuide) {
      state.selectedIds.clear();
      beginGuideDrag(hitGuide, raw, e.pointerId);
      render();
      return;
    }

    state.isMarquee = true;
    state.marqueeStart = raw;
    state.marqueeCurrent = raw;
    state.selectedGuide = null;
    if (!state._shiftHeld) state.selectedIds.clear();
    canvas.setPointerCapture(e.pointerId);
    render();
    return;
  }

  // Click–move–click placement for box/ellipse primitives.
  if (!state.isDrawing) {
    startPlacement(pt);
  } else {
    state.drawCurrent = pt;
    commitDraw();
  }
}

function onPointerMove(e) {
  if (state.isPanning && state._panStart) {
    state.panX = state._panStart.panX + (e.clientX - state._panStart.x);
    state.panY = state._panStart.panY + (e.clientY - state._panStart.y);
    render();
    return;
  }

  const raw = getPointerPos(e);

  if (isBrushTool()) { handleBrushMove(raw); return; }

  if (state.isDraggingShapes || state.isCarrying) {
    updateShapeMove(raw);
    updateStatus();
    render();
    return;
  }

  if (state.isDraggingGuide) {
    updateGuideDrag(raw);
    updateStatus();
    render();
    return;
  }

  if (isSegmentTool()) {
    if (state.tool === 'stroke') {
      state.segmentSpan = segmentUnderCursor(raw);
      snapIndicator.hidden = true;
      render();
      return;
    }
    state.segmentHover = state.segmentStart ? crossingsOnGuideFrom(state.segmentStart, raw) : nearestCrossing(raw);
    updateCrossingOverlay(state.segmentHover || state.segmentStart);
    render();
    return;
  }

  if (state.tool === 'protractor') {
    state._protractorPointer = raw;
    if (state.protractorActive) {
      setProtractorAngleFromPointer(raw.x, raw.y);
      updateStatus();
    }
    const vertex = findVertexAt(raw.x, raw.y);
    updateCrossingOverlay(vertex || state.protractorVertex);
    render();
    return;
  }

  if (state.tool === 'select' && !state.isMarquee) {
    const overMovable = findShapeAt(raw.x, raw.y) || hitTestGuide(raw.x, raw.y);
    workspace.style.cursor = overMovable ? 'move' : '';
  }

  state._hoverWorld = raw;
  const { pt, snap } = applySnap(raw);
  state.activeSnap = snap;
  updateOverlays(e.clientX, e.clientY, snap);

  if (state.isMarquee) state.marqueeCurrent = raw;
  else if (state.isDrawing) { state.drawCurrent = pt; updateStatus(); }
  render();
}

function onPointerUp(e) {
  if (state._protractorArmPending) {
    state._protractorArmPending = false;
  }

  if (state.isPanning) {
    state.isPanning = false;
    state._panStart = null;
    workspace.classList.remove('panning');
    return;
  }

  if (state.isDraggingShapes) {
    const down = state._moveDownClient;
    const moved = !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4;
    if (!moved && state._movePickupEligible) {
      // Click on an already-selected shape → pick it up for no-button typed move.
      state.isDraggingShapes = false;
      state.isCarrying = true;
      state.moveEntry = { active: 0, typed: {} };
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      updateStatus();
      render();
      return;
    }
    endShapeDrag();
    render();
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    return;
  }

  if (state.isDraggingGuide) {
    finishGuideDrag(true);
    updateStatus();
    render();
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    return;
  }

  if (state.isMarquee) {
    state.isMarquee = false;
    finalizeMarquee();
    state.marqueeStart = null;
    state.marqueeCurrent = null;
    render();
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    return;
  }

  // Primitive placement commits on the second click (onPointerDown), not on release.

  try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
}

function onWheel(e) {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left - RULER_SIZE;
  const my = e.clientY - rect.top;

  if (handleProtractorWheel(e)) return;

  if (e.ctrlKey || e.metaKey) {
    const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.zoom * factor));
    const scale = newZoom / state.zoom;
    state.panX = mx - (mx - state.panX) * scale;
    state.panY = my - (my - state.panY) * scale;
    state.zoom = newZoom;
  } else {
    state.panX -= e.deltaX;
    state.panY -= e.deltaY;
  }

  render();
  if (!state.previewGuide && !isSegmentTool()) statusEl.textContent = `${Math.round(state.zoom * 100)}%`;
}

const TOOL_KEYS = {
  v: 'select', p: 'stroke', l: 'line', t: 'protractor', s: 'square', e: 'ellipse', c: 'circle',
  a: 'text',
  // b: 'brush', x: 'eraser',  // hatch painting disabled for now (HATCH_ENABLED)
};

function onKeyDown(e) {
  if (e.target.tagName === 'INPUT') return;

  // History / file shortcuts (⌘/Ctrl). Commit any in-progress text first.
  if (e.metaKey || e.ctrlKey) {
    const k = e.key.toLowerCase();
    if (k === 'z') { e.preventDefault(); if (state.textEditing) commitText(); e.shiftKey ? redo() : undo(); return; }
    if (k === 'y') { e.preventDefault(); if (state.textEditing) commitText(); redo(); return; }
    if (k === 's') { e.preventDefault(); if (state.textEditing) commitText(); saveToFile(); return; }
    if (k === 'o') { e.preventDefault(); if (state.textEditing) commitText(); openFileDialog(); return; }
  }

  // Live text entry captures every key while a text item is being edited.
  if (state.textEditing && handleTextKey(e)) return;

  // Tab on a selected object spawns a text attachment and starts editing it.
  if (e.key === 'Tab' && !state.isDrawing && !state.isCarrying && state.selectedIds.size > 0) {
    const id = [...state.selectedIds].find(i => {
      const s = state.shapes.find(sh => sh.id === i);
      return s && s.type !== 'text';
    });
    const shape = state.shapes.find(s => s.id === id);
    if (shape) { e.preventDefault(); createAttachedText(shape); return; }
  }

  // Exact dimension entry takes priority while a guide is being set.
  if (state.previewGuide && handleDimKey(e)) return;

  // Typed dimensions while placing a primitive.
  if (state.isDrawing && handleDrawDimKey(e)) return;

  // Typed X/Y/ΔX/ΔY while carrying a picked-up object.
  if (state.isCarrying && handleMoveKey(e)) return;

  // Brush/eraser: 1–4 press the pen/eraser to paper.
  if (isBrushTool() && handleBrushKeyDown(e)) return;

  if (e.key.toLowerCase() === 'o') { toggleOrigin(); return; }

  // Press 'g' twice within G_DOUBLE_MS to open/close the grid & snap panel.
  if (e.key.toLowerCase() === 'g' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const now = Date.now();
    if (state._lastGPress >= 0 && now - state._lastGPress < G_DOUBLE_MS) {
      state._lastGPress = -1;
      e.preventDefault();   // don't let the opening 'g' land in the focused grid-size field
      toggleGridPanel();
    } else {
      state._lastGPress = now;
    }
    return;
  }

  if (e.code === 'Space' && !state.spaceHeld) {
    e.preventDefault();
    state.spaceHeld = true;
    workspace.classList.add('panning');
  }

  if (e.key === 'Shift') state._shiftHeld = true;

  const tool = TOOL_KEYS[e.key.toLowerCase()];
  if (tool) setTool(tool);

  if (e.key === 'Backspace' || e.key === 'Delete') {
    let changed = false;
    if (state.selectedIds.size > 0) {
      const del = state.selectedIds;
      state.shapes = state.shapes.filter(s =>
        !(del.has(s.id) || (s.type === 'text' && s.attachTo != null && del.has(s.attachTo))));
      state.selectedIds.clear();
      changed = true;
    }
    if (state.selectedGuide) changed = deleteSelectedGuide() || changed;
    if (changed) { recordHistory(); render(); }
  }

  if (e.key === 'Escape') {
    if (state.gridPanelOpen) closeGridPanel();
    if (state.isDraggingGuide) finishGuideDrag(false);
    if (state.isDraggingShapes) restoreShapeDrag();
    endShapeDrag();
    state.selectedGuide = null;
    state.selectedIds.clear();
    state.segmentStart = null;
    state.segmentHover = null;
    state.segmentSpan = null;
    state.brushAngleKey = null;
    state.brushLast = null;
    state.eraserDown = false;
    state.eraserLast = null;
    cancelPlacement();
    state.isMarquee = false;
    state.marqueeStart = null;
    state.marqueeCurrent = null;
    state.previewGuide = null;
    resetProtractor();
    snapIndicator.hidden = true;
    updateStatus();
    render();
  }
}

function onKeyUp(e) {
  if (e.code === 'Space') {
    state.spaceHeld = false;
    if (!state.isPanning) workspace.classList.remove('panning');
  }
  if (e.key === 'Shift') state._shiftHeld = false;

  if (isBrushTool()) handleBrushKeyUp(e);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
function init() {
  const toolsEl = document.getElementById('tools');
  if (!canvas || !ctx || !workspace || !toolsEl || !rulerV || !rulerH) {
    document.body.innerHTML = '<p style="padding:2rem;font-family:monospace;color:#f0a030">Failed to load Primitives.</p>';
    return;
  }

  toolsEl.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.tool');
    if (!btn?.dataset.tool) return;
    e.preventDefault();
    setTool(btn.dataset.tool);
  });

  snapGridToggle.addEventListener('change', e => setSnapGrid(e.target.checked));
  snapObjectToggle.addEventListener('change', e => setSnapObject(e.target.checked));
  drawCenterToggle.addEventListener('change', e => { state.drawFromCenter = e.target.checked; });

  const originBtn = document.getElementById('origin-toggle');
  if (originBtn) originBtn.addEventListener('click', toggleOrigin);

  // Grid & snap panel (g g) controls.
  if (unitSelect) unitSelect.addEventListener('change', e => setUnit(e.target.value));
  if (panelSnapGrid) panelSnapGrid.addEventListener('change', e => setSnapGrid(e.target.checked));
  if (panelSnapObject) panelSnapObject.addEventListener('change', e => setSnapObject(e.target.checked));
  if (gridSizeInput) {
    const applyGrid = () => {
      const n = parseFloat(gridSizeInput.value);
      if (Number.isFinite(n) && n > 0) setGridSize(unitToPx(n));
    };
    const applyGridNoRefresh = () => {
      const n = parseFloat(gridSizeInput.value);
      if (Number.isFinite(n) && n > 0) setGridSize(unitToPx(n), false);
    };
    gridSizeInput.addEventListener('input', applyGridNoRefresh);
    gridSizeInput.addEventListener('keydown', e => {
      // preventScroll: focusing the workspace otherwise scrolls the wide canvas into
      // view, shoving the rulers off-screen.
      if (e.key === 'Enter') { applyGrid(); closeGridPanel(); workspace.focus({ preventScroll: true }); }
      else if (e.key === 'Escape') { closeGridPanel(); workspace.focus({ preventScroll: true }); }
      e.stopPropagation();
    });
  }
  const gridPanelToggleBtn = document.getElementById('grid-panel-toggle');
  if (gridPanelToggleBtn) gridPanelToggleBtn.addEventListener('click', toggleGridPanel);
  // Click outside the panel (and not on its toggle) dismisses it.
  document.addEventListener('pointerdown', e => {
    if (!state.gridPanelOpen) return;
    if (gridPanel && gridPanel.contains(e.target)) return;
    if (gridPanelToggleBtn && gridPanelToggleBtn.contains(e.target)) return;
    closeGridPanel();
  });

  // History + file actions.
  if (undoBtn) undoBtn.addEventListener('click', undo);
  if (redoBtn) redoBtn.addEventListener('click', redo);
  if (saveBtn) saveBtn.addEventListener('click', saveToFile);
  if (openBtn) openBtn.addEventListener('click', openFileDialog);
  if (fileInput) fileInput.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) loadFromFile(f);
    e.target.value = ''; // allow re-opening the same file
  });

  syncControls();

  bindRuler(rulerV, 'h');
  bindRuler(rulerH, 'v');

  function isInDrawArea(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return clientX - rect.left >= RULER_SIZE && clientY - rect.top < rect.height - RULER_SIZE;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (isInDrawArea(e.clientX, e.clientY)) onPointerDown(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (isInDrawArea(e.clientX, e.clientY) || state.isPanning
        || state.isDraggingShapes || state.isDraggingGuide || state.isCarrying
        || (state.tool === 'protractor' && state.protractorActive)) {
      onPointerMove(e);
    }
  });
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('wheel', (e) => { handleProtractorWheel(e); }, { passive: false, capture: true });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('resize', resize);

  setTool('select');
  resize();
  const area = drawAreaSize();
  state.panX = area.w / 2;
  state.panY = area.h / 2;

  // Restore the autosaved working document (if any), then seed the history baseline.
  restoreAutosave();
  initHistory();
  updateStatus();
  render();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
