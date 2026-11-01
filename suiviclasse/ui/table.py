"""Tableau d'une classe : une ligne par élève, avec en-têtes fixes et défilement."""
import tkinter as tk
from tkinter import font as tkfont
from tkinter import messagebox, ttk

from .. import exchange, model

COLORS = {"ok": "#d9f2e1", "warn": "#ffe9c7", "bad": "#fbd5d5", "": "#ffffff"}
# Largeurs des colonnes en pixels, dans l'ordre : n°, nom, prénom, infos, T1, T2, T3, moyenne,
# séance +, séance −, travail non fait, oubli de matériel, commentaire.
LAYOUTS = {
    "compact": {"row_h": 26, "widths": [28, 112, 98, 104, 46, 46, 46, 40, 112, 112, 78, 78, 330]},
    "normal": {"row_h": 30, "widths": [36, 150, 125, 150, 64, 64, 64, 54, 140, 140, 125, 125, 360]},
}
TITLES = {
    "compact": ["n°", "Nom", "Prénom", "Infos", "T1", "T2", "T3", "Moy.", "Séance +", "Séance −", "Travail", "Oublis", "Commentaire"],
    "normal": ["n°", "Nom", "Prénom", "Infos (PAI…)", "T1 /20", "T2 /20", "T3 /20", "Moy.", "Séance +", "Séance −",
               "Travail non fait", "Oubli matériel", "Commentaire"],
}


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
        self.widths, self.row_h = layout["widths"], layout["row_h"]
        self.total_w = sum(self.widths)
        base = tkfont.nametofont("TkDefaultFont")
        size = base.actual("size")
        size = size + 1 if size < 0 else size - 1  # un point de moins que la police par défaut
        self.font, self.bold = (base.actual("family"), size), (base.actual("family"), size, "bold")
        self.hdr = tk.Canvas(self, height=self.row_h, highlightthickness=0, bg="#eef1f7")
        self.body = tk.Canvas(self, highlightthickness=0, bg="#ffffff")
        self.vsb = ttk.Scrollbar(self, orient="vertical", command=self.body.yview)
        self.hsb = ttk.Scrollbar(self, orient="horizontal", command=self._xview)
        self.body.configure(yscrollcommand=self.vsb.set, xscrollcommand=self._xset)
        self.hdr.grid(row=0, column=0, sticky="ew")
        self.body.grid(row=1, column=0, sticky="nsew")
        self.vsb.grid(row=1, column=1, sticky="ns")
        self.hsb.grid(row=2, column=0, sticky="ew")
        self.rowconfigure(1, weight=1)
        self.columnconfigure(0, weight=1)
        self.hf = tk.Frame(self.hdr, bg="#eef1f7")
        self.bf = tk.Frame(self.body, bg="#ffffff")
        self.hdr.create_window(0, 0, window=self.hf, anchor="nw")
        self.body.create_window(0, 0, window=self.bf, anchor="nw")
        self.bf.bind("<Configure>", lambda e: self.body.configure(scrollregion=(0, 0, self.total_w, self.bf.winfo_reqheight())))
        self.hdr.configure(scrollregion=(0, 0, self.total_w, self.row_h))
        self.body.bind("<Enter>", lambda e: self._bind_wheel(True))
        self.body.bind("<Leave>", lambda e: self._bind_wheel(False))
        self.build()

    def cell(self, parent, row, col, bg="#ffffff"):
        """Case de largeur fixe : garantit l'alignement des en-têtes avec les lignes."""
        f = tk.Frame(parent, width=self.widths[col], height=self.row_h, bg=bg, highlightthickness=0)
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
        for i in range(8, 12):
            titles[i] += f" (T{t})"
        titles[12] += f" T{t}"
        for i, title in enumerate(titles):
            c = self.cell(self.hf, 0, i, "#eef1f7")
            tk.Label(c, text=title.upper(), bg="#eef1f7", font=(self.font[0], self.font[1] - 1, "bold"), anchor="w").pack(fill="both", padx=3)
        q = exchange.norm(self.app.search.get())
        r = 0
        for i, s in enumerate(self.cls["eleves"]):
            if q and q not in exchange.norm(f"{s['nom']} {s['prenom']} {s['infos']}"):
                continue
            self.rows.append(Row(self, s, i + 1, r))
            r += 1
        if not self.rows:
            msg = "Aucun élève ne correspond à la recherche." if self.cls["eleves"] else "Aucun élève. Utilisez « Importer / ajouter des élèves… »."
            tk.Label(self.bf, text=msg, bg="#ffffff", fg="#6b7385", pady=30).grid(row=0, column=0, columnspan=len(self.widths), sticky="w", padx=20)
            r = 1
        self.footer = [self.cell(self.bf, r, i, "#f5f6fa") for i in range(len(self.widths))]
        tk.Label(self.footer[1], text="Moy. classe" if self.mode == "compact" else "Moyenne de la classe", bg="#f5f6fa", font=self.bold).pack(side="left", padx=4)
        self.footer_labels = [tk.Label(self.footer[4 + k], bg="#f5f6fa", font=self.bold) for k in range(3)]
        for lab in self.footer_labels:
            lab.pack(expand=True)
        self.refresh_footer()
        self.update_idletasks()
        self.body.yview_moveto(y)

    def refresh_footer(self):
        for k, lab in enumerate(self.footer_labels):
            vals = [s["notes"][str(k + 1)] for s in self.cls["eleves"] if s["notes"][str(k + 1)] is not None]
            lab.configure(text=exchange.fmt_num(sum(vals) / len(vals)) if vals else "")

    def refresh_student(self, student):
        for row in self.rows:
            if row.s is student:
                row.refresh()


class Row:
    """Une ligne du tableau : garde ses widgets pour mettre à jour compteurs et couleurs sans tout reconstruire."""

    def __init__(self, table, s, number, r):
        self.table, self.s, self.app = table, s, table.app
        t = self.app.t
        bf, cell, f, b = table.bf, table.cell, table.font, table.bold
        tk.Label(cell(bf, r, 0), text=str(number), fg="#6b7385", bg="#ffffff", font=f).pack(fill="both")
        name = tk.Label(cell(bf, r, 1), text=s["nom"], font=b, anchor="w", bg="#ffffff", fg="#1d2433", cursor="hand2")
        name.pack(fill="both", padx=4)
        name.bind("<Button-1>", lambda e: self.open())
        tk.Label(cell(bf, r, 2), text=s["prenom"], anchor="w", bg="#ffffff", font=f).pack(fill="both", padx=4)
        self.infos_cell = cell(bf, r, 3)
        self.infos = tk.Label(self.infos_cell, anchor="w", font=(f[0], f[1] - 1), bg="#ffffff")
        self.infos.pack(fill="x", padx=3, pady=4)
        self.note_vars = {}
        for k in "123":
            var = tk.StringVar(value="" if s["notes"][k] is None else exchange.fmt_num(s["notes"][k]))
            e = ttk.Entry(cell(bf, r, 3 + int(k)), textvariable=var, justify="center", font=f)
            e.pack(fill="both", padx=2, pady=2)
            e.bind("<FocusOut>", lambda ev, k=k: self.commit_note(k))
            e.bind("<Return>", lambda ev, k=k: self.commit_note(k))
            self.note_vars[k] = var
        self.moy = tk.Label(cell(bf, r, 7), bg="#ffffff", font=f)
        self.moy.pack(fill="both")
        # séance + / séance −
        self.seance = []
        for col, deltas in ((8, (0.5, 1)), (9, (-0.5, -1))):
            c = cell(bf, r, col)
            for d in deltas:
                label = ("+" if d > 0 else "−") + exchange.fmt_num(abs(d))
                ttk.Button(c, text=label, style="Mini.TButton", command=lambda d=d: self.add("seance", d)).pack(side="left", padx=1, pady=2)
            total = tk.Label(c, font=b)
            total.pack(side="left", fill="both", expand=True, padx=(2, 1), pady=2)
            self.seance.append(total)
        self.counters = {}
        for col, kind in ((10, "travail"), (11, "oubli")):
            c = cell(bf, r, col)
            ttk.Button(c, text="−", style="Mini.TButton", command=lambda k=kind: self.remove(k)).pack(side="left", padx=1, pady=2)
            ttk.Button(c, text="+", style="Mini.TButton", command=lambda k=kind: self.add(k, 1)).pack(side="right", padx=1, pady=2)
            lab = tk.Label(c, font=b)
            lab.pack(fill="both", expand=True)
            self.counters[kind] = (c, lab)
        self.comm = tk.Entry(cell(bf, r, 12), relief="solid", bd=1, font=f)
        self.comm.pack(fill="both", padx=2, pady=2)
        self.comm.insert(0, s["comms"][str(t)])
        self.comm.bind("<KeyRelease>", lambda e: self.color_comment())
        self.comm.bind("<FocusOut>", lambda e: self.commit_comment())
        self.comm.bind("<Return>", lambda e: self.commit_comment())
        self.refresh()
        self.color_comment()

    def open(self):
        from .dialogs import StudentWindow
        StudentWindow(self.app, self.table.cls, self.s)

    # ---------- affichage ----------
    def refresh(self):
        s, t, v = self.s, self.app.t, self.app.values
        first = s["infos"].splitlines()[0][:40] if s["infos"] else ""
        self.infos.configure(text=first, bg="#fbd5d5" if first else "#ffffff")
        m = model.moyenne(s)
        self.moy.configure(text="" if m is None else exchange.fmt_num(m))
        plus, moins = model.seance(s, t)
        self.seance[0].configure(text=exchange.fmt_num(plus), bg=COLORS["ok" if plus >= v["seancePlusVert"] else ""])
        lv = "bad" if moins <= -v["seanceMoinsRouge"] else "warn" if moins < 0 else ""
        self.seance[1].configure(text=exchange.fmt_num(moins), bg=COLORS[lv])
        for kind, (c, lab) in self.counters.items():
            n = model.count(s, kind, t)
            color = COLORS[model.level(n, v[kind + "Orange"], v[kind + "Rouge"])]
            c.configure(bg=color)
            lab.configure(text=str(n), bg=color)

    def color_comment(self):
        n, mx = len(self.comm.get()), self.app.values["appreciationMax"]
        self.comm.configure(bg="#fbd5d5" if n > mx else "#ffffff", fg="#8a1c14" if n > mx else "#000000")

    # ---------- actions ----------
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
            self.moy.configure(text="" if model.moyenne(self.s) is None else exchange.fmt_num(model.moyenne(self.s)))
            self.table.refresh_footer()
            w = self.app.student_window
            if w is not None and w.winfo_exists() and w.s is self.s:
                w.refresh()
        var.set("" if value is None else exchange.fmt_num(value))

    def commit_comment(self):
        text, t = self.comm.get(), str(self.app.t)
        if text != self.s["comms"][t]:
            self.s["comms"][t] = text
            self.app.commit()
