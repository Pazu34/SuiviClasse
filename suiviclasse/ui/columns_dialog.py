"""Onglet « Colonnes » des préférences : colonnes intégrées et personnalisées, éditeur de colonne,
choix du pictogramme et suggestions prêtes à l'emploi.

L'onglet travaille sur une copie de la configuration ; elle n'est appliquée aux données qu'à « Enregistrer »
(en une seule modification annulable)."""
import copy
import tkinter as tk
from tkinter import font as tkfont
from tkinter import messagebox, ttk

from .. import columns, exchange, model
from .dialogs import Dialog
from .theme import P

TYPE_LABELS = dict(columns.TYPES)


def parse_number(text):
    """« 2,5 » -> 2.5 ; ValueError si ce n'est pas un nombre."""
    return float(str(text).strip().replace(",", "."))


class EmojiPicker(Dialog):
    """Grille de pictogrammes classés par thème, plus une zone pour en saisir un autre."""

    def __init__(self, app, parent, current, on_pick):
        super().__init__(app, "Choisir un pictogramme", parent=parent)
        self.on_pick = on_pick
        font = (tkfont.nametofont("TkDefaultFont").actual("family"), 16)
        body = ttk.Frame(self, padding=10)
        body.pack(fill="both", expand=True)
        for group, items in columns.EMOJIS:
            ttk.Label(body, text=group, style="Bold.TLabel").pack(anchor="w", pady=(6, 2))
            grid = ttk.Frame(body)
            grid.pack(anchor="w")
            for n, e in enumerate(items):
                lab = tk.Label(grid, text=e, font=font, bg=P["accent"] if e == current else P["surface"], fg=P["text"], width=2,
                               cursor="hand2", relief="flat", bd=1, highlightthickness=1, highlightbackground=P["border"])
                lab.grid(row=n // 12, column=n % 12, padx=1, pady=1)
                lab.bind("<Button-1>", lambda ev, e=e: self.pick(e))
                lab.bind("<Enter>", lambda ev, lab=lab: lab.configure(bg=P["hover"]))
                lab.bind("<Leave>", lambda ev, lab=lab, e=e: lab.configure(bg=P["accent"] if e == current else P["surface"]))
        other = ttk.Frame(body)
        other.pack(fill="x", pady=(10, 0))
        ttk.Label(other, text="Autre (saisir ou coller un emoji) :").pack(side="left")
        self.entry = ttk.Entry(other, width=6)
        self.entry.pack(side="left", padx=6)
        ttk.Button(other, text="Utiliser", command=lambda: self.pick(self.entry.get().strip()[:4])).pack(side="left")
        ttk.Button(other, text="Aucun pictogramme", command=lambda: self.pick("")).pack(side="right")

    def pick(self, emoji):
        self.on_pick(emoji)
        self.destroy()


class ColumnEditor(Dialog):
    """Création ou modification d'une colonne. `data` : réglages actuels ; `builtin` : clé d'une colonne intégrée (titre,
    pictogramme et incréments seulement) ; `on_ok(dict)` reçoit le résultat."""

    def __init__(self, app, parent, data, on_ok, builtin=None):
        super().__init__(app, "Modifier la colonne" if data.get("id") or builtin else "Nouvelle colonne", parent=parent)
        self.on_ok, self.builtin, self.data = on_ok, builtin, dict(data)
        self.var_title = tk.StringVar(value=data.get("titre", ""))
        self.emoji = data.get("emoji", "")
        self.var_type = tk.StringVar(value=TYPE_LABELS[data.get("type", "compteur")])
        self.var_incs = tk.StringVar(value=columns.format_increments(data.get("increments", [-1, 1])).replace("+", "+"))
        self.var_scale = tk.StringVar(value=exchange.fmt_num(data.get("echelle", 10)))
        self.var_orange = tk.StringVar(value="" if not data.get("orange") else exchange.fmt_num(data["orange"]))
        self.var_rouge = tk.StringVar(value="" if not data.get("rouge") else exchange.fmt_num(data["rouge"]))
        f = ttk.Frame(self, padding=14)
        f.pack(fill="both", expand=True)
        f.columnconfigure(1, weight=1)
        ttk.Label(f, text="Titre").grid(row=0, column=0, sticky="w", pady=4)
        title = ttk.Entry(f, textvariable=self.var_title, width=34)
        title.grid(row=0, column=1, sticky="ew", padx=8)
        ttk.Label(f, text="Pictogramme").grid(row=1, column=0, sticky="w", pady=4)
        self.btn_emoji = ttk.Button(f, command=self.choose_emoji, width=8)
        self.btn_emoji.grid(row=1, column=1, sticky="w", padx=8)
        ttk.Label(f, text="Type").grid(row=2, column=0, sticky="w", pady=4)
        self.combo = ttk.Combobox(f, state="readonly", width=30, values=[l for _, l in columns.TYPES], textvariable=self.var_type)
        self.combo.grid(row=2, column=1, sticky="w", padx=8)
        self.combo.bind("<<ComboboxSelected>>", lambda e: self.show_fields())
        if builtin:  # une colonne intégrée garde son type ; celui d'une colonne personnalisée peut changer
            self.combo.state(["disabled"])
        self.first_type = data.get("type", "compteur")
        self.hint_type = ttk.Label(f, style="Muted.TLabel", wraplength=440, justify="left", text=(
            "Changer le type conserve les valeurs déjà saisies : elles réapparaissent si elles sont compatibles "
            "(note ↔ texte ↔ menu ↔ case ; un compteur garde son journal)."))
        self.f_incs = ttk.Frame(f)
        ttk.Label(self.f_incs, text="Boutons d'incrément").grid(row=0, column=0, sticky="w")
        ttk.Entry(self.f_incs, textvariable=self.var_incs, width=30).grid(row=0, column=1, padx=8)
        ttk.Label(self.f_incs, style="Muted.TLabel", wraplength=420, justify="left", text=(
            "Une valeur par bouton, séparées par des « ; » ou des espaces. Exemples : « +0,5 ; +2 », « −1 ; +1 », « −2 −1 +1 +2 ». "
            "Les valeurs négatives retirent des points. Jusqu'à 6 boutons.")).grid(row=1, column=0, columnspan=2, sticky="w", pady=(2, 0))
        self.f_choix = ttk.Frame(f)
        ttk.Label(self.f_choix, text="Choix du menu (un par ligne)").grid(row=0, column=0, sticky="w")
        self.txt_choix = tk.Text(self.f_choix, width=34, height=6, wrap="none")
        self.txt_choix.grid(row=1, column=0, sticky="w", pady=2)
        self.txt_choix.insert("1.0", "\n".join(data.get("choix", [])))
        ttk.Label(self.f_choix, style="Muted.TLabel", wraplength=440, justify="left",
                  text="Exemples : Très bien / Bien / À surveiller. Jusqu'à 20 choix. Vous pourrez les modifier plus tard avec « Modifier… ».").grid(row=2, column=0, sticky="w")
        self.f_scale = ttk.Frame(f)
        ttk.Label(self.f_scale, text="Note sur").grid(row=0, column=0, sticky="w")
        ttk.Entry(self.f_scale, textvariable=self.var_scale, width=8, justify="center").grid(row=0, column=1, padx=8)
        ttk.Label(self.f_scale, style="Muted.TLabel", text="(10 pour une note /10, 5 pour /5…)").grid(row=0, column=2)
        self.f_alert = ttk.LabelFrame(f, text="Alertes colorées (facultatif)", padding=8)
        ttk.Label(self.f_alert, text="Orange à partir de").grid(row=0, column=0, sticky="w")
        ttk.Entry(self.f_alert, textvariable=self.var_orange, width=6, justify="center").grid(row=0, column=1, padx=8)
        ttk.Label(self.f_alert, text="Rouge à partir de").grid(row=0, column=2, sticky="w", padx=(12, 0))
        ttk.Entry(self.f_alert, textvariable=self.var_rouge, width=6, justify="center").grid(row=0, column=3, padx=8)
        self.err = ttk.Label(f, style="Error.TLabel", wraplength=440)
        self.err.grid(row=9, column=0, columnspan=2, sticky="w", pady=(6, 0))
        self.frames = (self.f_incs, self.f_scale, self.f_alert, self.f_choix, self.hint_type)
        self.show_fields()
        self.buttons(("OK", self.ok, "right"), ("Annuler", self.destroy, "right"))
        title.focus_set()
        self.bind("<Return>", lambda e: self.ok())

    def current_type(self):
        return next(k for k, l in columns.TYPES if l == self.var_type.get())

    def show_fields(self):
        """N'affiche que les réglages utiles au type de colonne choisi."""
        typ = "compteur" if self.builtin else self.current_type()
        for fr in self.frames:
            fr.grid_forget()
        if typ == "compteur":
            self.f_incs.grid(row=3, column=0, columnspan=2, sticky="ew", pady=(10, 0))
            if not self.builtin:
                self.f_alert.grid(row=4, column=0, columnspan=2, sticky="ew", pady=(10, 0))
        elif typ == "note":
            self.f_scale.grid(row=3, column=0, columnspan=2, sticky="w", pady=(10, 0))
        elif typ == "liste":
            self.f_choix.grid(row=3, column=0, columnspan=2, sticky="w", pady=(10, 0))
        if not self.builtin and self.data.get("id") and typ != self.first_type:  # rappel seulement si le type a été changé
            self.hint_type.grid(row=5, column=0, columnspan=2, sticky="w", pady=(8, 0))
        self.btn_emoji.configure(text=self.emoji or "(aucun)")

    def choose_emoji(self):
        EmojiPicker(self.app, self, self.emoji, self.set_emoji)

    def set_emoji(self, emoji):
        self.emoji = emoji
        self.show_fields()

    def ok(self):
        title = " ".join(self.var_title.get().split())
        if not title:
            self.err.configure(text="Donnez un titre à la colonne.")
            return
        out = {**self.data, "titre": title, "emoji": self.emoji}
        typ = "compteur" if self.builtin else self.current_type()
        out["type"] = typ
        try:
            if typ == "compteur":
                sign = {"seancePlus": 1, "seanceMoins": -1}.get(self.builtin)  # séance + / − : signe imposé
                incs = columns.parse_increments(self.var_incs.get(), sign)
                if not incs:
                    raise ValueError("Saisissez au moins une valeur d'incrément (par exemple « +1 »).")
                out["increments"] = incs
                if not self.builtin:
                    for k, var in (("orange", self.var_orange), ("rouge", self.var_rouge)):
                        text = var.get().strip()
                        if text:
                            v = parse_number(text)
                            if v <= 0:
                                raise ValueError("Les seuils d'alerte doivent être positifs.")
                            out[k] = v
                        else:
                            out.pop(k, None)
                    if out.get("orange") and out.get("rouge") and out["orange"] > out["rouge"]:
                        raise ValueError("Le seuil orange doit être inférieur ou égal au seuil rouge.")
            elif typ == "liste":
                out["choix"] = columns.parse_choices(self.txt_choix.get("1.0", "end"))
                if not out["choix"]:
                    raise ValueError("Saisissez au moins un choix pour le menu (un par ligne).")
            elif typ == "note":
                sc = parse_number(self.var_scale.get())
                if sc <= 0:
                    raise ValueError
                out["echelle"] = sc
        except ValueError as e:
            self.err.configure(text=str(e) or "Valeur numérique invalide.")
            return
        self.destroy()
        self.on_ok(out)


class PresetsDialog(Dialog):
    """Suggestions de colonnes prêtes à l'emploi : cocher pour activer, décocher pour masquer."""

    def __init__(self, app, parent, tab):
        super().__init__(app, "Suggestions de colonnes", parent=parent)
        self.tab = tab
        body = ttk.Frame(self, padding=12)
        body.pack(fill="both", expand=True)
        ttk.Label(body, style="Muted.TLabel", wraplength=520, text=(
            "Cochez les colonnes à ajouter au tableau. Décocher une colonne la masque sans perdre les valeurs déjà saisies.")).pack(anchor="w", pady=(0, 8))
        self.vars = {}
        existing = {c.get("preset"): c for c in tab.customs}
        for p in columns.PRESETS:
            var = tk.BooleanVar(value=p["id"] in existing and existing[p["id"]].get("visible", True))
            self.vars[p["id"]] = var
            row = ttk.Frame(body)
            row.pack(fill="x", pady=1)
            ttk.Checkbutton(row, variable=var, text=f"{p['emoji']}  {p['titre']}").pack(side="left")
            kind = TYPE_LABELS[p["type"]].split(" (")[0]
            extra = (f" — {columns.format_increments(p['increments'])}" if p["type"] == "compteur" else f" — /{exchange.fmt_num(p['echelle'])}"
                     if p["type"] == "note" else f" — {len(p['choix'])} choix" if p["type"] == "liste" else "")
            ttk.Label(row, style="Muted.TLabel", text=f"   {kind}{extra} · {p['description']}").pack(side="left")
        self.buttons(("Appliquer", self.apply, "right"), ("Annuler", self.destroy, "right"))

    def apply(self):
        by_preset = {c.get("preset"): c for c in self.tab.customs}
        for p in columns.PRESETS:
            want, col = self.vars[p["id"]].get(), by_preset.get(p["id"])
            if col is not None:
                col["visible"] = want
            elif want:
                self.tab.customs.append(columns.from_preset(p))
        self.destroy()
        self.tab.refresh()


class ColumnsTab(ttk.Frame):
    """Contenu de l'onglet « Colonnes »."""

    def __init__(self, parent, dialog, app):
        super().__init__(parent, padding=10)
        self.dialog, self.app = dialog, app
        st = app.state["settings"]
        self.orig_scale = columns.scale(st)
        self.orig_note_scales = {c["id"]: c["echelle"] for c in columns.customs(st) if c["type"] == "note"}
        self.var_scale = tk.StringVar(value=exchange.fmt_num(self.orig_scale))
        self.builtin = copy.deepcopy(st.get("builtin") or {})
        self.customs = copy.deepcopy(columns.customs(st))
        top = ttk.Frame(self)
        top.pack(fill="x")
        per = app.per
        ttk.Label(top, text=f"Notes de {per['prefix']}1 à {per['prefix']}{per['n']} sur").pack(side="left")
        ttk.Entry(top, textvariable=self.var_scale, width=6, justify="center").pack(side="left", padx=6)
        ttk.Label(top, style="Muted.TLabel", text="(20 par défaut ; 10 pour des notes /10)").pack(side="left")
        ttk.Label(self, text="Colonnes du tableau", style="Bold.TLabel").pack(anchor="w", pady=(12, 3))
        mid = ttk.Frame(self)
        mid.pack(fill="both", expand=True)
        self.tree = ttk.Treeview(mid, columns=("etat", "emoji", "titre", "type", "detail"), show="headings", height=9, selectmode="browse")
        for col, text, w, anchor in (("etat", "Affichée", 72, "center"), ("emoji", "", 40, "center"), ("titre", "Titre", 170, "w"),
                                     ("type", "Type", 135, "w"), ("detail", "Réglages", 190, "w")):
            self.tree.heading(col, text=text)
            self.tree.column(col, width=w, anchor=anchor, stretch=col == "detail")
        self.tree.pack(side="left", fill="both", expand=True)
        self.tree.bind("<Double-Button-1>", lambda e: self.edit())
        btns = ttk.Frame(mid)
        btns.pack(side="left", fill="y", padx=(10, 0))
        for text, cmd in (("Ajouter une colonne…", self.add), ("Suggestions…", self.presets), ("Modifier…", self.edit),
                          ("Afficher / masquer", self.toggle), ("Monter", lambda: self.move(-1)), ("Descendre", lambda: self.move(1)),
                          ("Supprimer", self.delete)):
            ttk.Button(btns, text=text, command=cmd).pack(fill="x", pady=2)
        self.err = ttk.Label(self, style="Error.TLabel", wraplength=640)
        self.err.pack(anchor="w", pady=(6, 0))
        ttk.Label(self, style="Muted.TLabel", wraplength=640, text=(
            "Les colonnes personnalisées s’affichent après « Oublis » ; « Monter / Descendre » règle leur ordre. Séance +, séance −, travail non fait et "
            "oublis sont toujours disponibles (réglez leurs boutons avec « Modifier… »).")).pack(anchor="w")
        self.refresh()

    # ---------- liste ----------
    def _builtin_cfg(self, key):
        return columns.builtin({"builtin": self.builtin}, key)  # titre complet (la présentation resserrée en utilise une forme courte)

    def refresh(self, select=None):
        self.tree.delete(*self.tree.get_children())
        for key in columns.BUILTIN_ORDER:
            c = self._builtin_cfg(key)
            self.tree.insert("", "end", iid=key, values=("☑" if c["visible"] else "☐", c["emoji"], c["titre"], "Compteur (intégré)",
                                                         columns.format_increments(c["increments"])))
        for c in self.customs:
            detail = (columns.format_increments(c["increments"]) if c["type"] == "compteur" else f"/{exchange.fmt_num(c['echelle'])}" if c["type"] == "note"
                      else " · ".join(c["choix"]) if c["type"] == "liste" else "")
            if c["type"] == "compteur" and (c.get("orange") or c.get("rouge")):
                detail += f"  · alertes : {exchange.fmt_num(c.get('orange', 0)) if c.get('orange') else '–'} / {exchange.fmt_num(c['rouge']) if c.get('rouge') else '–'}"
            self.tree.insert("", "end", iid=c["id"], values=("☑" if c.get("visible", True) else "☐", c["emoji"], c["titre"],
                                                             TYPE_LABELS[c["type"]].split(" (")[0], detail))
        if select and self.tree.exists(select):
            self.tree.selection_set(select)

    def selected(self):
        sel = self.tree.selection()
        if not sel:
            self.err.configure(text="Sélectionnez d'abord une colonne dans la liste.")
            return None
        self.err.configure(text="")
        return sel[0]

    def custom_of(self, iid):
        return next((c for c in self.customs if c["id"] == iid), None)

    # ---------- actions ----------
    def add(self):
        def done(col):
            col["id"] = columns.new_id()
            col["visible"] = True
            self.customs.append(columns.sanitize_column(col))
            self.refresh(col["id"])
        ColumnEditor(self.app, self.dialog, {"type": "compteur", "increments": [-1, 1], "echelle": 10}, done)

    def presets(self):
        PresetsDialog(self.app, self.dialog, self)

    def edit(self):
        iid = self.selected()
        if iid is None:
            return
        if iid in columns.BUILTINS:
            cfg = self._builtin_cfg(iid)

            def done_builtin(out, key=iid):
                base = columns.BUILTINS[key]
                over = {}
                if out["titre"] != base["titre"]:
                    over["titre"] = out["titre"]
                if out["emoji"] != base["emoji"]:
                    over["emoji"] = out["emoji"]
                if out["increments"] != [float(v) for v in base["increments"]]:
                    over["increments"] = out["increments"]
                if not cfg["visible"]:
                    over["visible"] = False
                self.builtin[key] = over
                self.refresh(key)
            ColumnEditor(self.app, self.dialog, cfg, done_builtin, builtin=iid)
        else:
            col = self.custom_of(iid)

            def done_custom(out, col=col):
                col.clear()
                col.update(columns.sanitize_column(out))
                self.refresh(col["id"])
            ColumnEditor(self.app, self.dialog, col, done_custom)

    def toggle(self):
        iid = self.selected()
        if iid is None:
            return
        if iid in columns.BUILTINS:
            over = self.builtin.setdefault(iid, {})
            if over.get("visible", True) is False:
                over.pop("visible", None)
            else:
                over["visible"] = False
        else:
            col = self.custom_of(iid)
            col["visible"] = not col.get("visible", True)
        self.refresh(iid)

    def move(self, step):
        iid = self.selected()
        col = self.custom_of(iid) if iid else None
        if iid and col is None:
            self.err.configure(text="Les colonnes intégrées gardent leur place.")
            return
        if col is None:
            return
        i = self.customs.index(col)
        j = i + step
        if 0 <= j < len(self.customs):
            self.customs[i], self.customs[j] = self.customs[j], self.customs[i]
            self.refresh(iid)

    def delete(self):
        iid = self.selected()
        if iid is None:
            return
        col = self.custom_of(iid)
        if col is None:
            self.err.configure(text="Une colonne intégrée ne se supprime pas : utilisez « Afficher / masquer ».")
            return
        if messagebox.askyesno("Supprimer la colonne", f"Supprimer la colonne « {col['titre']} » ?\n\nLes valeurs déjà saisies restent enregistrées : "
                               "si vous recréez la colonne à partir de la même suggestion, elles réapparaissent. "
                               "Pour simplement la cacher, utilisez « Afficher / masquer ».", parent=self.dialog):
            self.customs.remove(col)
            self.refresh()

    # ---------- application aux données ----------
    def apply(self):
        """Écrit la configuration dans les données. Retourne False si l'onglet contient une erreur (rien n'est alors modifié)."""
        try:
            new_scale = parse_number(self.var_scale.get())
            if new_scale <= 0:
                raise ValueError
        except ValueError:
            self.err.configure(text="Le barème des notes doit être un nombre positif (par exemple 20 ou 10).")
            return False
        app, st = self.app, self.app.state["settings"]
        if abs(new_scale - self.orig_scale) > 1e-9 and any(v is not None for c in app.state["classes"] for s in c["eleves"] for v in s["notes"].values()):
            if messagebox.askyesno("Barème des notes", f"Les notes passent de /{exchange.fmt_num(self.orig_scale)} à /{exchange.fmt_num(new_scale)}.\n\n"
                                   f"Convertir les notes déjà saisies (×{exchange.fmt_num(new_scale / self.orig_scale)}) ?\n"
                                   "Oui : 14 sur 20 devient 7 sur 10. Non : les valeurs restent telles quelles.", parent=self.dialog):
                model.rescale_notes(app.state, self.orig_scale, new_scale)
        for c in self.customs:
            old = self.orig_note_scales.get(c["id"])
            if c["type"] == "note" and old and abs(c["echelle"] - old) > 1e-9 and any(
                    isinstance(v, (int, float)) for k in app.state["classes"] for s in k["eleves"] for v in (s.get("extra") or {}).get(c["id"], {}).values()):
                if messagebox.askyesno("Barème de la colonne", f"« {c['titre']} » passe de /{exchange.fmt_num(old)} à /{exchange.fmt_num(c['echelle'])}.\n\n"
                                       "Convertir les valeurs déjà saisies ?", parent=self.dialog):
                    model.rescale_extra(app.state, c["id"], old, c["echelle"])
        st["echelle"] = new_scale
        st["builtin"] = {k: v for k, v in self.builtin.items() if v}
        st["colonnes"] = copy.deepcopy(self.customs)
        # la configuration est appliquée : un second « Enregistrer » ne doit pas reconvertir les notes
        self.orig_scale = new_scale
        self.orig_note_scales = {c["id"]: c["echelle"] for c in self.customs if c["type"] == "note"}
        return True
