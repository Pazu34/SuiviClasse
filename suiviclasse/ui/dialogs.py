"""Fenêtres : fiche élève, import, export, archives, préférences, données et mot de passe."""
import copy
import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog, ttk

from .. import exchange, model
from ..vault import NeedPasswordError, WrongPasswordError
from .theme import P

REASONS = {"suppression": "avant suppression d’une classe", "auto": "automatique", "manuel": "manuelle", "demarrage": "à l’ouverture", "fermeture": "à la fermeture",
           "restauration": "avant restauration", "mdp": "avant changement de mot de passe"}


def ask_text(parent, title, label, initial=""):
    value = simpledialog.askstring(title, label, initialvalue=initial, parent=parent)
    return value.strip() if value and value.strip() else None


def ask_password(parent, title, label):
    return simpledialog.askstring(title, label, show="•", parent=parent)


class Dialog(tk.Toplevel):
    def __init__(self, app, title, modal=True, size=None):
        super().__init__(app.root)
        self.app = app
        self.title(title)
        self.transient(app.root)
        if size:
            self.geometry(size)
        self.update_idletasks()
        x = app.root.winfo_rootx() + max(0, (app.root.winfo_width() - self.winfo_reqwidth()) // 2)
        y = app.root.winfo_rooty() + 40
        self.geometry(f"+{x}+{y}")
        if modal:
            self.after(60, self._grab)
        self.bind("<Escape>", lambda e: self.destroy())

    def _grab(self):
        try:
            self.grab_set()
        except tk.TclError:
            pass

    def buttons(self, *specs):
        bar = ttk.Frame(self, padding=(10, 6))
        bar.pack(side="bottom", fill="x")
        for text, command, side in specs:
            ttk.Button(bar, text=text, command=command).pack(side=side, padx=3)
        return bar


# ---------------------------------------------------------------- fiche élève
class StudentWindow(Dialog):
    def __init__(self, app, cls, student):
        app.close_student_window()
        super().__init__(app, f"{student['nom']} {student['prenom']}", modal=False, size="660x700")
        app.student_window = self
        self.cls, self.s = cls, student
        self.protocol("WM_DELETE_WINDOW", self.close)
        t = app.t
        pad = dict(padx=10, pady=3)
        ttk.Label(self, text=f"{student['nom']} {student['prenom']}", font=("TkDefaultFont", 14, "bold")).pack(anchor="w", **pad)
        ttk.Label(self, text=f"Classe {cls['nom']}", foreground=P["muted"]).pack(anchor="w", padx=10)
        ident = ttk.Frame(self)
        ident.pack(fill="x", **pad)
        self.vars = {}
        for i, (label, key) in enumerate((("Nom", "nom"), ("Prénom", "prenom"), ("Né(e) le", "naissance"))):
            ttk.Label(ident, text=label).grid(row=i, column=0, sticky="w")
            var = tk.StringVar(value=student.get(key, ""))
            e = ttk.Entry(ident, textvariable=var, width=34)
            e.grid(row=i, column=1, sticky="w", padx=8, pady=1)
            e.bind("<FocusOut>", lambda ev: self.commit_identity())
            e.bind("<Return>", lambda ev: self.commit_identity())
            self.vars[key] = var

        ttk.Label(self, text="Informations particulières (handicap, PAI, situation…)", font=("TkDefaultFont", 10, "bold")).pack(anchor="w", **pad)
        self.infos = tk.Text(self, height=4, wrap="word", undo=True)
        self.infos.pack(fill="x", padx=10)
        self.infos.insert("1.0", student["infos"])
        self.infos.bind("<FocusOut>", lambda e: self.commit_infos())

        ttk.Label(self, text="Notes et commentaires de bulletin", font=("TkDefaultFont", 10, "bold")).pack(anchor="w", **pad)
        self.notes, self.stats, self.comms, self.counters = {}, {}, {}, {}
        self.per = app.per  # trimestres ou semestres
        for k in self.per["keys"]:
            row = ttk.Frame(self)
            row.pack(fill="x", padx=10, pady=(4, 0))
            ttk.Label(row, text=f"{self.per['word'].capitalize()} {k}", width=12).pack(side="left")
            var = tk.StringVar()
            e = ttk.Entry(row, textvariable=var, width=7, justify="center")
            e.pack(side="left")
            e.bind("<FocusOut>", lambda ev, k=k: self.commit_note(k))
            e.bind("<Return>", lambda ev, k=k: self.commit_note(k))
            self.notes[k] = var
            self.stats[k] = ttk.Label(row, foreground=P["muted"])
            self.stats[k].pack(side="left", padx=8)
            self.counters[k] = ttk.Label(row, foreground=P["muted"])
            self.counters[k].pack(side="right")
            txt = tk.Text(self, height=3, wrap="word", undo=True)
            txt.pack(fill="x", padx=10)
            txt.insert("1.0", student["comms"][k])
            txt.bind("<FocusOut>", lambda ev, k=k: self.commit_comment(k))
            txt.bind("<KeyRelease>", lambda ev, k=k: self.update_counter(k))
            self.comms[k] = txt

        ttk.Label(self, text=f"Journal du {app.per['word']} {t}", font=("TkDefaultFont", 10, "bold")).pack(anchor="w", **pad)
        quick = ttk.Frame(self)
        quick.pack(fill="x", padx=10)
        self.precision = tk.StringVar()
        ttk.Entry(quick, textvariable=self.precision).pack(fill="x", pady=2)
        row = ttk.Frame(quick)
        row.pack(fill="x")
        for label, kind, value in (("Séance +0,5", "seance", 0.5), ("Séance +1", "seance", 1), ("Séance −0,5", "seance", -0.5),
                                   ("Séance −1", "seance", -1), ("Travail non fait", "travail", 1), ("Oubli matériel", "oubli", 1)):
            ttk.Button(row, text=label, style="Mini.TButton", command=lambda kind=kind, value=value: self.add(kind, value)).pack(side="left", padx=1, pady=2)
        self.journal = ttk.Treeview(self, columns=("date", "type", "note"), show="headings", height=4, selectmode="browse")
        for col, text, w in (("date", "Date", 120), ("type", "Événement", 150), ("note", "Précision", 280)):
            self.journal.heading(col, text=text)
            self.journal.column(col, width=w)
        self.journal.pack(fill="both", expand=True, padx=10, pady=3)
        self.buttons(("Fermer", self.close, "right"), ("Supprimer l’entrée sélectionnée", self.delete_entry, "left"),
                     ("Supprimer cet élève", self.delete_student, "left"))
        self.refresh()

    # ---------- affichage ----------
    def refresh(self):
        s, t = self.s, self.app.t
        for k in self.per["keys"]:
            v = s["notes"][k]
            self.notes[k].set("" if v is None else exchange.fmt_num(v))
            plus, moins = model.seance(s, int(k))
            self.stats[k].configure(text=f"Séance + {exchange.fmt_num(plus)} · − {exchange.fmt_num(moins)} · "
                                         f"travail {model.count(s, 'travail', int(k))} · oublis {model.count(s, 'oubli', int(k))}")
            self.update_counter(k)
        self.journal.delete(*self.journal.get_children())
        for e in reversed(s["events"]):
            if e["t"] == t:
                name = model.TYPES[e["type"]] + (f" {'+' if e['v'] > 0 else '−'}{exchange.fmt_num(abs(e['v']))}" if e["type"] == "seance" else "")
                self.journal.insert("", "end", iid=e["id"], values=(model.event_datetime(e).strftime("%d/%m/%Y %H:%M"), name, e["note"]))

    def update_counter(self, k):
        n, mx = len(self.comms[k].get("1.0", "end-1c")), self.app.values["appreciationMax"]
        self.counters[k].configure(text=f"{n} / {mx}", foreground=P["bad_text"] if n > mx else P["muted"])

    # ---------- enregistrement des champs ----------
    def changed(self):
        self.app.commit()
        if self.app.table:
            self.app.table.refresh_student(self.s)
            self.app.table.refresh_footer()

    def commit_identity(self):
        nom = self.vars["nom"].get().strip()
        if not nom:
            self.vars["nom"].set(self.s["nom"])
            return
        old = (self.s["nom"], self.s["prenom"], self.s.get("naissance", ""))
        self.s["nom"], self.s["prenom"], self.s["naissance"] = nom, self.vars["prenom"].get().strip(), self.vars["naissance"].get().strip()
        if old != (self.s["nom"], self.s["prenom"], self.s["naissance"]):
            model.sort_students(self.cls)
            self.app.commit()
            self.title(f"{self.s['nom']} {self.s['prenom']}")
            if self.app.table:
                self.app.table.build()

    def commit_infos(self):
        text = self.infos.get("1.0", "end-1c")
        if text != self.s["infos"]:
            self.s["infos"] = text
            self.changed()

    def commit_note(self, k):
        from .table import parse_grade
        try:
            value = parse_grade(self.notes[k].get())
        except ValueError:
            messagebox.showwarning("Note invalide", "Entrez un nombre entre 0 et 20.", parent=self)
            self.refresh()
            return
        if value != self.s["notes"][k]:
            self.s["notes"][k] = value
            self.changed()
            if self.app.table:
                self.app.table.build()
        self.notes[k].set("" if value is None else exchange.fmt_num(value))

    def commit_comment(self, k):
        text = self.comms[k].get("1.0", "end-1c")
        if text != self.s["comms"][k]:
            self.s["comms"][k] = text
            self.app.commit()
            if self.app.table and k == str(self.app.t):
                self.app.table.build()

    def commit_all(self):
        self.commit_identity()
        self.commit_infos()
        for k in self.per["keys"]:
            self.commit_note(k)
            self.commit_comment(k)

    # ---------- actions ----------
    def add(self, kind, value):
        model.add_event(self.s, kind, self.app.t, value, self.precision.get().strip())
        self.precision.set("")
        self.changed()
        self.refresh()

    def delete_entry(self):
        sel = self.journal.selection()
        if sel:
            self.s["events"] = [e for e in self.s["events"] if e["id"] != sel[0]]
            self.changed()
            self.refresh()

    def delete_student(self):
        if messagebox.askyesno("Supprimer", f"Supprimer définitivement {self.s['prenom']} {self.s['nom']} ?", parent=self):
            self.cls["eleves"].remove(self.s)
            self.app.commit()
            self.close(save=False)
            if self.app.table:
                self.app.table.build()

    def close(self, save=True):
        if save:
            self.commit_all()
        self.app.student_window = None
        self.destroy()


# ---------------------------------------------------------------- import
class ImportDialog(Dialog):
    PREVIEW_ROWS = 8

    def __init__(self, app, cls):
        super().__init__(app, f"Importer dans {cls['nom']}" if cls else "Importer une liste PRONOTE", size="980x640")
        self.cls = cls
        self.rows, self.guessed, self.role_boxes = [], [], []
        self.roles_list = exchange.role_list(app.per["prefix"], app.per["n"])
        ttk.Label(self, wraplength=940, foreground=P["muted"], padding=(10, 8), text=(
            "Dans PRONOTE, le bouton de copie en haut à droite d’une liste (ou du tableau de notes) place les données dans le "
            "presse-papiers : collez-les ici (Ctrl+V). Un fichier texte exporté de PRONOTE ou d’Excel convient aussi.")).pack(anchor="w")
        self.text = tk.Text(self, height=6, wrap="none", undo=True)
        self.text.pack(fill="x", padx=10)
        self.text.bind("<KeyRelease>", lambda e: self.analyse())
        self.text.bind("<<Paste>>", lambda e: self.after(60, self.analyse))
        opts = ttk.Frame(self, padding=(10, 6))
        opts.pack(fill="x")
        ttk.Button(opts, text="Ouvrir un fichier…", command=self.open_file).pack(side="left")
        self.delim = ttk.Combobox(opts, state="readonly", width=24, values=["Séparateur : automatique", "Tabulation", "Point-virgule", "Virgule"])
        self.delim.current(0)
        self.delim.pack(side="left", padx=8)
        self.delim.bind("<<ComboboxSelected>>", lambda e: self.analyse())
        ttk.Label(opts, text="Ne pas importer les").pack(side="left")
        self.skip = tk.IntVar(value=0)
        sp = ttk.Spinbox(opts, from_=0, to=50, width=4, textvariable=self.skip, command=self.draw)
        sp.pack(side="left", padx=4)
        sp.bind("<KeyRelease>", lambda e: self.draw())
        ttk.Label(opts, text="premières lignes").pack(side="left")
        self.preview = ttk.Frame(self, padding=(10, 0))
        self.preview.pack(fill="both", expand=True)
        self.info = ttk.Label(self, foreground=P["muted"], padding=(10, 0))
        self.info.pack(anchor="w")
        self.summary = ttk.Label(self, font=("TkDefaultFont", 9, "bold"), wraplength=940, padding=(10, 2))
        self.summary.pack(anchor="w")
        self.create = tk.BooleanVar(value=cls is None or not cls["eleves"])
        ttk.Checkbutton(self, variable=self.create, command=self.summarize, padding=(10, 0),
                        text="Créer les élèves absents de la classe (sinon, seuls les élèves existants sont mis à jour)").pack(anchor="w")
        self.error = ttk.Label(self, foreground=P["bad_text"], padding=(10, 0))
        self.error.pack(anchor="w")
        self.buttons(("Importer", self.do_import, "right"), ("Annuler", self.destroy, "right"))
        self.text.focus_set()

    def open_file(self):
        path = filedialog.askopenfilename(parent=self, filetypes=[("Texte / CSV", "*.txt *.csv *.tsv"), ("Tous les fichiers", "*.*")])
        if path:
            try:
                content = exchange.read_text_file(path)
            except OSError as e:
                self.error.configure(text=str(e))
                return
            self.text.delete("1.0", "end")
            self.text.insert("1.0", content)
            self.analyse()

    def analyse(self):
        self.error.configure(text="")
        delim = {1: "\t", 2: ";", 3: ","}.get(self.delim.current())
        self.rows = exchange.parse_table(self.text.get("1.0", "end-1c"), delim)
        self.role_boxes = []
        if self.rows:
            has_header = exchange.looks_like_header(self.rows[0])
            self.skip.set(1 if has_header else 0)
            n = max(len(r) for r in self.rows)
            self.guessed = ([exchange.guess_role(x, self.app.t) for x in self.rows[0]] if has_header
                            else ["nomprenom"] if n == 1 else [["nom", "prenom", "infos"][i] if i < 3 else "ignore" for i in range(n)])
            self.guessed += ["ignore"] * (n - len(self.guessed))
            valid = {k for k, _ in self.roles_list}  # un titre « T3 » n'a pas de rubrique en semestres
            self.guessed = [r if r in valid else "ignore" for r in self.guessed]
            if "classe" in self.guessed:  # la liste indique les classes : on peut les créer
                self.create.set(True)
        self.draw()

    def skip_count(self):
        try:
            return max(0, int(self.skip.get()))
        except (tk.TclError, ValueError):
            return 0

    def draw(self):
        keep = [self.key_of(b.get()) for b in self.role_boxes]
        for w in self.preview.winfo_children():
            w.destroy()
        self.role_boxes = []
        if not self.rows:
            self.info.configure(text="")
            self.summary.configure(text="")
            return
        n, k = max(len(r) for r in self.rows), self.skip_count()
        labels = [label for _, label in self.roles_list]
        for i in range(n):
            box = ttk.Combobox(self.preview, state="readonly", values=labels, width=18)
            role = keep[i] if i < len(keep) else self.guessed[i]
            box.set(dict(self.roles_list)[role])
            box.grid(row=0, column=i, padx=1, pady=(0, 3), sticky="ew")
            box.bind("<<ComboboxSelected>>", lambda e: self.summarize())
            self.role_boxes.append(box)
            self.preview.columnconfigure(i, weight=1)
        for ri, row in enumerate(self.rows[:self.PREVIEW_ROWS]):
            for i in range(n):
                ttk.Label(self.preview, text=row[i] if i < len(row) else "", foreground=P["muted"] if ri < k else P["text"]
                          ).grid(row=ri + 1, column=i, sticky="w", padx=4)
        self.info.configure(text=f"{max(0, len(self.rows) - k)} ligne(s) à importer sur {len(self.rows)}. Associez chaque colonne à une "
                                 "rubrique ; les lignes grisées (titres) sont ignorées.")
        self.summarize()

    def key_of(self, label):
        return next(k for k, l in self.roles_list if l == label)

    def roles(self):
        return [self.key_of(b.get()) for b in self.role_boxes]

    def apply(self, classes):
        return exchange.apply_table(classes, self.rows, self.roles(), self.skip_count(), self.cls["id"] if self.cls else None,
                                    self.create.get(), model.new_student, model.new_class)

    def summarize(self):
        roles = self.roles()
        if not roles or not ({"nom", "nomprenom"} & set(roles)):
            self.summary.configure(text="")
            return
        rep = self.apply(copy.deepcopy(self.app.state["classes"]))
        cl = ", ".join(f"{n} ({k})" for n, k in rep["classes"].items())
        self.summary.configure(text=f"Résultat attendu : {rep['created']} élève(s) à créer, {rep['updated']} à mettre à jour"
                               + (f", {rep['createdClasses']} classe(s) à créer" if rep["createdClasses"] else "")
                               + (f" — classes : {cl}" if cl else "")
                               + (f" — {len(rep['unmatched'])} ligne(s) sans classe ou élève inconnu(e), ignorée(s)" if rep["unmatched"] else "") + ".")

    def do_import(self):
        roles = self.roles()
        if not ({"nom", "nomprenom"} & set(roles)):
            self.error.configure(text="Associez au moins une colonne à « Nom » ou « Nom et prénom ».")
            return
        if self.cls is None and "classe" not in roles:
            self.error.configure(text="Aucune classe n’est ouverte : associez une colonne à « Classe » (ou créez d’abord une classe).")
            return
        app = self.app
        rep = self.apply(app.state["classes"])
        for c in app.state["classes"]:
            model.sort_students(c)
            model.ensure_numbers(c)
        if rep["createdClasses"]:
            model.sort_classes(app.state)
        if app.current_class is None and app.state["classes"]:
            app.state["ui"]["classe"] = app.state["classes"][0]["id"]
        app.commit()
        self.destroy()
        app.render()
        lines = [f"{rep['created']} élève(s) créé(s), {rep['updated']} mis à jour, {rep['unchanged']} inchangé(s)"
                 + (f", {rep['createdClasses']} classe(s) créée(s)" if rep["createdClasses"] else "") + "."]
        if rep["unmatched"]:
            lines.append("Non trouvés (ignorés) : " + ", ".join(rep["unmatched"][:15]) + ("…" if len(rep["unmatched"]) > 15 else ""))
        if rep["invalid"]:
            lines.append("Valeurs de note non reconnues (ignorées) : " + " ; ".join(rep["invalid"][:10]))
        messagebox.showinfo("Import terminé", "\n\n".join(lines), parent=app.root)


# ---------------------------------------------------------------- export
class ExportDialog(Dialog):
    def __init__(self, app, cls):
        super().__init__(app, f"Exporter {cls['nom']}")
        self.cls = cls
        ttk.Label(self, wraplength=620, foreground=P["muted"], padding=10, text=(
            "Choisissez les champs, comme dans l’export texte de PRONOTE. Le tableau copié se colle directement dans un tableur.")).pack(anchor="w")
        top = ttk.Frame(self, padding=(10, 0))
        top.pack(fill="x")
        self.t = tk.StringVar(value=str(app.t))
        ttk.Combobox(top, state="readonly", width=14, textvariable=self.t, values=app.per["keys"]).pack(side="left")
        ttk.Label(top, text=f"← {app.per['word']}   ").pack(side="left")
        self.sep = ttk.Combobox(top, state="readonly", width=36, values=["Tabulation (collage PRONOTE / Excel)", "Point-virgule (CSV)"])
        self.sep.current(0)
        self.sep.pack(side="left")
        self.header = tk.BooleanVar(value=True)
        ttk.Checkbutton(top, text="Ligne de titres", variable=self.header).pack(side="left", padx=10)
        box = ttk.LabelFrame(self, text="Champs à exporter", padding=8)
        box.pack(fill="x", padx=10, pady=8)
        self.fields = {}
        for i, (key, label) in enumerate(exchange.EXPORT_FIELDS):
            var = tk.BooleanVar(value=key in ("nom", "prenom", "note", "comm"))
            ttk.Checkbutton(box, text=label.replace("trimestre", app.per["word"]), variable=var).grid(row=i // 3, column=i % 3, sticky="w", padx=8, pady=2)
            self.fields[key] = var
        self.warn = ttk.Label(self, foreground=P["bad_text"], wraplength=620, padding=(10, 0))
        self.warn.pack(anchor="w")
        self.msg = ttk.Label(self, foreground=P["muted"], wraplength=620, padding=(10, 0))
        self.msg.pack(anchor="w")
        ttk.Label(self, foreground=P["muted"], font=("TkDefaultFont", 8), padding=(10, 4),
                  text="Le fichier enregistré n’est pas chiffré (UTF-8).").pack(anchor="w")
        self.buttons(("Enregistrer un fichier…", self.save, "right"), ("Copier dans le presse-papiers", self.copy, "right"),
                     ("Fermer", self.destroy, "left"))

    def build(self):
        fields = [k for k, _ in exchange.EXPORT_FIELDS if self.fields[k].get()]
        if not fields:
            self.warn.configure(text="Cochez au moins un champ.")
            return None
        delim = "\t" if self.sep.current() == 0 else ";"
        mx = self.app.values["appreciationMax"]
        text, too_long = exchange.build_export(self.cls, fields, int(self.t.get()), self.header.get(), delim, mx, model.stats,
                                             self.app.per["prefix"], self.app.per["word"])
        self.warn.configure(text=f"⚠ Appréciation(s) de plus de {mx} caractères (PRONOTE les refuserait ou les tronquerait) : "
                                 + ", ".join(too_long) if too_long else "")
        return text, delim

    def copy(self):
        built = self.build()
        if built:
            self.clipboard_clear()
            self.clipboard_append(built[0])
            self.update()
            self.msg.configure(text=f"✓ Copié ({len(self.cls['eleves'])} lignes). Collez avec Ctrl+V.")

    def save(self):
        built = self.build()
        if not built:
            return
        ext = "txt" if built[1] == "\t" else "csv"
        path = filedialog.asksaveasfilename(parent=self, defaultextension="." + ext, initialfile=f"{self.cls['nom']}-{self.app.per['prefix']}{self.t.get()}.{ext}",
                                            filetypes=[("Fichier texte", "*." + ext)])
        if path:
            with open(path, "w", encoding="utf-8-sig", newline="") as f:
                f.write(built[0])
            self.msg.configure(text="✓ Enregistré : " + path)


# ---------------------------------------------------------------- archives
class ArchivesDialog(Dialog):
    def __init__(self, app):
        super().__init__(app, "Archives des données", size="640x460")
        app.flush()
        v = app.values
        ttk.Label(self, wraplength=600, foreground=P["muted"], padding=10, text=(
            f"Une archive chiffrée est créée toutes les {v['backupMinutes']} min si les données ont changé, ainsi qu’à l’ouverture et à la "
            "fermeture. Les modifications sont par ailleurs enregistrées en continu dans le fichier principal." if v["backupMinutes"] > 0 else
            "Les archives automatiques périodiques sont désactivées (voir Préférences). Les modifications restent enregistrées en continu.")).pack(anchor="w")
        self.tree = ttk.Treeview(self, columns=("date", "motif", "taille"), show="headings", selectmode="browse")
        for col, text, w in (("date", "Date", 150), ("motif", "Motif", 280), ("taille", "Taille", 80)):
            self.tree.heading(col, text=text)
            self.tree.column(col, width=w)
        self.tree.pack(fill="both", expand=True, padx=10)
        self.err = ttk.Label(self, foreground=P["bad_text"], padding=(10, 2))
        self.err.pack(anchor="w")
        self.buttons(("Fermer", self.destroy, "right"), ("Restaurer", self.restore, "left"), ("Supprimer", self.delete, "left"),
                     ("Archiver maintenant", self.now, "left"), ("Ouvrir le dossier", self.open_dir, "left"))
        self.refresh()

    def refresh(self):
        self.tree.delete(*self.tree.get_children())
        for a in self.app.vault.list_archives():
            self.tree.insert("", "end", iid=a["name"], values=(a["date"].strftime("%d/%m/%Y %H:%M"), REASONS.get(a["reason"], a["reason"] or "—"),
                                                               f"{max(1, round(a['size'] / 1024))} Ko"))

    def selected(self):
        sel = self.tree.selection()
        if not sel:
            self.err.configure(text="Sélectionnez d’abord une archive dans la liste.")
        return sel[0] if sel else None

    def now(self):
        self.app.archive("manuel")
        self.refresh()

    def open_dir(self):
        from .app import open_folder
        self.app.vault.archive_dir.mkdir(parents=True, exist_ok=True)
        open_folder(self.app.vault.archive_dir)

    def delete(self):
        name = self.selected()
        if name and messagebox.askyesno("Supprimer", "Supprimer cette archive ?", parent=self):
            self.app.vault.delete_archive(name)
            self.refresh()

    def restore(self):
        name = self.selected()
        if not name:
            return
        date = self.tree.item(name, "values")[0]
        if not messagebox.askyesno("Restaurer", f"Restaurer les données du {date} ?\n\nLes données actuelles seront remplacées (une archive de "
                                   "l’état actuel est créée juste avant, vous pourrez y revenir).", parent=self):
            return
        vault = self.app.vault
        try:
            try:
                data = vault.read_archive(name)
            except NeedPasswordError:
                pw = ask_password(self, "Mot de passe de l’archive", "Cette archive date d’un autre mot de passe.\nEntrez celui qui était utilisé à ce moment-là :")
                if pw is None:
                    return
                data = vault.read_archive(name, pw)
        except (WrongPasswordError, OSError, ValueError) as e:
            self.err.configure(text=str(e))
            return
        self.app.archive("restauration")
        vault.save(data)
        self.destroy()
        self.app.set_state(data)


# ---------------------------------------------------------------- préférences
class ChoiceVar:
    """Donne à une liste déroulante la même interface .get() que les autres réglages (valeur, pas libellé)."""

    def __init__(self, combo, options):
        self.combo, self.options = combo, options

    def get(self):
        return next(value for value, label in self.options if label == self.combo.get())


class PrefsDialog(Dialog):
    def __init__(self, app):
        super().__init__(app, "Préférences")
        from ..prefs import SCHEMA
        self.schema, self.vars = SCHEMA, {}
        grid = ttk.Frame(self, padding=(8, 8, 8, 0))  # groupes sur deux colonnes : la fenêtre reste basse
        grid.pack(fill="both", expand=True)
        grid.columnconfigure((0, 1), weight=1, uniform="g")
        for i, group in enumerate(dict.fromkeys(f["group"] for f in SCHEMA)):
            box = ttk.LabelFrame(grid, text=group, padding=8)
            box.grid(row=i // 2, column=i % 2, sticky="nsew", padx=5, pady=5)
            box.columnconfigure(0, weight=1)
            for r, f in enumerate(x for x in SCHEMA if x["group"] == group):
                ttk.Label(box, text=f["label"]).grid(row=r, column=0, sticky="w")
                if f["type"] == "choice":
                    labels = dict(f["options"])
                    combo = ttk.Combobox(box, state="readonly", width=22, values=list(labels.values()))
                    combo.set(labels[app.values[f["key"]]])
                    combo.grid(row=r, column=1, columnspan=2, padx=8, pady=2, sticky="w")
                    self.vars[f["key"]] = ChoiceVar(combo, f["options"])
                    continue
                var = tk.StringVar(value=str(app.values[f["key"]]).replace(".", ","))
                ttk.Spinbox(box, from_=f["min"], to=f["max"], increment=1 if f["type"] == "int" else 0.5, width=7,
                            textvariable=var, justify="center").grid(row=r, column=1, padx=8, pady=2)
                ttk.Label(box, text=f["unit"], foreground=P["muted"]).grid(row=r, column=2, sticky="w")
                self.vars[f["key"]] = var
        ttk.Label(self, foreground=P["muted"], font=("TkDefaultFont", 8), padding=(10, 2),
                  text="Réglages enregistrés dans : " + str(app.prefs.file)).pack(anchor="w")
        self.buttons(("Enregistrer", self.save, "right"), ("Annuler", self.destroy, "right"), ("Valeurs par défaut", self.reset, "left"),
                     ("Rétablir les largeurs de colonnes", self.reset_columns, "left"))

    def save(self):
        app = self.app
        before = app.values["periodes"]
        app.prefs.set({k: v.get() for k, v in self.vars.items()})
        if app.values["periodes"] != before:
            sem = app.values["periodes"] == "semestres"
            messagebox.showinfo(
                "Découpage de l’année",
                "Les données déjà saisies gardent leur numéro de période : la période 1 devient "
                + ("S1" if sem else "T1") + ", la période 2 devient " + ("S2" if sem else "T2") + ".\n\n"
                "Le 3e trimestre n’est pas affiché en semestres, mais ses données restent enregistrées "
                "et réapparaissent si vous revenez aux trimestres.", parent=self)
        app.vault.prune(app.values["backupKeepRecent"], app.values["backupKeepDays"])
        self.destroy()
        app.restyle()

    def reset_columns(self):
        self.app.prefs.reset_columns()
        self.destroy()
        self.app.restyle()

    def reset(self):
        if messagebox.askyesno("Préférences", "Revenir aux réglages par défaut ?", parent=self):
            self.app.prefs.reset()
            self.destroy()
            self.app.restyle()


# ---------------------------------------------------------------- données et mot de passe
class DataDialog(Dialog):
    def __init__(self, app):
        super().__init__(app, "Données et mot de passe")
        f = ttk.Frame(self, padding=14)
        f.pack(fill="both", expand=True)
        self.annee = tk.StringVar(value=app.state["settings"].get("annee", ""))
        self.cur, self.n1, self.n2 = tk.StringVar(), tk.StringVar(), tk.StringVar()
        ttk.Label(f, text="Année scolaire").grid(row=0, column=0, sticky="w")
        ttk.Entry(f, textvariable=self.annee, width=26).grid(row=0, column=1, pady=2, padx=8)
        ttk.Label(f, text="Changer le mot de passe", font=("TkDefaultFont", 10, "bold")).grid(row=1, column=0, columnspan=2, sticky="w", pady=(14, 2))
        for i, (label, var) in enumerate((("Mot de passe actuel", self.cur), ("Nouveau mot de passe", self.n1), ("Confirmer", self.n2))):
            ttk.Label(f, text=label).grid(row=2 + i, column=0, sticky="w")
            ttk.Entry(f, textvariable=var, show="•", width=26).grid(row=2 + i, column=1, pady=2, padx=8)
        self.err = ttk.Label(f, foreground=P["bad_text"], wraplength=360)
        self.err.grid(row=5, column=0, columnspan=2, sticky="w")
        ttk.Label(f, foreground=P["muted"], wraplength=360, text=f"Dossier : {app.vault.dir}\nArchives chiffrées dans le sous-dossier « sauvegardes ».").grid(
            row=6, column=0, columnspan=2, sticky="w", pady=(8, 0))
        self.buttons(("Enregistrer", self.save, "right"), ("Fermer", self.destroy, "right"), ("Ouvrir le dossier des données", self.open_dir, "left"),
                     ("Ajouter la classe Test", self.add_demo, "left"))

    def add_demo(self):
        app = self.app
        if any(model.norm(c["nom"]) == model.norm(model.DEMO_NAME) for c in app.state["classes"]):
            self.err.configure(text=f"Une classe « {model.DEMO_NAME} » existe déjà (supprimez-la d’abord si vous voulez la recréer).")
            return
        demo = model.demo_class()
        app.state["classes"].append(demo)
        model.sort_classes(app.state)
        app.state["ui"]["classe"] = demo["id"]
        app.commit()
        self.destroy()
        app.render()

    def open_dir(self):
        from .app import open_folder
        open_folder(self.app.vault.dir)

    def save(self):
        from .app import MIN_PW
        app = self.app
        app.state["settings"]["annee"] = self.annee.get().strip()
        try:
            if self.cur.get() or self.n1.get():
                if len(self.n1.get()) < MIN_PW:
                    raise ValueError(f"Le nouveau mot de passe doit contenir au moins {MIN_PW} caractères.")
                if self.n1.get() != self.n2.get():
                    raise ValueError("Les deux nouveaux mots de passe sont différents.")
                app.vault.change_password(self.cur.get(), self.n1.get(), app.state)
        except (ValueError, WrongPasswordError) as e:
            self.err.configure(text=str(e))
            return
        app.commit()
        self.destroy()
