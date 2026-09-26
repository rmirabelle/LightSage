const { contextBridge, ipcRenderer } = require('electron');
const argument = process.argv.find(value => value.startsWith('--lightsage-message='));
const data = JSON.parse(Buffer.from(argument.slice('--lightsage-message='.length), 'base64').toString('utf8'));
const { channel, ...message } = data;
contextBridge.exposeInMainWorld('lightSageMessage', {
  ...message,
  respond: index => ipcRenderer.send(channel, index),
});
