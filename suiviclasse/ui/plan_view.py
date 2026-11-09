"""Vue « Plan de classe » : la salle vue d'en haut, une place (chaise + bureau) par rectangle.

Dans chaque place : le nom de l'élève et une pastille par colonne à compteur (mêmes valeurs, mêmes couleurs d'alerte que le tableau).
 - clic sur une pastille : ajoute son incrément principal ; clic droit : tous les incréments, ou saisie du total ;
 - clic sur le nom : fiche de l'élève ; glisser le nom vers une autre place : déplace ou échange ;
 - glisser un élève de la liste « sans place » vers une place libre (ou l'inverse pour le retirer).
"""
import tkinter as tk
from tkinter import font as tkfont
from tkinter import messagebox, simpledialog, ttk

from .. import columns, exchange, model
from .. import plan as P
from . import dialogs
from .table import COUNTER_KINDS, build_columns, counter_state, grade_state
from .theme import P as PAL

LEVEL_COLORS = {"ok": "ok", "warn": "warn", "bad": "bad"}
DRAG_THRESHOLD = 6


def fit_text(text, font, width):
    """Abrège `text` avec « … » pour qu'il tienne dans `width` pixels."""
    if font.measure(text) <= width:
        return text
    while len(text) > 1 and font.measure(text + "…") > width:
        text = text[:-1]
    return text.rstrip() + "…"


def draw_marker(c, m, z, font=None, fill=None, outline=None, width=1, dash=(4, 3), tags=()):
    """Dessine un repère (rectangle en pointillés + texte, vertical si son angle est de 90°) ; commun à l'éditeur de salle et au plan."""
    x, y, mw, mh = m["x"] * z, m["y"] * z, m["w"] * z, m["h"] * z
    vertical = m.get("angle", 0) == 90
    c.create_rectangle(x, y, x + mw, y + mh, fill=fill or PAL["surface2"], outline=outline or PAL["border"], width=width, dash=dash, tags=tags)
    opts = {"font": font} if font else {}
    c.create_text(x + mw / 2, y + mh / 2, text=m["texte"], fill=PAL["muted"], angle=90 if vertical else 0,
                  width=max(10, (mh if vertical else mw) - 6), tags=tags, **opts)


class PlanView(ttk.Frame):
    def __init__(self, parent, app, cls):
        super().__init__(parent)
        self.app, self.cls = app, cls
        self.drag = None            # glissement en cours : {"student", "origin", "active", "x", "y"}
        self.pending = None         # clic en attente de savoir si c'est un clic ou un glissement
        self._hover = None
        self._build_toolbar()
        body = ttk.Frame(self)
        body.pack(fill="both", expand=True)
        side = ttk.Frame(body, padding=(8, 0, 0, 0))
        side.pack(side="right", fill="y")
        self.lbl_free = ttk.Label(side, style="Bold.TLabel")
        self.lbl_free.pack(anchor="w", pady=(2, 4))
        self.free = tk.Listbox(side, width=24, activestyle="none", exportselection=False, highlightthickness=1,
                               bg=PAL["surface"], fg=PAL["text"], selectbackground=PAL["accent"], selectforeground=PAL["accent_fg"])
        self.free.pack(fill="y", expand=True)
        ttk.Label(side, style="Muted.TLabel", wraplength=170, justify="left",
                  text="Glissez un élève sur une place libre. Glissez un nom de la salle ici pour le retirer de sa place.").pack(anchor="w", pady=6)
        self.canvas = tk.Canvas(body, bg=PAL["surface"], highlightthickness=1, highlightbackground=PAL["border"])
        self.vsb = ttk.Scrollbar(body, orient="vertical", command=self.canvas.yview)
        self.hsb = ttk.Scrollbar(self, orient="horizontal", command=self.canvas.xview)
        self.canvas.configure(yscrollcommand=self.vsb.set, xscrollcommand=self.hsb.set)
        self.vsb.pack(side="right", fill="y")
        self.canvas.pack(side="left", fill="both", expand=True)
        self.hsb.pack(fill="x")
        c = self.canvas
        c.bind("<ButtonPress-1>", self.on_press)
        c.bind("<B1-Motion>", self.on_motion)
        c.bind("<ButtonRelease-1>", self.on_release)
        for ev in ("<Button-3>", "<Button-2>"):
            c.bind(ev, self.on_context)
        c.bind("<Enter>", lambda e: self._bind_wheel(True))
        c.bind("<Leave>", lambda e: self._bind_wheel(False))
        self.free.bind("<ButtonPress-1>", self.on_free_press)
        self.free.bind("<B1-Motion>", self.on_motion)
        self.free.bind("<ButtonRelease-1>", self.on_release)
        self.build()

    # ---------- accès aux données ----------
    @property
    def plan(self):
        return P.active_plan(self.cls)

    @property
    def salle(self):
        p = self.plan
        return P.find(self.app.state.get("salles", []), p["salle"]) if p else None

    @property
    def zoom(self):
        return self.app.state["ui"].get("zoomPlan", 100) / 100

    def student(self, sid):
        return next((s for s in self.cls["eleves"] if s["id"] == sid), None)

    def counter_cols(self):
        """Colonnes qui ont une pastille sur chaque place : compteurs et notes de A à E."""
        return [c for c in build_columns(self.app) if c.kind in COUNTER_KINDS or c.kind == "grade"]

    # ---------- barre d'outils ----------
    def _build_toolbar(self):
        bar = ttk.Frame(self)
        bar.pack(fill="x", pady=(0, 6))
        r1 = ttk.Frame(bar)
        r1.pack(fill="x", pady=2)
        ttk.Label(r1, text="Répartition", style="Muted.TLabel").pack(side="left")
        self.cb_plan = ttk.Combobox(r1, state="readonly", width=22)
        self.cb_plan.pack(side="left", padx=(4, 4))
        self.cb_plan.bind("<<ComboboxSelected>>", lambda e: self.choose_plan())
        for text, cmd in (("Nouvelle", self.new_plan), ("Dupliquer", self.duplicate_plan), ("Renommer", self.rename_plan), ("Supprimer", self.delete_plan)):
            ttk.Button(r1, text=text, command=cmd).pack(side="left", padx=2)
        ttk.Label(r1, text="Salle", style="Muted.TLabel").pack(side="left", padx=(16, 0))
        self.cb_salle = ttk.Combobox(r1, state="readonly", width=22)
        self.cb_salle.pack(side="left", padx=(4, 4))
        self.cb_salle.bind("<<ComboboxSelected>>", lambda e: self.choose_salle())
        ttk.Button(r1, text="Salles…", command=self.open_salles).pack(side="left", padx=2)
        r2 = ttk.Frame(bar)
        r2.pack(fill="x", pady=2)
        ttk.Label(r2, text="Noms affichés", style="Muted.TLabel").pack(side="left")
        self.cb_mode = ttk.Combobox(r2, state="readonly", width=24, values=[l for _, l in P.DISPLAY_MODES])
        self.cb_mode.pack(side="left", padx=(4, 12))
        self.cb_mode.bind("<<ComboboxSelected>>", lambda e: self.choose_mode())
        ttk.Label(r2, text="Zoom", style="Muted.TLabel").pack(side="left")
        self.var_zoom = tk.StringVar(value=str(self.app.state["ui"].get("zoomPlan", 100)))
        sp = ttk.Spinbox(r2, from_=50, to=200, increment=10, width=5, textvariable=self.var_zoom, justify="center", command=self.set_zoom)
        sp.pack(side="left", padx=(4, 0))
        sp.bind("<Return>", lambda e: self.set_zoom())
        sp.bind("<FocusOut>", lambda e: self.set_zoom())
        ttk.Label(r2, text="%", style="Muted.TLabel").pack(side="left", padx=(2, 16))
        ttk.Button(r2, text="Répartir les élèves…", command=self.fill).pack(side="left", padx=2)
        ttk.Button(r2, text="Vider la répartition", command=self.clear).pack(side="left", padx=2)

    def _sync_toolbar(self):
        plans = self.cls.get("plans") or []
        self.cb_plan.configure(values=[p["nom"] for p in plans])
        cur = self.plan
        self.cb_plan.set(cur["nom"] if cur else "")
        salles = self.app.state.get("salles", [])
        self.cb_salle.configure(values=[s["nom"] for s in salles])
        s = self.salle
        self.cb_salle.set(s["nom"] if s else "")
        self.cb_mode.set(dict(P.DISPLAY_MODES)[self.app.values["planAffichage"]])

    # ---------- dessin ----------
    def build(self):
        """Redessine tout (appelé à chaque changement : élève modifié, période, recherche, zoom…)."""
        y0, x0 = self.canvas.yview()[0], self.canvas.xview()[0]
        cur = self.plan
        if cur:
            P.clean(cur, self.salle, self.cls)
        self._sync_toolbar()
        c = self.canvas
        c.delete("all")
        self.seats = {}  # id de place -> rectangle (x0, y0, x1, y1) en coordonnées du canevas
        salle = self.salle
        if salle is None or cur is None:
            self._empty_message(cur)
            self._fill_free_list()
            return
        z = self.zoom
        base = tkfont.nametofont("TkDefaultFont")
        size = max(6, round(9 * z))
        self.f_name = tkfont.Font(family=base.actual("family"), size=size, weight="bold")
        self.f_chip = tkfont.Font(family=base.actual("family"), size=max(6, round(8 * z)))
        icons = self.app.values["pictogrammes"] == "oui"
        cols = self.counter_cols()
        mode = self.app.values["planAffichage"]
        names = P.display_names(self.cls["eleves"], mode)  # abrégés rallongés si deux élèves s'afficheraient pareil
        q = exchange.norm(self.app.search.get())
        t = self.app.t
        w, h = salle["place"]["w"] * z, salle["place"]["h"] * z
        for m in salle["reperes"]:
            draw_marker(c, m, z, font=self.f_chip, tags=("repere",))
        line = self.f_name.metrics("linespace")
        for place in salle["places"]:
            pid = place["id"]
            x, y = place["x"] * z, place["y"] * z
            self.seats[pid] = (x, y, x + w, y + h)
            s = self.student(cur["places"].get(pid))
            dim = bool(q) and (s is None or q not in exchange.norm(f"{s['nom']} {s['prenom']}"))
            if s is None:
                c.create_rectangle(x, y, x + w, y + h, fill=PAL["bg"], outline=PAL["border"], dash=(3, 3), tags=("seat", f"seat:{pid}"))
                c.create_text(x + w / 2, y + h / 2, text="libre", fill=PAL["muted"], font=self.f_chip, tags=("seat", f"seat:{pid}"))
                continue
            c.create_rectangle(x, y, x + w, y + h, fill=PAL["bg"] if dim else PAL["surface"], outline=PAL["border"], width=1,
                               tags=("seat", f"seat:{pid}"))
            name = fit_text(names.get(s["id"]) or P.display_name(s, mode), self.f_name, w - 12)
            c.create_text(x + 6, y + 4, text=name, anchor="nw", fill=PAL["muted"] if dim else PAL["text"], font=self.f_name,
                          tags=("name", f"name:{pid}", f"seat:{pid}"))
            self._draw_chips(pid, s, cols, icons, t, x, y + 6 + line, w, h - 6 - line, dim)
        c.configure(scrollregion=(0, 0, P.bounds(salle)[0] * z, P.bounds(salle)[1] * z))
        c.xview_moveto(x0)
        c.yview_moveto(y0)
        self._fill_free_list()

    def _draw_chips(self, pid, s, cols, icons, t, x, y, w, h, dim):
        c = self.canvas
        ch = self.f_chip.metrics("linespace") + 4
        labels = []
        for col in cols:
            if col.kind == "grade":  # moyenne des notes A à E ; « – » tant que l'élève n'a aucune note (la place est comptée)
                text, level, n = grade_state(self.app, col, s, t)
                title = columns.builtin(self.app.state["settings"], col.key, short=True)["titre"]
                icon = col.icon if icons and col.icon else P.initial_text(title)
                labels.append((col, f"{icon}{text if n else '–'}", level))
                continue
            value, level = counter_state(self.app, col, s, t)
            icon = col.icon if icons and col.icon else P.initial_text(col.title)
            labels.append((col, f"{icon}{exchange.fmt_num(value)}", level))
        cw = max((self.f_chip.measure(txt) for _, txt, _ in labels), default=30) + 10
        per_row = max(1, int((w - 8) // (cw + 3)))
        rows = max(1, int((h - 2) // (ch + 3)))
        capacity = per_row * rows
        shown, more = (labels, []) if len(labels) <= capacity else (labels[:capacity - 1], labels[capacity - 1:])
        items = [("chip", col, txt, level) for col, txt, level in shown] + ([("more", None, "⋯", "")] if more else [])
        for i, (kind, col, txt, level) in enumerate(items):
            cx, cy = x + 5 + (i % per_row) * (cw + 3), y + (i // per_row) * (ch + 3)
            fill = PAL[LEVEL_COLORS[level]] if level else PAL["surface2"]
            tag = f"chip:{pid}:{col.key}" if kind == "chip" else f"more:{pid}"
            c.create_rectangle(cx, cy, cx + cw, cy + ch, fill=PAL["bg"] if dim else fill, outline=PAL["border"], tags=("chip", tag, f"seat:{pid}"))
            c.create_text(cx + cw / 2, cy + ch / 2, text=txt, fill=PAL["muted"] if dim else PAL["text"], font=self.f_chip,
                          tags=("chip", tag, f"seat:{pid}"))

    def _empty_message(self, cur):
        c = self.canvas
        if not self.app.state.get("salles"):
            msg = "Aucune salle n'est définie.\nCliquez sur « Salles… » pour dessiner le plan de votre salle, puis créez une répartition."
        elif cur is None:
            msg = "Cette classe n'a pas encore de répartition.\nCliquez sur « Nouvelle » pour en créer une."
        else:
            msg = "Choisissez une salle pour cette répartition (liste « Salle »)."
        c.create_text(40, 40, text=msg, anchor="nw", fill=PAL["muted"], font=tkfont.nametofont("TkDefaultFont"))
        c.configure(scrollregion=(0, 0, 10, 10))

    def _fill_free_list(self):
        cur = self.plan
        self.free.delete(0, "end")
        self.free_ids = []
        mode = self.app.values["planAffichage"]
        if cur is not None:
            for s in P.without_place(cur, self.cls):
                self.free.insert("end", P.list_name(s))
                self.free_ids.append(s["id"])
        self.lbl_free.configure(text=f"Sans place ({len(self.free_ids)})")

    # ---------- molette ----------
    def _bind_wheel(self, on):
        root = self.winfo_toplevel()
        for ev in ("<MouseWheel>", "<Button-4>", "<Button-5>"):
            if on:
                root.bind_all(ev, self._wheel)
            else:
                root.unbind_all(ev)

    def _wheel(self, e):
        self.canvas.yview_scroll((-1 if (e.num == 4 or e.delta > 0) else 1) * 2, "units")

    # ---------- repérage sous le pointeur ----------
    def _canvas_xy(self, e):
        return self.canvas.canvasx(e.x_root - self.canvas.winfo_rootx()), self.canvas.canvasy(e.y_root - self.canvas.winfo_rooty())

    def _seat_at(self, cx, cy):
        for pid, (x0, y0, x1, y1) in self.seats.items():
            if x0 <= cx <= x1 and y0 <= cy <= y1:
                return pid
        return None

    def _over_free_list(self, e):
        f = self.free
        return f.winfo_rootx() <= e.x_root <= f.winfo_rootx() + f.winfo_width() and f.winfo_rooty() <= e.y_root <= f.winfo_rooty() + f.winfo_height()

    def _hit(self, e):
        """Ce qui est cliqué : ('chip', place, clé de colonne) | ('more', place) | ('name', place) | ('seat', place) | None."""
        cx, cy = self.canvas.canvasx(e.x), self.canvas.canvasy(e.y)
        for item in reversed(self.canvas.find_overlapping(cx, cy, cx, cy)):
            for tag in self.canvas.gettags(item):
                if tag.startswith("chip:"):
                    _, pid, key = tag.split(":", 2)
                    return ("chip", pid, key)
                if tag.startswith("more:"):
                    return ("more", tag.split(":", 1)[1])
                if tag.startswith("name:"):
                    return ("name", tag.split(":", 1)[1])
                if tag.startswith("seat:"):
                    return ("seat", tag.split(":", 1)[1])
        return None

    # ---------- clics et glissements ----------
    def on_press(self, e):
        hit = self._hit(e)
        self.pending, self.drag = hit, None
        cur = self.plan
        if hit and cur and hit[0] in ("name", "seat") and cur["places"].get(hit[1]):
            self.drag = {"student": cur["places"][hit[1]], "origin": hit[1], "active": False, "x": e.x_root, "y": e.y_root}

    def on_free_press(self, e):
        i = self.free.nearest(e.y)
        if 0 <= i < len(self.free_ids):
            self.free.selection_clear(0, "end")
            self.free.selection_set(i)
            self.pending = None
            self.drag = {"student": self.free_ids[i], "origin": None, "active": False, "x": e.x_root, "y": e.y_root}

    def on_motion(self, e):
        d = self.drag
        if not d:
            return
        if not d["active"] and abs(e.x_root - d["x"]) + abs(e.y_root - d["y"]) > DRAG_THRESHOLD:
            d["active"] = True
            self.canvas.configure(cursor="fleur")
            self.free.configure(cursor="fleur")
        if d["active"]:
            self._show_drag(e)

    def _show_drag(self, e):
        c = self.canvas
        cx, cy = self._canvas_xy(e)
        target = None if self._over_free_list(e) else self._seat_at(cx, cy)
        if target != self._hover:
            self._clear_hover()
            if target:
                for item in c.find_withtag(f"seat:{target}"):
                    if c.type(item) == "rectangle" and "chip" not in c.gettags(item):
                        c.itemconfigure(item, outline=PAL["accent"], width=3)
            self._hover = target
        c.delete("ghost")
        s = self.student(self.drag["student"])
        if s and not self._over_free_list(e):
            text = P.display_names(self.cls["eleves"], self.app.values["planAffichage"]).get(s["id"], "")
            tid = c.create_text(cx + 14, cy + 10, text=text, anchor="nw", font=self.f_name, fill=PAL["accent_fg"], tags="ghost")
            x0, y0, x1, y1 = c.bbox(tid)
            r = c.create_rectangle(x0 - 4, y0 - 2, x1 + 4, y1 + 2, fill=PAL["accent"], outline="", tags="ghost")
            c.tag_lower(r, tid)

    def _clear_hover(self):
        if self._hover and self._hover in self.seats:
            for item in self.canvas.find_withtag(f"seat:{self._hover}"):
                if self.canvas.type(item) == "rectangle" and "chip" not in self.canvas.gettags(item):
                    self.canvas.itemconfigure(item, outline=PAL["border"], width=1)
        self._hover = None

    def on_release(self, e):
        d, hit = self.drag, self.pending
        self.drag = self.pending = None
        self.canvas.configure(cursor="")
        self.free.configure(cursor="")
        self.canvas.delete("ghost")
        self._clear_hover()
        cur = self.plan
        if cur is None:
            return
        if d and d["active"]:
            cx, cy = self._canvas_xy(e)
            if self._over_free_list(e):
                if d["origin"] is not None:
                    P.unassign(cur, d["student"])
                    self.changed()
            else:
                target = self._seat_at(cx, cy)
                if target and target != d["origin"]:
                    P.assign(cur, target, d["student"])
                    self.changed()
            return
        if not hit:
            return
        if hit[0] == "chip":
            col = self.col_by_key(hit[2])
            if col is not None and col.kind == "grade":  # une note de A à E se choisit dans un menu
                menu = tk.Menu(self, tearoff=0)
                self._counter_menu(menu, hit[1], col)
                menu.tk_popup(e.x_root, e.y_root)
            else:
                self.add_increment(hit[1], hit[2])
        elif hit[0] == "more":
            self.popup_more(hit[1], e)
        elif hit[0] == "name":
            s = self.student(cur["places"].get(hit[1]))
            if s:
                dialogs.StudentWindow(self.app, self.cls, s)

    # ---------- actions sur les pastilles ----------
    def col_by_key(self, key):
        return next((c for c in self.counter_cols() if c.key == key), None)

    def add_increment(self, pid, key, value=None):
        col, s = self.col_by_key(key), self.student(self.plan["places"].get(pid))
        if col is None or s is None:
            return
        model.add_event(s, col.event, self.app.t, P.primary_increment(col.increments) if value is None else value)
        self.after_student_change(s)

    def after_student_change(self, s):
        self.app.commit()
        self.build()
        w = self.app.student_window
        if w is not None and w.winfo_exists() and w.s is s:
            w.refresh()

    def add_grade(self, pid, key, letter):
        col, s = self.col_by_key(key), self.student(self.plan["places"].get(pid))
        if col is None or s is None:
            return
        model.add_event(s, col.event, self.app.t, model.grade_value(letter))
        self.after_student_change(s)

    def remove_last_grade(self, pid, key):
        col, s = self.col_by_key(key), self.student(self.plan["places"].get(pid))
        if col is None or s is None:
            return
        model.remove_last(s, col.event, self.app.t)
        self.after_student_change(s)

    def _grade_menu(self, menu, pid, col):
        """Notes de A à E à attribuer, moyenne actuelle, annulation de la dernière note."""
        s = self.student(self.plan["places"].get(pid))
        for letter in model.GRADES:
            menu.add_command(label=f"{col.title} : {letter} — {model.GRADE_NAMES[letter]}", command=lambda l=letter: self.add_grade(pid, col.key, l))
        if s is not None:
            text, _, n = grade_state(self.app, col, s, self.app.t)
            menu.add_separator()
            menu.add_command(label=f"Moyenne : {text}" + (f" ({n} note{'s' if n > 1 else ''})" if n else ""), state="disabled")
            if n:
                last = model.grade_events(s, col.event, self.app.t)[-1]
                menu.add_command(label=f"Annuler la dernière note ({model.grade_letter(last['v'])})", command=lambda: self.remove_last_grade(pid, col.key))

    def _counter_menu(self, menu, pid, col):
        if col.kind == "grade":
            return self._grade_menu(menu, pid, col)
        for v in col.increments:
            menu.add_command(label=f"{col.title} {columns.increment_label(v)}", command=lambda v=v: self.add_increment(pid, col.key, v))
        menu.add_command(label=f"{col.title} : saisir le total…", command=lambda: self.type_total(pid, col))

    def type_total(self, pid, col):
        s = self.student(self.plan["places"].get(pid))
        t = self.app.t
        if s is None:
            return
        value, _ = counter_state(self.app, col, s, t)
        text = simpledialog.askstring(col.title, f"Total de « {col.title} » pour {s['prenom']} {s['nom']} :", initialvalue=exchange.fmt_num(value),
                                      parent=self.app.root)
        if text is None:
            return
        try:
            target = float(text.strip().replace(",", "."))
        except ValueError:
            messagebox.showwarning("Valeur invalide", "Entrez un nombre (par exemple 2,5).", parent=self.app.root)
            return
        if col.kind == "seance":
            model.set_seance_total(s, t, "plus" if col.key == "seancePlus" else "moins", abs(target))
        else:
            model.set_total(s, col.event, t, target)
        self.after_student_change(s)

    def popup_more(self, pid, e):
        menu = tk.Menu(self, tearoff=0)
        for col in self.counter_cols():
            sub = tk.Menu(menu, tearoff=0)
            self._counter_menu(sub, pid, col)
            menu.add_cascade(label=f"{col.icon} {col.title}".strip(), menu=sub)
        menu.tk_popup(e.x_root, e.y_root)

    def on_context(self, e):
        hit, cur = self._hit(e), self.plan
        if hit is None or cur is None:
            return
        menu = tk.Menu(self, tearoff=0)
        pid = hit[1]
        s = self.student(cur["places"].get(pid))
        if hit[0] == "chip" and s:
            self._counter_menu(menu, pid, self.col_by_key(hit[2]))
        elif s:
            menu.add_command(label="Ouvrir la fiche", command=lambda: dialogs.StudentWindow(self.app, self.cls, s))
            menu.add_command(label="Retirer de sa place", command=lambda: (P.unassign(cur, s["id"]), self.changed()))
        else:
            free = P.without_place(cur, self.cls)
            if not free:
                menu.add_command(label="Tous les élèves ont une place", state="disabled")
            sub = tk.Menu(menu, tearoff=0)
            for st in free:
                sub.add_command(label=P.list_name(st), command=lambda st=st: (P.assign(cur, pid, st["id"]), self.changed()))
            if free:
                menu.add_cascade(label="Placer un élève ici", menu=sub)
        menu.tk_popup(e.x_root, e.y_root)

    # ---------- répartitions ----------
    def changed(self):
        self.app.commit()
        self.build()

    def choose_plan(self):
        plans = self.cls.get("plans") or []
        i = self.cb_plan.current()
        if 0 <= i < len(plans):
            self.cls["plan_actif"] = plans[i]["id"]
            self.app.commit()
            self.build()

    def new_plan(self, copy_from=None):
        salles = self.app.state.get("salles", [])
        cur = self.plan
        name = dialogs.ask_text(self.app.root, "Nouvelle répartition", "Nom de la répartition (ex. Plan T2)",
                                f"{copy_from['nom']} (copie)" if copy_from else f"Plan {len(self.cls.get('plans') or []) + 1}")
        if not name:
            return
        p = P.new_plan(name, (cur or {}).get("salle") or (salles[0]["id"] if salles else None))
        if copy_from:
            p["salle"], p["places"] = copy_from["salle"], dict(copy_from["places"])
        P.plans(self.cls).append(p)
        self.cls["plan_actif"] = p["id"]
        self.changed()

    def duplicate_plan(self):
        if self.plan:
            self.new_plan(copy_from=self.plan)

    def rename_plan(self):
        cur = self.plan
        if cur:
            name = dialogs.ask_text(self.app.root, "Renommer la répartition", "Nouveau nom", cur["nom"])
            if name:
                cur["nom"] = name
                self.changed()

    def delete_plan(self):
        cur = self.plan
        if cur and messagebox.askyesno("Supprimer la répartition", f"Supprimer la répartition « {cur['nom']} » ?\n\n"
                                       "(Annuler la suppression reste possible avec le bouton « Annuler ».)", parent=self.app.root):
            self.cls["plans"] = [p for p in self.cls["plans"] if p is not cur]
            self.cls["plan_actif"] = self.cls["plans"][0]["id"] if self.cls["plans"] else None
            self.changed()

    def choose_salle(self):
        salles, cur = self.app.state.get("salles", []), self.plan
        i = self.cb_salle.current()
        if cur is None or not (0 <= i < len(salles)) or salles[i]["id"] == cur["salle"]:
            return
        ids = {p["id"] for p in salles[i]["places"]}
        lost = [p for p in cur["places"] if p not in ids]
        if lost and not messagebox.askyesno("Changer de salle", f"{len(lost)} élève(s) n'auront plus de place dans la nouvelle salle (leurs places n'y existent pas).\n\n"
                                            "Changer quand même de salle ?", parent=self.app.root):
            self._sync_toolbar()
            return
        cur["salle"] = salles[i]["id"]
        self.changed()

    def choose_mode(self):
        i = self.cb_mode.current()
        if i >= 0:
            self.app.prefs.set({"planAffichage": P.DISPLAY_MODES[i][0]})
            self.build()

    def set_zoom(self):
        try:
            z = min(200, max(50, int(float(self.var_zoom.get()))))
        except ValueError:
            z = self.app.state["ui"].get("zoomPlan", 100)
        self.var_zoom.set(str(z))
        if z != self.app.state["ui"].get("zoomPlan", 100):
            self.app.state["ui"]["zoomPlan"] = z
            self.build()

    def fill(self):
        cur = self.plan
        if cur is None or self.salle is None:
            messagebox.showinfo("Répartir les élèves", "Créez d'abord une répartition et choisissez une salle.", parent=self.app.root)
            return
        FillDialog(self.app, self)

    def clear(self):
        cur = self.plan
        if cur and cur["places"] and messagebox.askyesno("Vider la répartition", "Retirer tous les élèves de leur place ?", parent=self.app.root):
            cur["places"].clear()
            self.changed()

    def open_salles(self):
        from .salle_editor import SallesDialog
        SallesDialog(self.app)

    # ---------- compatibilité avec le tableau (appelé par la fiche élève, etc.) ----------
    def refresh_student(self, student):
        self.build()

    def refresh_footer(self):
        pass

    def refresh_numbers(self):
        pass


class FillDialog(dialogs.Dialog):
    def __init__(self, app, view):
        super().__init__(app, "Répartir les élèves")
        self.view = view
        body = ttk.Frame(self, padding=14)
        body.pack(fill="both", expand=True)
        self.mode = tk.StringVar(value="alpha")
        ttk.Radiobutton(body, text="Dans l'ordre alphabétique (rangée par rangée, de gauche à droite)", value="alpha", variable=self.mode).pack(anchor="w", pady=2)
        ttk.Radiobutton(body, text="Au hasard", value="hasard", variable=self.mode).pack(anchor="w", pady=2)
        self.keep = tk.BooleanVar(value=True)
        ttk.Checkbutton(body, text="Garder les élèves déjà placés (ne répartir que les autres)", variable=self.keep).pack(anchor="w", pady=(10, 2))
        self.buttons(("Répartir", self.ok, "right"), ("Annuler", self.destroy, "right"))

    def ok(self):
        v = self.app.plan_view if self.app.plan_view is not None and self.app.plan_view.winfo_exists() else self.view
        left = P.auto_fill(v.plan, v.salle, v.cls, self.mode.get(), self.keep.get())
        self.destroy()
        v.changed()
        if left:
            messagebox.showinfo("Répartir les élèves", f"{left} élève(s) n'ont pas de place : la salle n'a pas assez de places.", parent=self.app.root)
