"""Tableau d'une classe : une ligne par élève, en-têtes fixes, colonnes redimensionnables, textes qui passent à la ligne."""
import tkinter as tk
from tkinter import font as tkfont
from tkinter import messagebox, ttk

from .. import exchange, model
from ..prefs import COLUMN_MIN
from .theme import P

# Largeurs des colonnes en pixels, dans l'ordre : n°, nom, prénom, infos, T1, T2, T3, moyenne,
# séance +, séance −, travail non fait, oubli de matériel, commentaire, accès à la fiche (pictogramme).
LAYOUTS = {
    "compact": {"row_h": 26, "widths": [30, 108, 94, 104, 46, 46, 46, 48, 112, 112, 68, 68, 280, 34]},
    "normal": {"row_h": 30, "widths": [40, 150, 125, 150, 64, 64, 64, 54, 140, 140, 96, 96, 340, 40]},
}
TITLES = {
    "compact": ["n°", "Nom", "Prénom", "Infos", "T1", "T2", "T3", "Moy.", "Séance +", "Séance −", "Travail", "Oublis", "Commentaire", ""],
    "normal": ["n°", "Nom", "Prénom", "Infos (PAI…)", "T1 /20", "T2 /20", "T3 /20", "Moy.", "Séance +", "Séance −",
               "Travail non fait", "Oubli matériel", "Commentaire", ""],
}
# Pictogrammes des colonnes à compteur (indice de colonne -> pictogramme)
NOTE_COL = 4  # indice de la colonne de la note de la 1re période
ICONS = {8: "👍", 9: "👎", 10: "📝", 11: "🎒"}
FICHE_ICON = "📝"  # en bout de ligne : ouvre la fiche de l'élève


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


def parse_grade(text):
    """'' -> None ; '14,5' -> 14.5 ; texte invalide -> ValueError."""
    text = text.strip()
    if not text:
        return None
    v = float(text.replace(",", "."))
    if not 0 <= v <= 20:
        raise ValueError
    return v


class ClassTable(ttk.Frame):
    def __init__(self, parent, app, cls):
        super().__init__(parent)
        self.app, self.cls = app, cls
        self.rows = []
        self.mode = app.values["affichage"] if app.values["affichage"] in LAYOUTS else "compact"
        layout = LAYOUTS[self.mode]
        self.default_widths, self.row_h = layout["widths"], layout["row_h"]
        self.widths = app.prefs.columns(self.mode, self.default_widths)  # largeurs réglées à la souris, sinon défaut
        self.per = app.per
        # colonnes masquées : la note de la 3e période n'existe pas en semestres (ses données restent conservées)
        self.hidden = {NOTE_COL + 2} if self.per["n"] < 3 else set()
        self.total_w = self.visible_width()
        self.head_h = self.row_h
        self._drag = None
        base = tkfont.nametofont("TkDefaultFont")
        size = base.actual("size")
        size = size + 1 if size < 0 else size - 1  # un point de moins que la police par défaut
        self.font, self.bold = (base.actual("family"), size), (base.actual("family"), size, "bold")
        self.measure = tkfont.Font(font=self.font)
        self.icon_font = tkfont.Font(family="Segoe UI Emoji" if "Segoe UI Emoji" in tkfont.families() else self.font[0], size=self.font[1] + 4)
        self.linespace = self.measure.metrics("linespace")
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
        self.hdr.configure(scrollregion=(0, 0, self.total_w, self.row_h))
        self.body.bind("<Enter>", lambda e: self._bind_wheel(True))
        self.body.bind("<Leave>", lambda e: self._bind_wheel(False))
        self.build()

    def visible_width(self, upto=None):
        """Largeur des colonnes visibles (jusqu'à la colonne `upto` exclue)."""
        cols = range(len(self.widths) if upto is None else upto)
        return sum(self.widths[i] for i in cols if i not in self.hidden)

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
        t = self.app.t
        titles = list(TITLES[self.mode])
        pre = self.per["prefix"]
        for k in range(1, 4):  # « T1 /20 » ou « S1 /20 »
            titles[NOTE_COL + k - 1] = titles[NOTE_COL + k - 1].replace("T", pre, 1)
        for i in range(8, 12):
            titles[i] += f" ({pre}{t})"
        titles[12] += f" {pre}{t}"
        self.total_w = self.visible_width()
        heads, labels = [], []
        icon_font = self.icon_font
        head_font = tkfont.Font(family=self.font[0], size=self.font[1] - 1, weight="bold")
        icons = self.app.values["pictogrammes"] == "oui"
        for i, title in enumerate(titles):
            if i in self.hidden:
                heads.append(None)
                continue
            c = self.cell(self.hf, 0, i, P["surface2"])
            text = title.upper()
            fits = head_font.measure(text) <= self.widths[i] - 12
            if icons and i in ICONS:  # le pictogramme est placé au-dessus du titre
                tk.Label(c, text=ICONS[i], bg=P["surface2"], fg=P["text"], font=icon_font).pack(side="top", pady=(3, 0))
            lab = tk.Label(c, text=text, bg=P["surface2"], fg=P["muted"], font=head_font, justify="center", anchor="center",
                           wraplength=0 if fits else max(10, self.widths[i] - 10))  # titre centré, à la ligne s'il est trop long
            lab.pack(fill="both", expand=True, padx=2)
            if i < len(titles) - 1:
                self._add_handle(c, i)
            heads.append(c)
            labels.append(lab)
        # hauteur de l'en-tête : celle du titre le plus haut (pictogramme + titre sur plusieurs lignes)
        heads = [c for c in heads if c is not None]
        self.head_h = max(self.row_h, max(sum(w.winfo_reqheight() for w in c.winfo_children() if isinstance(w, tk.Label)) for c in heads) + 8)
        for c in heads:
            c.configure(height=self.head_h)
        self.hdr.configure(height=self.head_h, scrollregion=(0, 0, self.total_w, self.head_h))
        q = exchange.norm(self.app.search.get())
        r = 0
        for i, s in enumerate(self.cls["eleves"]):
            if q and q not in exchange.norm(f"{s['nom']} {s['prenom']} {s['infos']}"):
                continue
            self.rows.append(Row(self, s, r))
            r += 1
        if not self.rows:
            msg = "Aucun élève ne correspond à la recherche." if self.cls["eleves"] else "Aucun élève. Utilisez « Importer / ajouter des élèves… »."
            tk.Label(self.bf, text=msg, bg=P["surface"], fg=P["muted"], pady=30).grid(row=0, column=0, columnspan=len(self.widths), sticky="w", padx=20)
            r = 1
        self.footer = [None if i in self.hidden else self.cell(self.bf, r, i, P["surface2"]) for i in range(len(self.widths))]
        tk.Label(self.footer[1], text="Moy. classe" if self.mode == "compact" else "Moyenne de la classe", bg=P["surface2"], fg=P["text"], font=self.bold).pack(side="left", padx=4)
        self.footer_labels = [tk.Label(self.footer[NOTE_COL + k], bg=P["surface2"], fg=P["text"], font=self.bold) for k in range(self.per["n"])]
        for lab in self.footer_labels:
            lab.pack(expand=True)
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
            w.bind("<Double-Button-1>", lambda e, i=i: self.set_width(i, self.default_widths[i]))
        handle.bind("<Enter>", lambda e: handle.configure(bg=P["border"]))
        handle.bind("<Leave>", lambda e: handle.configure(bg=P["surface2"]))

    def _drag_start(self, i, e):
        self._drag = {"i": i, "x0": e.x_root, "w0": self.widths[i], "w": self.widths[i]}

    def _drag_move(self, e):
        d = self._drag
        if not d:
            return
        d["w"] = max(COLUMN_MIN, d["w0"] + e.x_root - d["x0"])
        x = self.visible_width(d["i"]) + d["w"] - self.hdr.canvasx(0) + self.hdr.winfo_x()
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
            self.app.prefs.set_columns(self.mode, self.widths)
            self.build()

    def refresh_numbers(self):
        """Repeint les n° (ceux en double dans la classe sont surlignés en rouge)."""
        dups = model.duplicate_numbers(self.cls)
        for row in self.rows:
            row.paint_number(dups)

    def refresh_footer(self):
        for k, lab in enumerate(self.footer_labels):
            vals = [s["notes"][str(k + 1)] for s in self.cls["eleves"] if s["notes"][str(k + 1)] is not None]
            lab.configure(text=exchange.fmt_num(sum(vals) / len(vals)) if vals else "")

    def refresh_student(self, student):
        for row in self.rows:
            if row.s is student:
                row.refresh()


class Row:
    """Une ligne du tableau. Elle garde ses widgets pour mettre à jour compteurs et couleurs sans tout reconstruire.
    Chaque valeur (n°, nom, prénom, infos, notes, totaux de séance, compteurs, commentaire) se modifie en cliquant dessus."""

    def __init__(self, table, s, r):
        self.table, self.s, self.app = table, s, table.app
        t = self.app.t
        bf, f, b = table.bf, table.font, table.bold
        self.font = f
        self.bg = P["surface"] if r % 2 == 0 else P["zebra"]  # lignes alternées
        self.cells = []
        self.height = table.row_h

        def cell(parent, row, col):
            c = table.cell(parent, row, col, self.bg)
            self.cells.append(c)
            return c

        def editable(widget, command):
            """Clic sur la valeur (ou sur sa case) = modification sur place."""
            widget.configure(cursor="xterm")
            widget.bind("<Button-1>", lambda e: command())
            widget.master.bind("<Button-1>", lambda e: command())

        w = table.widths
        # n° (modifiable ; les doublons sont surlignés en rouge)
        self.num = tk.Label(cell(bf, r, 0), fg=P["muted"], bg=self.bg, font=f)
        self.num.pack(fill="both", expand=True)
        editable(self.num, self.edit_number)
        self.name = tk.Label(cell(bf, r, 1), text=s["nom"], font=b, anchor="w", justify="left", wraplength=max(10, w[1] - 10), bg=self.bg, fg=P["text"])
        self.name.pack(fill="both", expand=True, padx=4)
        editable(self.name, lambda: self.edit_text(self.name, "nom"))
        self.prenom = tk.Label(cell(bf, r, 2), text=s["prenom"], anchor="w", justify="left", wraplength=max(10, w[2] - 10), bg=self.bg, fg=P["text"], font=f)
        self.prenom.pack(fill="both", expand=True, padx=4)
        editable(self.prenom, lambda: self.edit_text(self.prenom, "prenom"))
        self.infos = tk.Label(cell(bf, r, 3), anchor="w", justify="left", wraplength=max(10, w[3] - 10), font=(f[0], f[1] - 1), bg=self.bg, fg=P["text"])
        self.infos.pack(fill="x", expand=True, padx=3, pady=3)
        editable(self.infos, self.edit_infos)
        self.note_vars = {}
        for k in table.per["keys"]:
            var = tk.StringVar(value="" if s["notes"][k] is None else exchange.fmt_num(s["notes"][k]))
            e = ttk.Entry(cell(bf, r, 3 + int(k)), textvariable=var, justify="center", font=f, style="Cell.TEntry")
            e.pack(fill="x", expand=True, padx=2, pady=2)
            e.bind("<FocusOut>", lambda ev, k=k: self.commit_note(k))
            e.bind("<Return>", lambda ev, k=k: self.commit_note(k))
            self.note_vars[k] = var
        self.moy = tk.Label(cell(bf, r, 7), bg=self.bg, fg=P["text"], font=f)  # calculée : pas modifiable
        self.moy.pack(fill="both", expand=True)

        # séance + / séance −
        self.seance = []
        for col, deltas, bucket in ((8, (0.5, 1), "plus"), (9, (-0.5, -1), "moins")):
            c = cell(bf, r, col)
            for d in deltas:
                label = ("+" if d > 0 else "−") + exchange.fmt_num(abs(d))
                ttk.Button(c, text=label, style="Mini.TButton", command=lambda d=d: self.add("seance", d)).pack(side="left", padx=1, pady=2)
            total = tk.Label(c, font=b, fg=P["text"])
            total.pack(side="left", fill="both", expand=True, padx=(2, 1), pady=2)
            editable(total, lambda total=total, bucket=bucket: self.edit_seance(total, bucket))
            self.seance.append(total)
        self.counters = {}
        for col, kind in ((10, "travail"), (11, "oubli")):
            c = cell(bf, r, col)
            ttk.Button(c, text="−", style="Mini.TButton", command=lambda k=kind: self.remove(k)).pack(side="left", padx=1, pady=2)
            ttk.Button(c, text="+", style="Mini.TButton", command=lambda k=kind: self.add(k, 1)).pack(side="right", padx=1, pady=2)
            lab = tk.Label(c, font=b, fg=P["text"])
            lab.pack(fill="both", expand=True)
            editable(lab, lambda lab=lab, kind=kind: self.edit_count(lab, kind))
            self.counters[kind] = (c, lab)
        # commentaire : zone de texte qui passe à la ligne ; la ligne du tableau grandit avec elle
        self.comm = tk.Text(cell(bf, r, 12), font=f, wrap="word", height=1, padx=3, pady=2)
        self.comm.pack(fill="both", expand=True, padx=2, pady=2)
        self.comm.insert("1.0", s["comms"][str(t)])
        self.comm.bind("<KeyRelease>", lambda e: (self.color_comment(), self.fit()))
        self.comm.bind("<FocusOut>", lambda e: self.commit_comment())
        self.comm.bind("<Return>", lambda e: (self.commit_comment(), "break")[1])  # une appréciation tient sur un paragraphe
        self.comm.bind("<Tab>", lambda e: (e.widget.tk_focusNext().focus_set(), "break")[1])
        self._add_fiche_button(cell(bf, r, 13))
        self.refresh()
        self.color_comment()
        self.paint_number(model.duplicate_numbers(table.cls))

    def _add_fiche_button(self, parent):
        """En bout de ligne : un pictogramme (clic) qui ouvre la fiche de l'élève."""
        if self.app.values["pictogrammes"] == "oui":
            icon = tk.Label(parent, text=FICHE_ICON, bg=self.bg, fg=P["text"], cursor="hand2",
                            font=self.table.icon_font)
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
        """Hauteur de la ligne : celle du contenu le plus haut (noms, infos ou commentaire à la ligne)."""
        tb = self.table
        need = tb.row_h
        for widget in (self.name, self.prenom, self.infos):
            need = max(need, widget.winfo_reqheight() + 6)
        text = self.comm.get("1.0", "end-1c")
        need = max(need, wrapped_lines(text, tb.measure, max(10, tb.widths[12] - 18)) * tb.linespace + 12)
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
        self.seance[0].configure(text=exchange.fmt_num(plus), bg=self.color("ok" if plus >= v["seancePlusVert"] else ""))
        lv = "bad" if moins <= -v["seanceMoinsRouge"] else "warn" if moins < 0 else ""
        self.seance[1].configure(text=exchange.fmt_num(moins), bg=self.color(lv))
        for kind, (c, lab) in self.counters.items():
            n = model.count(s, kind, t)
            color = self.color(model.level(n, v[kind + "Orange"], v[kind + "Rouge"]))
            c.configure(bg=color)
            lab.configure(text=str(n), bg=color)
        self.fit()

    def color_comment(self):
        n, mx = len(self.comm.get("1.0", "end-1c")), self.app.values["appreciationMax"]
        self.comm.configure(bg=P["bad"] if n > mx else P["surface"], fg=P["bad_text"] if n > mx else P["text"])

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

    def edit_count(self, label, kind):
        def commit(value):
            try:
                target = int(value.strip())
                if target < 0:
                    raise ValueError
            except ValueError:
                return self._warn("Entrez un nombre entier positif ou nul.")
            model.set_count(self.s, kind, self.app.t, target)
            self.after_change()
        self._inline(label, str(model.count(self.s, kind, self.app.t)), commit)

    # ---------- actions ----------
    def open(self):
        from .dialogs import StudentWindow
        StudentWindow(self.app, self.table.cls, self.s)

    def add(self, kind, value):
        model.add_event(self.s, kind, self.app.t, value)
        self.after_change()

    def remove(self, kind):
        model.remove_last(self.s, kind, self.app.t)
        self.after_change()

    def after_change(self):
        self.app.commit()
        self.refresh()
        w = self.app.student_window
        if w is not None and w.winfo_exists() and w.s is self.s:
            w.refresh()

    def commit_note(self, k):
        var, old = self.note_vars[k], self.s["notes"][k]
        try:
            value = parse_grade(var.get())
        except ValueError:
            messagebox.showwarning("Note invalide", "Entrez un nombre entre 0 et 20.", parent=self.app.root)
            var.set("" if old is None else exchange.fmt_num(old))
            return
        if value != old:
            self.s["notes"][k] = value
            self.app.commit()
            m = model.moyenne(self.s, self.table.per["n"])
            self.moy.configure(text="" if m is None else exchange.fmt_num(m))
            self.table.refresh_footer()
            w = self.app.student_window
            if w is not None and w.winfo_exists() and w.s is self.s:
                w.refresh()
        var.set("" if value is None else exchange.fmt_num(value))

    def commit_comment(self):
        text, t = " ".join(self.comm.get("1.0", "end-1c").split()), str(self.app.t)
        if text != self.s["comms"][t]:
            self.s["comms"][t] = text
            self.app.commit()
