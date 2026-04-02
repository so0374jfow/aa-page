import * as THREE from 'three';
import { STATUS_COLORS, CATEGORY_COLORS, getElementColor } from './colors.js';
import { slotMeshes } from './wall.js';

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let panelEl = null;
let currentSlotId = null;

export function initPanel(camera, canvasEl) {
  panelEl = document.getElementById('detail-panel');

  canvasEl.addEventListener('click', (event) => {
    // Ignore if panel click
    if (event.target.closest('#detail-panel')) return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const meshes = [];
    for (const entry of slotMeshes.values()) {
      meshes.push(entry.mesh);
    }

    const intersects = raycaster.intersectObjects(meshes);
    if (intersects.length > 0) {
      const slotId = intersects[0].object.userData.slotId;
      openPanel(slotId);
    }
  });
}

export function openPanel(slotId) {
  const entry = slotMeshes.get(slotId);
  if (!entry) return;

  currentSlotId = slotId;
  const { slot, element } = entry;

  let html = `<button class="panel-close" onclick="document.getElementById('detail-panel').classList.remove('open')">&times;</button>`;

  if (!element) {
    html += renderEmptySlot(slot);
  } else {
    html += renderElementDetail(slot, element);
  }

  panelEl.innerHTML = html;
  panelEl.classList.add('open');

  // Bind architect notes save
  const textarea = panelEl.querySelector('.architect-notes-input');
  if (textarea) {
    const key = `architect_notes_${element.id}`;
    textarea.value = localStorage.getItem(key) || element.architect_notes || '';
    textarea.addEventListener('input', () => {
      localStorage.setItem(key, textarea.value);
    });
  }
}

export function closePanel() {
  if (panelEl) {
    panelEl.classList.remove('open');
    currentSlotId = null;
  }
}

export function isPanelOpen() {
  return panelEl?.classList.contains('open');
}

function renderEmptySlot(slot) {
  return `
    <div class="empty-slot-info">
      <h3>${slot.id}</h3>
      <p>Type ${slot.type} &middot; ${slot.face} face</p>
      <p>${slot.dimensions.width} &times; ${slot.dimensions.height} &times; ${slot.dimensions.depth} mm</p>
      <p>Fire Zone ${slot.fire_zone}</p>
      <p style="margin-top:20px;color:#555">Unassigned</p>
    </div>
  `;
}

function renderElementDetail(slot, el) {
  const statusColor = '#' + (getElementColor(el) || 0x666666).toString(16).padStart(6, '0');
  const catColor = '#' + (CATEGORY_COLORS[el.category] || 0x666666).toString(16).padStart(6, '0');

  let html = '';

  // Status badge
  html += `<span class="status-badge" style="background:${statusColor};color:#000">${el.status}</span>`;

  // Category + ID
  html += `<h2>${el.id}</h2>`;
  html += `<div class="subcategory" style="color:${catColor}">${el.category} &middot; ${el.subcategory.replace(/_/g, ' ')}</div>`;

  // Description
  html += `<div class="description">${el.description}</div>`;

  // Dimensions
  html += `<div class="section-title">Dimensions (mm)</div>`;
  html += `<table class="dim-table"><tr><th></th><th>W</th><th>H</th><th>D</th></tr>`;
  if (el.dimensions_estimated) {
    html += `<tr><td style="color:#666">Est.</td><td>${el.dimensions_estimated.width}</td><td>${el.dimensions_estimated.height}</td><td>${el.dimensions_estimated.depth}</td></tr>`;
  }
  if (el.dimensions_actual) {
    html += `<tr><td style="color:#666">Act.</td><td>${el.dimensions_actual.width}</td><td>${el.dimensions_actual.height}</td><td>${el.dimensions_actual.depth}</td></tr>`;
  }
  html += `</table>`;

  // Images
  if (el.images_local && el.images_local.length > 0) {
    html += `<div class="section-title">Images</div>`;
    html += `<div class="image-grid">`;
    for (const img of el.images_local) {
      const src = `./data/images/${img}`;
      html += `<img src="${src}" alt="${img}" onerror="this.style.display='none'" onclick="openLightbox('${src}')" />`;
    }
    html += `</div>`;
  }

  // 3D Model status
  html += `<div class="section-title">3D Model</div>`;
  if (el.mesh_url) {
    html += `<div style="color:#2e7d32">&#10003; GLB mesh generated</div>`;
  } else {
    const eligible = ['APPROVED','NEGOTIATING','PURCHASED','SHIPPED','RECEIVED','ALLOCATED','INSTALLED'].includes(el.status)
      || (el.status === 'ASSESSED' && !el.architect_review_flag);
    if (eligible) {
      html += `<div style="color:#cc9933">Eligible for generation</div>`;
    } else {
      html += `<div style="color:#999">Not yet eligible</div>`;
    }
  }

  // Price breakdown
  if (el.asking_price_chf != null) {
    html += `<div class="section-title">Purchase (CHF)</div>`;
    html += `<div class="price-row"><span>Asking</span><span>${formatCHF(el.asking_price_chf)}</span></div>`;
    if (el.agreed_price_chf != null) {
      html += `<div class="price-row"><span>Agreed</span><span>${formatCHF(el.agreed_price_chf)}</span></div>`;
    }
    if (el.shipping_cost_chf != null) {
      html += `<div class="price-row"><span>Shipping</span><span>${formatCHF(el.shipping_cost_chf)}</span></div>`;
    }
    if (el.total_chf != null) {
      html += `<div class="price-row total"><span>Total</span><span>${formatCHF(el.total_chf)}</span></div>`;
    }
  }

  // Listing link
  if (el.listing_url) {
    html += `<div class="section-title">Listing</div>`;
    html += `<a class="listing-link" href="${el.listing_url}" target="_blank" rel="noopener">${el.platform} &rarr; ${el.listing_url}</a>`;
  }

  // Provenance
  if (el.provenance_seller_text) {
    html += `<div class="section-title">Provenance (seller's words)</div>`;
    html += `<div class="provenance">${el.provenance_seller_text}</div>`;
  }

  // Negotiation log
  if (el.negotiation_log) {
    html += `<div class="section-title">Negotiation Log</div>`;
    html += `<div class="negotiation-log">${escapeHtml(el.negotiation_log)}</div>`;
  }

  // Agent notes
  if (el.agent_notes) {
    html += `<div class="section-title">Agent Notes</div>`;
    html += `<div class="agent-notes">${el.agent_notes}</div>`;
  }

  // Fire zone + classification
  html += `<div class="section-title">Fire Safety</div>`;
  html += `<span class="fire-badge zone">Zone ${slot.fire_zone}</span>`;
  html += `<span class="fire-badge classification">${el.fire_classification || 'unknown'}</span>`;

  // Architect notes
  html += `<div class="section-title">Architect Notes</div>`;
  html += `<textarea class="architect-notes-input" placeholder="Add notes..."></textarea>`;

  return html;
}

function formatCHF(val) {
  return val != null ? val.toFixed(2) : '—';
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Global lightbox function
window.openLightbox = function(src) {
  let lb = document.getElementById('lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'lightbox';
    lb.addEventListener('click', () => lb.classList.remove('active'));
    lb.innerHTML = '<img />';
    document.body.appendChild(lb);
  }
  lb.querySelector('img').src = src;
  lb.classList.add('active');
};
