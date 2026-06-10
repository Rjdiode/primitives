---
name: encapsulation-target
description: Agreed packaging + API contract for turning Primitives into an embeddable component in the larger design framework
metadata:
  type: project
---

The Primitives sketching canvas is destined to be an **encapsulated, modular component** dropped into a larger design framework — not a standalone page. The refactor is **not yet started** (decided 2026-06-10; user said "just note the constraint, wait"). Approach all new work as if this encapsulation is coming.

**Current obstacle:** `app.js` (~1425 lines) is a global singleton — one global `state` object, top-level functions, and hardcoded DOM lookups (`getElementById('canvas')`, `'ruler-v'`, `'status'`, etc.). It assumes it owns the whole page. Multi-instance and host-mounting are both impossible as written.

**Agreed target packaging:** ES module + class.
- `export class SketchCanvas { constructor(container, opts) }` — mounts into a host-provided container element, builds its own DOM (canvas + rulers + overlays) internally, no hardcoded IDs, no global leakage, multi-instance safe.
- Note this **breaks the current `file://` no-build constraint** (HANDOFF.md documents the non-module `<script src="app.js">` choice). That's an accepted tradeoff for the framework integration — revisit only if a build step is unavailable in the host.

**Agreed public API surface (all four):**
- **Serialize / load** — `toJSON()` / `loadJSON()` covering full document: shapes, guidesH/V/Angle, vertices, view (pan/zoom).
- **Change events** — emit on shape / guide / selection changes so the host stays in sync (EventTarget or callback registry).
- **Programmatic tool + view control** — methods to set tool, zoom, pan, add/remove shapes & guides from host code.
- **Export geometry** — vector output (SVG / path data / coordinate list) for downstream use.

When implementing: lift the global `state` into instance state, parameterize the DOM (`drawRulers`, `bindRuler`, overlay refs), and keep the geometry/snap/crossing math (`getCrossings`, `applySnap`, intersect helpers) as pure functions — they're already side-effect-free and port cleanly. See HANDOFF.md for the function map.
