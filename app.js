// ─── Config ───────────────────────────────────────────────────────────────────
const GRID_SIZE = 20;
const RULER_SIZE = 28;
const SNAP_RADIUS = 10;
const CROSSING_RADIUS = 12;
const PROTRACTOR_STEP_DEG = 15;
const PROTRACTOR_STEP = (PROTRACTOR_STEP_DEG * Math.PI) / 180;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  tool: 'select',
  shapes: [],
  selectedIds: new Set(),
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
  snapGrid: true,
  snapObject: true,
  drawFromCenter: false,
  panX: 0,
  panY: 0,
  zoom: 1,
  isDrawing: false,
  isPanning: false,
  isMarquee: false,
  drawStart: null,
  drawCurrent: null,
  marqueeStart: null,
  marqueeCurrent: null,
  spaceHeld: false,
  activeSnap: null,
  _hoverWorld: null,
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

let nextId = 1;

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

function worldYFromClientY(clientY) {
  const rect = canvas.getBoundingClientRect();
  return snapGuideValue((clientY - rect.top - state.panY) / state.zoom);
}

function worldXFromClientX(clientX) {
  const rect = canvas.getBoundingClientRect();
  return snapGuideValue((clientX - rect.left - RULER_SIZE - state.panX) / state.zoom);
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

function drawAngularGuide(x, y, angle, preview = false) {
  const { x1, y1, x2, y2 } = angularGuideEndpoints(x, y, angle);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = preview ? 'rgba(240, 160, 48, 0.9)' : 'rgba(186, 130, 255, 0.6)';
  ctx.lineWidth = preview ? 2 / state.zoom : 1.25 / state.zoom;
  ctx.setLineDash(preview ? [4 / state.zoom, 8 / state.zoom] : [5 / state.zoom, 9 / state.zoom]);
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
function expandFromCenter(cx, cy, x2, y2, constrainSquare = false) {
  let dx = x2 - cx;
  let dy = y2 - cy;
  if (constrainSquare) {
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * size;
    dy = Math.sign(dy || 1) * size;
  }
  return { x: cx - dx, y: cy - dy, x2: cx + dx, y2: cy + dy };
}

function normalizeRect(x1, y1, x2, y2, constrainSquare = false) {
  let dx = x2 - x1;
  let dy = y2 - y1;
  if (constrainSquare) {
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * size;
    dy = Math.sign(dy || 1) * size;
  }
  return { x: x1, y: y1, x2: x1 + dx, y2: y1 + dy };
}

function constrainLine(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const angle = Math.atan2(dy, dx);
  const snapAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy);
  return { x: x1, y: y1, x2: x1 + Math.cos(snapAngle) * len, y2: y1 + Math.sin(snapAngle) * len };
}

function constrainCircle(x1, y1, x2, y2) {
  const r = Math.hypot(x2 - x1, y2 - y1);
  return { x: x1, y: y1, x2: x1 + r, y2: y1 + r };
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

function drawGuideLine(axis, value, preview = false) {
  const view = getViewBounds();
  ctx.beginPath();
  if (axis === 'h') {
    ctx.moveTo(view.left, value);
    ctx.lineTo(view.right, value);
  } else {
    ctx.moveTo(value, view.top);
    ctx.lineTo(value, view.bottom);
  }
  ctx.strokeStyle = preview ? 'rgba(240, 160, 48, 0.75)' : 'rgba(78, 205, 196, 0.5)';
  ctx.lineWidth = preview ? 1.5 / state.zoom : 1 / state.zoom;
  ctx.setLineDash(preview ? [10 / state.zoom, 7 / state.zoom] : [6 / state.zoom, 5 / state.zoom]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawGuides() {
  for (const y of state.guidesH) drawGuideLine('h', y);
  for (const x of state.guidesV) drawGuideLine('v', x);
  if (state.previewGuide) drawGuideLine(state.previewGuide.axis, state.previewGuide.value, true);

  for (const g of state.guidesAngle) drawAngularGuide(g.x, g.y, g.angle);

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
      ctx.fillText(String(y), RULER_SIZE - 10, sy);
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
      ctx.fillText(String(x), sx, by + 12);
    }
  }

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

  for (const shape of state.shapes) {
    const selected = state.selectedIds.has(shape.id);
    drawShape(shape, false, selected);
    if (selected) drawSnapPoints(shape);
  }

  if (state.isDrawing && state.drawStart && state.drawCurrent) {
    const preview = buildPreviewShape();
    if (preview) drawShape(preview, true);
  }

  drawSegmentPreview();
  drawMarquee();
  ctx.restore();

  drawRulers();
}

function buildPreviewShape() {
  const { tool, drawStart, drawCurrent, drawFromCenter } = state;
  if (!drawStart || !drawCurrent) return null;

  let { x: x1, y: y1 } = drawStart;
  let { x: x2, y: y2 } = drawCurrent;
  const shift = state._shiftHeld;

  if (tool === 'line') {
    let dx = x2 - x1, dy = y2 - y1;
    if (shift) { const c = constrainLine(0, 0, dx, dy); dx = c.x2; dy = c.y2; }
    if (drawFromCenter) return { type: 'line', x: x1 - dx, y: y1 - dy, x2: x1 + dx, y2: y1 + dy };
    return { type: 'line', x: x1, y: y1, x2: x1 + dx, y2: y1 + dy };
  }

  if (tool === 'square' || (tool === 'rect' && shift)) {
    const box = drawFromCenter ? expandFromCenter(x1, y1, x2, y2, true) : normalizeRect(x1, y1, x2, y2, true);
    return { type: tool === 'square' ? 'square' : 'rect', ...box };
  }

  if (tool === 'circle' || (tool === 'ellipse' && shift)) {
    const box = drawFromCenter ? expandFromCenter(x1, y1, x2, y2, true) : constrainCircle(x1, y1, x2, y2);
    return { type: tool === 'circle' ? 'circle' : 'ellipse', ...box };
  }

  if (tool === 'rect') {
    const box = drawFromCenter ? expandFromCenter(x1, y1, x2, y2) : normalizeRect(x1, y1, x2, y2);
    return { type: 'rect', ...box };
  }

  if (tool === 'ellipse') {
    const box = drawFromCenter ? expandFromCenter(x1, y1, x2, y2) : { x: x1, y: y1, x2, y2 };
    return { type: 'ellipse', ...box };
  }

  return { type: tool, x: x1, y: y1, x2, y2 };
}

function finalizeShape() {
  const preview = buildPreviewShape();
  if (!preview) return;
  const { x, y, x2, y2, type } = preview;
  const minSize = 2 / state.zoom;
  if (type === 'line') {
    if (Math.hypot(x2 - x, y2 - y) < minSize) return;
  } else if (Math.abs(x2 - x) < minSize && Math.abs(y2 - y) < minSize) return;
  const shape = { id: nextId++, ...preview };
  state.shapes.push(shape);
  state.selectedIds = new Set([shape.id]);
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
  if (tool !== 'protractor') resetProtractor();
  state.segmentStart = null;
  state.segmentHover = null;
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
  if (state.previewGuide) {
    const label = state.previewGuide.axis === 'h' ? `H guide @ ${state.previewGuide.value}` : `V guide @ ${state.previewGuide.value}`;
    statusEl.textContent = label;
    return;
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
  if (isSegmentTool()) {
    if (!getCrossings().length) {
      statusEl.textContent = 'Place guides first';
    } else if (state.segmentStart) {
      statusEl.textContent = 'Click second crossing';
    } else {
      statusEl.textContent = `${state.tool} · click two crossings`;
    }
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

  if (state.tool !== 'select' && !state.isPanning && !isSegmentTool()) {
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
  const value = axis === 'h' ? worldYFromClientY(clientPos) : worldXFromClientX(clientPos);
  state.previewGuide = { axis, value };
  updateStatus();
  render();
}

function handleRulerDown(axis, clientPos, shiftKey) {
  const value = axis === 'h' ? worldYFromClientY(clientPos) : worldXFromClientX(clientPos);
  if (shiftKey) removeNearestGuide(axis, value);
  else addGuide(axis, value);
  state.previewGuide = { axis, value };
  updateStatus();
  render();
}

function handleRulerLeave() {
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

  if (isSegmentTool()) {
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
    updateStatus();
    render();
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
        state.selectedIds = new Set([hit.id]);
      }
    } else {
      state.isMarquee = true;
      state.marqueeStart = raw;
      state.marqueeCurrent = raw;
      if (!state._shiftHeld) state.selectedIds.clear();
      canvas.setPointerCapture(e.pointerId);
    }
    render();
    return;
  }

  state.isDrawing = true;
  state.drawStart = pt;
  state.drawCurrent = pt;
  canvas.setPointerCapture(e.pointerId);
  render();
}

function onPointerMove(e) {
  if (state.isPanning && state._panStart) {
    state.panX = state._panStart.panX + (e.clientX - state._panStart.x);
    state.panY = state._panStart.panY + (e.clientY - state._panStart.y);
    render();
    return;
  }

  const raw = getPointerPos(e);

  if (isSegmentTool()) {
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

  state._hoverWorld = raw;
  const { pt, snap } = applySnap(raw);
  state.activeSnap = snap;
  updateOverlays(e.clientX, e.clientY, snap);

  if (state.isMarquee) state.marqueeCurrent = raw;
  else if (state.isDrawing) state.drawCurrent = pt;
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

  if (state.isMarquee) {
    state.isMarquee = false;
    finalizeMarquee();
    state.marqueeStart = null;
    state.marqueeCurrent = null;
    render();
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    return;
  }

  if (state.isDrawing) {
    state.isDrawing = false;
    finalizeShape();
    state.drawStart = null;
    state.drawCurrent = null;
    render();
  }

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
};

function onKeyDown(e) {
  if (e.target.tagName === 'INPUT') return;

  if (e.code === 'Space' && !state.spaceHeld) {
    e.preventDefault();
    state.spaceHeld = true;
    workspace.classList.add('panning');
  }

  if (e.key === 'Shift') state._shiftHeld = true;

  const tool = TOOL_KEYS[e.key.toLowerCase()];
  if (tool) setTool(tool);

  if ((e.key === 'Backspace' || e.key === 'Delete') && state.selectedIds.size > 0) {
    state.shapes = state.shapes.filter(s => !state.selectedIds.has(s.id));
    state.selectedIds.clear();
    render();
  }

  if (e.key === 'Escape') {
    state.selectedIds.clear();
    state.segmentStart = null;
    state.segmentHover = null;
    state.isDrawing = false;
    state.isMarquee = false;
    state.drawStart = null;
    state.drawCurrent = null;
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

  snapGridToggle.addEventListener('change', e => { state.snapGrid = e.target.checked; });
  snapObjectToggle.addEventListener('change', e => { state.snapObject = e.target.checked; render(); });
  drawCenterToggle.addEventListener('change', e => { state.drawFromCenter = e.target.checked; });

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
  render();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
