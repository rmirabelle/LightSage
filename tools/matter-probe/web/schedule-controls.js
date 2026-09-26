// Schedules run on the Windows service; this screen only edits them.
const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayLetters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export function formatTime(hour, minute) {
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}
export function formatDays(days) {
  const key = [...days].sort().join('');
  if (key === '0123456') return 'Every day';
  if (key === '12345') return 'Weekdays';
  if (key === '06') return 'Weekends';
  return [...days].sort().map(day => dayNames[day]).join(', ');
}
export function scheduleControls({ getCatalog, getTarget, allowed, perform, showScreen }) {
  const $ = id => document.getElementById(id);
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const button = (text, action, className = 'secondary') => {
    const node = element('button', text, className); node.type = 'button'; node.onclick = action; return node;
  };
  const select = (id, label, options) => {
    const node = element('select'); node.id = id; node.setAttribute('aria-label', label);
    node.append(...options.map(([value, text]) => new Option(text, value)));
    return node;
  };
  const scope = target => target === 'all-rooms' ? 'ALL ROOMS' : getCatalog()?.groups.find(group => group.id === target)?.name ?? 'Room';
  const actionLabel = entry => entry.action === 'on' ? 'Power on' : entry.action === 'off' ? 'Power off' : `Load scene · ${entry.sceneName ?? 'Deleted scene'}`;
  const when = iso => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  const list = $('schedule-list');
  const empty = $('schedule-empty');
  const badge = element('span', '', 'count-badge'); badge.setAttribute('aria-hidden', 'true'); badge.hidden = true;
  $('schedule-button').append(badge);
  $('schedule-button').onclick = () => { render(true); showScreen('schedule-screen'); };
  $('schedule-new').onclick = () => edit();

  const dialog = element('dialog', '', 'schedule-dialog');
  dialog.setAttribute('aria-labelledby', 'schedule-dialog-title');
  const heading = element('div', '', 'dialog-heading');
  const title = element('h2'); title.id = 'schedule-dialog-title';
  const close = button('×', () => dialog.close(), 'icon-button screen-close'); close.setAttribute('aria-label', 'Close');
  heading.append(title, close);
  const content = element('div');
  dialog.append(heading, content); document.body.append(dialog);
  let pending = false, signature;
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });

  function lock() {
    const disabled = pending || !allowed();
    $('schedule-button').disabled = !getCatalog();
    $('schedule-new').disabled = disabled;
    list.querySelectorAll('button,input').forEach(node => { node.disabled = disabled || node.dataset.edge === 'true'; });
    content.querySelectorAll('button,select').forEach(node => { node.disabled = disabled; });
    close.disabled = pending;
  }
  async function execute(command, error) {
    if (pending || !allowed()) return false;
    pending = true; error.textContent = ''; lock();
    try { await perform(command); return true; }
    catch (cause) { error.textContent = cause.message; return false; }
    finally { pending = false; lock(); render(true); }
  }
  function card(entry, index, entries) {
    const item = element('li', '', 'schedule-card');
    item.classList.toggle('paused', !entry.enabled);
    const details = button('', () => edit(entry), 'schedule-edit');
    details.setAttribute('aria-label', `Edit ${formatTime(entry.hour, entry.minute)}, ${entry.roomName}, ${actionLabel(entry)}`);
    details.append(element('strong', formatTime(entry.hour, entry.minute), 'schedule-time'),
      element('span', `${entry.roomName} · ${actionLabel(entry)}`, 'schedule-action'),
      element('span', formatDays(entry.days), 'schedule-days'));
    if (entry.problem) details.append(element('span', entry.problem, 'schedule-run error'));
    else if (entry.lastRun) details.append(element('span', entry.lastRun.ok ? `Last ran ${when(entry.lastRun.at)} · ${entry.lastRun.message}` : `${when(entry.lastRun.at)} · ${entry.lastRun.message}`, `schedule-run${entry.lastRun.ok ? '' : ' error'}`));
    const toggle = element('label', '', 'schedule-switch');
    const input = element('input'); input.type = 'checkbox'; input.checked = entry.enabled;
    input.setAttribute('role', 'switch');
    input.setAttribute('aria-label', `${entry.enabled ? 'Pause' : 'Resume'} ${formatTime(entry.hour, entry.minute)} ${entry.roomName}`);
    input.onchange = () => { void execute({ type: 'enable', id: entry.id, enabled: input.checked }, $('schedule-error')); };
    toggle.append(input, element('span', '', 'schedule-slider'));
    const sameTime = entries.filter(other => other.hour === entry.hour && other.minute === entry.minute);
    if (sameTime.length > 1) {
      const position = sameTime.indexOf(entry);
      const move = (direction, path, text) => {
        const node = button('', () => { void execute({ type: 'move', id: entry.id, direction }, $('schedule-error')); }, 'icon-button schedule-move');
        node.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;
        node.setAttribute('aria-label', `${text}: ${formatTime(entry.hour, entry.minute)} ${entry.roomName}`); node.title = text;
        node.dataset.edge = String(position === (direction < 0 ? 0 : sameTime.length - 1));
        return node;
      };
      const order = element('div', '', 'schedule-order');
      order.append(move(-1, 'm6 15 6-6 6 6', 'Run earlier'), move(1, 'm6 9 6 6 6-6', 'Run later'));
      item.append(details, order, toggle);
    } else item.append(details, toggle);
    return item;
  }
  function render(force = false) {
    const entries = getCatalog()?.schedules ?? [];
    badge.textContent = String(entries.length); badge.hidden = entries.length === 0;
    $('schedule-button').setAttribute('aria-label', entries.length ? `Schedules, ${entries.length}` : 'Schedules');
    const next = JSON.stringify(entries);
    if (force || next !== signature) {
      signature = next;
      list.replaceChildren(...entries.map(card));
      empty.hidden = entries.length > 0;
    }
    lock();
  }
  function edit(entry) {
    const catalog = getCatalog();
    title.textContent = entry ? 'Edit Action' : 'New Action';
    content.replaceChildren();
    const rooms = [['all-rooms', 'ALL ROOMS'], ...(catalog?.groups ?? []).map(group => [group.id, group.name])];
    const room = select('schedule-room', 'Room', rooms);
    room.value = entry?.target ?? (rooms.some(([id]) => id === getTarget()) ? getTarget() : 'all-rooms');
    const action = select('schedule-action', 'Action', [['scene', 'Load scene'], ['on', 'Power on'], ['off', 'Power off']]);
    action.value = entry?.action ?? ((catalog?.scenes ?? []).some(value => value.target === room.value) ? 'scene' : 'on');
    const scene = select('schedule-scene', 'Scene', []);
    const sceneLabel = element('label', 'Scene'); sceneLabel.htmlFor = 'schedule-scene';
    const noScenes = element('p', '', 'muted');
    const start = entry ?? { hour: (new Date().getHours() + 1) % 24, minute: 0 };
    const hour = select('schedule-hour', 'Hour', Array.from({ length: 12 }, (_, index) => [String(index + 1), String(index + 1)]));
    hour.value = String(start.hour % 12 || 12);
    const minute = select('schedule-minute', 'Minute', Array.from({ length: 60 }, (_, index) => [String(index), String(index).padStart(2, '0')]));
    minute.value = String(start.minute);
    const half = select('schedule-ampm', 'AM or PM', [['am', 'AM'], ['pm', 'PM']]);
    half.value = start.hour < 12 ? 'am' : 'pm';
    const time = element('div', '', 'schedule-time-fields'); time.setAttribute('role', 'group'); time.setAttribute('aria-label', 'Time');
    time.append(hour, element('span', ':'), minute, half);
    const days = new Set(entry?.days ?? [0, 1, 2, 3, 4, 5, 6]);
    const daysLabel = element('span', '', 'schedule-field-label');
    const countDays = () => { daysLabel.textContent = `Days (${days.size})`; };
    countDays();
    const dayRow = element('div', '', 'schedule-day-picker'); dayRow.setAttribute('role', 'group'); dayRow.setAttribute('aria-label', 'Days');
    dayLetters.forEach((letter, day) => {
      const toggle = button(letter, () => {
        if (days.has(day)) days.delete(day); else days.add(day);
        toggle.setAttribute('aria-pressed', String(days.has(day)));
        countDays();
      });
      toggle.setAttribute('aria-pressed', String(days.has(day)));
      toggle.setAttribute('aria-label', dayNames[day]);
      dayRow.append(toggle);
    });
    const error = element('p', '', 'feedback error'); error.setAttribute('role', 'status');
    const save = button('Save', () => void submit(), 'schedule-save');
    function showScenes() {
      const choices = (catalog?.scenes ?? []).filter(value => value.target === room.value)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
      const previous = scene.value || entry?.sceneId;
      scene.replaceChildren(...choices.map(value => new Option(value.name, value.id)));
      if (choices.some(value => value.id === previous)) scene.value = previous;
      const needed = action.value === 'scene';
      sceneLabel.hidden = scene.hidden = !needed || !choices.length;
      noScenes.hidden = !needed || choices.length > 0;
      noScenes.textContent = `${scope(room.value)} has no saved scenes. Save a scene first, or choose Power on or Power off.`;
    }
    room.onchange = showScenes; action.onchange = showScenes;
    async function submit() {
      if (!days.size) { error.textContent = 'Choose at least one day.'; return; }
      if (action.value === 'scene' && !scene.value) { error.textContent = 'Choose a scene.'; return; }
      const hour12 = Number(hour.value) % 12;
      const command = { type: entry ? 'update' : 'create', ...(entry ? { id: entry.id } : {}), target: room.value, action: action.value,
        ...(action.value === 'scene' ? { sceneId: scene.value } : {}),
        hour: half.value === 'pm' ? hour12 + 12 : hour12, minute: Number(minute.value), days: [...days].sort() };
      if (await execute(command, error)) dialog.close();
    }
    const label = (text, id) => { const node = element('label', text); node.htmlFor = id; return node; };
    const actions = element('div', '', 'rename-actions');
    if (entry) {
      const remove = button('', () => confirmDelete(entry), 'icon-button schedule-delete');
      remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';
      remove.setAttribute('aria-label', 'Delete action'); remove.title = 'Delete action';
      actions.append(remove);
    }
    actions.append(button('Cancel', () => dialog.close()), save);
    content.append(label('Room', 'schedule-room'), room, label('Action', 'schedule-action'), action, sceneLabel, scene, noScenes,
      element('span', 'Time', 'schedule-field-label'), time, daysLabel, dayRow, error, actions);
    showScenes(); lock();
    if (!dialog.open) dialog.showModal();
    room.focus();
  }
  function confirmDelete(entry) {
    title.textContent = 'Delete action?';
    content.replaceChildren();
    const error = element('p', '', 'feedback error');
    content.append(element('p', `Delete ${formatTime(entry.hour, entry.minute)} · ${entry.roomName} · ${actionLabel(entry)}? Your lights will not change.`), error);
    const actions = element('div', '', 'rename-actions');
    const cancel = button('Cancel', () => edit(entry));
    actions.append(cancel, button('Delete', async () => { if (await execute({ type: 'delete', id: entry.id }, error)) dialog.close(); }, 'schedule-delete-confirm'));
    content.append(actions); lock(); cancel.focus();
  }
  return { render, lock };
}
