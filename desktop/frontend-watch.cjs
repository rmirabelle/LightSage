const { watch } = require('node:fs');
const path = require('node:path');

// Watch only UI assets. Controller state, logs, and backend edits must not
// trigger reloads or restart the process that owns the bulbs.
module.exports = function watchFrontend(root, reload, onError = () => {}, debounceMs = 350) {
  const watchers = [];
  let timer, closed = false;
  const changed = (_event, filename) => {
    if (closed || !filename || !/\.(html|css|js|webmanifest|png|svg|ico|jpe?g|webp)$/i.test(String(filename))) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (!closed) reload();
    }, debounceMs);
    timer.unref?.();
  };
  for (const directory of ['tools/matter-probe/web', 'resource']) {
    try {
      const watcher = watch(path.join(root, directory), { recursive: true }, changed);
      watcher.on('error', onError);
      watchers.push(watcher);
    } catch (error) { onError(error); }
  }
  return () => {
    closed = true;
    clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
  };
};
