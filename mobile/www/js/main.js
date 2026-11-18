// Démarrage de l'application.
import { App } from "./app.js";
import { IdbStorage } from "./core/storage.js";
import { onNative, isNative } from "./platform.js";
import { initOrientation } from "./orientation.js";
import { closeAll, closeTop, overlayCount } from "./ui/dom.js";
import { showLogin } from "./ui/login.js";
import { Shell } from "./ui/shell.js";

async function start() {
  const root = document.getElementById("app");
  const app = new App(window.__storage || new IdbStorage());
  window.app = app;  // pratique pour le dépannage et les tests
  await app.init();
  const shell = new Shell(app, root);
  app.renderHook = () => shell.schedule();
  app.statusHook = (t) => shell.setStatus(t);
  const orient = initOrientation(() => shell.schedule());  // mise en page et verrouillage d'orientation
  const login = (message = "") => { closeAll(); showLogin(app, root, () => shell.show(), message); };
  app.lockHook = () => login("Données verrouillées.");
  onNative({
    back: () => {
      if (overlayCount()) { closeTop(); return; }
      const cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if (cap && cap.minimizeApp) cap.minimizeApp();
    },
    pause: () => app.onPause(),
    resume: () => { app.onResume(); orient.reapply(); },
  });
  login();
  if ("serviceWorker" in navigator && !isNative() && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
}

start();
