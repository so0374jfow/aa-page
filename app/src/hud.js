import { STATUS_COLORS, CATEGORY_COLORS } from './colors.js';
import { getCurrentElements } from './data.js';

let hudEl = null;
let violationCount = 0;

const STATUS_ORDER = [
  'SCOUTED', 'ASSESSED', 'PENDING_REVIEW', 'APPROVED',
  'NEGOTIATING', 'PURCHASED', 'SHIPPED', 'RECEIVED',
  'ALLOCATED', 'INSTALLED', 'REJECTED'
];

const CATEGORY_TARGETS = {
  'CAT-A': [40, 50],
  'CAT-B': [20, 30],
  'CAT-C': [5, 15],
  'CAT-D': [3, 8],
  'CAT-E': [10, 15]
};

const CATEGORY_LABELS = {
  'CAT-A': 'Stone/Ceramic',
  'CAT-B': 'Metal',
  'CAT-C': 'Experimental',
  'CAT-D': 'Digital Debris',
  'CAT-E': 'Domestic'
};

export function initHUD() {
  hudEl = document.getElementById('hud');

  // Add keyboard hints
  const hints = document.createElement('div');
  hints.id = 'keyboard-hints';
  hints.innerHTML = `
    <kbd>C</kbd> composition overlay<br>
    <kbd>A</kbd> axes<br>
    <kbd>R</kbd> refresh<br>
    <kbd>F</kbd> fit camera<br>
    <kbd>Esc</kbd> close panel
  `;
  document.body.appendChild(hints);
}

export function setViolationCount(count) {
  violationCount = count;
}

export function updateHUD(elementsData) {
  if (!hudEl) return;

  const elements = elementsData?.elements || [];
  const metadata = elementsData?.metadata || {};

  // Status counts
  const statusCounts = {};
  for (const s of STATUS_ORDER) statusCounts[s] = 0;
  for (const el of elements) {
    if (statusCounts[el.status] !== undefined) statusCounts[el.status]++;
  }

  // Category proportions (by area in m²)
  const catArea = {};
  let totalArea = 0;
  for (const el of elements) {
    if (el.status === 'REJECTED') continue;
    const dim = el.dimensions_actual || el.dimensions_estimated;
    if (dim) {
      const area = (dim.width / 1000) * (dim.height / 1000);
      catArea[el.category] = (catArea[el.category] || 0) + area;
      totalArea += area;
    }
  }

  let html = '';

  // Title
  html += `<div class="hud-section">`;
  html += `<div class="hud-title">Spolia Wall</div>`;
  html += `</div>`;

  // Key stats
  html += `<div class="hud-section">`;
  const demoCount = elements.filter(el => el.demo).length;
  const totalCount = metadata.total_elements || elements.length;
  html += `<div class="hud-stat">${totalCount}${demoCount > 0 ? ` <span style="font-size:12px;color:#ff9800">(${demoCount} demo)</span>` : ''}</div>`;
  html += `<div class="hud-label">Elements</div>`;
  html += `<div class="hud-stat" style="margin-top:4px">CHF ${(metadata.total_spend_chf || 0).toFixed(2)}</div>`;
  html += `<div class="hud-label">Total Spend</div>`;
  html += `<div class="hud-stat" style="margin-top:4px">${(metadata.estimated_coverage_m2 || 0).toFixed(2)} m&sup2;</div>`;
  html += `<div class="hud-label">Coverage</div>`;
  html += `</div>`;

  // Status pipeline
  html += `<div class="hud-section">`;
  html += `<div class="hud-label" style="margin-bottom:4px">Pipeline</div>`;
  for (const status of STATUS_ORDER) {
    const count = statusCounts[status];
    if (count === 0 && ['SCOUTED', 'ASSESSED', 'REJECTED'].includes(status)) continue;
    const color = status === 'INSTALLED' ? '#888' : '#' + (STATUS_COLORS[status] || 0x666666).toString(16).padStart(6, '0');
    html += `<div class="hud-row"><span class="hud-dot" style="background:${color}"></span> <span>${count} ${status}</span></div>`;
  }
  html += `</div>`;

  // Category proportions
  html += `<div class="hud-section">`;
  html += `<div class="hud-label" style="margin-bottom:4px">Category Mix</div>`;
  for (const cat of Object.keys(CATEGORY_TARGETS)) {
    const pct = totalArea > 0 ? ((catArea[cat] || 0) / totalArea) * 100 : 0;
    const [lo, hi] = CATEGORY_TARGETS[cat];
    const catColor = '#' + (CATEGORY_COLORS[cat] || 0x666666).toString(16).padStart(6, '0');
    const inRange = pct >= lo && pct <= hi;
    const barColor = inRange ? catColor : '#aa3333';

    html += `<div style="margin-bottom:6px">`;
    html += `<div class="hud-row"><span style="color:${catColor}">${cat}</span> <span style="color:#666;font-size:10px;margin-left:auto">${pct.toFixed(1)}% (${lo}–${hi}%)</span></div>`;
    html += `<div class="bar-container">`;
    html += `<div class="bar-target" style="left:${lo}%;width:${hi - lo}%"></div>`;
    html += `<div class="bar-fill" style="width:${Math.min(pct, 100)}%;background:${barColor}"></div>`;
    html += `</div>`;
    html += `</div>`;
  }
  html += `</div>`;

  // Violations
  html += `<div class="hud-section">`;
  if (violationCount > 0) {
    html += `<div class="violations">${violationCount} composition violation${violationCount > 1 ? 's' : ''}</div>`;
  } else {
    html += `<div style="color:#4a4">No violations</div>`;
  }
  html += `</div>`;

  // Timestamp
  html += `<div class="hud-section">`;
  html += `<div class="timestamp">Updated: ${metadata.last_updated ? new Date(metadata.last_updated).toLocaleString() : '—'}</div>`;
  html += `</div>`;

  hudEl.innerHTML = html;
}
