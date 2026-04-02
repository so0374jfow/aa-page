// Generate slots.json — irregular spolia mosaic packing
// Each slot has its own random height. Skyline algorithm fills from bottom up.
// Run: node generate_slots.mjs > ../data/slots.json

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickType() {
  const r = Math.random();
  if (r < 0.05) return 'A';       // ~5% large — rare anchor pieces
  if (r < 0.35) return 'B';       // ~30% medium
  return 'C';                      // ~65% small — the fabric of spolia
}

function slotDims(type) {
  switch (type) {
    case 'A': return {
      width: rand(180, 350),
      height: rand(100, 250),
      depth: rand(60, 180)
    };
    case 'B': return {
      width: rand(70, 180),
      height: rand(50, 150),
      depth: rand(40, 220)
    };
    case 'C': return {
      width: rand(25, 100),
      height: rand(25, 90),
      depth: rand(30, 280)        // small objects can protrude far (pipes, molds)
    };
  }
}

function fireZone(absoluteHeightM) {
  if (absoluteHeightM < 3) return 1;
  if (absoluteHeightM < 6) return 2;
  return 3;
}

const STORIES = [
  { name: 'level-1', label: 'Ground floor',  baseY: 0 },
  { name: 'level-2', label: 'First floor',   baseY: 3500 },
  { name: 'level-3', label: 'Second floor',  baseY: 7000 },
];

/**
 * Skyline-based irregular packing.
 *
 * Maintains a heightmap (skyline) across the railing width.
 * At each step, finds the lowest point, places a random slot there.
 * Slots have independent heights — no uniform rows.
 * Result: organic, spolia-like mosaic.
 */
function packRailing(story, storyIndex) {
  const W = 20000; // 20m in mm
  const H = 1000;  // 1m in mm
  const RESOLUTION = 5; // mm per skyline bucket (performance vs precision)
  const buckets = Math.ceil(W / RESOLUTION);
  const prefix = `SLOT-L${storyIndex + 1}`;

  // Skyline: height at each x bucket (relative to railing bottom)
  const skyline = new Float32Array(buckets); // all zeros

  const slots = [];
  let slotNum = 1;
  let attempts = 0;
  const MAX_ATTEMPTS = 50000;

  while (attempts < MAX_ATTEMPTS) {
    attempts++;

    // Find the lowest point in the skyline
    let minH = Infinity;
    let minBucket = 0;
    for (let i = 0; i < buckets; i++) {
      if (skyline[i] < minH) {
        minH = skyline[i];
        minBucket = i;
      }
    }

    // If lowest point is at or above the railing height, we're done
    if (minH >= H) break;

    // Find the width of the "valley" at this height
    // (contiguous run of buckets at or near the minimum height)
    let leftBucket = minBucket;
    let rightBucket = minBucket;
    while (leftBucket > 0 && skyline[leftBucket - 1] <= minH + 5) leftBucket--;
    while (rightBucket < buckets - 1 && skyline[rightBucket + 1] <= minH + 5) rightBucket++;

    const valleyWidthMM = (rightBucket - leftBucket + 1) * RESOLUTION;
    const xStart = leftBucket * RESOLUTION;

    // Pick a slot type and generate dimensions
    const type = pickType();
    let dims = slotDims(type);

    // Constrain width to valley width (but at least some minimum)
    if (dims.width > valleyWidthMM) {
      dims.width = valleyWidthMM;
    }
    if (dims.width < 30) {
      // Valley too narrow — try to fill with a tiny infill
      dims.width = Math.min(valleyWidthMM, rand(30, 80));
      dims.height = Math.min(dims.height, rand(30, 100));
    }

    // Constrain height to not exceed railing top
    const remainingH = H - minH;
    if (dims.height > remainingH) {
      dims.height = remainingH;
    }
    if (dims.height < 20) continue; // skip if too small
    if (dims.width < 20) continue;

    // Place the slot
    const absoluteY = story.baseY + minH;
    const absoluteHeightM = absoluteY / 1000;
    const id = `${prefix}-${String(slotNum).padStart(3, '0')}`;

    slots.push({
      id,
      face: story.name,
      type,
      position: {
        x: xStart,
        y: absoluteY,
        z: 0
      },
      dimensions: {
        width: Math.round(dims.width),
        height: Math.round(dims.height),
        depth: dims.depth
      },
      height_m: parseFloat(absoluteHeightM.toFixed(3)),
      fire_zone: fireZone(absoluteHeightM),
      status: 'empty',
      element_id: null,
      adjacent: []
    });

    slotNum++;

    // Update skyline: raise the height where this slot was placed
    const slotLeftBucket = Math.floor(xStart / RESOLUTION);
    const slotRightBucket = Math.min(
      buckets - 1,
      Math.floor((xStart + dims.width) / RESOLUTION) - 1
    );
    const newH = minH + dims.height;
    for (let i = slotLeftBucket; i <= slotRightBucket; i++) {
      skyline[i] = newH;
    }
  }

  return slots;
}

// Compute adjacency: slots sharing an edge
function computeAdjacency(slots) {
  const TOLERANCE = 15;

  // Build spatial index for performance
  for (let i = 0; i < slots.length; i++) {
    const a = slots[i];
    const ax1 = a.position.x, ax2 = ax1 + a.dimensions.width;
    const ay1 = a.position.y, ay2 = ay1 + a.dimensions.height;

    for (let j = i + 1; j < slots.length; j++) {
      const b = slots[j];
      if (b.face !== a.face) continue;

      const bx1 = b.position.x, bx2 = bx1 + b.dimensions.width;
      const by1 = b.position.y, by2 = by1 + b.dimensions.height;

      // Quick bounding box reject
      if (ax2 + TOLERANCE < bx1 || bx2 + TOLERANCE < ax1) continue;
      if (ay2 + TOLERANCE < by1 || by2 + TOLERANCE < ay1) continue;

      // Horizontal adjacency
      const hAdj = Math.abs(ax2 - bx1) < TOLERANCE || Math.abs(bx2 - ax1) < TOLERANCE;
      const yOverlap = ay1 < by2 && by1 < ay2;

      // Vertical adjacency
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
  const heights = slots.map(s => s.dimensions.height);
  process.stderr.write(
    `${story.name}: ${slots.length} slots, ` +
    `height ${Math.min(...heights)}–${Math.max(...heights)}mm, ` +
    `depth ${Math.min(...depths)}–${Math.max(...depths)}mm\n`
  );
}
process.stderr.write(`Total: ${allSlots.length} slots\n`);
