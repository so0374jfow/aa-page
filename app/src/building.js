import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Building model loader — renders an IFC or GLB model behind the spolia wall.
 *
 * Reads building_config.json to align the building so its balcony railings
 * match the Three.js wall level positions. This makes it adaptive to any
 * IFC/GLB file — just update the config with the new balcony heights.
 *
 * Upload your file to: data/models/building.glb (or building.ifc)
 * Edit alignment:      data/models/building_config.json
 */

let buildingGroup = null;
let buildingVisible = true;
let scene = null;
let buildingConfig = null;

const MM = 0.001; // mm to Three.js units

const CONFIG_PATH = './data/models/building_config.json';
const BUILDING_PATH_GLB = './data/models/building.glb';
const BUILDING_PATH_IFC = './data/models/building.ifc';

export function initBuilding(sceneRef) {
  scene = sceneRef;

  buildingGroup = new THREE.Group();
  buildingGroup.name = 'building';
  scene.add(buildingGroup);

  // Load config first, then try to load the building model
  loadConfig().then(() => tryAutoLoad());

  initDragDrop();
}

export function toggleBuilding() {
  buildingVisible = !buildingVisible;
  if (buildingGroup) buildingGroup.visible = buildingVisible;
  return buildingVisible;
}

export function isBuildingVisible() {
  return buildingVisible;
}

export function hasBuildingModel() {
  return buildingGroup && buildingGroup.children.length > 0;
}

/**
 * Returns the loaded building config, or null if not loaded.
 * Other modules (like generate_slots.mjs) use this to get balcony heights.
 */
export function getBuildingConfig() {
  return buildingConfig;
}

/**
 * Returns the wall level base-Y positions in mm, derived from the config.
 * Falls back to hardcoded defaults if no config is loaded.
 */
export function getLevelBaseHeights() {
  if (buildingConfig?.balcony_levels) {
    return buildingConfig.balcony_levels.map(l => ({
      name: l.name,
      label: l.label,
      baseY: l.ifc_railing_y_mm,
      railingHeight: l.railing_height_mm || 1000,
    }));
  }
  // Defaults matching the original generate_slots.mjs
  return [
    { name: 'level-1', label: 'Ground floor', baseY: 0, railingHeight: 1000 },
    { name: 'level-2', label: 'First floor', baseY: 3500, railingHeight: 1000 },
    { name: 'level-3', label: 'Second floor', baseY: 7000, railingHeight: 1000 },
  ];
}

// ── Config Loading ──

async function loadConfig() {
  try {
    const resp = await fetch(CONFIG_PATH);
    if (resp.ok) {
      buildingConfig = await resp.json();
      console.log('Building config loaded:', buildingConfig);
    }
  } catch (_) {
    console.log('No building_config.json found, using defaults');
  }
}

// ── Alignment Transform ──

/**
 * Computes and applies the transform that aligns the IFC building
 * with the Three.js wall coordinates.
 *
 * The wall sits at X: 0–20 units, Y: per balcony_levels, Z: 0 (face).
 * IFC models often use real-world survey coordinates (large offsets).
 *
 * Strategy:
 * 1. Apply rotation to model FIRST (around its own center)
 * 2. Recompute bounding box of rotated model
 * 3. Position so balcony edge aligns with wall face at Z=0,
 *    building body extends behind (negative Z)
 */
function applyAlignmentTransform(model) {
  const t = buildingConfig?.building_transform || {};

  // URL query params override config for live tuning:
  //   ?ox=0&oy=0&oz=2000&ry=180
  const params = new URLSearchParams(window.location.search);
  const offsetXmm = params.has('ox') ? parseFloat(params.get('ox')) : (t.offset_x_mm || 0);
  const offsetYmm = params.has('oy') ? parseFloat(params.get('oy')) : (t.offset_y_mm || 0);
  const offsetZmm = params.has('oz') ? parseFloat(params.get('oz')) : (t.offset_z_mm || 0);
  const rotYdeg   = params.has('ry') ? parseFloat(params.get('ry')) : (t.rotation_y_deg || 0);

  console.log(`Building transform: ox=${offsetXmm} oy=${offsetYmm} oz=${offsetZmm} ry=${rotYdeg} (use ?ox=&oy=&oz=&ry= to override)`);

  // Step 1: Apply rotation to model around its own center
  if (rotYdeg) {
    const preBbox = new THREE.Box3().setFromObject(model);
    const preCenter = new THREE.Vector3();
    preBbox.getCenter(preCenter);

    // Translate so center is at origin, rotate, translate back
    model.position.sub(preCenter);
    const rotGroup = new THREE.Group();
    rotGroup.rotation.y = (rotYdeg * Math.PI) / 180;
    rotGroup.updateMatrixWorld(true);

    // Apply rotation directly to model's matrix
    model.applyMatrix4(new THREE.Matrix4().makeTranslation(-preCenter.x, -preCenter.y, -preCenter.z));
    model.applyMatrix4(new THREE.Matrix4().makeRotationY((rotYdeg * Math.PI) / 180));
    model.applyMatrix4(new THREE.Matrix4().makeTranslation(preCenter.x, preCenter.y, preCenter.z));
    model.position.set(0, 0, 0);
  }

  // Step 2: Compute bounding box of (now rotated) model
  const bbox = new THREE.Box3().setFromObject(model);
  const modelCenter = new THREE.Vector3();
  bbox.getCenter(modelCenter);
  const modelSize = new THREE.Vector3();
  bbox.getSize(modelSize);

  console.log('Building bbox (after rotation):', {
    min: `(${(bbox.min.x/MM).toFixed(0)}, ${(bbox.min.y/MM).toFixed(0)}, ${(bbox.min.z/MM).toFixed(0)})mm`,
    max: `(${(bbox.max.x/MM).toFixed(0)}, ${(bbox.max.y/MM).toFixed(0)}, ${(bbox.max.z/MM).toFixed(0)})mm`,
    size: `${(modelSize.x/MM).toFixed(0)} x ${(modelSize.y/MM).toFixed(0)} x ${(modelSize.z/MM).toFixed(0)}mm`,
  });

  // Step 3: Position the building
  const wallCenterX = 10;

  // X: center the building on the wall (X=10)
  const offsetX = wallCenterX - modelCenter.x + offsetXmm * MM;

  // Y: DON'T move vertically — IFC elevations already match wall levels
  const offsetY = offsetYmm * MM;

  // Z: Place the building's front face (max Z after rotation) at Z=0,
  //    so the balcony edge aligns with the wall face.
  //    Building body extends behind (negative Z).
  //    offset_z_mm: negative = push building further behind, positive = pull forward
  const offsetZ = -bbox.max.z + offsetZmm * MM;

  buildingGroup.position.set(offsetX, offsetY, offsetZ);
  buildingGroup.rotation.set(0, 0, 0); // rotation already baked into model

  console.log(`Building aligned: front face at Z=${(bbox.max.z/MM).toFixed(0)}mm → Z=0, centered at X=${wallCenterX}`);
}

// ── Auto-load ──

async function tryAutoLoad() {
  // Try GLB first (simpler, no WASM needed)
  try {
    const resp = await fetch(BUILDING_PATH_GLB, { method: 'HEAD' });
    if (resp.ok) {
      await loadGLB(BUILDING_PATH_GLB);
      return;
    }
  } catch (_) { /* not found, try IFC */ }

  // Try IFC
  try {
    const resp = await fetch(BUILDING_PATH_IFC, { method: 'HEAD' });
    if (resp.ok) {
      const data = await fetch(BUILDING_PATH_IFC).then(r => r.arrayBuffer());
      await loadIFC(new Uint8Array(data));
      return;
    }
  } catch (_) { /* not found */ }
}

// ── GLB Loading ──

function loadGLB(url) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        clearBuilding();
        // Override materials to neutral grey
        gltf.scene.traverse((child) => {
          if (child.isMesh) {
            child.material = new THREE.MeshStandardMaterial({
              color: 0xd0d0d0,
              opacity: 0.85,
              transparent: true,
              side: THREE.DoubleSide,
              roughness: 0.9,
              metalness: 0.0,
            });
          }
        });
        buildingGroup.add(gltf.scene);
        applyAlignmentTransform(gltf.scene);
        logBuildingInfo(gltf.scene);
        resolve();
      },
      undefined,
      (err) => {
        console.warn('Building GLB load failed:', err.message);
        reject(err);
      }
    );
  });
}

// ── IFC Loading (dynamic import of web-ifc) ──

async function loadIFC(data) {
  let WebIFC;
  try {
    WebIFC = await import('web-ifc');
  } catch (e) {
    console.warn('web-ifc not available. Install with: npm install web-ifc');
    console.warn('Or convert your IFC to GLB and place at data/models/building.glb');
    return;
  }

  const api = new WebIFC.IfcAPI();

  // Try local WASM first, then CDN fallback
  const base = import.meta.env.BASE_URL || '/';
  try {
    api.SetWasmPath(base + 'wasm/');
    await api.Init();
  } catch (_) {
    try {
      api.SetWasmPath('https://cdn.jsdelivr.net/npm/web-ifc@0.0.57/');
      await api.Init();
    } catch (e) {
      console.warn('Failed to initialize web-ifc WASM:', e);
      return;
    }
  }

  const modelID = api.OpenModel(data);
  const meshGroup = new THREE.Group();

  const flatMeshes = api.LoadAllGeometry(modelID);
  for (let i = 0; i < flatMeshes.size(); i++) {
    const flatMesh = flatMeshes.get(i);

    for (let j = 0; j < flatMesh.geometries.size(); j++) {
      const placedGeom = flatMesh.geometries.get(j);
      const geometry = api.GetGeometry(modelID, placedGeom.geometryExpressID);

      const verts = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
      const indices = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());

      // web-ifc vertex format: x, y, z, nx, ny, nz per vertex
      const vertCount = verts.length / 6;
      const positions = new Float32Array(vertCount * 3);
      const normals = new Float32Array(vertCount * 3);

      for (let k = 0; k < vertCount; k++) {
        positions[k * 3] = verts[k * 6];
        positions[k * 3 + 1] = verts[k * 6 + 1];
        positions[k * 3 + 2] = verts[k * 6 + 2];
        normals[k * 3] = verts[k * 6 + 3];
        normals[k * 3 + 1] = verts[k * 6 + 4];
        normals[k * 3 + 2] = verts[k * 6 + 5];
      }

      const bufferGeom = new THREE.BufferGeometry();
      bufferGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      bufferGeom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      bufferGeom.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));

      // Neutral grey — no IFC colors, clean architectural context
      const opacity = placedGeom.color.w;
      const material = new THREE.MeshStandardMaterial({
        color: 0xd0d0d0,
        opacity: opacity < 1 ? opacity : 0.85,
        transparent: true,
        side: THREE.DoubleSide,
        roughness: 0.9,
        metalness: 0.0,
      });

      const mesh = new THREE.Mesh(bufferGeom, material);
      const mat4 = new THREE.Matrix4().fromArray(placedGeom.flatTransformation);
      mesh.applyMatrix4(mat4);

      meshGroup.add(mesh);
      geometry.delete();
    }
  }

  api.CloseModel(modelID);

  clearBuilding();
  buildingGroup.add(meshGroup);
  applyAlignmentTransform(meshGroup);
  logBuildingInfo(meshGroup);
}

function logBuildingInfo(model) {
  const bbox = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const center = new THREE.Vector3();
  bbox.getCenter(center);

  console.log('Building loaded:');
  console.log(`  Size: ${(size.x / MM).toFixed(0)} x ${(size.y / MM).toFixed(0)} x ${(size.z / MM).toFixed(0)} mm`);
  console.log(`  Center: (${(center.x / MM).toFixed(0)}, ${(center.y / MM).toFixed(0)}, ${(center.z / MM).toFixed(0)}) mm`);
  console.log(`  Bounding box: (${(bbox.min.x / MM).toFixed(0)}, ${(bbox.min.y / MM).toFixed(0)}, ${(bbox.min.z / MM).toFixed(0)}) to (${(bbox.max.x / MM).toFixed(0)}, ${(bbox.max.y / MM).toFixed(0)}, ${(bbox.max.z / MM).toFixed(0)}) mm`);

  if (buildingConfig) {
    const levels = buildingConfig.balcony_levels;
    console.log('  Balcony alignment:');
    for (const l of levels) {
      console.log(`    ${l.name} (${l.label}): railing at Y=${l.ifc_railing_y_mm}mm, height=${l.railing_height_mm}mm`);
    }
  }
}

// ── Drag & Drop ──

function initDragDrop() {
  const dropzone = document.getElementById('ifc-dropzone');
  if (!dropzone) return;

  let dragCounter = 0;

  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    if (hasModelFile(e)) dropzone.classList.add('active');
  });

  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      dropzone.classList.remove('active');
    }
  });

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropzone.classList.remove('active');

    const file = e.dataTransfer?.files?.[0];
    if (!file) return;

    const name = file.name.toLowerCase();
    const data = new Uint8Array(await file.arrayBuffer());

    if (name.endsWith('.ifc')) {
      await loadIFC(data);
    } else if (name.endsWith('.glb') || name.endsWith('.gltf')) {
      const blob = new Blob([data], { type: 'model/gltf-binary' });
      const url = URL.createObjectURL(blob);
      await loadGLB(url);
      URL.revokeObjectURL(url);
    } else {
      console.warn('Unsupported file type. Drop an .ifc or .glb file.');
    }
  });
}

function hasModelFile(e) {
  if (e.dataTransfer?.items) {
    for (const item of e.dataTransfer.items) {
      if (item.kind === 'file') return true;
    }
  }
  return false;
}

function clearBuilding() {
  while (buildingGroup.children.length > 0) {
    const child = buildingGroup.children[0];
    buildingGroup.remove(child);
    child.traverse?.((node) => {
      if (node.geometry) node.geometry.dispose();
      if (node.material) {
        if (Array.isArray(node.material)) node.material.forEach(m => m.dispose());
        else node.material.dispose();
      }
    });
  }
}
