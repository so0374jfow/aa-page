import * as THREE from 'three';
import { createScene, fitCameraToWall, flyToObject, updateFlyTo } from './scene.js';
import { buildWall, slotMeshes, updatePulses, toggleColorOverlay, isColorOverlayVisible } from './wall.js';
import { loadLocalData, initDataPolling, setInitialData, forceRefresh } from './data.js';
import { initPanel, closePanel, isPanelOpen } from './panel.js';
import { initHUD, updateHUD, setViolationCount } from './hud.js';
import { toggleCompositionOverlay, recalculateViolations } from './composition.js';
import { initBuilding, toggleBuilding, isBuildingVisible } from './building.js';

const EMPTY_DATA = {
  elements: { metadata: { total_elements: 0, total_spend_chf: 0, estimated_coverage_m2: 0, last_updated: '' }, elements: [] },
  slots: { slots: [] }
};

async function init() {
  const canvas = document.getElementById('wall-canvas');
  const { renderer, scene, camera, controls, axesHelper } = createScene(canvas);

  // Start render loop immediately so background is never black
  function animate() {
    requestAnimationFrame(animate);
    const elapsed = (performance.now()) / 1000;
    updateFlyTo(camera, controls);
    controls.update();
    updatePulses(elapsed);
    renderer.render(scene, camera);
  }
  animate();

  // Load data (local first, then remote fallback)
  let data;
  try {
    data = await loadLocalData();
  } catch (e) {
    console.warn('Data load failed:', e);
  }
  if (!data) data = EMPTY_DATA;

  // Build the 3D wall
  buildWall(scene, data.slots, data.elements);
  setInitialData(data.elements, data.slots);

  // Init building loader (IFC/GLB behind the wall)
  initBuilding(scene);

  // Init subsystems
  initPanel(camera, canvas);
  initHUD();
  updateHUD(data.elements);

  // Initial violation count
  const violations = recalculateViolations();
  setViolationCount(violations);
  updateHUD(data.elements);

  // Start polling for updates
  let latestElementsData = data.elements;
  initDataPolling(scene, (newData) => {
    latestElementsData = newData.elements;
    const v = recalculateViolations();
    setViolationCount(v);
    updateHUD(newData.elements);
  });

  // ── Double-click to focus on object ──
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  canvas.addEventListener('dblclick', (event) => {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const groups = [];
    for (const entry of slotMeshes.values()) {
      groups.push(entry.group);
    }
    const intersects = raycaster.intersectObjects(groups, true);

    if (intersects.length > 0) {
      const slotId = intersects[0].object.userData.slotId;
      if (slotId) {
        const entry = slotMeshes.get(slotId);
        if (entry) flyToObject(camera, controls, entry.group);
      }
    } else {
      // Double-click empty space → reset view
      fitCameraToWall(camera, controls, slotMeshes);
    }
  });

  // ── Toolbar buttons ──
  const btnInfo = document.getElementById('btn-info');
  const btnColor = document.getElementById('btn-color');
  const btnBuilding = document.getElementById('btn-building');
  const btnFit = document.getElementById('btn-fit');
  const infoOverlay = document.getElementById('info-overlay');
  const infoClose = document.getElementById('info-close');

  function toggleInfo() {
    infoOverlay.classList.toggle('visible');
    btnInfo.classList.toggle('active', infoOverlay.classList.contains('visible'));
  }

  function doToggleColor() {
    const on = toggleColorOverlay();
    btnColor.classList.toggle('active', on);
  }

  function doToggleBuilding() {
    const on = toggleBuilding();
    btnBuilding.classList.toggle('active', on);
  }

  btnInfo?.addEventListener('click', toggleInfo);
  btnColor?.addEventListener('click', doToggleColor);
  btnBuilding?.addEventListener('click', doToggleBuilding);
  btnFit?.addEventListener('click', () => fitCameraToWall(camera, controls, slotMeshes));
  infoClose?.addEventListener('click', toggleInfo);

  // Show info overlay on first visit
  if (!localStorage.getItem('spolia_visited')) {
    infoOverlay.classList.add('visible');
    btnInfo.classList.add('active');
    localStorage.setItem('spolia_visited', '1');
  }

  // ── Keyboard shortcuts ──
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;

    switch (e.key.toLowerCase()) {
      case 'c': {
        const v = toggleCompositionOverlay();
        setViolationCount(v);
        updateHUD(latestElementsData);
        break;
      }
      case 'a':
        axesHelper.visible = !axesHelper.visible;
        break;
      case 'r':
        forceRefresh();
        break;
      case 'f':
        fitCameraToWall(camera, controls, slotMeshes);
        break;
      case 't':
        doToggleColor();
        break;
      case 'b':
        doToggleBuilding();
        break;
      case 'i':
        toggleInfo();
        break;
      case 'escape':
        if (infoOverlay.classList.contains('visible')) {
          toggleInfo();
        } else {
          closePanel();
        }
        break;
    }
  });

  // Fit camera after geometry is ready
  if (slotMeshes.size > 0) {
    setTimeout(() => fitCameraToWall(camera, controls, slotMeshes), 100);
  }
}

init().catch(console.error);
