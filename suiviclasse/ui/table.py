"""Tableau d'une classe : colonnes configurables, en-têtes fixes, colonnes redimensionnables,
textes qui passent à la ligne, valeurs modifiables en cliquant dessus."""
import tkinter as tk
from tkinter import font as tkfont
from tkinter import messagebox, ttk

from .. import columns, exchange, model
from ..prefs import COLUMN_MIN
from .theme import P

# Dimensions selon la densité : hauteur de ligne, largeur des boutons d'incrément et du total.
LAYOUTS = {
    "compact": {"row_h": 26, "char": 6, "pad": 11, "min_btn": 17, "total": 34, "gap": 6},
    "normal": {"row_h": 30, "char": 7, "pad": 14, "min_btn": 20, "total": 40, "gap": 8},
}
# Largeur par défaut (compact, normal) de chaque sorte de colonne
WIDTHS = {"numero": (30, 40), "nom": (108, 150), "prenom": (94, 125), "infos": (104, 150), "note": (46, 64), "moy": (48, 54),
          "xnote": (52, 64), "xtext": (150, 200), "xlist": (110, 140), "xcheck": (46, 56), "comment": (280, 340), "fiche": (34, 40)}
FICHE_ICON = "📝"  # en bout de ligne : ouvre la fiche de l'élève
COUNTER_KINDS = ("seance", "counter")


class Col:
    """Spécification d'une colonne : clé (stable, sert à mémoriser sa largeur), type, titre, pictogramme, réglages."""

    def __init__(self, key, kind, title, icon="", cfg=None, event=None, per_period=False):
        self.key, self.kind, self.title, self.icon, self.cfg = key, kind, title, icon, cfg or {}
        self.event = event or key          # type d'entrée du journal (colonnes à compteur)
        self.per_period = per_period       # le titre porte la période affichée : « (T1) »

    @property
    def increments(self):
        return self.cfg.get("increments", [])


def build_columns(app):
    """Liste ordonnée des colonnes selon la configuration (données) et la période (trimestres / semestres)."""
    settings, per = app.state["settings"], app.per
    compact = app.values["affichage"] == "compact"
    sc = columns.scale(settings)
    note_suffix = f" /{exchange.fmt_num(sc)}" if not compact else ""
    cols = [Col("numero", "num", "n°"), Col("nom", "nom", "Nom"), Col("prenom", "prenom", "Prénom"),
            Col("infos", "infos", "Infos" if compact else "Infos (PAI…)")]
    cols += [Col(f"note{k}", "note", f"{per['prefix']}{k}{note_suffix}") for k in per["keys"]]
    cols.append(Col("moy", "moy", "Moy."))
    for key in columns.BUILTIN_ORDER:
        cfg = columns.builtin(settings, key, short=compact)
        if cfg["visible"]:
            kind = "seance" if key.startswith("seance") else "counter"
            cols.append(Col(key, kind, cfg["titre"], cfg["emoji"], cfg, event=columns.BUILTIN_EVENT[key], per_period=True))
    for c in (c for c in columns.customs(settings) if c["visible"]):
        kind = {"compteur": "counter", "note": "xnote", "texte": "xtext", "liste": "xlist", "coche": "xcheck"}[c["type"]]
        cols.append(Col(c["id"], kind, c["titre"], c["emoji"], c, per_period=True))
    cols += [Col("comm", "comment", "Commentaire"), Col("fiche", "fiche", "")]
    return cols


def wrapped_lines(text, font, width):
    """Nombre de lignes qu'occupe `text` dans `width` pixels (retour à la ligne entre les mots, comme Tk)."""
    space, total = font.measure(" "), 0
    for paragraph in text.split("\n"):
        lines, used = 1, 0
        for word in paragraph.split(" "):
            w = font.measure(word)
            if used == 0:
                used = w
            elif used + space + w <= width:
                used += space + w
            else:
                lines, used = lines + 1, w
            if w > width:  # mot plus long que la colonne : Tk le coupe
                lines, used = lines + w // width, w % width
        total += lines
    return total


def parse_grade(text, maxi=20):
    """'' -> None ; '14,5' -> 14.5 ; texte invalide ou hors de 0..maxi -> ValueError."""
    text = text.strip()
    if not text:
        return None
    v = float(text.replace(",", "."))
    if not 0 <= v <= maxi:
        raise ValueError
    return v


class ClassTable(ttk.Frame):
    def __init__(self, parent, app, cls):
        super().__init__(parent)
        self.app, self.cls = app, cls
        self.rows = []
        self.mode = app.values["affichage"] if app.values["affichage"] in LAYOUTS else "compact"
        self.layout = LAYOUTS[self.mode]
        self.row_h = self.layout["row_h"]
        self.per = app.per
        self.scale = columns.scale(app.state["settings"])
        self.cols = build_columns(app)
        self._init_fonts()
        self.defaults = [self.default_width(c) for c in self.cols]
        saved = app.prefs.widths(self.mode)  # largeurs réglées à la souris, par clé de colonne
        self.widths = [saved.get(c.key, d) for c, d in zip(self.cols, self.defaults)]
        self.index = {c.key: i for i, c in enumerate(self.cols)}
        self.total_w = sum(self.widths)
        self.head_h = self.row_h
        self._drag = None
        self.guide = tk.Frame(self, width=2, bg=P["accent"])  # repère affiché pendant le redimensionnement d'une colonne
        self.hdr = tk.Canvas(self, height=self.row_h, highlightthickness=0, bg=P["surface2"])
        self.body = tk.Canvas(self, highlightthickness=0, bg=P["surface"])
        self.vsb = ttk.Scrollbar(self, orient="vertical", command=self.body.yview)
        self.hsb = ttk.Scrollbar(self, orient="horizontal", command=self._xview)
        self.body.configure(yscrollcommand=self.vsb.set, xscrollcommand=self._xset)
        self.hdr.grid(row=0, column=0, sticky="ew")
        self.body.grid(row=1, column=0, sticky="nsew")
        self.vsb.grid(row=1, column=1, sticky="ns")
        self.hsb.grid(row=2, column=0, sticky="ew")
        self.rowconfigure(1, weight=1)
        self.columnconfigure(0, weight=1)
        self.hf = tk.Frame(self.hdr, bg=P["surface2"])
        self.bf = tk.Frame(self.body, bg=P["surface"])
        self.hdr.create_window(0, 0, window=self.hf, anchor="nw")
        self.body.create_window(0, 0, window=self.bf, anchor="nw")
        self.bf.bind("<Configure>", lambda e: self.body.configure(scrollregion=(0, 0, self.total_w, self.bf.winfo_reqheight())))
        self.body.bind("<Enter>", lambda e: self._bind_wheel(True))
        self.body.bind("<Leave>", lambda e: self._bind_wheel(False))
        self.build()

    def _init_fonts(self):
        base = tkfont.nametofont("TkDefaultFont")
        size = base.actual("size")
        size = size + 1 if size < 0 else size - 1  # un point de moins que la police par défaut
        self.font, self.bold = (base.actual("family"), size), (base.actual("family"), size, "bold")
        self.measure = tkfont.Font(font=self.font)
        self.head_font = tkfont.Font(family=self.font[0], size=self.font[1] - 1, weight="bold")
        self.icon_font = tkfont.Font(family="Segoe UI Emoji" if "Segoe UI Emoji" in tkfont.families() else self.font[0], size=self.font[1] + 4)
        self.linespace = self.measure.metrics("linespace")

    # ---------- dimensions ----------
    def button_width(self, label):
        lay = self.layout
        return max(lay["min_btn"], lay["char"] * len(label) + lay["pad"])

    def counter_labels(self, col):
        symbolic = col.key in ("travail", "oubli")
        return [(v, columns.increment_label(v, symbolic)) for v in col.increments]

    def default_width(self, col):
        """Largeur par défaut : celle de la sorte de colonne, mais assez pour que le plus long mot du titre ne soit pas coupé."""
        i = 0 if self.mode == "compact" else 1
        if col.kind == "note":
            width = WIDTHS["note"][i]
        elif col.kind in COUNTER_KINDS:
            labels = [lab for _, lab in self.counter_labels(col)]
            width = sum(self.button_width(x) for x in labels) + self.layout["total"] + self.layout["gap"] + 2 * len(labels)
        else:
            width = WIDTHS[{"num": "numero"}.get(col.kind, col.kind)][i]
        if col.kind == "xlist":  # assez large pour le plus long choix, flèche du menu comprise
            width = max(width, max((self.measure.measure(c) for c in col.cfg.get("choix", [])), default=0) + 44)
        title = col.title + (f" ({self.per['prefix']}{self.app.t})" if col.per_period else "")
        whole = self.head_font.measure(title.upper()) + 16
        longest = max((self.head_font.measure(w) for w in title.upper().split()), default=0) + 16
        # titre court : tenir sur une ligne ; titre long : au moins son plus long mot (le reste passe à la ligne)
        return max(width, whole if whole <= 130 else min(longest, 220))

    def cell(self, parent, row, col, bg=None):
        """Case de largeur fixe : garantit l'alignement des en-têtes avec les lignes."""
        f = tk.Frame(parent, width=self.widths[col], height=self.row_h, bg=bg or P["surface"], highlightthickness=0)
        f.grid(row=row, column=col)
        f.pack_propagate(False)
        return f

    # ---------- défilement ----------
    def _xview(self, *args):
        self.body.xview(*args)
        self.hdr.xview(*args)

    def _xset(self, lo, hi):
        self.hsb.set(lo, hi)
        self.hdr.xview_moveto(lo)

    def _bind_wheel(self, on):
        root = self.winfo_toplevel()
        for ev in ("<MouseWheel>", "<Button-4>", "<Button-5>"):
            if on:
                root.bind_all(ev, self._wheel)
            else:
                root.unbind_all(ev)

    def _wheel(self, e):
        delta = -1 if (e.num == 4 or e.delta > 0) else 1
        self.body.yview_scroll(delta * 2, "units")

    # ---------- construction ----------
    def build(self):
        y = self.body.yview()[0]
        for w in self.hf.winfo_children() + self.bf.winfo_children():
            w.destroy()
        self.rows = []
        t, pre = self.app.t, self.per["prefix"]
        self.total_w = sum(self.widths)
        heads = []
        head_font = self.head_font
        icons = self.app.values["pictogrammes"] == "oui"
        for i, col in enumerate(self.cols):
            title = col.title + (f" ({pre}{t})" if col.per_period else f" {pre}{t}" if col.kind == "comment" else "")
            c = self.cell(self.hf, 0, i, P["surface2"])
            text = title.upper()
            fits = head_font.measure(text) <= self.widths[i] - 12
            if icons and col.icon:  # le pictogramme est placé au-dessus du titre
                tk.Label(c, text=col.icon, bg=P["surface2"], fg=P["text"], font=self.icon_font).pack(side="top", pady=(3, 0))
            lab = tk.Label(c, text=text, bg=P["surface2"], fg=P["muted"], font=head_font, justify="center", anchor="center",
                           wraplength=0 if fits else max(10, self.widths[i] - 10))  # titre centré, à la ligne s'il est trop long
            lab.pack(fill="both", expand=True, padx=2)
            if col.kind != "fiche":
                self._add_handle(c, i)
            heads.append(c)
        # hauteur de l'en-tête : celle du titre le plus haut (pictogramme + titre sur plusieurs lignes)
        self.head_h = max(self.row_h, max(sum(w.winfo_reqheight() for w in c.winfo_children() if isinstance(w, tk.Label)) for c in heads) + 8)
        for c in heads:
            c.configure(height=self.head_h)
        self.hdr.configure(height=self.head_h, scrollregion=(0, 0, self.total_w, self.head_h))
        q = exchange.norm(self.app.search.get())
        r = 0
        for s in self.cls["eleves"]:
            if q and q not in exchange.norm(f"{s['nom']} {s['prenom']} {s['infos']}"):
                continue
            self.rows.append(Row(self, s, r))
            r += 1
        if not self.rows:
            msg = "Aucun élève ne correspond à la recherche." if self.cls["eleves"] else "Aucun élève. Utilisez « Importer / ajouter des élèves… »."
            tk.Label(self.bf, text=msg, bg=P["surface"], fg=P["muted"], pady=30).grid(row=0, column=0, columnspan=len(self.cols), sticky="w", padx=20)
            r = 1
        self.footer = [self.cell(self.bf, r, i, P["surface2"]) for i in range(len(self.cols))]
        tk.Label(self.footer[self.index["nom"]], text="Moy. classe" if self.mode == "compact" else "Moyenne de la classe",
                 bg=P["surface2"], fg=P["text"], font=self.bold).pack(side="left", padx=4)
        self.footer_labels = {}
        for col in self.cols:
            if col.kind in ("note", "xnote"):
                lab = tk.Label(self.footer[self.index[col.key]], bg=P["surface2"], fg=P["text"], font=self.bold)
                lab.pack(expand=True)
                self.footer_labels[col.key] = lab
        self.refresh_footer()
        self.update_idletasks()
        self.body.yview_moveto(y)

    # ---------- redimensionnement des colonnes ----------
    def _add_handle(self, cell, i):
        """Poignée sur le bord droit d'un titre : glisser pour élargir/rétrécir, double-clic pour la largeur par défaut."""
        handle = tk.Frame(cell, width=6, bg=P["surface2"], cursor="sb_h_double_arrow")
        handle.place(relx=1.0, x=-6, y=0, relheight=1.0)
        line = tk.Frame(handle, width=1, bg=P["border"])
        line.place(relx=1.0, x=-1, rely=0.2, relheight=0.6)
        for w in (handle, line):
            w.bind("<ButtonPress-1>", lambda e, i=i: self._drag_start(i, e))
            w.bind("<B1-Motion>", self._drag_move)
            w.bind("<ButtonRelease-1>", self._drag_end)
            w.bind("<Double-Button-1>", lambda e, i=i: self.reset_width(i))
        handle.bind("<Enter>", lambda e: handle.configure(bg=P["border"]))
        handle.bind("<Leave>", lambda e: handle.configure(bg=P["surface2"]))

    def _drag_start(self, i, e):
        self._drag = {"i": i, "x0": e.x_root, "w0": self.widths[i], "w": self.widths[i]}

    def _drag_move(self, e):
        d = self._drag
        if not d:
            return
        d["w"] = max(COLUMN_MIN, d["w0"] + e.x_root - d["x0"])
        x = sum(self.widths[:d["i"]]) + d["w"] - self.hdr.canvasx(0) + self.hdr.winfo_x()
        self.guide.place(x=x, y=0, relheight=1.0)
        self.guide.lift()

    def _drag_end(self, e):
        d, self._drag = self._drag, None
        self.guide.place_forget()
        if d and d["w"] != self.widths[d["i"]]:
            self.set_width(d["i"], d["w"])

    def set_width(self, i, width):
        if width != self.widths[i]:
            self.widths[i] = width
            self.app.prefs.set_width(self.mode, self.cols[i].key, width)
            self.build()

    def reset_width(self, i):
        self.widths[i] = self.defaults[i]
        self.app.prefs.forget_width(self.mode, self.cols[i].key)
        self.build()

    # ---------- mises à jour ----------
    def refresh_numbers(self):
        """Repeint les n° (ceux en double dans la classe sont surlignés en rouge)."""
        dups = model.duplicate_numbers(self.cls)
        for row in self.rows:
            row.paint_number(dups)

    def refresh_footer(self):
        t = str(self.app.t)
        for col in self.cols:
            lab = self.footer_labels.get(col.key)
            if lab is None:
                continue
            if col.kind == "note":
                vals = [s["notes"][col.key[4:]] for s in self.cls["eleves"] if s["notes"][col.key[4:]] is not None]
            else:
                vals = [v for v in (model.extra_value(s, col.cfg, t) for s in self.cls["eleves"]) if v is not None]
            lab.configure(text=exchange.fmt_num(sum(vals) / len(vals)) if vals else "")

    def refresh_student(self, student):
        for row in self.rows:
            if row.s is student:
                row.refresh()


class Row:
    """Une ligne du tableau. Elle garde ses widgets pour mettre à jour compteurs et couleurs sans tout reconstruire.
    Chaque valeur se modifie en cliquant dessus (Entrée ou clic ailleurs valide, Échap annule)."""

    def __init__(self, table, s, r):
        self.table, self.s, self.app = table, s, table.app
        self.font, self.bold = table.font, table.bold
        self.bg = P["surface"] if r % 2 == 0 else P["zebra"]  # lignes alternées
        self.cells, self.height = [], table.row_h
        self.note_vars, self.xvars, self.seance, self.counters, self.checks = {}, {}, [], {}, {}
        self.texts = []  # zones de texte à hauteur variable : (colonne, widget)
        self.comm = None
        for i, col in enumerate(table.cols):
            parent = self._cell(r, i)
            getattr(self, "_build_" + col.kind)(col, parent, i)
        self.refresh()
        for col, box in self.texts:
            self.color_text(col, box)
        self.paint_number(model.duplicate_numbers(table.cls))

    def _cell(self, r, i):
        c = self.table.cell(self.table.bf, r, i, self.bg)
        self.cells.append(c)
        return c

    def _editable(self, widget, command):
        """Clic sur la valeur (ou sur sa case) = modification sur place."""
        widget.configure(cursor="xterm")
        widget.bind("<Button-1>", lambda e: command())
        widget.master.bind("<Button-1>", lambda e: command())

    # ---------- construction des cases, selon le type de colonne ----------
    def _build_num(self, col, parent, i):
        self.num = tk.Label(parent, fg=P["muted"], bg=self.bg, font=self.font)
        self.num.pack(fill="both", expand=True)
        self._editable(self.num, self.edit_number)

    def _build_nom(self, col, parent, i):
        self.name = tk.Label(parent, text=self.s["nom"], font=self.bold, anchor="w", justify="left",
                             wraplength=max(10, self.table.widths[i] - 10), bg=self.bg, fg=P["text"])
        self.name.pack(fill="both", expand=True, padx=4)
        self._editable(self.name, lambda: self.edit_text(self.name, "nom"))

    def _build_prenom(self, col, parent, i):
        self.prenom = tk.Label(parent, text=self.s["prenom"], anchor="w", justify="left",
                               wraplength=max(10, self.table.widths[i] - 10), bg=self.bg, fg=P["text"], font=self.font)
        self.prenom.pack(fill="both", expand=True, padx=4)
        self._editable(self.prenom, lambda: self.edit_text(self.prenom, "prenom"))

    def _build_infos(self, col, parent, i):
        f = self.font
        self.infos = tk.Label(parent, anchor="w", justify="left", wraplength=max(10, self.table.widths[i] - 10),
                              font=(f[0], f[1] - 1), bg=self.bg, fg=P["text"])
        self.infos.pack(fill="x", expand=True, padx=3, pady=3)
        self._editable(self.infos, self.edit_infos)

    def _entry(self, parent, var, commit):
        e = ttk.Entry(parent, textvariable=var, justify="center", font=self.font, style="Cell.TEntry")
        e.pack(fill="x", expand=True, padx=2, pady=2)
        e.bind("<FocusOut>", lambda ev: commit())
        e.bind("<Return>", lambda ev: commit())
        return e

    def _build_note(self, col, parent, i):
        k = col.key[4:]
        v = self.s["notes"][k]
        var = tk.StringVar(value="" if v is None else exchange.fmt_num(v))
        self._entry(parent, var, lambda k=k: self.commit_note(k))
        self.note_vars[k] = var

    def _build_moy(self, col, parent, i):
        self.moy = tk.Label(parent, bg=self.bg, fg=P["text"], font=self.font)  # calculée : pas modifiable
        self.moy.pack(fill="both", expand=True)

    def _button(self, parent, text, command, side):
        ttk.Button(parent, text=text, style="Mini.TButton", command=command).pack(side=side, padx=1, pady=2)

    def _counter_cell(self, col, parent, total_label):
        """Boutons d'incrément : les négatifs à gauche du total, les positifs à droite (si tous du même signe : à gauche)."""
        incs = self.table.counter_labels(col)
        neg = [x for x in incs if x[0] < 0]
        pos = [x for x in incs if x[0] > 0]
        mixed = bool(neg and pos)
        for v, label in sorted(neg, key=lambda x: x[0]) if mixed else sorted(incs, key=lambda x: abs(x[0])):
            self._button(parent, label, lambda v=v: self.add(col.event, v), "left")
        if mixed:
            for v, label in sorted(pos, key=lambda x: -x[0]):
                self._button(parent, label, lambda v=v: self.add(col.event, v), "right")
        total_label.pack(side="left", fill="both", expand=True, padx=(2, 1), pady=2)

    def _build_seance(self, col, parent, i):
        total = tk.Label(parent, font=self.bold, fg=P["text"])
        self._counter_cell(col, parent, total)
        bucket = "plus" if col.key == "seancePlus" else "moins"
        self._editable(total, lambda total=total, bucket=bucket: self.edit_seance(total, bucket))
        self.seance.append(total)
        self.counters[col.key] = (parent, total)

    def _build_counter(self, col, parent, i):
        total = tk.Label(parent, font=self.bold, fg=P["text"])
        self._counter_cell(col, parent, total)
        self._editable(total, lambda total=total, col=col: self.edit_count(total, col.key))
        self.counters[col.key] = (parent, total)

    def _build_xnote(self, col, parent, i):
        v = model.extra_value(self.s, col.cfg, self.app.t)
        var = tk.StringVar(value="" if v is None else exchange.fmt_num(v))
        self._entry(parent, var, lambda col=col: self.commit_xnote(col))
        self.xvars[col.key] = var

    def _text_box(self, col, parent, text, commit):
        """Zone de texte qui passe à la ligne ; la ligne du tableau grandit avec elle."""
        box = tk.Text(parent, font=self.font, wrap="word", height=1, padx=3, pady=2)
        box.pack(fill="both", expand=True, padx=2, pady=2)
        box.insert("1.0", text)
        box.bind("<KeyRelease>", lambda e: (self.color_text(col, box), self.fit()))
        box.bind("<FocusOut>", lambda e: commit())
        box.bind("<Return>", lambda e: (commit(), "break")[1])  # une saisie tient sur un paragraphe
        box.bind("<Tab>", lambda e: (e.widget.tk_focusNext().focus_set(), "break")[1])
        self.texts.append((col, box))
        return box

    def _build_comment(self, col, parent, i):
        self.comm = self._text_box(col, parent, self.s["comms"][str(self.app.t)], self.commit_comment)

    def _build_xtext(self, col, parent, i):
        self._text_box(col, parent, model.extra_value(self.s, col.cfg, self.app.t) or "", lambda col=col: self.commit_xtext(col))

    def _build_xlist(self, col, parent, i):
        """Menu déroulant : une valeur parmi les choix définis dans la configuration de la colonne."""
        var = tk.StringVar(value=model.extra_value(self.s, col.cfg, self.app.t) or "")
        box = ttk.Combobox(parent, state="readonly", textvariable=var, values=[""] + list(col.cfg.get("choix", [])), font=self.font)
        box.pack(fill="x", expand=True, padx=2, pady=2)
        box.bind("<<ComboboxSelected>>", lambda e, col=col: (self.commit_xlist(col), box.selection_clear()))
        # la molette fait défiler le tableau (au lieu de changer, sans le vouloir, le choix du menu survolé)
        for ev in ("<MouseWheel>", "<Button-4>", "<Button-5>"):
            box.bind(ev, lambda e: (self.table._wheel(e), "break")[1])
        self.xvars[col.key] = var

    def _build_xcheck(self, col, parent, i):
        lab = tk.Label(parent, bg=self.bg, fg=P["text"], font=(self.font[0], self.font[1] + 3), cursor="hand2")
        lab.pack(fill="both", expand=True)
        lab.bind("<Button-1>", lambda e, col=col: self.toggle_check(col))
        self.checks[col.key] = lab

    def _build_fiche(self, col, parent, i):
        """En bout de ligne : un pictogramme (clic) qui ouvre la fiche de l'élève."""
        if self.app.values["pictogrammes"] == "oui":
            icon = tk.Label(parent, text=FICHE_ICON, bg=self.bg, fg=P["text"], cursor="hand2", font=self.table.icon_font)
            icon.pack(fill="both", expand=True)
            icon.bind("<Button-1>", lambda e: self.open())
            icon.bind("<Enter>", lambda e: icon.configure(bg=P["hover"]))
            icon.bind("<Leave>", lambda e: icon.configure(bg=self.bg))
        else:
            ttk.Button(parent, text="Fiche", style="Mini.TButton", command=self.open).pack(expand=True)

    # ---------- affichage ----------
    def color(self, level):
        """Couleur de fond d'un compteur selon son niveau d'alerte ('ok', 'warn', 'bad' ou '' = couleur de la ligne)."""
        return P[level] if level else self.bg

    def paint_number(self, dups):
        n = self.s.get("numero")
        dup = n in dups
        self.num.configure(text="" if n is None else str(n), bg=P["bad"] if dup else self.bg,
                           fg=P["bad_text"] if dup else P["muted"], font=(self.font[0], self.font[1], "bold") if dup else self.font)
        self.num.master.configure(bg=P["bad"] if dup else self.bg)

    def fit(self):
        """Hauteur de la ligne : celle du contenu le plus haut (noms, infos ou zones de texte à la ligne)."""
        tb = self.table
        need = tb.row_h
        for widget in (self.name, self.prenom, self.infos):
            need = max(need, widget.winfo_reqheight() + 6)
        for col, box in self.texts:
            width = tb.widths[tb.index[col.key]]
            need = max(need, wrapped_lines(box.get("1.0", "end-1c"), tb.measure, max(10, width - 18)) * tb.linespace + 12)
        if need != self.height:
            self.height = need
            for c in self.cells:
                c.configure(height=need)

    def refresh(self):
        s, t, v = self.s, self.app.t, self.app.values
        infos = " · ".join(x.strip() for x in s["infos"].splitlines() if x.strip())
        self.infos.configure(text=infos, bg=P["bad"] if infos else self.bg, fg=P["text"])
        self.infos.master.configure(bg=self.bg)
        m = model.moyenne(s, self.table.per["n"])
        self.moy.configure(text="" if m is None else exchange.fmt_num(m))
        plus, moins = model.seance(s, t)
        for col in self.table.cols:
            if col.kind == "seance":
                if col.key == "seancePlus":
                    value, level = plus, "ok" if plus >= v["seancePlusVert"] else ""
                else:
                    value, level = moins, "bad" if moins <= -v["seanceMoinsRouge"] else "warn" if moins < 0 else ""
                self._paint_counter(col, value, level)
            elif col.kind == "counter":
                n = model.total(s, col.event, t)
                if col.key in ("travail", "oubli"):
                    level = model.level(n, v[col.key + "Orange"], v[col.key + "Rouge"])
                else:  # colonne personnalisée : alerte seulement si des seuils ont été définis
                    orange, rouge = col.cfg.get("orange"), col.cfg.get("rouge")
                    level = model.level(n, orange or float("inf"), rouge or float("inf")) if (orange or rouge) else ""
                self._paint_counter(col, n, level)
            elif col.kind == "xcheck":
                done = bool(model.extra_value(s, col.cfg, t))
                self.checks[col.key].configure(text="☑" if done else "☐", bg=P["ok"] if done else self.bg)
        self.fit()

    def _paint_counter(self, col, value, level):
        cell, label = self.counters[col.key]
        color = self.color(level)
        cell.configure(bg=color)
        label.configure(text=exchange.fmt_num(value), bg=color)

    def color_text(self, col, box):
        if col.kind != "comment":
            return
        n, mx = len(box.get("1.0", "end-1c")), self.app.values["appreciationMax"]
        box.configure(bg=P["bad"] if n > mx else P["surface"], fg=P["bad_text"] if n > mx else P["text"])

    # ---------- modification sur place ----------
    def _inline(self, widget, text, commit, multiline=False):
        """Remplace la valeur affichée par un champ de saisie ; Entrée ou clic ailleurs valide, Échap annule."""
        cell = widget.master
        if getattr(cell, "_editing", False):
            return
        cell._editing = True
        if multiline:
            box = tk.Text(cell, font=self.font, wrap="word", height=1, padx=3, pady=2)
            box.insert("1.0", text)
            get = lambda: box.get("1.0", "end-1c")
        else:
            box = tk.Entry(cell, font=self.font, justify="left")
            box.insert(0, text)
            box.select_range(0, "end")
            get = box.get
        box.place(x=1, y=1, relwidth=1.0, width=-2, relheight=1.0, height=-2)
        box.focus_set()
        state = {"done": False}

        def finish(save):
            if state["done"]:
                return
            state["done"] = True
            value = get()
            cell._editing = False
            box.destroy()
            if save:
                commit(value)

        box.bind("<Return>", lambda e: (finish(True), "break")[1])
        box.bind("<Escape>", lambda e: (finish(False), "break")[1])
        box.bind("<FocusOut>", lambda e: finish(True))
        if multiline:
            box.bind("<Shift-Return>", lambda e: None)  # Maj+Entrée : retour à la ligne dans les infos

    def _warn(self, message):
        messagebox.showwarning("Valeur invalide", message, parent=self.app.root)

    def edit_text(self, widget, key):
        def commit(value):
            value = " ".join(value.split())
            if key == "nom" and not value:
                return self._warn("Le nom ne peut pas être vide.")
            if value != self.s[key]:
                self.s[key] = value
                model.sort_students(self.table.cls)
                self.app.commit()
                self.app.close_student_window()
                self.table.after_idle(self.table.build)  # l'ordre alphabétique peut changer
        self._inline(widget, self.s[key], commit)

    def edit_infos(self):
        def commit(value):
            value = value.strip()
            if value != self.s["infos"]:
                self.s["infos"] = value
                self.after_change()
        self._inline(self.infos, self.s["infos"], commit, multiline=True)

    def edit_number(self):
        def commit(value):
            try:
                n = int(value.strip())
                if n < 0:
                    raise ValueError
            except ValueError:
                return self._warn("Le n° doit être un nombre entier positif.")
            if n == self.s.get("numero"):
                return
            others = [e for e in self.table.cls["eleves"] if e is not self.s and e.get("numero") == n]
            if others:
                who = ", ".join(f"{e['nom']} {e['prenom']}" for e in others)
                if not messagebox.askyesno("N° déjà attribué", f"Le n° {n} est déjà attribué dans cette classe à : {who}.\n\n"
                                           "Garder ce doublon ? (les n° en double sont surlignés en rouge)", icon="warning", default="no", parent=self.app.root):
                    return
            self.s["numero"] = n
            self.app.commit()
            self.table.refresh_numbers()
        self._inline(self.num, str(self.s.get("numero") or ""), commit)

    def edit_seance(self, label, bucket):
        def commit(value):
            try:
                target = abs(float(value.strip().replace(",", ".")))
            except ValueError:
                return self._warn("Entrez un nombre (par exemple 2,5).")
            model.set_seance_total(self.s, self.app.t, bucket, target)
            self.after_change()
        plus, moins = model.seance(self.s, self.app.t)
        self._inline(label, exchange.fmt_num(plus if bucket == "plus" else abs(moins)), commit)

    def edit_count(self, label, key):
        col = self.table.cols[self.table.index[key]]

        def commit(value):
            try:
                target = float(value.strip().replace(",", "."))
                if target < 0 and key in ("travail", "oubli"):
                    raise ValueError
            except ValueError:
                return self._warn("Entrez un nombre positif ou nul." if key in ("travail", "oubli") else "Entrez un nombre (par exemple 2,5).")
            model.set_total(self.s, col.event, self.app.t, target)
            self.after_change()
        self._inline(label, exchange.fmt_num(model.total(self.s, col.event, self.app.t)), commit)

    # ---------- actions ----------
    def open(self):
        from .dialogs import StudentWindow
        StudentWindow(self.app, self.table.cls, self.s)

    def add(self, event, value):
        model.add_event(self.s, event, self.app.t, value)
        self.after_change()

    def after_change(self):
        self.app.commit()
        self.refresh()
        self._refresh_window()

    def _refresh_window(self):
        w = self.app.student_window
        if w is not None and w.winfo_exists() and w.s is self.s:
            w.refresh()

    def commit_note(self, k):
        var, old = self.note_vars[k], self.s["notes"][k]
        sc = self.table.scale
        try:
            value = parse_grade(var.get(), sc)
        except ValueError:
            messagebox.showwarning("Note invalide", f"Entrez un nombre entre 0 et {exchange.fmt_num(sc)}.", parent=self.app.root)
            var.set("" if old is None else exchange.fmt_num(old))
            return
        if value != old:
            self.s["notes"][k] = value
            self.app.commit()
            m = model.moyenne(self.s, self.table.per["n"])
            self.moy.configure(text="" if m is None else exchange.fmt_num(m))
            self.table.refresh_footer()
            self._refresh_window()
        var.set("" if value is None else exchange.fmt_num(value))

    def commit_xnote(self, col):
        var, old = self.xvars[col.key], model.extra_value(self.s, col.cfg, self.app.t)
        maxi = col.cfg.get("echelle", 10)
        try:
            value = parse_grade(var.get(), maxi)
        except ValueError:
            messagebox.showwarning("Note invalide", f"Entrez un nombre entre 0 et {exchange.fmt_num(maxi)}.", parent=self.app.root)
            var.set("" if old is None else exchange.fmt_num(old))
            return
        if value != old:
            model.set_extra(self.s, col.key, self.app.t, value)
            self.app.commit()
            self.table.refresh_footer()
        var.set("" if value is None else exchange.fmt_num(value))

    def commit_comment(self):
        text, t = " ".join(self.comm.get("1.0", "end-1c").split()), str(self.app.t)
        if text != self.s["comms"][t]:
            self.s["comms"][t] = text
            self.app.commit()

    def commit_xlist(self, col):
        value = self.xvars[col.key].get() or None
        if value != model.extra_value(self.s, col.cfg, self.app.t):
            model.set_extra(self.s, col.key, self.app.t, value)
            self.app.commit()
            self._refresh_window()

    def commit_xtext(self, col):
        box = next(b for c, b in self.texts if c is col)
        text = " ".join(box.get("1.0", "end-1c").split())
        if text != (model.extra_value(self.s, col.cfg, self.app.t) or ""):
            model.set_extra(self.s, col.key, self.app.t, text)
            self.app.commit()

    def toggle_check(self, col):
        model.set_extra(self.s, col.key, self.app.t, None if model.extra_value(self.s, col.cfg, self.app.t) else True)
        self.after_change()
