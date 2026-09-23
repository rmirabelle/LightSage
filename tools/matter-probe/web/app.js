import { musicControls } from './music-controls.js';
import { bulbPhoto } from './bulb-photos.js';
import { sceneControls } from './scene-controls.js';
import { AdjustmentQueue } from './adjustment-queue.js';
import { gradientControls } from './gradient-controls.js';
import { attachWheel, hsvRgb, distinctWheelColors } from './color-wheel.js';
const $ = id => document.getElementById(id);
let loadingRequests = 0;
let pairingLoading = false;
let desktopServiceState = 'unknown', desktopServicePid = null, serviceActionBusy = false;
function renderServiceButtons() {
  const locked = serviceActionBusy || pairingActive || managing || busy || adjusting;
  $('controller-start').disabled = locked || !window.lightSageDesktop?.start || !!desktopServicePid || !['stopped','error'].includes(desktopServiceState);
  $('controller-stop').disabled = locked || !window.lightSageDesktop?.stop || !['running','starting','error','restarting'].includes(desktopServiceState) || (desktopServiceState === 'restarting' && !!desktopServicePid);
  $('controller-restart').disabled = locked || desktopServiceState !== 'running';
}
function showLoading() {
  $('global-loading').hidden = loadingRequests === 0 && !pairingLoading;
  $('loading-text').textContent = pairingLoading ? 'Pairing light…' : 'Working…';
}
let wheelFitFrame;
function fitWheels() {
  cancelAnimationFrame(wheelFitFrame);
  wheelFitFrame = requestAnimationFrame(() => {
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    for (const id of ['color-wheel','bulb-color-wheel']) {
      const canvas = $(id), screen = canvas.closest('.screen');
      if (canvas.closest('[hidden]')) continue;
      const container = screen ?? document.querySelector('main');
      const bottom = parseFloat(getComputedStyle(container).paddingBottom) + 20;
      const top = canvas.parentElement.getBoundingClientRect().top + (screen?.scrollTop ?? window.scrollY) + 8;
      const size = Math.max(80, Math.min(320, Math.floor(viewportHeight - top - bottom)));
      canvas.style.setProperty('--wheel-space', `${size}px`);
    }
  });
}
window.addEventListener('resize', fitWheels);
window.visualViewport?.addEventListener('resize', fitWheels);
document.fonts.ready.then(fitWheels);
new ResizeObserver(fitWheels).observe(document.querySelector('header'));
if (window.lightSageDesktop) {
  document.body.classList.add('desktop');
  $('controller-panel').hidden = false;
  const controllerTabs = [...document.querySelectorAll('.controller-tabs [role="tab"]')];
  function selectControllerTab(tab, focus = false) {
    for (const item of controllerTabs) {
      const active = item === tab;
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
      $(item.getAttribute('aria-controls')).hidden = !active;
    }
    if (focus) tab.focus();
    if (tab.id === 'controller-tab-activity' && $('controller-log-live').checked) {
      $('controller-logs').scrollTop = $('controller-logs').scrollHeight;
    }
    try { sessionStorage.setItem('lightsage-controller-tab', tab.id); } catch {}
  }
  for (const [index, tab] of controllerTabs.entries()) {
    tab.onclick = () => selectControllerTab(tab);
    tab.onkeydown = event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % controllerTabs.length;
      else if (event.key === 'ArrowLeft') next = (index + controllerTabs.length - 1) % controllerTabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = controllerTabs.length - 1;
      else return;
      event.preventDefault(); selectControllerTab(controllerTabs[next], true);
    };
  }
  try {
    const savedTab = controllerTabs.find(tab => tab.id === sessionStorage.getItem('lightsage-controller-tab'));
    if (savedTab) selectControllerTab(savedTab);
  } catch {}
  const splitter = $('controller-splitter');
  splitter.hidden = false;
  let appWidth = 440, drag;
  try {
    const saved = Number(localStorage.getItem('lightsage-app-width'));
    if (Number.isFinite(saved) && saved >= 320) appWidth = saved;
  } catch {}
  function resizePanels(width = appWidth) {
    const available = window.innerWidth - 8;
    appWidth = Math.round(Math.max(320, Math.min(available - 280, width)));
    document.body.style.setProperty('--mobile-width', `${appWidth}px`);
    const controllerWidth = available - appWidth;
    splitter.setAttribute('aria-valuemin', '280');
    splitter.setAttribute('aria-valuemax', String(available - 320));
    splitter.setAttribute('aria-valuenow', String(controllerWidth));
    splitter.setAttribute('aria-valuetext', `Controller ${controllerWidth} pixels, app ${appWidth} pixels`);
    fitWheels();
  }
  function rememberPanels() {
    try { localStorage.setItem('lightsage-app-width', String(appWidth)); } catch {}
  }
  splitter.onpointerdown = event => {
    if (event.button !== 0 || drag) return;
    event.preventDefault(); splitter.focus();
    drag = { id: event.pointerId, x: event.clientX, width: appWidth };
    splitter.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing-panels');
  };
  splitter.onpointermove = event => {
    if (drag?.id === event.pointerId) resizePanels(drag.width + drag.x - event.clientX);
  };
  const stopResize = event => {
    if (drag?.id !== event.pointerId) return;
    drag = undefined;
    document.body.classList.remove('resizing-panels');
    if (splitter.hasPointerCapture(event.pointerId)) splitter.releasePointerCapture(event.pointerId);
    rememberPanels();
  };
  splitter.onpointerup = stopResize;
  splitter.onpointercancel = stopResize;
  splitter.onlostpointercapture = stopResize;
  splitter.ondblclick = () => { resizePanels(440); rememberPanels(); };
  splitter.onkeydown = event => {
    const step = event.shiftKey ? 50 : 10;
    const widths = { ArrowLeft: appWidth + step, ArrowRight: appWidth - step, Home: window.innerWidth - 288, End: 320 };
    if (!Object.hasOwn(widths, event.key)) return;
    event.preventDefault(); resizePanels(widths[event.key]); rememberPanels();
  };
  window.addEventListener('resize', () => resizePanels());
  resizePanels();
  $('controller-startup-slot').append($('desktop-startup').closest('label'));
  let readingDesktop = false, savingStartup = false, startupVersion = 0;
  const desktopStatus = async () => {
    if (readingDesktop) return;
    readingDesktop = true;
    const observedStartupVersion = startupVersion;
    try {
      const value = await window.lightSageDesktop.status();
      // Also display concise labels when the running desktop shell predates
      // the service terminology update; frontend reloads do not restart it.
      const serviceLabel = ({
        'Controller running': 'Running',
        'Starting controller…': 'Starting…',
        'Restarting controller…': 'Restarting…',
        'Controller stopped — retrying': 'Stopped — restarting…',
        'Controller could not start': 'Could not start',
      })[value.status] ?? value.status;
      desktopServiceState = value.serviceState ?? (serviceLabel === 'Running' ? 'running' : serviceLabel === 'Could not start' ? 'error' : 'starting');
      desktopServicePid = value.pid;
      $('controller-service-label').textContent = serviceLabel;
      $('controller-service').dataset.state = desktopServiceState;
      if (desktopServiceState !== 'running') { disconnect(); lock(); }
      renderControllerHealth();
      const minutes = value.readyAt ? Math.floor((Date.now() - value.readyAt) / 60000) : null;
      $('controller-uptime').textContent = minutes === null ? '' : `Uptime ${Math.floor(minutes/60)}h ${minutes%60}m · Process ${value.pid}`;
      if (!savingStartup && observedStartupVersion === startupVersion) $('desktop-startup').checked = value.startup;
      $('controller-log-path').textContent = value.logPath ?? 'Restart LightSage to enable the log folder shortcut.';
      $('controller-log-folder').disabled = !value.logPath || !window.lightSageDesktop.showLog;
      if ($('controller-log-live').checked && window.lightSageDesktop.logs) {
        const log = $('controller-logs');
        const atBottom = log.scrollHeight - log.clientHeight - log.scrollTop < 30;
        const text = await window.lightSageDesktop.logs();
        if (log.textContent !== text) { log.textContent = text; if (atBottom) log.scrollTop = log.scrollHeight; }
      }
    } catch (error) { $('controller-error').textContent = error.message; }
    finally { readingDesktop = false; }
  };
  $('desktop-startup').onchange = async event => {
    const enabled = event.target.checked;
    savingStartup = true; startupVersion++;
    event.target.disabled = true;
    $('controller-error').textContent = '';
    try { event.target.checked = await window.lightSageDesktop.setStartup(enabled); }
    catch (error) { $('controller-error').textContent = error.message; await desktopStatus(); }
    finally { savingStartup = false; startupVersion++; event.target.disabled = false; }
  };
  for (const action of ['start', 'stop', 'restart']) $('controller-' + action).onclick = async () => {
    if (serviceActionBusy) return;
    serviceActionBusy = true; renderServiceButtons();
    $('controller-error').textContent = '';
    try {
      await window.lightSageDesktop[action]();
      await desktopStatus();
    } catch (error) { $('controller-error').textContent = error.message; }
    finally { serviceActionBusy = false; renderServiceButtons(); }
  };
  $('controller-retry').onclick = async () => {
    const ids = (catalog?.lights ?? []).filter(light => !light.available).map(light => light.id);
    if (!ids.length || pairingActive || managing || adjusting || busy) return;
    $('controller-retry').disabled = true;
    $('controller-error').textContent = '';
    try {
      const value = await api('/api/reconnect', {ids}, true);
      render(value);
      $('controller-error').textContent = value.recovery?.message ?? '';
    }
    catch (error) { $('controller-error').textContent = error.message; }
    finally { renderControllerHealth(); }
  };
  $('controller-log-live').onchange = desktopStatus;
  $('controller-log-folder').onclick = async () => {
    $('controller-error').textContent = '';
    try { await window.lightSageDesktop.showLog(); }
    catch (error) { $('controller-error').textContent = error.message; }
  };
  void desktopStatus();
  setInterval(desktopStatus, 3000);
}
function renderControllerHealth() {
  if (!window.lightSageDesktop) return;
  renderServiceButtons();
  if (desktopServiceState !== 'running') {
    $('controller-health').textContent = 'Device health is available while the lighting service is running.';
    $('controller-missing').replaceChildren(); $('controller-retry').disabled = true;
    return;
  }
  if (!catalog) return;
  const missing = catalog.lights.filter(light => !light.available);
  $('controller-health').textContent = `${catalog.lights.length - missing.length} connected · ${missing.length} unavailable · ${catalog.lights.length} total`;
  $('controller-missing').replaceChildren(...missing.map(light => {
    const item = document.createElement('li'); item.textContent = light.name; return item;
  }));
  $('controller-retry').disabled = !missing.length || pairingActive || managing || busy || adjusting;
}

let state;
let gradientUI;
let musicUI;
let sceneUI;
const gradientErrors = new Set();
let busy = false;
let adjusting = false;
let connected = false;
let serviceInfo = null;
let connectionPhase = 'starting';
let connectionVersion = 0;
function disconnect() { connected = false; connectionPhase = 'stopped'; connectionVersion++; }
let polling = false;
let commandVersion = 0;
let catalog;
let selected = 'all-rooms';
const viewModes = new Map();
const bulbColors = new Map();
const pendingFullWhite = new Set();
const controlViews = new Map();
function controlsFor(value) {
  if (!value.fullWhite) controlViews.set(value.id, { ...value });
  return value.fullWhite ? controlViews.get(value.id) ?? value : value;
}
const screenStack = [];
let showingRoomLights = false;
let colorSending = false, pendingColor = null, wheelDragging = false;
let roomColorGesture, roomColorProposal;
const wheel = attachWheel($('color-wheel'), color => {
  if (roomColorGesture?.confirm) roomColorGesture.color = color;
  else void queueColor(selected, color);
}, () => !blocked(state) && !roomColorProposal, (active, cancelled = false) => {
  wheelDragging = active;
  if (active) {
    roomColorGesture = { target: selected, confirm: distinctWheelColors(state?.members ?? []).length > 1 };
  } else {
    const gesture = roomColorGesture; roomColorGesture = undefined;
    if (gesture?.confirm && gesture.color && !cancelled) {
      roomColorProposal = gesture;
      $('room-color-confirm').showModal();
    } else if (gesture?.confirm) {
      wheel.drawPoints(distinctWheelColors(state?.members ?? []));
    }
  }
});
$('room-color-apply').onclick = () => {
  const proposal = roomColorProposal;
  roomColorProposal = undefined;
  $('room-color-confirm').close();
  if (proposal) void queueColor(proposal.target, proposal.color);
};
for (const id of ['room-color-cancel','room-color-close']) $(id).onclick = () => $('room-color-confirm').close();
$('room-color-confirm').addEventListener('close', () => {
  roomColorProposal = undefined;
  if (!colorSending) wheel.drawPoints(distinctWheelColors(state?.members ?? []));
});
let controlledLightId;
let newlyPairedLight;
const controlledLight = () => catalog?.lights.find(light => light.id === controlledLightId) ?? (newlyPairedLight?.id === controlledLightId ? newlyPairedLight : undefined);
const bulbWheel = attachWheel($('bulb-color-wheel'), color => queueColor(controlledLightId,color), () => !blocked(controlledLight()), active => { wheelDragging = active; });
let pairingActive = false;
let observedPairingId;
let pairedBulbToOpen;
let managing = false;
let managementSignature = '';
function message(text, error = false) {
  $('notice').textContent = text; $('notice').className = error ? 'error' : '';
  const screen = screenStack.at(-1);
  if (screen && (error || !text)) {
    const node = $(screen.id).querySelector('.screen-message');
    node.textContent = text; node.classList.toggle('error', error);
  }
}
function connectionPending() {
  return !connected && ['starting', 'restarting'].includes(connectionPhase) &&
    (window.lightSageDesktop ? !['stopped', 'stopping', 'error'].includes(desktopServiceState) : navigator.onLine !== false);
}
function unavailableLabel() {
  if (window.lightSageDesktop && desktopServiceState === 'stopped') return 'Lighting service stopped';
  if (!window.lightSageDesktop && navigator.onLine === false) return 'No network connection';
  if (connectionPending()) return connectionPhase === 'starting' ? 'Connecting…' : 'Reconnecting…';
  return 'Lighting service unreachable';
}
function unavailableMessage() {
  if (connectionPending()) return '';
  return `${unavailableLabel()}. Controls are disabled. Reconnecting automatically; commands are not queued.`;
}
function connection() {
  $('connection').classList.toggle('connected', connected);
  $('connection').dataset.state = window.lightSageDesktop && desktopServiceState !== 'unknown'
    ? desktopServiceState : connected ? 'running' : connectionPhase;
  $('connection').setAttribute('aria-label', `${connected ? 'Connected' : unavailableLabel()}. View connection details`);
  $('connection').title = 'View connection details';
  if ($('connection-dialog').open) renderConnectionDialog();
  $('offline-startup').hidden = connected || !!catalog || connectionPending();
  if (!connected) {
    $('offline-startup').querySelector('h1').textContent = unavailableLabel();
    $('offline-startup').querySelector('p').textContent = connectionPending()
      ? 'Connecting to your lighting service…'
      : navigator.onLine === false && !window.lightSageDesktop
      ? 'Reconnect to your network. LightSage will retry automatically.'
      : 'Check that the lighting service is running and this device can reach your desktop. LightSage will retry automatically.';
  }
}
function renderConnectionDialog() {
  const status = $('connection-detail-status');
  status.dataset.state = $('connection').dataset.state;
  $('connection-detail-label').textContent = connected ? 'Connected' : connectionPending() ? 'Waiting for the service' : unavailableLabel();
  const info = connected ? serviceInfo : null;
  $('connection-address').textContent = info?.address ?? window.location.hostname;
  $('connection-port').textContent = String(info?.port ?? (window.location.port || (window.location.protocol === 'https:' ? 443 : 80)));
  $('connection-uptime-row').hidden = !connected;
  const seconds = info?.uptimeSeconds;
  $('connection-uptime').textContent = Number.isFinite(seconds)
    ? `${Math.floor(seconds / 86400)}d ${Math.floor(seconds / 3600) % 24}h ${Math.floor(seconds / 60) % 60}m ${seconds % 60}s`
    : 'Available after the next service restart';
  let explanation, steps = [];
  if (connected) {
    explanation = 'Your app is connected to the lighting service. Uptime is the time since the service process started.';
  } else if (!$('login').hidden) {
    explanation = 'This device needs to sign in to the lighting service.';
    steps = ['Close this dialog and enter a fresh six-digit sign-in code from a connected LightSage app.'];
  } else if (!window.lightSageDesktop && navigator.onLine === false) {
    explanation = 'Your device reports no network connection.';
    steps = ['Connect to the same home network as your LightSage desktop.', 'Keep the desktop awake with the lighting service running.'];
  } else if (window.lightSageDesktop && desktopServiceState === 'stopped') {
    explanation = 'The lighting service is stopped.';
    steps = ['Open the Service tab in the controller and click Start.'];
  } else if (connectionPending()) {
    explanation = 'No connection failure has been detected. Controls will become available when the service responds.';
  } else if (connectionPhase === 'error') {
    explanation = 'The service returned an error and lighting controls are unavailable.';
    steps = ['Check the Log tab in the desktop controller for details.', 'Restart from the Service tab, then let this app reconnect.'];
  } else {
    explanation = 'The lighting service is not responding. This app cannot tell whether the service is stopped or the desktop is unreachable.';
    steps = ['Make sure your desktop is on and awake. Open the LightSage controller and check the Service tab; click Start if stopped.', 'Connect this device to the same home network as the desktop. Guest Wi-Fi or a VPN may prevent access.', 'If it still cannot connect, verify the address below and check that the desktop firewall allows LightSage.'];
  }
  $('connection-explanation').textContent = explanation;
  $('connection-recovery').replaceChildren(...steps.map(text => {
    const item = document.createElement('li'); item.textContent = text; return item;
  }));
  $('connection-recovery').hidden = !steps.length;
  $('connection-retry-note').hidden = connected || !$('login').hidden;
}
$('connection').onclick = () => { renderConnectionDialog(); $('connection-dialog').showModal(); };
$('connection-close').onclick = () => $('connection-dialog').close();
function blocked(value) { return !connected || !value?.available || !!value?.fullWhite || !!value?.blockedBy || pairingActive || managing || (busy && !colorSending); }
function updateFullWhiteButton() {
  const restoring = !!state?.fullWhite;
  const button = $('full-white');
  button.disabled = busy || managing || pairingActive || adjusting || !connected || pendingFullWhite.has(selected) || !!state?.blockedBy ||
    (!restoring && (!state?.available || state?.capabilities?.fullWhite === false));
  button.setAttribute('aria-label', restoring ? 'Restore previous settings' : 'Full White');
  button.setAttribute('aria-pressed', String(restoring));
  button.title = restoring ? 'Restore previous settings' : 'Full White · 100% · 4400 K';
  $('room-restore-label').hidden = !restoring;
  button.classList.toggle('restore-available', restoring);
}
function lock() {
  sceneUI?.lock();
  renderControllerHealth();
  document.querySelectorAll('[data-management]').forEach(fields => { fields.disabled = busy || managing || pairingActive || !connected; });
  $('lights-room-name').disabled = selected === 'all-rooms' || !connected || busy || managing || pairingActive;
  for (const id of ['lights-room-input','save-lights-room','cancel-lights-room','close-lights-room']) $(id).disabled = busy || managing || pairingActive;
  $('target').disabled = busy || pairingActive;
  $('power').disabled = busy || !connected || !state?.available || !!state?.fullWhite || !!state?.blockedBy;
  updateFullWhiteButton();
  $('cancel-full-white').disabled = busy || managing || pairingActive || !connected;
  $('cancel-bulb-white').disabled = busy || managing || pairingActive || !connected;
  $('adjustments').disabled = blocked(state);
  $('adjustments').inert = blocked(state);
  $('room-panel').classList.toggle('controls-disabled',blocked(state));
  const roomOverride = !!state?.fullWhite || pendingFullWhite.has(selected);
  $('room-panel').classList.toggle('full-white-active',roomOverride);
  $('full-white-overlay').hidden = !roomOverride;
  for (const id of ['brightness','temperature','white-mode','color-mode']) $(id).disabled = busy;
  $('add-room').disabled = busy || managing || pairingActive || !connected;
  $('add-device').disabled = busy || managing || pairingActive || !connected;
  $('lights-add-bulb').disabled = $('add-device').disabled;
  $('lights-button').disabled = !state;
  connection();
  const light = controlledLight();
  const editingBlocked = busy || managing || pairingActive || !connected || !light || !!light.loading;
  $('bulb-view-name').disabled = editingBlocked;
  $('identify').disabled = editingBlocked || !light?.available;
  $('bulb-move').disabled = editingBlocked || !!light?.fullWhite || !!light?.blockedBy;
  for (const id of ['bulb-name-input','save-bulb-name','cancel-bulb-name','close-bulb-name']) $(id).disabled = editingBlocked;
  $('bulb-move-menu').inert = editingBlocked;
  $('bulb-adjustments').disabled = blocked(light);
  $('bulb-adjustments').inert = blocked(light);
  $('bulb-adjustment-panel').classList.toggle('controls-disabled',blocked(light));
  const bulbOverride = !!light?.fullWhite || pendingFullWhite.has(controlledLightId);
  $('bulb-adjustment-panel').classList.toggle('full-white-active',bulbOverride);
  $('bulb-white-overlay').hidden = !bulbOverride || !!light?.blockedBy;
  $('color-wheel').setAttribute('aria-disabled',String(blocked(state)));
  $('bulb-color-wheel').setAttribute('aria-disabled',String(blocked(light)));
  gradientUI?.lock();
  musicUI?.render();
  $('music-mode').disabled = blocked(state);
  $('bulb-music-mode').disabled = blocked(light);
  $('bulb-retry').disabled = busy || managing || pairingActive || !connected;
  $('unavailable-bulbs').disabled = $('bulb-retry').disabled;
  $('bulb-power').disabled = busy || blocked(light);
  $('bulb-white').disabled = busy || !light || !connected || !!light.blockedBy || !light.available || !!light.fullWhite || pairingActive || managing;
  for (const id of ['bulb-brightness','bulb-temperature','bulb-white-mode','bulb-color-mode']) $(id).disabled = busy;
  for (const [value, prefix] of [[state,''],[light,'bulb-']]) {
    for (const [capability, suffixes] of Object.entries({temperature:['white-mode','temperature'],gradient:['gradient-mode','gradient-speed','gradient-repeat'],music:['music-mode']})) {
      if (value?.capabilities?.[capability] === false) for (const suffix of suffixes) $(prefix+suffix).disabled = true;
    }
  }
  if (light?.capabilities?.fullWhite === false) $('bulb-white').disabled = true;
  if (light?.capabilities?.identify === false) $('identify').disabled = true;
  if (pairingActive || managing) {
    $('power').disabled = true; $('full-white').disabled = true;
    $('adjustments').disabled = true;
  }
}
async function api(url, body, background = false) {
  const requestConnectionVersion = connectionVersion;
  // Lighting commands use toolbar feedback, regardless of their caller.
  background ||= ['/api/command', '/api/gradient', '/api/state'].includes(url);
  if (!background) { loadingRequests++; showLoading(); }
  try {
  let response, data;
  try {
  if (!window.lightSageDesktop && navigator.onLine === false) throw new Error('The device reports no network connection.');
  response = await fetch(url, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(url === '/api/music/frame' ? 1500 : url === '/api/music/stop' ? 2000 : url === '/api/pairing' ? 3000 : body?.type === 'addBluetooth' ? 60000 : 40000) });
  data = await response.json();
  } catch (cause) {
    disconnect(); lock();
    const error = new Error(`${unavailableLabel()}.`, { cause });
    error.disconnected = true;
    throw error;
  }
  if (response.status === 401) {
    disconnect(); connectionPhase = 'error'; lock();
    try { localStorage.removeItem('lightsage-last-catalog'); } catch {}
    while (screenStack.length) closeScreen();
    $('offline-startup').hidden = true; $('login').hidden = false; $('light').hidden = true;
  }
  if (!response.ok) {
    if (response.status >= 500) { disconnect(); connectionPhase = 'error'; lock(); }
    const error = new Error(data.error ?? 'Controller unavailable.');
    error.status = response.status;
    throw error;
  }
  const freshCatalog = data?.state ?? data;
  // Cached renders and pairing-status replies are not evidence that lighting
  // controls are ready. An older request must not undo a newer disconnect.
  if (Array.isArray(freshCatalog?.lights) && Array.isArray(freshCatalog?.groups) &&
      requestConnectionVersion === connectionVersion &&
      (!window.lightSageDesktop || desktopServiceState === 'running')) {
    connected = true;
    for (const light of freshCatalog.lights) if (light.details) cacheLightDetails(light.id, light.details);
    if (freshCatalog.service) serviceInfo = freshCatalog.service;
    connectionPhase = 'running';
    try { localStorage.setItem('lightsage-last-catalog', JSON.stringify(freshCatalog)); } catch {}
  }
  return data;
  } finally { if (!background) { loadingRequests--; showLoading(); } }
}
function render(value) {
  catalog = value;
  const choices = [catalog.allRooms, ...catalog.groups].filter(Boolean);
  state = choices.find(item => item.id === selected) ?? choices[0];
  state ??= { id: '', name: 'Add your first light', available: false, members: [], brightness: null, kelvin: null };
  selected = state.id;
  if (JSON.stringify([...$('target').options].map(option => [option.value, option.text])) !== JSON.stringify(choices.map(item => [item.id, item.name]))) {
    $('target').replaceChildren(...choices.map(item => new Option(item.name, item.id)));
  }
  $('target').value = selected;
  $('offline-startup').hidden = true;
  $('login').hidden = true; $('light').hidden = false;
  renderManagement();
  sceneUI?.render();
  renderRoomView();
  renderLights();
  renderBulbControl();
  const powerLabel = state.on ? 'Turn off' : 'Turn on';
  $('power').setAttribute('aria-label',powerLabel); $('power').title = powerLabel;
  $('power').setAttribute('aria-pressed', String(state.on));
  const controls = controlsFor(state);
  $('brightness').value = controls.brightness ?? 50; $('brightness-value').value = controls.brightness == null ? 'Mixed' : `${controls.brightness}%`;
  $('temperature').value = controls.kelvin ?? 4000; $('temperature-value').value = controls.colorMode === 2 && controls.kelvin != null ? `${controls.kelvin} K` : 'Mixed / color mode';
  $('restore-note').textContent = state.blockedBy ? `Restore ${state.blockedBy} first.` : '';
  const music = viewModes.get(selected) === 'music' || !!state.music;
  $('music-panel').hidden = !music; $('music-mode').setAttribute('aria-pressed',String(music));
  const gradient = !music && (!!state.gradient || viewModes.get(selected) === 'gradient');
  const white = !music && !gradient && viewModes.get(selected) === 'white' && controls.colorMode === 2;
  $('temperature-control').hidden = !white; $('wheel-control').hidden = white || gradient || music;
  $('gradient-panel').hidden = !gradient;
  $('gradient-mode').setAttribute('aria-pressed',String(gradient));
  $('white-mode').setAttribute('aria-pressed',String(white)); $('color-mode').setAttribute('aria-pressed',String(!white && !gradient && !music));
  if (!wheelDragging && !colorSending && !roomColorProposal) {
    if (state.fullWhite) wheel.draw(controls.hue ?? null, controls.saturation ?? null);
    else wheel.drawPoints(distinctWheelColors(state.members ?? []));
  }
  const unavailable = (state.members ?? []).filter(light => !light.available);
  $('unavailable-bulbs').hidden = unavailable.length === 0;
  $('unavailable-bulb-list').replaceChildren(...unavailable.map(light => {
    const item = document.createElement('span'); item.textContent = light.name; return item;
  }));
  message(!connected ? unavailableMessage() : state.members?.length ? '' : 'This room has no lights yet.', !connected && !connectionPending());
  lock();
  fitWheels();
  gradientUI?.render();
  const errors = (catalog.lights ?? []).map(light => light.gradientError).filter(Boolean);
  const fresh = errors.filter(error => !gradientErrors.has(error));
  gradientErrors.clear(); errors.forEach(error => gradientErrors.add(error));
  if (fresh.length) showPairingAlert(fresh.join('\n'), 'Gradient stopped');
  openPairedBulb();
}
async function run(action) {
  if (busy || managing || pairingActive) return;
  commandVersion++;
  busy = true; lock();
  try { render(await action()); }
  catch (error) {
    if (connected && (error.disconnected || error.status === 401)) disconnect();
    message(error.disconnected ? unavailableMessage() : error.message, true);
  } finally { busy = false; lock(); }
}
async function refresh() {
  if (busy || managing || adjusting) return;
  try {
    updatePairing(await api('/api/pairing', undefined, true));
    if (!pairingActive) await run(() => api('/api/state', undefined, true));
  } catch (error) { message(error.message, true); lock(); }
}
$('target').onchange = event => { selected = event.target.value; commandVersion++; $('result').textContent = ''; render(catalog); };
async function poll() {
  if (!window.lightSageDesktop && navigator.onLine === false) return;
  if (window.lightSageDesktop && !['unknown','running'].includes(desktopServiceState)) return;
  if (document.hidden || musicUI?.active || busy || adjusting || managing || polling || wheelDragging || document.activeElement?.type === 'range') return;
  polling = true;
  const version = commandVersion;
  try {
    const pairing = await api('/api/pairing', undefined, true);
    updatePairing(pairing);
    if (pairingActive) return;
    const value = await api('/api/state', undefined, true);
    // A click may have issued a newer command while this read was in flight.
    // Background reads must neither lock controls nor overwrite newer state.
    if (version === commandVersion && !busy && !adjusting && !['brightness', 'temperature'].includes(document.activeElement?.id)) render(value);
  } catch (error) {
    if (version === commandVersion && !busy) {
      if (connected && (error.disconnected || error.status === 401)) disconnect();
      message(error.disconnected ? unavailableMessage() : error.message, true);
      lock();
    }
  } finally { polling = false; }
}
function options(id, values, blank = false) {
  const select = $(id), previous = select.value;
  select.replaceChildren(...(blank ? [new Option('Unassigned', '')] : []), ...values.map(item => new Option(item.name, item.id)));
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
}
function renderManagement() {
  const signature = JSON.stringify([catalog.lights.map(item => [item.id, item.name]), catalog.groups.map(item => [item.id, item.name, item.members.map(member => member.id)])]);
  if (signature === managementSignature) return;
  managementSignature = signature;
  options('pair-room', catalog.groups, true);
  options('edit-room', catalog.groups);
  $('room-name').value = catalog.groups.find(item => item.id === $('edit-room').value)?.name ?? '';
}
const shownPairingErrors = new Set();
function showPairingAlert(text, title = 'Couldn’t pair light') {
  $('pairing-alert-title').textContent = title;
  $('pairing-alert-text').textContent = text;
  if (!$('pairing-alert').open) $('pairing-alert').showModal();
}
$('close-pairing-alert').onclick = () => $('pairing-alert').close();
function openPairedBulb() {
  const job = pairedBulbToOpen;
  if (!job) return;
  newlyPairedLight = { id: job.id, name: job.name, available: false, loading: true };
  pairedBulbToOpen = undefined;
  controlledLightId = job.id;
  // Replace the pairing screen instead of leaving a completed form underneath.
  while (screenStack.length) closeScreen();
  endNameEdit();
  renderBulbControl();
  lock();
  showScreen('bulb-control-screen');
  showPairingAlert(`${controlledLight().name} paired successfully.`, 'Light paired');
  $('pair-code').value = '';
  $('pair-name').value = '';
}
function updatePairing(job) {
  if (job.state === 'pairing') observedPairingId = job.startedAt;
  if (job.state === 'succeeded' && observedPairingId && job.startedAt === observedPairingId) {
    pairedBulbToOpen = job;
    observedPairingId = undefined;
  }
  if (job.state === 'failed') observedPairingId = undefined;
  if (job.state === 'failed') {
    const key = job.startedAt ?? job.message;
    if (!shownPairingErrors.has(key)) {
      shownPairingErrors.add(key);
      showPairingAlert(job.message);
    }
  }
  pairingActive = job.state === 'pairing' || !!job.recovering;
  pairingLoading = job.state === 'pairing'; showLoading();
  $('pair-status').textContent = '';
  $('pair-status').classList.remove('error');
  if (pairingActive) {
    $('login').hidden = true;
    message('');
  }
  lock();
  openPairedBulb();
}
async function manage(action, statusId) {
  if (managing || busy || pairingActive) return;
  const statusIds = { 'bulb-control-screen':'bulb-edit-status', 'add-bulb-screen':'pair-status', 'rename-room-screen':'rename-room-status', 'room-screen':'room-error' };
  const status = $(statusId ?? statusIds[screenStack.at(-1)?.id]);
  managing = true; commandVersion++; lock();
  status.textContent = ''; status.classList.remove('error');
  try { status.textContent = await action() ?? 'Saved.'; }
  catch (error) {
    if (status.id === 'pair-status') showPairingAlert(error.message);
    else { status.textContent = error.message; status.classList.add('error'); }
  }
  finally { managing = false; lock(); }
}
async function saveManagement(command) {
  render(await api('/api/manage', command));
}
$('edit-room').onchange = () => { $('room-name').value = catalog.groups.find(item => item.id === $('edit-room').value)?.name ?? ''; };
$('identify').onclick = () => manage(async () => {
  const name = controlledLight().name;
  $('identify-confirmation-text').textContent = `${name} will blink full white every half-second for 5 seconds, then return to its previous settings.`;
  $('identify-confirmation-title').textContent = 'Identify light';
  $('identify-confirmation').showModal();
  try { await api('/api/identify', { id: controlledLightId }, true); }
  finally { $('identify-confirmation').close(); }
  return '';
});
$('identify-confirmation-close').onclick = () => $('identify-confirmation').close();
let bulbDetailsRequest = 0;
const lightDetailsCache = new Map();
function cachedLightDetails(id) {
  if (lightDetailsCache.has(id)) return lightDetailsCache.get(id);
  try {
    const data = JSON.parse(localStorage.getItem(`lightsage-details:${id}`));
    if (data?.nodeId === id && data.fields && typeof data.fields === 'object' && !Array.isArray(data.fields) && Object.keys(data.fields).length && Array.isArray(data.addresses)) {
      lightDetailsCache.set(id, data); return data;
    }
  } catch {}
}
function cacheLightDetails(id, data) {
  if (!Object.keys(data.fields).length) return;
  if (JSON.stringify(lightDetailsCache.get(id)) === JSON.stringify(data)) return;
  lightDetailsCache.set(id, data);
  try { localStorage.setItem(`lightsage-details:${id}`, JSON.stringify(data)); } catch {}
}
async function showLightDetails(refresh = false) {
  const id = controlledLightId, request = ++bulbDetailsRequest;
  $('refresh-light-details').disabled = !connected;
  showScreen('bulb-details-screen');
  const status = $('bulb-details-status'), facts = $('bulb-details-facts');
  facts.replaceChildren();
  const light = controlledLight() ?? {};
  const showPhoto = (identity = light) => {
    const image = $('light-details-photo'), photo = bulbPhoto(identity);
    image.hidden = !photo;
    image.alt = `${light.name ?? 'Light'} product photo`;
    image.onerror = () => { image.hidden = true; };
    if (photo) image.src = photo;
    else image.removeAttribute('src');
  };
  showPhoto();
  const row = (label, value) => {
    const entry = document.createElement('div'), term = document.createElement('dt'), detail = document.createElement('dd');
    term.textContent = label; detail.textContent = String(value);
    entry.append(term, detail); facts.append(entry);
  };
  status.classList.remove('error');
  const cached = !refresh && cachedLightDetails(id);
  if (!connected && !cached) { status.textContent = 'Connect to the lighting service to read this light’s technical details.'; return; }
  status.textContent = cached ? '' : 'Reading light details…';
  $('refresh-light-details').disabled = true;
  try {
    const data = cached || await api(`/api/bulb-details?id=${encodeURIComponent(id)}${refresh ? '&refresh=1' : ''}`, undefined, true);
    cacheLightDetails(id, data);
    if (request !== bulbDetailsRequest) return;
    showPhoto({ ...light, vendorId:data.fields.vendorId ?? light.vendorId, productId:data.fields.productId ?? light.productId, model:data.fields.productName ?? light.model });
    const model = data.fields.productName ?? light.model;
    if (model) row('Product / model', model);
    row(id.startsWith('ble-') ? 'Bluetooth device ID' : 'Matter node ID', id);
    const labels = { vendorName: 'Manufacturer', vendorId: 'Vendor ID', productId: 'Product ID', productLabel: 'Product label', serialNumber: 'Serial number', hardwareVersionString: 'Hardware version', hardwareVersion: 'Hardware revision', softwareVersionString: 'Firmware version', softwareVersion: 'Firmware build' };
    for (const [key, label] of Object.entries(labels)) {
      if (data.fields[key] !== undefined) row(label, data.fields[key]);
    }
    for (const [index, address] of data.addresses.entries()) {
      row(data.addresses.length > 1 ? `Known IP address ${index + 1}` : 'Known IP address', address.ip);
      row('Matter port', address.port);
    }
    status.textContent = data.partial ? 'Some device information could not be read.'
      : Object.keys(data.fields).length ? '' : 'This light did not provide additional product information.';
  } catch (cause) {
    if (request !== bulbDetailsRequest) return;
    status.textContent = cause.status === 404 ? 'Restart the lighting service to enable light details.' : cause.message;
    status.classList.add('error');
  } finally {
    if (request === bulbDetailsRequest) $('refresh-light-details').disabled = !connected;
  }
}
$('bulb-info').onclick = () => showLightDetails();
$('refresh-light-details').onclick = () => showLightDetails(true);
$('room-create-form').onsubmit = event => {
  event.preventDefault(); void manage(async () => {
      const before = new Set(catalog.groups.map(group => group.id));
      const value = await api('/api/manage',{type:'createRoom',name:$('room-new-name').value});
      selected = value.groups.find(group => !before.has(group.id))?.id ?? selected;
      render(value); $('room-new-name').value = ''; closeScreen();
  });
};
$('room-rename-form').onsubmit = event => { event.preventDefault(); void manage(() => saveManagement({ type: 'renameRoom', id: $('edit-room').value, name: $('room-name').value })); };
function updatePairKind() {
  const ble = $('pair-kind').value === 'bluetooth';
  $('ble-add').hidden = !ble;
  $('matter-add-help').hidden = ble;
  $('pair-code').hidden = ble; $('pair-code').required = !ble;
  document.querySelector('label[for="pair-code"]').hidden = ble;
  $('pair-submit').textContent = ble ? 'Add strip' : 'Pair light';
}
$('pair-kind').onchange = updatePairKind;
$('ble-scan').onclick = () => manage(async () => {
  const devices = await api('/api/bluetooth/scan', {});
  $('ble-device').replaceChildren(...devices.map(device => new Option(`${device.name} · ${device.address}`, device.address)));
  $('ble-scan-status').textContent = devices.length ? 'Choose your strip, enter a name and add it.' : 'No H6159 found. Move closer and close Govee Home, then retry.';
});
$('pair-form').onsubmit = event => {
  event.preventDefault();
  void manage(async () => {
    const input = { code: $('pair-code').value, name: $('pair-name').value, room: $('pair-room').value };
    if ($('pair-kind').value === 'bluetooth') {
      render(await api('/api/manage', {type:'addBluetooth',address:$('ble-device').value,name:input.name,room:input.room}));
      closeScreen(); return 'Strip added.';
    }
    updatePairing(await api('/api/pairing', input));
    return '';
  });
};
function previewAdjustment(url, body) {
  if (!catalog) return;
  const group = [catalog.allRooms, ...catalog.groups].find(value => value.id === body.target);
  const ids = new Set(group ? group.members.map(light => light.id) : [body.target]);
  for (const light of catalog.lights) {
    if (!ids.has(light.id) || !light.available) continue;
    if ((body.type === 'temperature' && light.capabilities?.temperature === false) || (body.type === 'fullWhite' && light.capabilities?.fullWhite === false) || (url === '/api/gradient' && light.capabilities?.gradient === false)) continue;
    light.music = null;
    if (url === '/api/gradient') light.gradient = body.enabled ? structuredClone(body) : null;
    else {
      if (['power','color','temperature','fullWhite'].includes(body.type)) light.gradient = null;
      if (body.type === 'power') light.on = body.on;
      if (body.type === 'brightness') light.brightness = body.value;
      if (body.type === 'temperature') Object.assign(light,{kelvin:body.value,colorMode:2});
      if (body.type === 'color') Object.assign(light,{hue:body.hue,saturation:body.saturation,colorMode:0});
      if (body.type === 'fullWhite') light.fullWhite = body.enabled;
    }
  }
  for (const room of [catalog.allRooms,...catalog.groups]) {
    room.members = room.members.map(member => catalog.lights.find(light => light.id === member.id) ?? member);
    const responding = room.members.filter(light => light.available);
    room.on = responding.some(light => light.on);
    room.gradient = responding.find(light => light.gradient)?.gradient ?? null;
    room.music = responding.find(light => light.music)?.music ?? null;
    for (const key of ['brightness','kelvin','colorMode','hue','saturation']) room[key] = responding.length && responding.every(light => light[key] === responding[0][key]) ? responding[0][key] : null;
  }
  if (body.type === 'fullWhite' && group) group.fullWhite = body.enabled;
  render(catalog);
}
const adjustments = new AdjustmentQueue({
  execute: async ({url, body}) => {
    const result = await api(url, body, true);
    if (result.outcomes) {
      const errors = result.outcomes.filter(item => !item.ok && !item.skipped);
      if (errors.length) showPairingAlert(errors.map(item => `${item.name}: ${item.error}`).join('\n'), 'Couldn’t apply all changes');
    }
    return result.state ?? result;
  },
  changed: pending => {
    adjusting = pending;
    sceneUI?.lock();
    renderControllerHealth();
    document.querySelectorAll('.adjustment-spinner').forEach(spinner => { spinner.hidden = !pending; });
  },
  failed: error => { showPairingAlert(error.message, 'Couldn’t apply change'); },
  idle: value => {
    if (value && connected) {
      catalog = value;
      if (!wheelDragging) render(value);
    }
    lock();
  },
});
function enqueueAdjustment(url, body, key) {
  if (busy || managing || pairingActive || !connected) return Promise.resolve();
  if (musicUI?.active) {
    const members = target => [catalog.allRooms,...catalog.groups].find(group=>group.id===target)?.members.map(light=>light.id) ?? [target];
    const affected = new Set(members(body.target));
    if (members(musicUI.target).some(id=>affected.has(id))) void musicUI.stop(false);
  }
  commandVersion++;
  // Paint the requested state before beginning any network work.
  adjusting = true;
  document.querySelectorAll('.adjustment-spinner').forEach(spinner => { spinner.hidden = false; });
  previewAdjustment(url,body);
  return adjustments.enqueue({url,body}, key);
}
const command = (body, target = selected) => enqueueAdjustment('/api/command', {...body,target},
  ['brightness','temperature','color'].includes(body.type) ? `${target}:${body.type}` : undefined);
sceneUI = sceneControls({
  getCatalog: () => catalog,
  getTarget: () => selected,
  allowed: () => connected && !busy && !managing && !pairingActive && !adjusting && !wheelDragging,
  perform: async body => {
    commandVersion++; busy = true; lock();
    try {
      const value = await api('/api/scenes', body);
      if (body.type === 'apply') {
        // The controller stops only affected Music bulbs. Release this phone's
        // microphone only if its session no longer owns any lights.
        if (musicUI?.active && !value.state.lights.some(light => light.music)) await musicUI.stop(false);
        const affected = new Set(value.outcomes.filter(outcome => outcome.ok).map(outcome => outcome.id));
        for (const target of [value.state.allRooms, ...value.state.groups, ...value.state.lights]) {
          if (affected.has(target.id) || target.members?.some(light => affected.has(light.id))) {
            viewModes.set(target.id, target.gradient ? 'gradient' : target.colorMode === 2 ? 'white' : 'color');
          }
        }
      }
      render(value.state);
      return value;
    } finally { busy = false; lock(); }
  },
});
$('link-device').onclick = async () => {
  $('link-device').disabled = true;
  try {
    const link = await api('/api/link-code', {});
    $('link-code').textContent = `Sign-in code: ${link.code}. Open LightSage from the other device’s Home Screen and enter it there. Single use; valid for 10 minutes.`;
  } catch (error) { $('link-code').textContent = error.message; }
  finally { $('link-device').disabled = false; }
};
$('power').onclick = () => command({ type: 'power', on: !state.on });
async function startFullWhite(target) {
  if (busy || managing || pairingActive || !connected) return;
  pendingFullWhite.add(target);
  lock();
  try { await command({ type: 'fullWhite', enabled: true }, target); }
  finally { pendingFullWhite.delete(target); lock(); }
}
$('full-white').onclick = () => state?.fullWhite
  ? command({type:'fullWhite',enabled:false}, selected)
  : startFullWhite(selected);
$('cancel-full-white').onclick = () => command({ type: 'fullWhite', enabled: false });
$('brightness').oninput = event => { $('brightness-value').value = `${event.target.value}%`; };
$('brightness').onchange = event => command({ type: 'brightness', value: Number(event.target.value) });
$('temperature').oninput = event => { $('temperature-value').value = `${event.target.value} K`; };
$('temperature').onchange = event => command({ type: 'temperature', value: Number(event.target.value) });
$('white-mode').onclick = () => { viewModes.set(selected,'white'); void command({type:'temperature',value:4400}); };
$('color-mode').onclick = async () => { viewModes.set(selected,'color'); if (state.gradient || state.music || musicUI?.active || adjusting) await applyGradient(selected,false); else render(catalog); };
function closeMenu() {
  $('app-menu').hidden = true; $('menu-toggle').setAttribute('aria-expanded','false');
}
function showScreen(id) {
  closeMenu();
  closeMoveMenu();
  if (screenStack.at(-1)?.id === id) return;
  const previous = screenStack.at(-1);
  if (previous) { previous.scroll = $(previous.id).scrollTop; $(previous.id).hidden = true; }
  screenStack.push({id,focus:document.activeElement,scroll:0});
  document.body.classList.add('screen-open');
  for (const node of document.querySelector('main').children) if (!node.classList.contains('screen')) node.inert = true;
  const screen = $(id); screen.hidden = false;
  if (!screen.querySelector('.screen-message')) {
    const status = document.createElement('p'); status.className = 'screen-message'; status.setAttribute('role','status');
    screen.querySelector('.screen-heading').after(status);
  }
  screen.querySelector('.screen-message').textContent = '';
  if (id !== 'add-bulb-screen') screen.querySelectorAll('.feedback').forEach(node => { node.textContent = ''; node.classList.remove('error'); });
  screen.scrollTop = 0; screen.focus(); fitWheels();
}
function closeScreen() {
  const current = screenStack.pop(); if (!current) return;
  $(current.id).hidden = true;
  const previous = screenStack.at(-1);
  if (previous) { $(previous.id).hidden = false; $(previous.id).scrollTop = previous.scroll; }
  else {
    document.body.classList.remove('screen-open');
    for (const node of document.querySelector('main').children) node.inert = false;
  }
  if (current.focus?.isConnected) current.focus.focus();
  else if (previous) $(previous.id).focus();
  else $('target').focus();
  gradientUI?.render();
  fitWheels();
}
$('menu-toggle').onclick = () => {
  const open = $('app-menu').hidden; $('app-menu').hidden = !open; $('menu-toggle').setAttribute('aria-expanded',String(open));
};
document.addEventListener('click',event => { if (!event.target.closest('.app-menu')) closeMenu(); });
document.addEventListener('keydown',event => {
  if (event.key !== 'Escape') return;
  if (document.querySelector('dialog[open]')) return;
  if (!$('bulb-move-menu').hidden) { closeMoveMenu(); $('bulb-move').focus(); return; }
  if (!$('app-menu').hidden) { closeMenu(); $('menu-toggle').focus(); }
  else closeScreen();
});
document.querySelectorAll('[data-close]').forEach(button => button.onclick = closeScreen);
$('add-room').onclick = () => { $('room-error').textContent = ''; showScreen('room-screen'); };
$('settings-button').onclick = () => showScreen('settings-screen');
function openAddBulb() {
  $('pair-form').reset(); updatePairKind();
  $('pair-status').textContent = '';
  $('pair-status').classList.remove('error');
  $('pair-room').value = catalog?.groups.some(room => room.id === selected) ? selected : '';
  showScreen('add-bulb-screen');
}
function renderRoomView() {
  $('room-panel').hidden = showingRoomLights;
  $('room-lights-panel').hidden = !showingRoomLights;
  const label = showingRoomLights ? 'Controls' : `Lights (${state?.members?.length ?? 0})`;
  $('lights-button').querySelector('span').textContent = label;
  $('lights-button').setAttribute('aria-label', label);
  $('lights-button').title = label;
  $('lights-button').querySelector('svg').innerHTML = showingRoomLights
    ? '<path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.4-3.4 1.5 1.5 0 0 1 1.1-2.6H18a3 3 0 0 0 3-3 9 9 0 0 0-9-9Z"/><circle cx="7.5" cy="10" r="1"/><circle cx="10" cy="6.5" r="1"/><circle cx="14.5" cy="7" r="1"/><circle cx="17.5" cy="10.5" r="1"/>'
    : '<path d="M9 18h6m-5 3h4M8 15a6 6 0 1 1 8 0l-1 3H9z"/>';
  $('lights-button').setAttribute('aria-pressed', String(showingRoomLights));
}
$('lights-button').onclick = () => {
  showingRoomLights = !showingRoomLights;
  renderRoomView();
  if (showingRoomLights) renderLights();
  else { render(catalog); fitWheels(); }
};
$('add-device').onclick = openAddBulb;
$('lights-add-bulb').onclick = openAddBulb;
function queueColor(target, color) {
  return command({type:'color',...color},target);
}
function renderLights() {
  $('lights-empty').hidden = !!state.members?.length;
  $('lights-room-name').hidden = selected === 'all-rooms';
  $('lights-room-name').title = selected === 'all-rooms' ? 'ALL ROOMS has a fixed name' : 'Edit room name';
  $('lights-room-name').setAttribute('aria-label',selected === 'all-rooms' ? 'ALL ROOMS' : `Edit room name: ${state.name}`);
  if (wheelDragging || colorSending) return;
  $('members').replaceChildren(...[...(state.members ?? [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })).map(light => {
    const li = document.createElement('li'); li.className = 'bulb-card-item';
    const card = document.createElement('button'); card.className = 'bulb-card';
    const icon = document.createElement('span'); icon.className = 'bulb-card-icon';
    icon.classList.toggle('is-on',light.available && light.on);
    icon.setAttribute('aria-hidden','true');
    icon.innerHTML = light.available && light.on
      ? '<svg viewBox="0 0 24 24"><path d="M9 18h6m-5 3h4M9 16v-2a5 5 0 1 1 6 0v2Z"/><path class="bulb-rays" d="M12 1v2M3 4l2 2M1 10h2M21 10h2M19 6l2-2"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M9 18h6m-5 3h4M8 15a6 6 0 1 1 8 0l-1 3H9z"/></svg>';
    const photo = bulbPhoto(light);
    if (photo) {
      const fallback = icon.innerHTML;
      const image = document.createElement('img');
      image.className = 'bulb-product-photo'; image.alt = ''; image.width = 40; image.height = 48;
      icon.classList.add('has-product-photo');
      icon.dataset.power = !connected || !light.available ? 'unavailable' : light.on ? 'on' : 'off';
      image.onerror = () => { icon.classList.remove('has-product-photo'); icon.innerHTML = fallback; };
      image.src = photo; icon.replaceChildren(image);
    }
    const name = document.createElement('strong'); name.textContent = light.name;
    const knownColor = light.available && Number.isFinite(light.hue) && Number.isFinite(light.saturation);
    if (knownColor) {
      card.style.setProperty('--bulb-color', `rgb(${hsvRgb(light.hue,light.saturation/100).join(',')})`);
      icon.title = light.colorMode === 2 ? `White · ${light.kelvin} K` : 'Current light color';
    } else { icon.classList.add('unknown-color'); icon.title = 'Color unavailable'; }
    const powerStatus = light.available ? light.on ? 'On' : 'Off' : 'Unavailable';
    card.setAttribute('aria-label', `${light.name}, ${powerStatus}. ${icon.title}. Open Light`);
    card.onclick = () => { controlledLightId = light.id; endNameEdit(); renderBulbControl(); lock(); showScreen('bulb-control-screen'); };
    card.append(icon,name); li.append(card); return li;
  }));
}
function renderBulbControl() {
  const light = controlledLight(); if (!light) return;
  const photo = bulbPhoto(light), image = $('bulb-view-photo');
  image.hidden = !photo || image.dataset.failedSrc === photo;
  if (photo && image.getAttribute('src') !== photo) {
    image.onerror = () => { image.dataset.failedSrc = photo; image.hidden = true; };
    image.src = photo;
  }
  $('bulb-view-name').textContent = light.name;
  $('bulb-view-name').setAttribute('aria-label', `Edit name: ${light.name}`);
  $('bulb-power').innerHTML = $('power').innerHTML;
  $('bulb-power').setAttribute('aria-pressed',String(!!light.on));
  $('bulb-power').setAttribute('aria-label',light.on ? 'Turn off' : 'Turn on');
  $('bulb-white').replaceChildren($('white-symbol').cloneNode(true));
  const symbol = $('bulb-white').firstElementChild; symbol.removeAttribute('id'); symbol.removeAttribute('hidden');
  $('bulb-white').setAttribute('aria-label','Full White');
  $('bulb-white').title = $('bulb-white').getAttribute('aria-label');
  $('bulb-control-note').textContent = light.blockedBy ? `Restore ${light.blockedBy} first.` : light.transport === 'bluetooth' ? 'Whole-strip color and brightness. White temperature, Full White, Gradient and Music are unavailable.' : '';
  $('bulb-unreachable').hidden = !!light.available || !!light.loading;
  const controls = controlsFor(light);
  $('bulb-brightness').value = controls.brightness ?? 50; $('bulb-brightness-value').value = `${controls.brightness ?? '—'}%`;
  $('bulb-temperature').value = controls.kelvin ?? 4400; $('bulb-temperature-value').value = `${controls.kelvin ?? '—'} K`;
  const music = viewModes.get(light.id) === 'music' || !!light.music;
  $('bulb-music-panel').hidden = !music; $('bulb-music-mode').setAttribute('aria-pressed',String(music));
  const gradient = !music && (!!light.gradient || viewModes.get(light.id) === 'gradient');
  const white = !music && !gradient && viewModes.get(light.id) === 'white' && controls.colorMode === 2;
  $('bulb-temperature-control').hidden = !white; $('bulb-wheel-control').hidden = white || gradient || music;
  $('bulb-gradient-panel').hidden = !gradient;
  $('bulb-gradient-mode').setAttribute('aria-pressed',String(gradient));
  $('bulb-white-mode').setAttribute('aria-pressed',String(white)); $('bulb-color-mode').setAttribute('aria-pressed',String(!white && !gradient && !music));
  if (!wheelDragging && !colorSending) bulbWheel.draw(controls.hue ?? null,controls.saturation ?? null);
  gradientUI?.render();
  fitWheels();
}
function bulbRoom(id) { return catalog.groups.find(room => room.members.some(light => light.id === id))?.id ?? ''; }
let renamingRoomId;
$('lights-room-name').onclick = () => {
  if (selected === 'all-rooms') return;
  renamingRoomId = selected;
  $('lights-room-input').value = state.name;
  $('lights-room-status').textContent = ''; $('lights-room-status').classList.remove('error');
  $('lights-room-dialog').showModal();
  $('lights-room-input').focus({preventScroll:true});
  $('lights-room-input').setSelectionRange(0, $('lights-room-input').value.length);
};
for (const id of ['close-lights-room','cancel-lights-room']) $(id).onclick = () => $('lights-room-dialog').close();
$('lights-room-dialog').oncancel = event => { if (managing) event.preventDefault(); };
$('lights-room-form').onsubmit = event => {
  event.preventDefault();
  void manage(async () => {
    await saveManagement({type:'renameRoom',id:renamingRoomId,name:$('lights-room-input').value});
    $('lights-room-dialog').close(); return 'Name saved.';
  }, 'lights-room-status');
};
function endNameEdit() {
  $('bulb-name-dialog').close();
}
$('bulb-view-name').onclick = () => {
  $('bulb-name-input').value = controlledLight().name;
  $('bulb-name-status').textContent = ''; $('bulb-name-status').classList.remove('error');
  $('bulb-name-dialog').showModal();
  $('bulb-name-input').focus(); $('bulb-name-input').select();
};
$('cancel-bulb-name').onclick = endNameEdit;
$('close-bulb-name').onclick = endNameEdit;
$('bulb-name-dialog').oncancel = event => { if (managing) event.preventDefault(); };
$('bulb-name-form').onsubmit = event => {
  event.preventDefault();
  void manage(async () => {
    const id = controlledLightId;
    await saveManagement({type:'saveBulb',id,name:$('bulb-name-input').value,room:bulbRoom(id)});
    endNameEdit(); return 'Name saved.';
  }, 'bulb-name-status');
};
function closeMoveMenu() { $('bulb-move-menu').hidden = true; $('bulb-move').setAttribute('aria-expanded','false'); }
$('bulb-move').onclick = () => {
  if (!$('bulb-move-menu').hidden) { closeMoveMenu(); return; }
  const current = bulbRoom(controlledLightId);
  const heading = document.createElement('h3');
  heading.className = 'bulb-move-heading'; heading.textContent = 'Move Light to:';
  $('bulb-move-menu').replaceChildren(heading, ...[{id:'',name:'Unassigned'},...catalog.groups].map(room => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = room.name;
    button.disabled = room.id === current;
    button.setAttribute('aria-pressed',String(room.id === current));
    button.onclick = () => manage(async () => {
      const light = controlledLight();
      await saveManagement({type:'saveBulb',id:light.id,name:light.name,room:room.id});
      closeMoveMenu(); return `Moved to ${room.name}.`;
    });
    return button;
  }));
  $('bulb-move-menu').hidden = false; $('bulb-move').setAttribute('aria-expanded','true');
  $('bulb-move-menu').querySelector('button:not(:disabled)')?.focus();
};
document.addEventListener('click',event => { if (!event.target.closest('.bulb-move-container')) closeMoveMenu(); });
$('unavailable-bulbs').onclick = async () => {
  if (busy || managing || pairingActive || !connected) return;
  const ids = (state.members ?? []).filter(light => !light.available).map(light => light.id);
  if (!ids.length) return;
  busy = true; commandVersion++; lock();
  try {
    const value = await api('/api/reconnect', { ids });
    render(value);
    if (value.recovery) { showPairingAlert(value.recovery.message, value.recovery.title); return; }
    const missing = value.lights.filter(light => ids.includes(light.id) && !light.available);
    if (missing.length) showPairingAlert(`Still unavailable: ${missing.map(light => light.name).join(', ')}. Check their power and Wi-Fi connection.`, 'Couldn’t reconnect all lights');
  } catch (error) { showPairingAlert(error.message, 'Couldn’t reconnect'); }
  finally { busy = false; lock(); }
};
$('bulb-retry').onclick = async () => {
  if (busy || managing || pairingActive || !connected) return;
  const id = controlledLightId;
  busy = true; commandVersion++; lock();
  $('bulb-retry').textContent = 'Reconnecting…';
  try {
    const value = await api('/api/reconnect', { id });
    render(value);
    if (value.recovery) { showPairingAlert(value.recovery.message, value.recovery.title); return; }
    if (!value.lights.find(light => light.id === id)?.available) {
      showPairingAlert('The light is still unreachable. Check that it has power and is connected to your Wi-Fi, then retry.', 'Couldn’t reconnect');
    }
  } catch (error) { showPairingAlert(error.message, 'Couldn’t reconnect'); }
  finally { busy = false; $('bulb-retry').textContent = 'Retry connection'; lock(); }
};
$('bulb-power').onclick = () => command({type:'power',on:!controlledLight().on},controlledLightId);
$('bulb-white').onclick = () => startFullWhite(controlledLightId);
$('cancel-bulb-white').onclick = () => command({type:'fullWhite',enabled:false},controlledLightId);
$('bulb-brightness').oninput = event => { $('bulb-brightness-value').value = `${event.target.value}%`; };
$('bulb-brightness').onchange = event => command({type:'brightness',value:Number(event.target.value)},controlledLightId);
$('bulb-temperature').oninput = event => { $('bulb-temperature-value').value = `${event.target.value} K`; };
$('bulb-temperature').onchange = event => command({type:'temperature',value:Number(event.target.value)},controlledLightId);
$('bulb-white-mode').onclick = () => {
  const light = controlledLight();
  if (blocked(light)) return;
  if ((light.colorMode === 0 || light.colorMode === 1) && Number.isFinite(light.hue) && Number.isFinite(light.saturation)) {
    bulbColors.set(light.id, { hue: light.hue, saturation: light.saturation });
  }
  viewModes.set(light.id, 'white');
  void command({type:'temperature',value:4400}, light.id);
};
$('bulb-color-mode').onclick = async () => {
  const light = controlledLight();
  if (blocked(light)) return;
  viewModes.set(light.id, 'color');
  if (light.gradient || light.music || musicUI?.active || adjusting) { await applyGradient(light.id,false); return; }
  const previous = bulbColors.get(light.id);
  if (light.colorMode === 2 && previous) {
    void command({type:'color', ...previous}, light.id);
  } else {
    renderBulbControl();
  }
};
function applyGradient(target, enabled, config = {}) {
  return enqueueAdjustment('/api/gradient', {...config,target,enabled}, enabled ? `${target}:gradient` : undefined);
}
gradientUI = gradientControls({
  value: prefix => prefix ? controlledLight() : state,
  allowed: light => !blocked(light) && light?.capabilities?.gradient !== false,
  apply: applyGradient,
  pending: () => adjusting,
  select: id => { viewModes.set(id,'gradient'); render(catalog); },
});
musicUI = musicControls({
  value: prefix => prefix ? controlledLight() : state,
  allowed: light => !blocked(light) && light?.capabilities?.music !== false,
  select: id => { viewModes.set(id,'music'); render(catalog); },
  request: (url,body) => api(url,body,true),
  alert: showPairingAlert,
  changed: () => { if (catalog) render(catalog); },
  ready: async () => { while (adjustments.pending) await new Promise(resolve=>setTimeout(resolve,25)); },
});
$('login-form').onsubmit = async event => {
  event.preventDefault();
  await run(async () => { await api('/api/session', { code: $('code').value }); $('code').value = ''; return api('/api/state'); });
};
function networkChanged() {
  if (navigator.onLine === false && !window.lightSageDesktop) disconnect();
  else if (!connected) connectionPhase = 'restarting';
  lock();
  if (!connected) message(unavailableMessage(), !connectionPending());
  if (navigator.onLine !== false) void poll();
}
window.addEventListener('offline', networkChanged);
window.addEventListener('online', networkChanged);
connection();
// Paint the last known rooms immediately, with connected still false. Restoring
// a snapshot never sends commands or makes its observations current.
try {
  const saved = JSON.parse(localStorage.getItem('lightsage-last-catalog'));
  if (saved?.allRooms && Array.isArray(saved.lights) && Array.isArray(saved.groups)) render(saved);
} catch {
  try { localStorage.removeItem('lightsage-last-catalog'); } catch {}
  $('light').hidden = true; $('offline-startup').hidden = false;
}
if ('serviceWorker' in navigator && window.isSecureContext && !window.lightSageDesktop) {
  let reloadingShell = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadingShell) return;
    reloadingShell = true; location.reload();
  });
  // Registration starts before API calls that might wait on an offline host.
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
    .then(registration => registration.update())
    .catch(error => console.warn('Could not update saved app:', error));
}
// A local setup link may supply the access code in the fragment, never the HTTP URL.
const setup = new URLSearchParams(location.hash.slice(1)).get('setup');
if (setup) {
  history.replaceState(null, '', location.pathname);
  await run(async () => { await api('/api/session', { code: setup }); return api('/api/state'); });
} else {
  try { updatePairing(await api('/api/pairing', undefined, true)); if (!pairingActive) await refresh(); }
  catch (error) { message(error.message, true); }
}
setInterval(poll, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void poll(); });
window.addEventListener('pageshow', () => void poll());
