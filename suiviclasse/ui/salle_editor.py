"""Plans de salle : liste des salles et éditeur graphique (places, repères, générateurs, alignement)."""
import copy
import tkinter as tk
from tkinter import messagebox, simpledialog, ttk

from .. import plan as P
from . import dialogs
from .plan_view import draw_marker
from .theme import P as PAL

EDIT_ZOOM = 0.6  # zoom initial de l'éditeur : une salle entière tient dans la fenêtre


class SallesDialog(dialogs.Dialog):
    """Liste des salles de l'établissement : nouvelle, modifier, dupliquer, renommer, supprimer."""

    def __init__(self, app, view=None):
        super().__init__(app, "Plans de salle", size="520x420")
        ttk.Label(self, style="Muted.TLabel", wraplength=480, padding=(12, 10), text=(
            "Une salle est un plan générique (les places, le tableau, le bureau…). Elle sert ensuite à répartir les élèves de n'importe quelle classe.")).pack(anchor="w")
        mid = ttk.Frame(self, padding=(12, 0))
        mid.pack(fill="both", expand=True)
        self.lst = tk.Listbox(mid, activestyle="none", exportselection=False, bg=PAL["surface"], fg=PAL["text"],
                              selectbackground=PAL["accent"], selectforeground=PAL["accent_fg"], highlightthickness=1)
        self.lst.pack(side="left", fill="both", expand=True)
        self.lst.bind("<Double-Button-1>", lambda e: self.edit())
        btns = ttk.Frame(mid)
        btns.pack(side="left", fill="y", padx=(10, 0))
        for text, cmd in (("Nouvelle salle…", self.new), ("Modifier…", self.edit), ("Dupliquer", self.duplicate), ("Renommer", self.rename), ("Supprimer", self.delete)):
            ttk.Button(btns, text=text, command=cmd).pack(fill="x", pady=2)
        self.err = ttk.Label(self, style="Error.TLabel", padding=(12, 4), wraplength=480)
        self.err.pack(anchor="w")
        self.buttons(("Fermer", self.destroy, "right"))
        self.refresh()

    @property
    def salles(self):
        return self.app.state.setdefault("salles", [])

    def refresh(self, select=None):
        self.lst.delete(0, "end")
        for s in self.salles:
            self.lst.insert("end", f"{s['nom']}  —  {len(s['places'])} places")
        if select is not None and 0 <= select < len(self.salles):
            self.lst.selection_set(select)

    def current(self):
        sel = self.lst.curselection()
        if not sel:
            self.err.configure(text="Sélectionnez d'abord une salle dans la liste.")
            return None
        self.err.configure(text="")
        return sel[0]

    def done(self, select=None):
        self.app.commit()
        self.refresh(select)
        v = self.app.plan_view  # toujours la vue actuelle : un annuler/rétablir peut l'avoir reconstruite
        if v is not None and v.winfo_exists():
            v.build()

    def new(self):
        name = dialogs.ask_text(self, "Nouvelle salle", "Nom de la salle (ex. Salle 12)", "Nouvelle salle")
        if name:
            def save(salle):
                self.salles.append(salle)
                self.done(len(self.salles) - 1)
            SalleEditor(self.app, self, P.new_salle(name), save, first=True)

    def edit(self):
        i = self.current()
        if i is None:
            return

        def save(salle):
            self.salles[i].clear()
            self.salles[i].update(salle)
            self.done(i)
        SalleEditor(self.app, self, copy.deepcopy(self.salles[i]), save)

    def duplicate(self):
        i = self.current()
        if i is not None:
            self.salles.append(P.copy_salle(self.salles[i], self.salles[i]["nom"] + " (copie)"))
            self.done(len(self.salles) - 1)

    def rename(self):
        i = self.current()
        if i is not None:
            name = dialogs.ask_text(self, "Renommer la salle", "Nouveau nom", self.salles[i]["nom"])
            if name:
                self.salles[i]["nom"] = name
                self.done(i)

    def delete(self):
        i = self.current()
        if i is None:
            return
        s = self.salles[i]
        used = [c["nom"] for c in self.app.state["classes"] for p in c.get("plans") or [] if p.get("salle") == s["id"]]
        extra = f"\n\nElle sert à {len(used)} répartition(s) ({', '.join(sorted(set(used)))}) : elles devront choisir une autre salle." if used else ""
        if messagebox.askyesno("Supprimer la salle", f"Supprimer la salle « {s['nom']} » ?{extra}", parent=self):
            del self.salles[i]
            self.done()


class GeneratorDialog(dialogs.Dialog):
    """Ajoute des places en rangées, en binômes ou en îlots."""
    KINDS = [("Rangées de places individuelles", "Rangées", "Places par rangée"),
             ("Rangées de binômes (2 places par table)", "Rangées", "Binômes par rangée"),
             ("Îlots de 4 places (2 × 2)", "Îlots en hauteur", "Îlots en largeur"),
             ("Îlots de 6 places (3 × 2)", "Îlots en hauteur", "Îlots en largeur")]

    def __init__(self, app, parent, editor):
        super().__init__(app, "Ajouter des places", parent=parent)
        self.editor = editor
        body = ttk.Frame(self, padding=14)
        body.pack(fill="both", expand=True)
        self.kind = ttk.Combobox(body, state="readonly", width=40, values=[k[0] for k in self.KINDS])
        self.kind.current(0)
        self.kind.grid(row=0, column=0, columnspan=2, sticky="w", pady=(0, 8))
        self.kind.bind("<<ComboboxSelected>>", lambda e: self.labels())
        self.l1, self.l2 = ttk.Label(body), ttk.Label(body)
        self.n1, self.n2 = tk.StringVar(value="4"), tk.StringVar(value="6")
        self.l1.grid(row=1, column=0, sticky="w", pady=3)
        ttk.Spinbox(body, from_=1, to=12, width=5, textvariable=self.n1, justify="center").grid(row=1, column=1, padx=8)
        self.l2.grid(row=2, column=0, sticky="w", pady=3)
        ttk.Spinbox(body, from_=1, to=12, width=5, textvariable=self.n2, justify="center").grid(row=2, column=1, padx=8)
        self.replace = tk.BooleanVar(value=not editor.salle["places"])
        ttk.Checkbutton(body, text="Remplacer les places existantes (sinon, les ajouter en dessous)", variable=self.replace).grid(row=3, column=0, columnspan=2, sticky="w", pady=(10, 0))
        self.err = ttk.Label(body, style="Error.TLabel")
        self.err.grid(row=4, column=0, columnspan=2, sticky="w")
        self.labels()
        self.buttons(("Ajouter", self.ok, "right"), ("Annuler", self.destroy, "right"))

    def labels(self):
        _, a, b = self.KINDS[self.kind.current()]
        self.l1.configure(text=a)
        self.l2.configure(text=b)

    def ok(self):
        try:
            a, b = int(self.n1.get()), int(self.n2.get())
            if not (1 <= a <= 12 and 1 <= b <= 12):
                raise ValueError
        except ValueError:
            self.err.configure(text="Entrez des nombres entre 1 et 12.")
            return
        s = self.editor.salle
        if self.replace.get():
            s["places"].clear()
        y0 = 80 if not s["places"] else max(p["y"] for p in s["places"]) + s["place"]["h"] + 40
        k = self.kind.current()
        if k == 0:
            P.add_rows(s, a, b, y0=y0)
        elif k == 1:
            P.add_rows(s, a, 2 * b, y0=y0, group=2, pair_gap=40)
        elif k == 2:
            P.add_islands(s, a, b, 2, 2, y0=y0)
        else:
            P.add_islands(s, a, b, 3, 2, y0=y0)
        self.destroy()
        self.editor.redraw()


class SalleEditor(dialogs.Dialog):
    """Dessin d'une salle : glisser les places et les repères, sélection multiple (cadre ou Maj+clic), flèches pour ajuster, Suppr."""

    def __init__(self, app, parent, salle, on_save, first=False):
        super().__init__(app, "Éditeur de salle", parent=parent, size="1020x640")
        self.salle, self.on_save = salle, on_save
        self.sel = set()
        self.zoom = EDIT_ZOOM
        self.drag = None
        tb = ttk.Frame(self, padding=(10, 8, 10, 2))
        tb.pack(fill="x")
        ttk.Label(tb, text="Nom", style="Muted.TLabel").pack(side="left")
        self.var_nom = tk.StringVar(value=salle["nom"])
        ttk.Entry(tb, textvariable=self.var_nom, width=22).pack(side="left", padx=(4, 12))
        ttk.Label(tb, text="Place :", style="Muted.TLabel").pack(side="left")
        self.var_w, self.var_h = tk.StringVar(value=str(salle["place"]["w"])), tk.StringVar(value=str(salle["place"]["h"]))
        for var in (self.var_w, self.var_h):
            sp = ttk.Spinbox(tb, from_=60, to=400, increment=10, width=5, textvariable=var, justify="center", command=self.resize_places)
            sp.pack(side="left", padx=(4, 0))
            sp.bind("<Return>", lambda e: self.resize_places())
            sp.bind("<FocusOut>", lambda e: self.resize_places())
            if var is self.var_w:
                ttk.Label(tb, text="×", style="Muted.TLabel").pack(side="left", padx=2)
        ttk.Label(tb, text="px", style="Muted.TLabel").pack(side="left", padx=(2, 12))
        ttk.Label(tb, text="Zoom", style="Muted.TLabel").pack(side="left")
        self.var_zoom = tk.StringVar(value=str(int(EDIT_ZOOM * 100)))
        sp = ttk.Spinbox(tb, from_=30, to=150, increment=10, width=5, textvariable=self.var_zoom, justify="center", command=self.set_zoom)
        sp.pack(side="left", padx=(4, 0))
        sp.bind("<Return>", lambda e: self.set_zoom())
        ttk.Label(tb, text="%", style="Muted.TLabel").pack(side="left", padx=2)
        tb2 = ttk.Frame(self, padding=(10, 2, 10, 2))
        tb2.pack(fill="x")
        ttk.Button(tb2, text="Ajouter une place", command=self.add_place).pack(side="left", padx=(0, 4))
        ttk.Button(tb2, text="Ajouter des rangées / îlots…", command=lambda: GeneratorDialog(app, self, self)).pack(side="left", padx=4)
        mb = ttk.Menubutton(tb2, text="Ajouter un repère ▾")
        menu = tk.Menu(mb, tearoff=0)
        for name in P.MARKERS:
            menu.add_command(label=name, command=lambda n=name: self.add_marker(n))
        menu.add_command(label="Texte libre…", command=lambda: self.add_marker(None))
        mb["menu"] = menu
        mb.pack(side="left", padx=4)
        ab = ttk.Menubutton(tb2, text="Aligner ▾")
        am = tk.Menu(ab, tearoff=0)
        for label, how in (("Aligner à gauche", "left"), ("Aligner en haut", "top"), ("Répartir horizontalement", "hspace"), ("Répartir verticalement", "vspace")):
            am.add_command(label=label, command=lambda h=how: self.align(h))
        ab["menu"] = am
        ab.pack(side="left", padx=4)
        ttk.Button(tb2, text="Supprimer la sélection", style="Danger.TButton", command=self.delete_selection).pack(side="left", padx=4)
        self.info = ttk.Label(tb2, style="Muted.TLabel")
        self.info.pack(side="right")
        tb3 = ttk.Frame(self, padding=(10, 2, 10, 6))
        tb3.pack(fill="x")
        ttk.Label(tb3, text="Repères :", style="Muted.TLabel").pack(side="left", padx=(0, 6))
        ttk.Button(tb3, text="Pivoter de 90°  (R)", command=self.rotate_markers).pack(side="left", padx=(0, 4))
        ttk.Button(tb3, text="Retourner la salle de 180°", command=self.rotate_room).pack(side="left", padx=4)
        ttk.Label(tb3, text="Sélectionnez un repère, puis tirez sur un coin pour le redimensionner.", style="Muted.TLabel").pack(side="left", padx=10)
        # boutons et message d'erreur créés avant la zone de dessin : ils restent visibles même dans une fenêtre basse
        self.buttons(("Enregistrer la salle", self.save, "right"), ("Annuler", self.cancel, "right"))
        self.err = ttk.Label(self, style="Error.TLabel", padding=(10, 2))
        self.err.pack(side="bottom", anchor="w")
        frame = ttk.Frame(self, padding=(10, 0))
        frame.pack(fill="both", expand=True)
        self.canvas = tk.Canvas(frame, bg=PAL["surface"], highlightthickness=1, highlightbackground=PAL["border"])
        vsb = ttk.Scrollbar(frame, orient="vertical", command=self.canvas.yview)
        hsb = ttk.Scrollbar(frame, orient="horizontal", command=self.canvas.xview)
        self.canvas.configure(yscrollcommand=vsb.set, xscrollcommand=hsb.set)
        vsb.pack(side="right", fill="y")
        hsb.pack(side="bottom", fill="x")
        self.canvas.pack(fill="both", expand=True)
        c = self.canvas
        c.bind("<ButtonPress-1>", self.on_press)
        c.bind("<B1-Motion>", self.on_motion)
        c.bind("<ButtonRelease-1>", self.on_release)
        c.bind("<Double-Button-1>", self.on_double)
        for key in ("<Delete>", "<BackSpace>"):
            self.bind(key, lambda e: self.delete_selection())
        for key, dx, dy in (("<Left>", -1, 0), ("<Right>", 1, 0), ("<Up>", 0, -1), ("<Down>", 0, 1)):
            self.bind(key, lambda e, dx=dx, dy=dy: self.nudge(dx, dy, e))
        self.bind("<r>", lambda e: self.rotate_markers() if not isinstance(self.focus_get(), (ttk.Entry, ttk.Spinbox)) else None)
        self.bind("<Control-a>", lambda e: (self.sel.update(i["id"] for i in self.items()), self.redraw()))
        if first:
            self.after(200, lambda: GeneratorDialog(app, self, self))  # une nouvelle salle commence par ses places
        self.redraw()

    # ---------- éléments ----------
    def items(self):
        return self.salle["places"] + self.salle["reperes"]

    def by_id(self, iid):
        return next((i for i in self.items() if i["id"] == iid), None)

    # ---------- dessin ----------
    def redraw(self):
        c, z, s = self.canvas, self.zoom, self.salle
        c.delete("all")
        w, h = s["place"]["w"] * z, s["place"]["h"] * z
        for m in s["reperes"]:
            sel = m["id"] in self.sel
            draw_marker(c, m, z, outline=PAL["accent"] if sel else PAL["border"], width=3 if sel else 1, dash=() if sel else (4, 3),
                        tags=("item", f"i:{m['id']}"))
        for n, pid in enumerate(P.reading_order(s), 1):
            p = self.by_id(pid)
            x, y = p["x"] * z, p["y"] * z
            sel = pid in self.sel
            c.create_rectangle(x, y, x + w, y + h, fill=PAL["bg"] if not sel else PAL["hover"], outline=PAL["accent"] if sel else PAL["muted"],
                               width=3 if sel else 1, tags=("item", f"i:{pid}"))
            c.create_text(x + w / 2, y + h / 2, text=str(n), fill=PAL["muted"], tags=("item", f"i:{pid}"))
        chosen = [m for m in s["reperes"] if m["id"] in self.sel]
        if len(chosen) == 1 and len(self.sel) == 1:  # poignées aux quatre coins du repère sélectionné
            m = chosen[0]
            for corner in P.CORNERS:
                hx = (m["x"] + (m["w"] if "e" in corner else 0)) * z
                hy = (m["y"] + (m["h"] if corner.startswith("s") else 0)) * z
                c.create_rectangle(hx - 5, hy - 5, hx + 5, hy + 5, fill=PAL["accent"], outline=PAL["surface"], tags=("handle", f"h:{corner}:{m['id']}"))
        bw, bh = P.bounds(s)
        c.configure(scrollregion=(0, 0, max(bw, 900) * z, max(bh, 500) * z))
        self.info.configure(text=f"{len(s['places'])} place(s) · {len(self.sel)} sélectionné(s) · glissez pour déplacer, Suppr pour retirer")

    def _handle(self, e):
        """(coin, repère) si le clic tombe sur une poignée de redimensionnement."""
        cx, cy = self.canvas.canvasx(e.x), self.canvas.canvasy(e.y)
        for item in self.canvas.find_overlapping(cx, cy, cx, cy):
            for tag in self.canvas.gettags(item):
                if tag.startswith("h:"):
                    _, corner, iid = tag.split(":")
                    return corner, self.by_id(iid)
        return None

    def _hit(self, e):
        cx, cy = self.canvas.canvasx(e.x), self.canvas.canvasy(e.y)
        for item in reversed(self.canvas.find_overlapping(cx, cy, cx, cy)):
            for tag in self.canvas.gettags(item):
                if tag.startswith("i:"):
                    return tag[2:]
        return None

    # ---------- souris ----------
    def on_press(self, e):
        self.canvas.focus_set()
        self.err.configure(text="")
        cx, cy = self.canvas.canvasx(e.x), self.canvas.canvasy(e.y)
        handle = self._handle(e)
        if handle:
            self.drag = {"mode": "resize", "corner": handle[0], "m": handle[1]}
            return
        hit = self._hit(e)
        shift = bool(e.state & 0x0001)
        if hit is None:
            if not shift:
                self.sel.clear()
            self.drag = {"mode": "band", "x": cx, "y": cy, "base": set(self.sel)}
            self.redraw()
            return
        if shift:
            self.sel ^= {hit}
        elif hit not in self.sel:
            self.sel = {hit}
        self.drag = {"mode": "move", "x": cx, "y": cy, "orig": {i: (self.by_id(i)["x"], self.by_id(i)["y"]) for i in self.sel}}
        self.redraw()

    def on_motion(self, e):
        d = self.drag
        if not d:
            return
        cx, cy = self.canvas.canvasx(e.x), self.canvas.canvasy(e.y)
        if d["mode"] == "resize":
            P.resize_marker(d["m"], d["corner"], cx / self.zoom, cy / self.zoom)
            self.redraw()
        elif d["mode"] == "move":
            dx, dy = (cx - d["x"]) / self.zoom, (cy - d["y"]) / self.zoom
            for iid, (ox, oy) in d["orig"].items():
                it = self.by_id(iid)
                it["x"], it["y"] = max(0, P.snap(ox + dx)), max(0, P.snap(oy + dy))
            self.redraw()
        else:
            self.canvas.delete("band")
            self.canvas.create_rectangle(d["x"], d["y"], cx, cy, outline=PAL["accent"], dash=(3, 3), tags="band")

    def on_release(self, e):
        d, self.drag = self.drag, None
        if d and d["mode"] == "band":
            cx, cy = self.canvas.canvasx(e.x), self.canvas.canvasy(e.y)
            x0, x1, y0, y1 = min(d["x"], cx), max(d["x"], cx), min(d["y"], cy), max(d["y"], cy)
            z, w, h = self.zoom, self.salle["place"]["w"], self.salle["place"]["h"]
            for it in self.items():
                iw, ih = it.get("w", w), it.get("h", h)
                if it["x"] * z < x1 and (it["x"] + iw) * z > x0 and it["y"] * z < y1 and (it["y"] + ih) * z > y0:
                    self.sel.add(it["id"])
            self.redraw()

    def on_double(self, e):
        hit = self._hit(e)
        m = next((m for m in self.salle["reperes"] if m["id"] == hit), None)
        if m:
            text = simpledialog.askstring("Repère", "Texte du repère :", initialvalue=m["texte"], parent=self)
            if text and text.strip():
                m["texte"] = text.strip()
                self.redraw()

    # ---------- actions ----------
    def set_zoom(self):
        try:
            self.zoom = min(150, max(30, int(float(self.var_zoom.get())))) / 100
        except ValueError:
            pass
        self.var_zoom.set(str(int(self.zoom * 100)))
        self.redraw()

    def resize_places(self):
        try:
            w, h = int(self.var_w.get()), int(self.var_h.get())
            if not (60 <= w <= 400 and 60 <= h <= 400):
                raise ValueError
        except ValueError:
            self.var_w.set(str(self.salle["place"]["w"]))
            self.var_h.set(str(self.salle["place"]["h"]))
            return
        self.salle["place"].update(w=w, h=h)
        self.redraw()

    def add_place(self):
        p = P.add_place(self.salle, *P.next_free_spot(self.salle))
        self.sel = {p["id"]}
        self.redraw()

    def add_marker(self, name):
        if name is None:
            name = simpledialog.askstring("Repère", "Texte du repère :", parent=self)
            if not name or not name.strip():
                return
            name = name.strip()
        m = P.add_marker(self.salle, name, 0, 0)
        m["x"], m["y"] = P.next_marker_spot(self.salle, m["w"], m["h"])  # en bas du plan, comme le tableau et le bureau
        self.sel = {m["id"]}
        self.redraw()

    def rotate_markers(self):
        chosen = [m for m in self.salle["reperes"] if m["id"] in self.sel]
        if not chosen:
            self.err.configure(text="Sélectionnez d'abord un repère (porte, tableau…) à pivoter.")
            return
        for m in chosen:
            P.rotate_marker(m)
        self.redraw()

    def rotate_room(self):
        P.rotate_room(self.salle)
        self.redraw()

    def delete_selection(self):
        if not self.sel:
            return
        self.salle["places"] = [p for p in self.salle["places"] if p["id"] not in self.sel]
        self.salle["reperes"] = [m for m in self.salle["reperes"] if m["id"] not in self.sel]
        self.sel.clear()
        self.redraw()

    def nudge(self, dx, dy, e):
        if self.focus_get() is not None and isinstance(self.focus_get(), (ttk.Entry, ttk.Spinbox)):
            return
        step = P.GRID * (5 if e.state & 0x0001 else 1)
        for iid in self.sel:
            it = self.by_id(iid)
            it["x"], it["y"] = max(0, it["x"] + dx * step), max(0, it["y"] + dy * step)
        self.redraw()

    def align(self, how):
        chosen = [self.by_id(i) for i in self.sel if self.by_id(i)]
        if len(chosen) < 2:
            self.err.configure(text="Sélectionnez au moins deux éléments (cadre de sélection ou Maj+clic).")
            return
        P.align(chosen, how)
        self.redraw()

    def save(self):
        name = " ".join(self.var_nom.get().split())
        if not name:
            self.err.configure(text="Donnez un nom à la salle.")
            return
        self.salle["nom"] = name
        self.destroy()
        self.on_save(self.salle)

    def cancel(self):
        self.destroy()
