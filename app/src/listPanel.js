import { getElementColor } from './colors.js';
import { slotMeshes } from './wall.js';
import { openPanel } from './panel.js';
import { flyToObject } from './scene.js';

let listEl = null;
let contentEl = null;
let sortSelect = null;
let filterSelect = null;
let currentData = null;
let camera = null;
let controls = null;

export function initListPanel(cam, ctrl) {
  listEl = document.getElementById('list-panel');
  contentEl = document.getElementById('list-content');
  sortSelect = document.getElementById('list-sort');
  filterSelect = document.getElementById('list-filter');
  camera = cam;
  controls = ctrl;

  sortSelect?.addEventListener('change', () => render());
  filterSelect?.addEventListener('change', () => render());
}

export function updateListData(elementsData) {
  currentData = elementsData;
  if (listEl?.classList.contains('open')) {
    render();
  }
}

export function toggleListPanel() {
  listEl?.classList.toggle('open');
  if (listEl?.classList.contains('open') && currentData) {
    render();
  }
  return listEl?.classList.contains('open');
}

export function isListOpen() {
  return listEl?.classList.contains('open');
}

function render() {
  if (!contentEl || !currentData?.elements) return;

  let elements = [...currentData.elements];
  const filter = filterSelect?.value || 'all';
  const sort = sortSelect?.value || 'id';

  // Filter
  if (filter !== 'all') {
    elements = elements.filter(el => el.status === filter);
  }

  // Sort
  elements.sort((a, b) => {
    switch (sort) {
      case 'status': return statusOrder(a.status) - statusOrder(b.status);
      case 'category': return (a.category || '').localeCompare(b.category || '');
      case 'price': return (b.total_chf || 0) - (a.total_chf || 0);
      default: return a.id.localeCompare(b.id);
    }
  });

  let html = '';
  for (const el of elements) {
    const color = '#' + (getElementColor(el) || 0x666666).toString(16).padStart(6, '0');
    const statusColor = color;
    const price = el.total_chf != null ? `CHF ${el.total_chf.toFixed(0)}` : '';
    const dims = el.dimensions_estimated;
    const dimStr = dims ? `${dims.width}x${dims.height}x${dims.depth}mm` : '';
    const hasMesh = el.mesh_url ? '3D' : '';

    html += `<div class="list-item" data-id="${el.id}" data-slot="${el.slot_id || ''}">`;
    html += `  <span class="list-status-dot" style="background:${statusColor}"></span>`;
    html += `  <div class="list-item-body">`;
    html += `    <div style="display:flex;justify-content:space-between;align-items:center">`;
    html += `      <span class="list-item-id">${el.id}</span>`;
    html += `      <span class="list-item-status" style="background:${statusColor};color:#000">${el.status}</span>`;
    html += `    </div>`;
    html += `    <div class="list-item-desc">${el.description || el.subcategory?.replace(/_/g, ' ') || ''}</div>`;
    html += `    <div class="list-item-meta">`;
    html += `      ${el.category} &middot; ${el.subcategory?.replace(/_/g, ' ') || ''}`;
    if (dimStr) html += ` &middot; ${dimStr}`;
    if (hasMesh) html += ` &middot; <strong>${hasMesh}</strong>`;
    html += `    </div>`;
    html += `    <div class="list-item-meta">`;
    html += `      ${el.platform || ''} &middot; ${el.seller_handle || ''}`;
    if (price) html += ` &middot; <span class="list-item-price">${price}</span>`;
    html += `    </div>`;
    html += `  </div>`;
    html += `</div>`;
  }

  if (elements.length === 0) {
    html = `<div style="padding:40px 20px;text-align:center;color:#999">No elements match filter</div>`;
  }

  contentEl.innerHTML = html;

  // Click handlers — open detail panel and fly to object
  contentEl.querySelectorAll('.list-item').forEach(item => {
    item.addEventListener('click', () => {
      const slotId = item.dataset.slot;
      if (slotId) {
        openPanel(slotId);
        const entry = slotMeshes.get(slotId);
        if (entry && camera && controls) {
          flyToObject(camera, controls, entry.group);
        }
      }
    });
  });
}

const STATUS_ORDER = [
  'SCOUTED', 'ASSESSED', 'PENDING_REVIEW', 'APPROVED',
  'NEGOTIATING', 'PURCHASED', 'SHIPPED', 'RECEIVED',
  'ALLOCATED', 'INSTALLED', 'REJECTED'
];

function statusOrder(status) {
  const idx = STATUS_ORDER.indexOf(status);
  return idx >= 0 ? idx : 99;
}
