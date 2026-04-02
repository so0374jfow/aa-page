import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0xf5f5f5);

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

  // Lighting
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  const directional = new THREE.DirectionalLight(0xffffff, 0.8);
  directional.position.set(10, 12, 20);
  scene.add(directional);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
  fillLight.position.set(-5, 6, -10);
  scene.add(fillLight);

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

export function fitCameraToWall(camera, controls, slotMeshes) {
  if (slotMeshes.size === 0) return;

  const box = new THREE.Box3();
  for (const mesh of slotMeshes.values()) {
    box.expandByObject(mesh);
  }

  const center = new THREE.Vector3();
  box.getCenter(center);

  const size = new THREE.Vector3();
  box.getSize(size);

  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  const dist = maxDim / (2 * Math.tan(fov / 2)) * 1.4;

  camera.position.set(center.x, center.y, center.z + dist);
  controls.target.copy(center);
  controls.update();
}
