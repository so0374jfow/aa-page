import { createScene, fitCameraToWall } from './scene.js';
import { buildWall, slotMeshes, updatePulses } from './wall.js';
import { loadLocalData, initDataPolling, setInitialData, forceRefresh } from './data.js';
import { initPanel, closePanel, isPanelOpen } from './panel.js';
import { initHUD, updateHUD, setViolationCount } from './hud.js';
import { toggleCompositionOverlay, recalculateViolations } from './composition.js';

async function init() {
  const canvas = document.getElementById('wall-canvas');
  const { renderer, scene, camera, controls, axesHelper } = createScene(canvas);

  // Load initial data (local files during dev, or bundled)
  let data = await loadLocalData();

  // Fallback: try fetching from known paths
  if (!data) {
    console.warn('No local data available');
    data = {
      elements: { metadata: { total_elements: 0, total_spend_chf: 0, estimated_coverage_m2: 0, last_updated: '' }, elements: [] },
      slots: { slots: [] }
    };
  }

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
    // Ignore if typing in textarea/input
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

  // Render loop
  const clock = { start: performance.now() };
  function animate() {
    requestAnimationFrame(animate);
    const elapsed = (performance.now() - clock.start) / 1000;
    controls.update();
    updatePulses(elapsed);
    renderer.render(scene, camera);
  }
  animate();

  // Fit camera after a brief delay to ensure geometry is ready
  setTimeout(() => fitCameraToWall(camera, controls, slotMeshes), 100);
}

init().catch(console.error);
