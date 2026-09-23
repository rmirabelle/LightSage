// Scenes share the room selector, but never infer membership when applied.
export function sceneControls({ getCatalog, getTarget, allowed, perform }) {
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const button = (text, action, className = 'secondary') => {
    const node = element('button', text, className); node.type = 'button'; node.onclick = action; return node;
  };
  const iconButton = (text, action, icon, className = 'secondary') => {
    const node = button('', action, `${className} scene-action`);
    node.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icon}</svg>`;
    node.append(element('span', text));
    return node;
  };
  const saveIcon = '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>';
  const trashIcon = '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>';
  const root = element('section', '', 'scenes'); root.setAttribute('aria-label', 'Scenes');
  root.hidden = true;
  const heading = element('div', '', 'scene-heading');
  heading.append(element('span', 'Scenes'));
  const save = button('', () => edit(), 'icon-button');
  save.id = 'save-scene'; save.title = 'Save scene'; save.setAttribute('aria-label', 'Save scene');
  save.setAttribute('aria-haspopup', 'dialog');
  save.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/></svg>';
  document.getElementById('lights-button').before(save);
  const strip = element('div', '', 'scene-strip');
  const feedback = element('dialog', '', 'scene-feedback'); feedback.id = 'scene-feedback';
  feedback.setAttribute('aria-labelledby', 'scene-feedback-title');
  feedback.setAttribute('aria-describedby', 'scene-feedback-text');
  const feedbackHeading = element('div', '', 'dialog-heading');
  const feedbackTitle = element('h2', 'Scenes'); feedbackTitle.id = 'scene-feedback-title';
  const dismiss = button('×', () => feedback.close(), 'icon-button');
  dismiss.setAttribute('aria-label', 'Dismiss scene message');
  feedbackHeading.append(feedbackTitle, dismiss);
  const status = element('p'); status.id = 'scene-feedback-text'; status.setAttribute('role', 'status');
  feedback.append(feedbackHeading, status); document.body.append(feedback);
  let feedbackTimer;
  feedback.addEventListener('close', () => clearTimeout(feedbackTimer));
  function notify(text, isError = false) {
    if (!isError) return;
    clearTimeout(feedbackTimer);
    feedback.classList.toggle('error', isError);
    feedbackTitle.textContent = isError ? 'Scene needs attention' : 'Scene updated';
    status.textContent = text;
    if (!feedback.open) feedback.showModal();
    if (!isError) feedbackTimer = setTimeout(() => feedback.close(), 3500);
  }
  const retry = button('Retry failed lights', () => apply(retryScene, retryIds)); retry.hidden = true;
  root.append(heading, strip, retry);
  document.getElementById('unavailable-bulbs').before(root);

  const dialog = element('dialog', '', 'scene-dialog');
  dialog.tabIndex = -1;
  dialog.setAttribute('aria-labelledby', 'scene-dialog-title');
  const dialogHeading = element('div', '', 'dialog-heading');
  const title = element('h2'); title.id = 'scene-dialog-title';
  const close = button('×', () => dialog.close(), 'icon-button'); close.setAttribute('aria-label', 'Close scenes');
  dialogHeading.append(title, close);
  const content = element('div');
  dialog.append(dialogHeading, content); document.body.append(dialog);
  let signature, pending = false, retryScene, retryIds, displayedTarget;
  const currentScenes = () => (getCatalog()?.scenes ?? []).filter(scene => scene.target === getTarget())
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const needsUpdate = scene => scene.dirty;
  const scope = (target = getTarget()) => target === 'all-rooms' ? 'ALL ROOMS' : getCatalog()?.groups.find(group => group.id === target)?.name ?? 'Room';
  const count = () => (getTarget() === 'all-rooms' ? getCatalog()?.allRooms : getCatalog()?.groups.find(group => group.id === getTarget()))?.members.length ?? 0;
  function show(headingText) {
    title.textContent = headingText; content.replaceChildren();
    if (!dialog.open) dialog.showModal();
  }
  function lock() {
    const disabled = pending || !allowed();
    root.querySelectorAll('button').forEach(node => { node.disabled = disabled; });
    dialog.querySelectorAll('button,input').forEach(node => { node.disabled = disabled; });
    for (const container of [root, dialog]) container.querySelectorAll('[data-scene-id]').forEach(node => {
      node.setAttribute('aria-pressed', String(!!getCatalog()?.scenes?.find(scene => scene.id === node.dataset.sceneId)?.active));
    });
    close.disabled = pending;
    save.disabled = disabled || count() === 0;
  }
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  async function execute(command, done) {
    if (pending || !allowed()) return;
    pending = true;
    clearTimeout(feedbackTimer);
    if (feedback.open) feedback.close();
    lock();
    try { const result = await perform(command); done(result); }
    catch (cause) {
      notify(cause.message, true);
    } finally { pending = false; render(); lock(); }
  }
  function apply(scene, ids, discard = false) {
    if (!scene) return;
    scene = getCatalog()?.scenes?.find(value => value.id === scene.id) ?? scene;
    if (!ids && scene.active && !scene.dirty) return;
    const dirty = currentScenes().find(value => value.dirty);
    if (!ids && !discard && dirty) {
      show('Unsaved scene changes');
      content.append(element('p', `“${dirty.name}” has unsaved changes. Discard them and apply “${scene.name}”, or save the current settings as a new scene?`));
      const cancel = button('Cancel', () => dialog.close());
      content.append(cancel);
      content.append(button('Discard changes', () => apply(scene, undefined, true)));
      content.append(iconButton('Save as new scene', () => edit(undefined, false, dirty.target), saveIcon));
      lock(); cancel.focus();
      return;
    }
    const previousFailures = ids;
    void execute({ type: 'apply', id: scene.id, ...(ids ? { ids } : {}) }, result => {
      retryScene = scene;
      retryIds = result.outcomes.filter(item => !item.ok).map(item => item.id);
      retry.hidden = retryIds.length === 0;
      const applied = result.outcomes.filter(item => item.ok).length;
      const failures = result.outcomes.filter(item => !item.ok).map(item => `${item.name}: ${item.error}`);
      const message = failures.length
        ? `${scene.name}: ${applied} of ${result.outcomes.length} lights applied${previousFailures ? ' on retry' : ''}. ${failures.join(' ')}`
        : `${scene.name} applied${scene.membershipChanged ? ' to saved lights only. Update this scene to include new lights.' : '.'}`;
      if (dialog.open) dialog.close();
      notify(message, failures.length > 0);
    });
  }
  function card(scene) {
    const row = element('div', '', 'scene-card');
    const applyButton = button('', () => apply(scene), 'scene-apply');
    applyButton.append(element('span', scene.name, 'scene-label'));
    if (needsUpdate(scene)) {
      const marker = element('span', '*', 'scene-dirty'); marker.setAttribute('aria-hidden', 'true');
      applyButton.append(marker);
      applyButton.setAttribute('aria-label', `${scene.name}, ${scene.dirty ? 'unsaved changes' : 'lights changed'}`);
    }
    applyButton.setAttribute('aria-pressed', String(!!scene.active));
    applyButton.dataset.sceneId = scene.id;
    applyButton.title = `${scene.count} lights${scene.hasGradient ? ' · Gradient' : ''}${scene.membershipChanged ? ' · Lights changed' : ''}`;
    const more = button('', () => edit(scene), 'scene-more');
    more.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15zM4 15l4 4"/></svg>';
    more.setAttribute('aria-label', `Edit ${scene.name}`); more.title = `Edit ${scene.name}`;
    row.append(applyButton, more); return row;
  }
  function list() {
    show(`${scope()} scenes`);
    for (const scene of currentScenes()) content.append(card(scene));
    content.append(button('＋ Save current settings', () => edit())); lock();
  }
  function edit(scene, editingName = false, saveTarget = getTarget()) {
    const target = scene?.target ?? saveTarget;
    show(editingName ? 'Edit scene name' : scene ? 'Edit Scene' : 'Save scene');
    const description = element('p', '', 'scene-scope');
    description.append(element('strong', scope(target)), element('span', ` · ${scene?.count ?? count()} lights`, 'muted'));
    if (scene && !editingName) {
      const name = button(scene.name, () => edit(scene, true), 'scene-name-trigger');
      name.setAttribute('aria-label', `Edit scene name: ${scene.name}`);
      content.append(name, description);
      if (needsUpdate(scene)) content.append(element('p', 'One or more lights have changed.', 'scene-membership-note'));
      content.append(iconButton('Overwrite', () => confirm(scene, 'replace'), saveIcon, 'secondary scene-overwrite'));
      content.append(iconButton('Delete scene', () => confirm(scene, 'delete'), trashIcon, 'secondary scene-delete'));
      lock(); dialog.focus();
      return;
    }
    const form = element('form'); form.autocomplete = 'off';
    const label = element('label', 'Scene name'); label.htmlFor = 'scene-name';
    const input = element('input'); input.id = 'scene-name'; input.required = true; input.maxLength = 60; input.value = scene?.name ?? ''; input.autocomplete = 'off';
    input.setAttribute('autocorrect', 'off'); input.spellcheck = false;
    const submit = element('button', scene ? 'Save' : 'Save scene'); submit.type = 'submit';
    form.append(label, input, description, submit);
    form.onsubmit = event => {
      event.preventDefault();
      const name = input.value.trim();
      if (!name) { input.setCustomValidity('Enter a scene name.'); input.reportValidity(); return; }
      void execute({ type: scene ? 'rename' : 'create', ...(scene ? { id: scene.id } : { target }), name }, () => {
        if (scene) edit({ ...scene, name }); else dialog.close();
        notify(scene ? 'Scene renamed.' : 'Scene saved. Your lights have not changed.');
      });
    };
    input.oninput = () => input.setCustomValidity('');
    content.append(form);
    if (scene) {
      content.append(button('Cancel', () => edit(scene)));
    } else content.append(element('p', 'Saves each light’s power, brightness, color, and gradient settings. Stop Music and restore Full White first.', 'muted'));
    lock(); input.focus();
  }
  function confirm(scene, type) {
    show(type === 'delete' ? 'Delete scene?' : 'Overwrite scene?');
    content.append(element('p', type === 'delete' ? `Delete “${scene.name}”? Your lights will not change.` : `Overwrite “${scene.name}” with the current settings of all ${count()} lights in ${scope()}? Your lights will not change.`));
    const cancel = button('Cancel', () => edit(scene));
    content.append(cancel);
    content.append(iconButton(type === 'delete' ? 'Delete scene' : 'Overwrite', () => {
      void execute({ type, id: scene.id }, () => {
        dialog.close(); notify(type === 'delete' ? 'Scene deleted.' : 'Scene updated.');
        if (retryScene?.id === scene.id) { retryScene = undefined; retryIds = undefined; retry.hidden = true; }
      });
    }, type === 'delete' ? trashIcon : saveIcon, type === 'delete' ? 'secondary scene-delete' : 'secondary')); lock(); cancel.focus();
  }
  function render() {
    if (displayedTarget !== getTarget()) {
      displayedTarget = getTarget(); retry.hidden = true; retryScene = undefined;
    }
    const scenes = currentScenes();
    root.hidden = scenes.length === 0;
    const next = JSON.stringify([getTarget(), scenes]);
    if (next !== signature) {
      signature = next; strip.replaceChildren(...scenes.slice(0, 3).map(card));
      if (scenes.length > 3) strip.append(button(`See all (${scenes.length})`, list));
    }
    lock();
  }
  return { render, lock };
}
