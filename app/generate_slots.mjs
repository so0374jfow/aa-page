// Generate slots.json — true irregular spolia packing
// Uses a free-form placement: no rows, no shelves, no skyline.
// Places objects into a 2D grid bitmap, finding gaps randomly.
// Run: node generate_slots.mjs > ../data/slots.json

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function randomDims() {
  // Wide range of sizes — from tiny shards to large blocks
  // No type system — just random objects like real spolia
  const w = rand(25, 350);
  const h = rand(25, 300);
  // Depth: deliberately uncorrelated with size
  // Small shards can protrude far (pipes), large slabs can be thin
  const d = rand(20, 300);
  return { width: w, height: h, depth: d };
}

function fireZone(absoluteHeightM) {
  if (absoluteHeightM < 3) return 1;
  if (absoluteHeightM < 6) return 2;
  return 3;
}

function slotType(w, h) {
  const area = w * h;
  if (area > 60000) return 'A';
  if (area > 15000) return 'B';
  return 'C';
}

const STORIES = [
  { name: 'level-1', label: 'Ground floor',  baseY: 0 },
  { name: 'level-2', label: 'First floor',   baseY: 3500 },
  { name: 'level-3', label: 'Second floor',  baseY: 7000 },
];

/**
 * Bitmap-based free packing.
 *
 * Uses a coarse 2D bitmap to track occupied space.
 * Generates random candidate positions and tries to place objects.
 * Results in truly irregular placement — no rows, no patterns.
 */
function packRailing(story, storyIndex) {
  const W = 20000;
  const H = 1000;
  const RES = 5; // mm per pixel
  const gridW = Math.ceil(W / RES);
  const gridH = Math.ceil(H / RES);
  const prefix = `SLOT-L${storyIndex + 1}`;

  // Bitmap: false = empty, true = occupied
  const grid = new Uint8Array(gridW * gridH);

  function isOccupied(gx, gy) {
    if (gx < 0 || gx >= gridW || gy < 0 || gy >= gridH) return true;
    return grid[gy * gridW + gx];
  }

  function canPlace(gx, gy, gw, gh) {
    if (gx + gw > gridW || gy + gh > gridH) return false;
    for (let y = gy; y < gy + gh; y++) {
      for (let x = gx; x < gx + gw; x++) {
        if (grid[y * gridW + x]) return false;
      }
    }
    return true;
  }

  function markOccupied(gx, gy, gw, gh) {
    for (let y = gy; y < gy + gh; y++) {
      for (let x = gx; x < gx + gw; x++) {
        grid[y * gridW + x] = 1;
      }
    }
  }

  const slots = [];
  let slotNum = 1;

  // Phase 1: Place large and medium objects at random positions
  // Try many random placements
  const PHASE1_ATTEMPTS = 8000;
  for (let attempt = 0; attempt < PHASE1_ATTEMPTS; attempt++) {
    const dims = randomDims();
    const gw = Math.max(1, Math.round(dims.width / RES));
    const gh = Math.max(1, Math.round(dims.height / RES));

    // Random position
    const gx = rand(0, gridW - gw);
    const gy = rand(0, gridH - gh);

    if (!canPlace(gx, gy, gw, gh)) continue;

    markOccupied(gx, gy, gw, gh);

    const xMM = gx * RES;
    const yLocal = gy * RES;
    const absoluteY = story.baseY + yLocal;
    const id = `${prefix}-${String(slotNum).padStart(3, '0')}`;

    slots.push({
      id,
      face: story.name,
      type: slotType(dims.width, dims.height),
      position: { x: xMM, y: absoluteY, z: 0 },
      dimensions: {
        width: gw * RES,
        height: gh * RES,
        depth: dims.depth
      },
      height_m: parseFloat((absoluteY / 1000).toFixed(3)),
      fire_zone: fireZone(absoluteY / 1000),
      status: 'empty',
      element_id: null,
      adjacent: []
    });
    slotNum++;
  }

  // Phase 2: Scan for remaining gaps and fill with small infill pieces
  // Scan every position, find empty regions, fill them
  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      if (grid[gy * gridW + gx]) continue;

      // Found an empty cell — find how big a rectangle we can fit
      // Expand right
      let gw = 0;
      while (gx + gw < gridW && !grid[gy * gridW + gx + gw]) gw++;
      gw = Math.min(gw, Math.ceil(200 / RES)); // cap infill width

      // Expand down
      let gh = 0;
      let canExpand = true;
      while (gy + gh < gridH && canExpand) {
        for (let x = gx; x < gx + gw; x++) {
          if (grid[(gy + gh) * gridW + x]) { canExpand = false; break; }
        }
        if (canExpand) gh++;
      }
      gh = Math.min(gh, Math.ceil(200 / RES)); // cap infill height

      if (gw < 2 || gh < 2) {
        // Too tiny — just mark as filled (mortar)
        markOccupied(gx, gy, Math.max(gw, 1), Math.max(gh, 1));
        continue;
      }

      markOccupied(gx, gy, gw, gh);

      const xMM = gx * RES;
      const yLocal = gy * RES;
      const absoluteY = story.baseY + yLocal;
      const id = `${prefix}-${String(slotNum).padStart(3, '0')}`;

      slots.push({
        id,
        face: story.name,
        type: 'C',
        position: { x: xMM, y: absoluteY, z: 0 },
        dimensions: {
          width: gw * RES,
          height: gh * RES,
          depth: rand(20, 280)
        },
        height_m: parseFloat((absoluteY / 1000).toFixed(3)),
        fire_zone: fireZone(absoluteY / 1000),
        status: 'empty',
        element_id: null,
        adjacent: []
      });
      slotNum++;
    }
  }

  return slots;
}

// Compute adjacency
function computeAdjacency(slots) {
  const TOLERANCE = 12;

  for (let i = 0; i < slots.length; i++) {
    const a = slots[i];
    const ax1 = a.position.x, ax2 = ax1 + a.dimensions.width;
    const ay1 = a.position.y, ay2 = ay1 + a.dimensions.height;

    for (let j = i + 1; j < slots.length; j++) {
      const b = slots[j];
      if (b.face !== a.face) continue;

      const bx1 = b.position.x, bx2 = bx1 + b.dimensions.width;
      const by1 = b.position.y, by2 = by1 + b.dimensions.height;

      if (ax2 + TOLERANCE < bx1 || bx2 + TOLERANCE < ax1) continue;
      if (ay2 + TOLERANCE < by1 || by2 + TOLERANCE < ay1) continue;

      const hAdj = Math.abs(ax2 - bx1) < TOLERANCE || Math.abs(bx2 - ax1) < TOLERANCE;
      const yOverlap = ay1 < by2 && by1 < ay2;
      const vAdj = Math.abs(ay2 - by1) < TOLERANCE || Math.abs(by2 - ay1) < TOLERANCE;
      const xOverlap = ax1 < bx2 && bx1 < ax2;

      if ((hAdj && yOverlap) || (vAdj && xOverlap)) {
        a.adjacent.push(b.id);
        b.adjacent.push(a.id);
      }
    }
  }
}

// Generate
const allLevels = STORIES.map((story, i) => {
  const slots = packRailing(story, i);
  computeAdjacency(slots);
  return { story, slots };
});

const allSlots = allLevels.flatMap(l => l.slots);
console.log(JSON.stringify({ slots: allSlots }, null, 2));

for (const { story, slots } of allLevels) {
  const depths = slots.map(s => s.dimensions.depth);
  const widths = slots.map(s => s.dimensions.width);
  const heights = slots.map(s => s.dimensions.height);
  process.stderr.write(
    `${story.name}: ${slots.length} slots, ` +
    `w ${Math.min(...widths)}–${Math.max(...widths)}mm, ` +
    `h ${Math.min(...heights)}–${Math.max(...heights)}mm, ` +
    `d ${Math.min(...depths)}–${Math.max(...depths)}mm\n`
  );
}
process.stderr.write(`Total: ${allSlots.length} slots\n`);
