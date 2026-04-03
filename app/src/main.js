import * as THREE from 'three';
import { createScene, fitCameraToWall, flyToObject, updateFlyTo } from './scene.js';
import { buildWall, slotMeshes, updatePulses, toggleColorOverlay, isColorOverlayVisible } from './wall.js';
import { loadLocalData, initDataPolling, setInitialData, forceRefresh } from './data.js';
import { initPanel, closePanel, isPanelOpen, setOnPanelOpen, setOnPanelBack } from './panel.js';
import { initHUD, updateHUD, setViolationCount } from './hud.js';
import { toggleCompositionOverlay, recalculateViolations } from './composition.js';
import { initBuilding, toggleBuilding, isBuildingVisible } from './building.js';
import { initListPanel, updateListData, toggleListPanel, closeListPanel, isListOpen } from './listPanel.js';

const isMobile = () => window.matchMedia('(max-width: 768px)').matches;

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
  initListPanel(camera, controls);
  initHUD();
  updateHUD(data.elements);
  updateListData(data.elements);

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
    updateListData(newData.elements);
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

    // Find first hit with a slotId (skip edges/overlays)
    let hitSlotId = null;
    for (const hit of intersects) {
      if (hit.object.userData?.slotId) { hitSlotId = hit.object.userData.slotId; break; }
    }

    if (hitSlotId) {
      const entry = slotMeshes.get(hitSlotId);
      if (entry) flyToObject(camera, controls, entry.group);
    } else if (intersects.length === 0) {
      fitCameraToWall(camera, controls, slotMeshes);
    }
  });

  // ── UI elements ──
  const btnList = document.getElementById('btn-list');
  const btnInfo = document.getElementById('btn-info');
  const btnColor = document.getElementById('btn-color');
  const btnBuilding = document.getElementById('btn-building');
  const btnComposition = document.getElementById('btn-composition');
  const btnAxes = document.getElementById('btn-axes');
  const btnFit = document.getElementById('btn-fit');
  const btnRefresh = document.getElementById('btn-refresh');
  const infoOverlay = document.getElementById('info-overlay');
  const infoClose = document.getElementById('info-close');
  const mobileFab = document.getElementById('mobile-fab');
  const mobileMenu = document.getElementById('mobile-menu');

  // Track whether the detail panel was opened from the list (for back button)
  let openedFromList = false;

  // ── Action functions ──
  function closeMobileMenu() {
    mobileFab?.classList.remove('menu-open');
    mobileMenu?.classList.remove('open');
  }

  function doToggleList() {
    if (isMobile() && !isListOpen()) {
      closePanel();
      if (infoOverlay.classList.contains('visible')) {
        infoOverlay.classList.remove('visible');
        btnInfo?.classList.remove('active');
      }
    }
    const on = toggleListPanel();
    btnList?.classList.toggle('active', on);
    updateMobileMenuStates();
  }

  function doToggleInfo() {
    const willOpen = !infoOverlay.classList.contains('visible');
    if (isMobile() && willOpen) {
      closePanel();
      closeListPanel();
      btnList?.classList.remove('active');
    }
    infoOverlay.classList.toggle('visible');
    btnInfo?.classList.toggle('active', infoOverlay.classList.contains('visible'));
    updateMobileMenuStates();
  }

  function doToggleColor() {
    const on = toggleColorOverlay();
    btnColor?.classList.toggle('active', on);
    updateMobileMenuStates();
  }

  function doToggleBuilding() {
    const on = toggleBuilding();
    btnBuilding?.classList.toggle('active', on);
    updateMobileMenuStates();
  }

  function doToggleComposition() {
    const v = toggleCompositionOverlay();
    setViolationCount(v);
    updateHUD(latestElementsData);
    btnComposition?.classList.toggle('active', v > 0 || btnComposition?.classList.contains('active'));
    updateMobileMenuStates();
  }

  function doToggleAxes() {
    axesHelper.visible = !axesHelper.visible;
    btnAxes?.classList.toggle('active', axesHelper.visible);
    updateMobileMenuStates();
  }

  function doFit() {
    fitCameraToWall(camera, controls, slotMeshes);
  }

  function doRefresh() {
    forceRefresh();
  }

  // Go back from detail panel to list on mobile
  function doBackToList() {
    closePanel();
    if (openedFromList) {
      toggleListPanel(); // re-open the list
      btnList?.classList.add('active');
    }
    openedFromList = false;
  }

  // Update active states on mobile menu buttons
  function updateMobileMenuStates() {
    if (!mobileMenu) return;
    const states = {
      list: isListOpen(),
      info: infoOverlay.classList.contains('visible'),
      color: isColorOverlayVisible(),
      building: isBuildingVisible(),
      axes: axesHelper.visible,
    };
    mobileMenu.querySelectorAll('button[data-action]').forEach(btn => {
      const action = btn.dataset.action;
      if (states[action] !== undefined) {
        btn.classList.toggle('active', states[action]);
      }
    });
  }

  // ── Desktop toolbar click handlers ──
  btnList?.addEventListener('click', doToggleList);
  btnInfo?.addEventListener('click', doToggleInfo);
  btnColor?.addEventListener('click', doToggleColor);
  btnBuilding?.addEventListener('click', doToggleBuilding);
  btnComposition?.addEventListener('click', doToggleComposition);
  btnAxes?.addEventListener('click', doToggleAxes);
  btnFit?.addEventListener('click', doFit);
  btnRefresh?.addEventListener('click', doRefresh);
  infoClose?.addEventListener('click', doToggleInfo);

  // ── Mobile FAB + menu ──
  const mobileActions = {
    list: doToggleList,
    info: doToggleInfo,
    color: doToggleColor,
    building: doToggleBuilding,
    composition: doToggleComposition,
    axes: doToggleAxes,
    fit: doFit,
    refresh: doRefresh,
  };

  mobileFab?.addEventListener('click', () => {
    const isOpen = mobileMenu?.classList.contains('open');
    if (isOpen) {
      closeMobileMenu();
    } else {
      mobileFab.classList.add('menu-open');
      mobileMenu?.classList.add('open');
      updateMobileMenuStates();
    }
  });

  mobileMenu?.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const fn = mobileActions[btn.dataset.action];
      if (fn) fn();
      closeMobileMenu();
    });
  });

  // Wire up detail panel opening from list — track so back button works
  setOnPanelOpen(() => {
    if (isMobile()) {
      openedFromList = isListOpen();
      closeListPanel();
      btnList?.classList.remove('active');
      if (infoOverlay?.classList.contains('visible')) {
        infoOverlay.classList.remove('visible');
        btnInfo?.classList.remove('active');
      }
      closeMobileMenu();
    }
  });
  setOnPanelBack(doBackToList);

  // Show info overlay on first visit
  if (!localStorage.getItem('spolia_visited')) {
    infoOverlay.classList.add('visible');
    btnInfo?.classList.add('active');
    localStorage.setItem('spolia_visited', '1');
  }

  // Open list view by default (skip on mobile — screen too small)
  if (!isMobile()) {
    doToggleList();
  }

  // ── Keyboard shortcuts (desktop) ──
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;

    switch (e.key.toLowerCase()) {
      case 'l':
        doToggleList();
        break;
      case 'c':
        doToggleComposition();
        break;
      case 'a':
        doToggleAxes();
        break;
      case 'r':
        doRefresh();
        break;
      case 'f':
        doFit();
        break;
      case 't':
        doToggleColor();
        break;
      case 'b':
        doToggleBuilding();
        break;
      case 'i':
        doToggleInfo();
        break;
      case 'escape':
        if (infoOverlay.classList.contains('visible')) {
          doToggleInfo();
        } else if (isPanelOpen() && isMobile()) {
          doBackToList();
        } else {
          closePanel();
        }
        closeMobileMenu();
        break;
    }
  });

  // Fit camera after geometry is ready
  if (slotMeshes.size > 0) {
    setTimeout(() => fitCameraToWall(camera, controls, slotMeshes), 100);
  }
}

init().catch(console.error);
