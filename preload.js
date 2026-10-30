'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = (name, ...args) => ipcRenderer.invoke(name, ...args).then(r => {
  if (!r.ok) { const e = new Error(r.error); e.code = r.code; throw e; }
  return r.value;
});

contextBridge.exposeInMainWorld('api', {
  status: () => call('vault:status'),
  create: (pw, data) => call('vault:create', pw, data),
  unlock: pw => call('vault:unlock', pw),
  save: data => call('vault:save', data),
  lock: () => call('vault:lock'),
  changePassword: (o, n, data) => call('vault:changePassword', o, n, data),
  openDir: () => call('vault:openDir'),
  chooseDir: () => call('vault:chooseDir'),
  listArchives: () => call('archives:list'),
  archiveNow: () => call('archives:now'),
  deleteArchive: name => call('archives:delete', name),
  restoreArchive: (name, pw) => call('archives:restore', name, pw),
  onBeforeClose: cb => ipcRenderer.on('app:before-close', async () => { try { await cb(); } finally { ipcRenderer.send('app:flushed'); } }),
  getPrefs: () => call('prefs:get'),
  setPrefs: values => call('prefs:set', values),
  resetPrefs: () => call('prefs:reset'),
  exportFile: (name, content, filters) => call('file:export', name, content, filters),
  importFile: filters => call('file:import', filters),
});
