const { BrowserWindow, ipcMain } = require('electron');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

// A separate modal survives controller restarts and main-page reloads during restore.
module.exports = function showAppMessage(parent, options) {
  const buttons = options.buttons ?? ['OK'];
  const cancelId = options.cancelId ?? 0;
  const channel = 'lightsage-message-' + randomUUID();
  const data = {
    channel, buttons, cancelId, defaultId: options.defaultId ?? 0,
    title: options.title ?? options.message,
    message: options.title ? options.message : '',
    detail: options.detail ?? '',
    type: options.type ?? 'info',
  };
  const modal = new BrowserWindow({
    parent, modal: true, show: false, width: 560, height: 410,
    resizable: false, minimizable: false, maximizable: false,
    title: data.title, backgroundColor: '#222612', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'message-preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      additionalArguments: ['--lightsage-message=' + Buffer.from(JSON.stringify(data)).toString('base64')],
    },
  });
  modal.removeMenu();
  modal.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  modal.webContents.on('will-navigate', event => event.preventDefault());
  return new Promise((resolve, reject) => {
    let response = cancelId;
    const respond = (event, value) => {
      if (event.sender !== modal.webContents || event.senderFrame !== modal.webContents.mainFrame) return;
      if (!Number.isInteger(value) || value < 0 || value >= buttons.length) return;
      response = value;
      modal.close();
    };
    ipcMain.on(channel, respond);
    modal.once('closed', () => { ipcMain.removeListener(channel, respond); resolve({ response }); });
    modal.once('ready-to-show', () => modal.show());
    modal.loadFile(path.join(__dirname, 'message-dialog.html')).catch(error => { reject(error); modal.destroy(); });
  });
};
