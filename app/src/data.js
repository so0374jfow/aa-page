import { getElementColor } from './colors.js';
import {
  slotMeshes,
  updateSlotElement,
  animateNewElement,
  animateColorChange,
  registerPendingPulse,
  unregisterPendingPulse
} from './wall.js';

const OWNER = 'so0374jfow';
const REPO = 'aa-page';
const BRANCH = 'main';
const POLL_INTERVAL = 30000; // 30 seconds

let currentElements = new Map();
let currentSlots = new Map();
let scene = null;
let onDataUpdate = null;

function dataUrl(file) {
  return `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/data/${file}?t=${Date.now()}`;
}

export async function fetchData() {
  try {
    const [elemRes, slotsRes] = await Promise.all([
      fetch(dataUrl('elements.json')),
      fetch(dataUrl('slots.json'))
    ]);

    if (!elemRes.ok || !slotsRes.ok) {
      console.warn('Failed to fetch remote data, using local');
      return null;
    }

    return {
      elements: await elemRes.json(),
      slots: await slotsRes.json()
    };
  } catch (e) {
    console.warn('Data fetch error:', e);
    return null;
  }
}

export async function loadLocalData() {
  try {
    const [elemRes, slotsRes] = await Promise.all([
      fetch('./data/elements.json'),
      fetch('./data/slots.json')
    ]);
    return {
      elements: await elemRes.json(),
      slots: await slotsRes.json()
    };
  } catch (e) {
    console.warn('Local data fetch error:', e);
    return null;
  }
}

export function initDataPolling(sceneRef, callback) {
  scene = sceneRef;
  onDataUpdate = callback;

  // Start polling
  setInterval(async () => {
    const data = await fetchData();
    if (data) processUpdate(data);
  }, POLL_INTERVAL);
}

export function forceRefresh() {
  fetchData().then(data => {
    if (data) processUpdate(data);
  });
}

function processUpdate(data) {
  const newElementMap = new Map();
  for (const el of data.elements.elements) {
    newElementMap.set(el.id, el);
  }

  const newSlotMap = new Map();
  for (const sl of data.slots.slots) {
    newSlotMap.set(sl.id, sl);
  }

  // Detect changes
  for (const [id, newEl] of newElementMap) {
    const oldEl = currentElements.get(id);

    if (!oldEl) {
      // New element — find its slot and animate in
      const slot = newSlotMap.get(newEl.slot_id);
      if (slot) {
        const entry = updateSlotElement(scene, slot.id, slot, newEl);
        animateNewElement(entry);
        if (newEl.status === 'PENDING_REVIEW') registerPendingPulse(entry);
      }
    } else if (oldEl.status !== newEl.status) {
      // Status changed — animate colour
      const slot = newSlotMap.get(newEl.slot_id);
      if (slot) {
        const entry = slotMeshes.get(slot.id);
        if (entry) {
          const newColor = getElementColor(newEl);
          animateColorChange(entry, newColor);
          entry.element = newEl;

          // Update pulse registration
          if (newEl.status === 'PENDING_REVIEW') registerPendingPulse(entry);
          else unregisterPendingPulse(entry);
        }
      }
    }
  }

  currentElements = newElementMap;
  currentSlots = newSlotMap;

  if (onDataUpdate) onDataUpdate(data);
}

export function setInitialData(elementsData, slotsData) {
  if (elementsData?.elements) {
    for (const el of elementsData.elements) {
      currentElements.set(el.id, el);
    }
  }
  if (slotsData?.slots) {
    for (const sl of slotsData.slots) {
      currentSlots.set(sl.id, sl);
    }
  }

  // Register initial pending review pulses
  for (const [, entry] of slotMeshes) {
    if (entry.element?.status === 'PENDING_REVIEW') {
      registerPendingPulse(entry);
    }
  }
}

export function getElementById(id) {
  return currentElements.get(id);
}

export function getSlotById(id) {
  return currentSlots.get(id);
}

export function getCurrentElements() {
  return currentElements;
}

export function getCurrentSlots() {
  return currentSlots;
}

export function getMetadata(elementsData) {
  return elementsData?.metadata || {
    total_elements: 0,
    total_spend_chf: 0,
    estimated_coverage_m2: 0,
    last_updated: ''
  };
}
