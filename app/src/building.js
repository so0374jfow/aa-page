import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Building model loader — renders an IFC or GLB model behind the spolia wall.
 *
 * Supports:
 * - Auto-load from data/models/building.ifc or building.glb
 * - Drag-and-drop .ifc or .glb files onto the page
 * - Toggle visibility with B key
 *
 * IFC loading uses web-ifc (dynamically imported, only loaded when needed).
 * GLB loading uses the standard Three.js GLTFLoader.
 */

let buildingGroup = null;
let buildingVisible = true;
let scene = null;

const BUILDING_PATH_GLB = './data/models/building.glb';
const BUILDING_PATH_IFC = './data/models/building.ifc';

// The wall sits at z=0 with depths extending into +z.
// The building goes behind the wall (further +z).
const BUILDING_OFFSET_Z = 0.5; // 500mm behind wall face

export function initBuilding(sceneRef) {
  scene = sceneRef;

  // Create container group
  buildingGroup = new THREE.Group();
  buildingGroup.name = 'building';
  buildingGroup.position.z = BUILDING_OFFSET_Z;
  scene.add(buildingGroup);

  // Try auto-loading building model
  tryAutoLoad();

  // Set up drag-and-drop
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
        const model = gltf.scene;
        buildingGroup.add(model);
        console.log('Building GLB loaded');
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
    console.warn('web-ifc not available. Install it with: npm install web-ifc');
    console.warn('Alternatively, convert your IFC to GLB and place at data/models/building.glb');
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

      const color = placedGeom.color;
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(color.x, color.y, color.z),
        opacity: color.w,
        transparent: color.w < 1,
        side: THREE.DoubleSide,
        roughness: 0.8,
        metalness: 0.1,
      });

      const mesh = new THREE.Mesh(bufferGeom, material);

      // Apply IFC placement transform
      const mat4 = new THREE.Matrix4().fromArray(placedGeom.flatTransformation);
      mesh.applyMatrix4(mat4);

      meshGroup.add(mesh);

      geometry.delete();
    }
  }

  api.CloseModel(modelID);

  clearBuilding();
  buildingGroup.add(meshGroup);
  console.log(`IFC loaded: ${flatMeshes.size()} elements`);
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
      // Create a blob URL for the GLTFLoader
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
