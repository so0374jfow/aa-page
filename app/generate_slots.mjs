// Generate slots.json with 3 wall faces, each 20m x 1m, packed with slots
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

function fireZone(heightM) {
  if (heightM < 3) return 1;
  if (heightM < 6) return 2;
  return 3;
}

const GAP = 5; // 5mm gap between slots

function packFace(face, baseX, baseZ) {
  const WALL_W = 20000; // 20m in mm
  const WALL_H = 1000;  // 1m in mm
  const slots = [];
  let slotNum = 1;

  // Pack rows bottom to top
  let y = 0;
  while (y < WALL_H) {
    // Determine row height from a random slot type
    const rowType = pickType();
    const rowDims = slotDims(rowType);
    let rowHeight = rowDims.height;

    // Ensure we don't exceed wall height
    if (y + rowHeight > WALL_H) {
      rowHeight = WALL_H - y;
      if (rowHeight < 40) break;
    }

    // Pack slots left to right in this row
    let x = 0;
    while (x < WALL_W) {
      const type = pickType();
      let dims = slotDims(type);

      // Constrain height to row height
      dims.height = Math.min(dims.height, rowHeight);
      if (dims.height < 40) dims.height = rowHeight;

      // Ensure we don't exceed wall width
      if (x + dims.width > WALL_W) {
        dims.width = WALL_W - x;
        if (dims.width < 30) break;
      }

      const heightM = y / 1000;
      const id = `SLOT-${face.charAt(0).toUpperCase()}-${String(slotNum).padStart(3, '0')}`;

      slots.push({
        id,
        face,
        type,
        position: {
          x: baseX + (face === 'west' ? 0 : (face === 'east' ? 0 : x)),
          y: y,
          z: baseZ + (face === 'north' ? 0 : x)
        },
        dimensions: dims,
        height_m: parseFloat(heightM.toFixed(3)),
        fire_zone: fireZone(heightM),
        status: 'empty',
        element_id: null,
        adjacent: []
      });

      slotNum++;
      x += dims.width + GAP;
    }

    y += rowHeight + GAP;
  }

  return slots;
}

// Compute adjacency: two slots are adjacent if they share an edge (within tolerance)
function computeAdjacency(slots) {
  const TOLERANCE = 20; // mm

  for (let i = 0; i < slots.length; i++) {
    const a = slots[i];
    // Only compare within same face
    for (let j = i + 1; j < slots.length; j++) {
      const b = slots[j];
      if (a.face !== b.face) continue;

      // Get bounding boxes in the face's local 2D space
      let ax, aw, ay, ah, bx, bw, by, bh;
      if (a.face === 'north') {
        ax = a.position.x; aw = a.dimensions.width;
        bx = b.position.x; bw = b.dimensions.width;
      } else {
        ax = a.position.z; aw = a.dimensions.width;
        bx = b.position.z; bw = b.dimensions.width;
      }
      ay = a.position.y; ah = a.dimensions.height;
      by = b.position.y; bh = b.dimensions.height;

      // Check horizontal adjacency (side by side, overlapping in Y)
      const hAdj = (Math.abs((ax + aw) - bx) < TOLERANCE || Math.abs((bx + bw) - ax) < TOLERANCE);
      const yOverlap = ay < (by + bh) && by < (ay + ah);

      // Check vertical adjacency (stacked, overlapping in X)
      const vAdj = (Math.abs((ay + ah) - by) < TOLERANCE || Math.abs((by + bh) - ay) < TOLERANCE);
      const xOverlap = ax < (bx + bw) && bx < (ax + aw);

      if ((hAdj && yOverlap) || (vAdj && xOverlap)) {
        a.adjacent.push(b.id);
        b.adjacent.push(a.id);
      }
    }
  }
}

// Generate three faces
const northSlots = packFace('north', 0, 0);
const eastSlots = packFace('east', 20000, 0);
const westSlots = packFace('west', -200, 0);

const allSlots = [...northSlots, ...eastSlots, ...westSlots];

// Compute adjacency within each face
computeAdjacency(northSlots);
computeAdjacency(eastSlots);
computeAdjacency(westSlots);

const output = { slots: allSlots };
console.log(JSON.stringify(output, null, 2));

process.stderr.write(`Generated ${allSlots.length} slots: ${northSlots.length} north, ${eastSlots.length} east, ${westSlots.length} west\n`);
