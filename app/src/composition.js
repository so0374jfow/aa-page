import { slotMeshes } from './wall.js';
import { getCurrentElements, getCurrentSlots } from './data.js';

let overlayVisible = false;
let lastViolationCount = 0;

export function toggleCompositionOverlay() {
  overlayVisible = !overlayVisible;
  if (overlayVisible) {
    lastViolationCount = checkAndShowViolations();
  } else {
    hideAllViolations();
    lastViolationCount = 0;
  }
  return lastViolationCount;
}

export function isOverlayVisible() {
  return overlayVisible;
}

export function getViolationCount() {
  return lastViolationCount;
}

export function recalculateViolations() {
  lastViolationCount = countViolations();
  if (overlayVisible) {
    checkAndShowViolations();
  }
  return lastViolationCount;
}

function hideAllViolations() {
  for (const entry of slotMeshes.values()) {
    entry.violationOverlay.visible = false;
  }
}

function checkAndShowViolations() {
  hideAllViolations();
  const violatingSlots = findViolations();

  for (const slotId of violatingSlots) {
    const entry = slotMeshes.get(slotId);
    if (entry) {
      entry.violationOverlay.visible = true;
    }
  }

  return violatingSlots.size;
}

function countViolations() {
  return findViolations().size;
}

function findViolations() {
  const violations = new Set();
  const elements = getCurrentElements();
  const slots = getCurrentSlots();

  for (const [slotId, entry] of slotMeshes) {
    if (!entry.element) continue;

    const slot = slots.get(slotId) || entry.slot;
    const el = entry.element;
    const adjacent = slot.adjacent || [];

    for (const adjId of adjacent) {
      const adjEntry = slotMeshes.get(adjId);
      if (!adjEntry?.element) continue;
      const adjEl = adjEntry.element;
      const adjSlot = slots.get(adjId) || adjEntry.slot;

      // Rule 1: No same subcategory adjacent
      if (el.subcategory === adjEl.subcategory) {
        violations.add(slotId);
        violations.add(adjId);
      }

      // Rule 2: No same category adjacent
      if (el.category === adjEl.category) {
        violations.add(slotId);
        violations.add(adjId);
      }

      // Rule 4: Adjacent must differ by ≥20mm depth
      const depthA = el.dimensions_actual?.depth || el.dimensions_estimated?.depth || 0;
      const depthB = adjEl.dimensions_actual?.depth || adjEl.dimensions_estimated?.depth || 0;
      if (Math.abs(depthA - depthB) < 20) {
        violations.add(slotId);
        violations.add(adjId);
      }
    }

    // Rule 3: CAT-D must be surrounded by CAT-A or CAT-B on all sides
    if (el.category === 'CAT-D') {
      for (const adjId of adjacent) {
        const adjEntry = slotMeshes.get(adjId);
        if (!adjEntry?.element) {
          // Empty adjacent — violation
          violations.add(slotId);
          break;
        }
        if (adjEntry.element.category !== 'CAT-A' && adjEntry.element.category !== 'CAT-B') {
          violations.add(slotId);
          violations.add(adjId);
        }
      }
    }

    // Rule 5: Fire zone compliance
    const zone = slot.fire_zone;
    if (zone === 3) {
      if (el.category === 'CAT-D') violations.add(slotId);
      if (el.category === 'CAT-E') violations.add(slotId);
      if (el.category === 'CAT-C' && el.fire_classification !== 'RF1') violations.add(slotId);
    } else if (zone === 2) {
      if (el.category === 'CAT-D' && el.fire_classification !== 'RF1') violations.add(slotId);
    }
  }

  return violations;
}
