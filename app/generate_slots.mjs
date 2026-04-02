// Generate slots.json with 3 balcony railings, each 20m x 1m, stacked at 3 story heights
// Tightly packed — no gaps. Irregular depth for sculptural surface.
// Run: node generate_slots.mjs > ../data/slots.json

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickType() {
  // Target: Large ≤25%, Medium 50-65%, Small ≥25%
  const r = Math.random();
  if (r < 0.20) return 'A';
  if (r < 0.75) return 'B';
  return 'C';
}

function slotDims(type) {
  // Depth is deliberately irregular — small objects can stick out far,
  // large objects can be shallow. Creates sculptural relief.
  switch (type) {
    case 'A': return {
      width: rand(300, 600),
      height: rand(200, 500),
      depth: rand(60, 180)
    };
    case 'B': return {
      width: rand(150, 300),
      height: rand(100, 300),
      depth: rand(40, 220)   // medium objects: wide depth range
    };
    case 'C': return {
      width: rand(50, 150),
      height: rand(50, 200),
      depth: rand(30, 280)   // small objects can protrude a lot (pipes, molds)
    };
  }
}

function fireZone(absoluteHeightM) {
  if (absoluteHeightM < 3) return 1;
  if (absoluteHeightM < 6) return 2;
  return 3;
}

// Story heights in mm (floor level where railing starts)
const STORIES = [
  { name: 'level-1', label: 'Ground floor',  baseY: 0 },
  { name: 'level-2', label: 'First floor',   baseY: 3500 },
  { name: 'level-3', label: 'Second floor',  baseY: 7000 },
];

function packRailing(story, storyIndex) {
  const RAILING_W = 20000; // 20m in mm
  const RAILING_H = 1000;  // 1m in mm
  const slots = [];
  let slotNum = 1;
  const prefix = `SLOT-L${storyIndex + 1}`;

  // Pack rows bottom-to-top, no gaps
  let y = 0;
  while (y < RAILING_H) {
    // Pick a row height — use a random slot to set it
    const seedType = pickType();
    const seedDims = slotDims(seedType);
    let rowHeight = seedDims.height;

    // Clamp to remaining space
    if (y + rowHeight > RAILING_H) {
      rowHeight = RAILING_H - y;
      if (rowHeight < 30) break;
    }

    // Pack left-to-right, no horizontal gaps
    let x = 0;
    while (x < RAILING_W) {
      const type = pickType();
      let dims = slotDims(type);

      // Force height to exactly fill the row (no vertical gaps)
      dims.height = rowHeight;

      // Fill remaining width if last slot in row
      const remaining = RAILING_W - x;
      if (remaining <= dims.width * 1.3) {
        // Stretch to fill instead of leaving a sliver
        dims.width = remaining;
      } else if (dims.width > remaining) {
        dims.width = remaining;
      }

      if (dims.width < 20) break;

      const absoluteY = story.baseY + y;
      const absoluteHeightM = absoluteY / 1000;
      const id = `${prefix}-${String(slotNum).padStart(3, '0')}`;

      slots.push({
        id,
        face: story.name,
        type,
        position: {
          x: x,
          y: absoluteY,
          z: 0
        },
        dimensions: dims,
        height_m: parseFloat(absoluteHeightM.toFixed(3)),
        fire_zone: fireZone(absoluteHeightM),
        status: 'empty',
        element_id: null,
        adjacent: []
      });

      slotNum++;
      x += dims.width; // No gap — flush packing
    }

    y += rowHeight; // No gap — flush packing
  }

  return slots;
}

// Compute adjacency within each railing
function computeAdjacency(slots) {
  const TOLERANCE = 10; // mm — tighter tolerance for flush packing

  for (let i = 0; i < slots.length; i++) {
    const a = slots[i];
    for (let j = i + 1; j < slots.length; j++) {
      const b = slots[j];
      if (a.face !== b.face) continue;

      const ax = a.position.x, aw = a.dimensions.width;
      const bx = b.position.x, bw = b.dimensions.width;
      const ay = a.position.y, ah = a.dimensions.height;
      const by = b.position.y, bh = b.dimensions.height;

      // Horizontal adjacency (side by side, overlapping in Y)
      const hAdj = (Math.abs((ax + aw) - bx) < TOLERANCE || Math.abs((bx + bw) - ax) < TOLERANCE);
      const yOverlap = ay < (by + bh) && by < (ay + ah);

      // Vertical adjacency (stacked, overlapping in X)
      const vAdj = (Math.abs((ay + ah) - by) < TOLERANCE || Math.abs((by + bh) - ay) < TOLERANCE);
      const xOverlap = ax < (bx + bw) && bx < (ax + aw);

      if ((hAdj && yOverlap) || (vAdj && xOverlap)) {
        a.adjacent.push(b.id);
        b.adjacent.push(a.id);
      }
    }
  }
}

// Generate three railings at different story heights
const allLevels = STORIES.map((story, i) => {
  const slots = packRailing(story, i);
  computeAdjacency(slots);
  return { story, slots };
});

const allSlots = allLevels.flatMap(l => l.slots);
const output = { slots: allSlots };

console.log(JSON.stringify(output, null, 2));

// Stats
for (const { story, slots } of allLevels) {
  const depths = slots.map(s => s.dimensions.depth);
  const avgDepth = Math.round(depths.reduce((a,b) => a+b, 0) / depths.length);
  const maxDepth = Math.max(...depths);
  const minDepth = Math.min(...depths);
  process.stderr.write(
    `${story.name}: ${slots.length} slots, depth ${minDepth}–${maxDepth}mm (avg ${avgDepth}mm)\n`
  );
}
process.stderr.write(`Total: ${allSlots.length} slots\n`);
