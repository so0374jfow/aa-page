import * as THREE from 'three';
import { EMPTY_COLOR, EDGE_COLOR, getElementColor } from './colors.js';

const MM_TO_UNITS = 0.001; // 1mm = 0.001 scene units

// Map: slotId → { mesh, edges, slot, element }
export const slotMeshes = new Map();

export function buildWall(scene, slotsData, elementsData) {
  const elementMap = new Map();
  if (elementsData?.elements) {
    for (const el of elementsData.elements) {
      elementMap.set(el.id, el);
    }
  }

  for (const slot of slotsData.slots) {
    const element = slot.element_id ? elementMap.get(slot.element_id) : null;
    const entry = createSlotMesh(slot, element);
    scene.add(entry.group);
    slotMeshes.set(slot.id, entry);
  }
}

function createSlotMesh(slot, element) {
  const w = slot.dimensions.width * MM_TO_UNITS;
  const h = slot.dimensions.height * MM_TO_UNITS;
  const d = slot.dimensions.depth * MM_TO_UNITS;

  const geometry = new THREE.BoxGeometry(w, h, d);

  const isEmpty = !element;
  const color = getElementColor(element);

  let material;
  if (isEmpty) {
    material = new THREE.MeshBasicMaterial({
      color: EMPTY_COLOR,
      wireframe: true,
      transparent: true,
      opacity: 0.3
    });
  } else {
    material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.7,
      metalness: 0.1
    });
  }

  const mesh = new THREE.Mesh(geometry, material);

  // Position: convert mm to scene units
  const px = slot.position.x * MM_TO_UNITS + w / 2;
  const py = slot.position.y * MM_TO_UNITS + h / 2;
  const pz = slot.position.z * MM_TO_UNITS + d / 2;
  mesh.position.set(px, py, pz);

  // Store metadata for raycasting
  mesh.userData = { slotId: slot.id };

  const group = new THREE.Group();
  group.add(mesh);

  // White edge outline for filled slots
  let edges = null;
  if (!isEmpty) {
    const edgeGeo = new THREE.EdgesGeometry(geometry);
    const edgeMat = new THREE.LineBasicMaterial({
      color: EDGE_COLOR,
      transparent: true,
      opacity: 0.15
    });
    edges = new THREE.LineSegments(edgeGeo, edgeMat);
    edges.position.copy(mesh.position);
    group.add(edges);
  }

  // Violation overlay (hidden by default)
  const violationGeo = new THREE.EdgesGeometry(geometry);
  const violationMat = new THREE.LineBasicMaterial({
    color: 0xff0000,
    transparent: true,
    opacity: 0.8,
    linewidth: 2
  });
  const violationOverlay = new THREE.LineSegments(violationGeo, violationMat);
  violationOverlay.position.copy(mesh.position);
  violationOverlay.visible = false;
  group.add(violationOverlay);

  return { mesh, edges, group, violationOverlay, slot, element, isEmpty };
}

export function updateSlotElement(scene, slotId, slot, element) {
  const existing = slotMeshes.get(slotId);
  if (existing) {
    scene.remove(existing.group);
  }

  const entry = createSlotMesh(slot, element);
  scene.add(entry.group);
  slotMeshes.set(slotId, entry);
  return entry;
}

export function animateNewElement(entry, duration = 600) {
  const mesh = entry.mesh;
  const edges = entry.edges;
  const violationOverlay = entry.violationOverlay;
  const targetScale = { x: mesh.scale.x, y: mesh.scale.y, z: mesh.scale.z };

  mesh.scale.set(0.001, 0.001, 0.001);
  if (edges) edges.scale.set(0.001, 0.001, 0.001);
  if (violationOverlay) violationOverlay.scale.set(0.001, 0.001, 0.001);

  const start = performance.now();

  function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    // ease-out cubic
    const e = 1 - Math.pow(1 - t, 3);
    const sx = 0.001 + (targetScale.x - 0.001) * e;
    const sy = 0.001 + (targetScale.y - 0.001) * e;
    const sz = 0.001 + (targetScale.z - 0.001) * e;

    mesh.scale.set(sx, sy, sz);
    if (edges) edges.scale.set(sx, sy, sz);
    if (violationOverlay) violationOverlay.scale.set(sx, sy, sz);

    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

export function animateColorChange(entry, newColor, duration = 400) {
  if (entry.isEmpty) return;
  const mat = entry.mesh.material;
  const startColor = mat.color.clone();
  const endColor = new THREE.Color(newColor);
  const start = performance.now();

  function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    mat.color.lerpColors(startColor, endColor, t);
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// Pulse animation for PENDING_REVIEW slots
const pendingSlots = [];

export function registerPendingPulse(entry) {
  if (!pendingSlots.includes(entry)) pendingSlots.push(entry);
}

export function unregisterPendingPulse(entry) {
  const idx = pendingSlots.indexOf(entry);
  if (idx !== -1) pendingSlots.splice(idx, 1);
}

export function updatePulses(time) {
  for (const entry of pendingSlots) {
    if (entry.mesh.material.emissive) {
      const pulse = 0.1 + 0.15 * Math.sin(time * 2);
      entry.mesh.material.emissiveIntensity = pulse;
      entry.mesh.material.emissive.setHex(0xddcc33);
    }
  }
}
