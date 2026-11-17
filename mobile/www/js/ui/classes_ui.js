// Ordre des classes : sur tablette, des flèches remplacent le glisser-déposer des boutons du PC.
import { moveClass } from "../core/model.js";
import { h, modal } from "./dom.js";

export function openClassOrder(app) {
  const list = h("div", { class: "list" });
  const draw = () => {
    list.replaceChildren();
    const classes = app.state.classes;
    if (!classes.length) list.append(h("div", { class: "item muted" }, "Aucune classe."));
    classes.forEach((c, i) => list.append(h("div", { class: "item" }, h("div", { class: "t" }, c.nom, h("small", {}, `${c.eleves.length} élève(s)`)),
      h("button", { class: "btn icon", type: "button", disabled: i === 0, "aria-label": "Monter", onclick: () => { moveClass(app.state, c.id, i - 1); app.commit(); draw(); } }, "↑"),
      h("button", { class: "btn icon", type: "button", disabled: i === classes.length - 1, "aria-label": "Descendre", onclick: () => { moveClass(app.state, c.id, i + 2); app.commit(); draw(); } }, "↓"))));
  };
  draw();
  modal({ title: "Ordre des classes", body: [h("p", { class: "hint" }, "Un import ou l'ajout de la classe Test place les nouvelles classes à la fin sans toucher à votre ordre."), list], actions: [{ label: "Fermer", kind: "primary" }] });
}
