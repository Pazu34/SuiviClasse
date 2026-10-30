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
  exportFile: (name, content, filters) => call('file:export', name, content, filters),
  importFile: filters => call('file:import', filters),
});
