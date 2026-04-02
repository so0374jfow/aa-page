// Generate slots.json with 3 balcony railings, each 20m x 1m, stacked at 3 story heights
// Run: node generate_slots.mjs > ../data/slots.json

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickType() {
  // Target: Large ≤25%, Medium 50-65%, Small ≥25%
  const r = Math.random();
  if (r < 0.20) return 'A';      // ~20% large
  if (r < 0.75) return 'B';      // ~55% medium
  return 'C';                     // ~25% small
}

function slotDims(type) {
  switch (type) {
    case 'A': return { width: rand(300, 600), height: rand(200, 500), depth: rand(80, 200) };
    case 'B': return { width: rand(150, 300), height: rand(100, 300), depth: rand(40, 120) };
    case 'C': return { width: rand(50, 150),  height: rand(50, 200),  depth: rand(20, 80)  };
  }
}

function fireZone(absoluteHeightM) {
  if (absoluteHeightM < 3) return 1;
  if (absoluteHeightM < 6) return 2;
  return 3;
}

const GAP = 5; // 5mm gap between slots

// Story heights in mm (floor level where railing starts)
const STORIES = [
  { name: 'level-1', label: 'Ground floor',  baseY: 0 },
  { name: 'level-2', label: 'First floor',   baseY: 3500 },  // 3.5m up
  { name: 'level-3', label: 'Second floor',  baseY: 7000 },  // 7m up
];

function packRailing(story, storyIndex) {
  const RAILING_W = 20000; // 20m in mm
  const RAILING_H = 1000;  // 1m in mm
  const slots = [];
  let slotNum = 1;
  const prefix = `SLOT-L${storyIndex + 1}`;

  // Pack rows bottom to top within the railing
  let localY = 0;
  while (localY < RAILING_H) {
    const rowType = pickType();
    const rowDims = slotDims(rowType);
    let rowHeight = rowDims.height;

    if (localY + rowHeight > RAILING_H) {
      rowHeight = RAILING_H - localY;
      if (rowHeight < 40) break;
    }

    // Pack slots left to right
    let x = 0;
    while (x < RAILING_W) {
      const type = pickType();
      let dims = slotDims(type);

      dims.height = Math.min(dims.height, rowHeight);
      if (dims.height < 40) dims.height = rowHeight;

      if (x + dims.width > RAILING_W) {
        dims.width = RAILING_W - x;
        if (dims.width < 30) break;
      }

      const absoluteY = story.baseY + localY;
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
      x += dims.width + GAP;
    }

    localY += rowHeight + GAP;
  }

  return slots;
}

// Compute adjacency within each railing
function computeAdjacency(slots) {
  const TOLERANCE = 20; // mm

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

for (const { story, slots } of allLevels) {
  process.stderr.write(`${story.name} (${story.label}, base ${story.baseY}mm): ${slots.length} slots\n`);
}
process.stderr.write(`Total: ${allSlots.length} slots\n`);
