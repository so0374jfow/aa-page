import { createScene, fitCameraToWall } from './scene.js';
import { buildWall, slotMeshes, updatePulses } from './wall.js';
import { loadLocalData, initDataPolling, setInitialData, forceRefresh } from './data.js';
import { initPanel, closePanel, isPanelOpen } from './panel.js';
import { initHUD, updateHUD, setViolationCount } from './hud.js';
import { toggleCompositionOverlay, recalculateViolations } from './composition.js';

const EMPTY_DATA = {
  elements: { metadata: { total_elements: 0, total_spend_chf: 0, estimated_coverage_m2: 0, last_updated: '' }, elements: [] },
  slots: { slots: [] }
};

async function init() {
  const canvas = document.getElementById('wall-canvas');
  const { renderer, scene, camera, controls, axesHelper } = createScene(canvas);

  // Start render loop immediately so background is never black
  const clock = { start: performance.now() };
  function animate() {
    requestAnimationFrame(animate);
    const elapsed = (performance.now() - clock.start) / 1000;
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

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;

    switch (e.key.toLowerCase()) {
      case 'c':
        const v = toggleCompositionOverlay();
        setViolationCount(v);
        updateHUD(latestElementsData);
        break;
      case 'a':
        axesHelper.visible = !axesHelper.visible;
        break;
      case 'r':
        forceRefresh();
        break;
      case 'f':
        fitCameraToWall(camera, controls, slotMeshes);
        break;
      case 'escape':
        closePanel();
        break;
    }
  });

  // Fit camera after geometry is ready
  if (slotMeshes.size > 0) {
    setTimeout(() => fitCameraToWall(camera, controls, slotMeshes), 100);
  }
}

init().catch(console.error);
