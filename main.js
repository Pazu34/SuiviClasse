'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const { Vault } = require('./src/vault');
const { Prefs } = require('./src/prefs');

// Dossier de données : à côté de l'exécutable portable (clé USB), sinon dans ./donnees.
const baseDir = process.env.PORTABLE_EXECUTABLE_DIR || (app.isPackaged ? path.dirname(process.execPath) : __dirname);
const configFile = path.join(baseDir, 'SuiviClasse-config.json');

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch { return {}; }
}
function dataDir() {
  if (process.env.SUIVI_DATA_DIR) return process.env.SUIVI_DATA_DIR;
  const c = readConfig();
  return c.dataDir ? path.resolve(baseDir, c.dataDir) : path.join(baseDir, 'SuiviClasse-Donnees');
}

// Garde les données de Chromium (cache, etc.) sur la clé : rien n'est laissé sur le PC hôte.
app.setPath('userData', path.join(dataDir(), '.electron'));

let vault = new Vault(dataDir());
let prefs = new Prefs(dataDir());
let win;

// ---- archives automatiques ----
let lastArchiveAt = Date.now();
function archive(reason) {
  if (!vault.exists()) return null;
  const name = vault.snapshot(reason);
  vault.prune(prefs.values.backupKeepRecent, prefs.values.backupKeepDays);
  lastArchiveAt = Date.now();
  return name;
}
setInterval(() => {
  const min = prefs.values.backupMinutes;
  if (vault.unlocked && min > 0 && Date.now() - lastArchiveAt >= min * 60000) {
    try { archive('auto'); } catch (e) { console.error('archive auto:', e.message); }
  }
}, 30000);

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600,
    title: 'SuiviClasse',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  // Avant de fermer : demander à l'interface d'écrire les dernières modifications.
  let closing = false;
  win.on('close', e => {
    if (closing || !vault.unlocked) return;
    e.preventDefault(); closing = true;
    const done = () => { try { archive('fermeture'); } catch { /* sans importance */ } vault.lock(); win.destroy(); };
    ipcMain.once('app:flushed', done);
    win.webContents.send('app:before-close');
    setTimeout(done, 4000);
  });
  win.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
}

const handle = (name, fn) => ipcMain.handle(name, async (_e, ...args) => {
  try { return { ok: true, value: await fn(...args) }; }
  catch (err) { return { ok: false, code: err.code || 'ERROR', error: err.message }; }
});

handle('vault:status', () => ({ exists: vault.exists(), unlocked: vault.unlocked, dir: vault.dir }));
handle('vault:create', (pw, data) => { vault.create(pw, data); return data; });
handle('vault:unlock', pw => { const d = vault.unlock(pw); archive('demarrage'); return d; });
handle('vault:save', data => { vault.save(data); return true; });
handle('vault:lock', () => { archive('fermeture'); vault.lock(); return true; });
handle('vault:changePassword', (oldPw, newPw, data) => { vault.changePassword(oldPw, newPw, data); return true; });
handle('vault:openDir', () => shell.openPath(vault.dir));
handle('vault:chooseDir', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choisir le dossier de données', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled) return null;
  vault.lock();
  vault = new Vault(r.filePaths[0]);
  prefs = new Prefs(r.filePaths[0]);
  try { fs.writeFileSync(configFile, JSON.stringify({ dataDir: r.filePaths[0] }, null, 2)); } catch { /* clé en lecture seule */ }
  return { exists: vault.exists(), dir: vault.dir };
});
handle('prefs:get', () => prefs.describe());
handle('prefs:set', values => { prefs.set(values); if (vault.exists()) vault.prune(prefs.values.backupKeepRecent, prefs.values.backupKeepDays); return prefs.describe(); });
handle('prefs:reset', () => { prefs.reset(); return prefs.describe(); });
handle('archives:list', () => vault.listArchives());
handle('archives:now', () => archive('manuel'));
handle('archives:delete', name => { vault.deleteArchive(name); return true; });
handle('archives:restore', (name, password) => {
  const data = vault.readArchive(name, password);   // peut demander le mot de passe de l'archive
  archive('restauration');                          // l'état actuel reste récupérable
  vault.save(data);
  return data;
});
handle('file:export', async (suggestedName, content, filters) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: suggestedName, filters });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, content, 'utf8');
  return r.filePath;
});
handle('file:import', async filters => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
  if (r.canceled) return null;
  return fs.readFileSync(r.filePaths[0], 'utf8');
});

const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { vault.lock(); app.quit(); });
