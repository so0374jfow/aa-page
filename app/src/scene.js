import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Fly-to animation state
let flyState = null;

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0xf5f5f5);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.01,
    500
  );
  // Position to see all 3 balcony railings (20m wide, stacked at 0m / 3.5m / 7m)
  camera.position.set(10, 4, 30);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(10, 4, 0);

  // Better navigation defaults
  controls.screenSpacePanning = true;    // Pan parallel to screen (more intuitive)
  controls.minDistance = 0.1;            // Allow close inspection
  controls.maxDistance = 80;             // Don't lose the wall
  controls.maxPolarAngle = Math.PI * 0.95; // Prevent flipping under
  controls.enablePan = true;
  controls.panSpeed = 1.0;
  controls.rotateSpeed = 0.8;
  controls.zoomSpeed = 1.2;

  // Lighting — better for textured models
  const ambient = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambient);

  const directional = new THREE.DirectionalLight(0xffffff, 1.0);
  directional.position.set(10, 12, 20);
  scene.add(directional);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
  fillLight.position.set(-5, 6, -10);
  scene.add(fillLight);

  // Backlight for depth
  const backLight = new THREE.DirectionalLight(0xffffff, 0.2);
  backLight.position.set(10, 4, -15);
  scene.add(backLight);

  // Axes helper (toggled with A key)
  const axesHelper = new THREE.AxesHelper(5);
  axesHelper.visible = false;
  scene.add(axesHelper);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { renderer, scene, camera, controls, axesHelper };
}

/**
 * Smoothly fly the camera to a new position/target over `duration` seconds.
 */
export function flyTo(camera, controls, position, target, duration = 0.8) {
  flyState = {
    startPos: camera.position.clone(),
    startTarget: controls.target.clone(),
    endPos: position.clone(),
    endTarget: target.clone(),
    startTime: performance.now(),
    duration: duration * 1000,
  };
  // Disable controls during fly
  controls.enabled = false;
}

/**
 * Call every frame to update fly-to animation.
 * Returns true if still animating.
 */
export function updateFlyTo(camera, controls) {
  if (!flyState) return false;

  const elapsed = performance.now() - flyState.startTime;
  const t = Math.min(elapsed / flyState.duration, 1);
  // ease-in-out cubic
  const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  camera.position.lerpVectors(flyState.startPos, flyState.endPos, e);
  controls.target.lerpVectors(flyState.startTarget, flyState.endTarget, e);
  controls.update();

  if (t >= 1) {
    controls.enabled = true;
    flyState = null;
    return false;
  }
  return true;
}

/**
 * Fly camera to focus on a specific object (by its world bounding box).
 * On mobile with a bottom panel, shifts the target upward so the object
 * appears centered in the visible top half of the viewport.
 */
export function flyToObject(camera, controls, object) {
  const bbox = new THREE.Box3().setFromObject(object);
  const center = new THREE.Vector3();
  bbox.getCenter(center);
  const size = new THREE.Vector3();
  bbox.getSize(size);

  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  // Get close enough to see detail — 2.5x the object size
  const dist = Math.max(maxDim / (2 * Math.tan(fov / 2)) * 2.5, 0.5);

  // On mobile, offset upward so object centers in the visible top half
  // (bottom 50% is covered by the panel sheet)
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  const yOffset = isMobile ? dist * Math.tan(fov * 0.25) : 0;

  const camPos = new THREE.Vector3(center.x, center.y + yOffset, center.z + dist);
  const target = new THREE.Vector3(center.x, center.y + yOffset, center.z);

  flyTo(camera, controls, camPos, target, 0.8);
}

export function fitCameraToWall(camera, controls, slotMeshes) {
  if (slotMeshes.size === 0) return;

  const box = new THREE.Box3();
  for (const entry of slotMeshes.values()) {
    box.expandByObject(entry.group);
  }

  const center = new THREE.Vector3();
  box.getCenter(center);

  const size = new THREE.Vector3();
  box.getSize(size);

  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  const dist = maxDim / (2 * Math.tan(fov / 2)) * 1.4;

  // On mobile, shift upward so wall centers in visible top half
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  const yOffset = isMobile ? dist * Math.tan(fov * 0.2) : 0;

  const newPos = new THREE.Vector3(center.x, center.y + yOffset, center.z + dist);
  const target = new THREE.Vector3(center.x, center.y + yOffset, center.z);
  flyTo(camera, controls, newPos, target, 1.0);
}
