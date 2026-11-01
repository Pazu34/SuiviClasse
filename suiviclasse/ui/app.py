"""Fenêtre principale : connexion, barre du haut, enregistrement automatique, archives, verrouillage."""
import os
import subprocess
import sys
import time
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from tkinter import font as tkfont

from .. import model, paths
from ..prefs import Prefs
from ..vault import Vault, WrongPasswordError
from . import dialogs
from .table import ClassTable

MIN_PW = 8
TICK_MS = 5000          # vérification des archives automatiques et du verrouillage
SAVE_DELAY_MS = 500     # enregistrement une demi-seconde après la dernière modification


def open_folder(path):
    if sys.platform.startswith("win"):
        os.startfile(path)  # noqa: S606
    else:
        subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", str(path)])


class App:
    def __init__(self, root):
        self.root = root
        root.title("SuiviClasse")
        root.geometry("1280x800")
        root.minsize(900, 560)
        self.vault = Vault(paths.data_dir())
        self.prefs = Prefs(paths.data_dir())
        self.state = None
        self.dirty = False
        self.table = None
        self.student_window = None
        self._save_job = None
        self._last_archive = time.time()
        self._last_activity = time.time()
        self.search = tk.StringVar()
        self.trimestre = tk.IntVar(value=1)
        self.status = tk.StringVar()
        self.frame = None
        self.search.trace_add("write", lambda *a: self.table and self.table.build())
        style = ttk.Style()
        if "vista" in style.theme_names():
            style.theme_use("vista")
        elif "clam" in style.theme_names():
            style.theme_use("clam")
        base = tkfont.nametofont("TkDefaultFont")
        size = base.actual("size")
        small = (base.actual("family"), size + 1 if size < 0 else size - 1)  # un point de moins que la police par défaut
        # width=0 : largeur du texte (par défaut, ttk impose environ 11 caractères minimum)
        style.configure("Mini.TButton", padding=(3, 0), font=small, width=0)
        for ev in ("<Key>", "<Button>", "<Motion>"):
            root.bind_all(ev, self._activity, add="+")
        root.bind_all("<Control-comma>", lambda e: self.show_prefs())
        root.protocol("WM_DELETE_WINDOW", self.on_close)
        self.show_login()
        self.root.after(TICK_MS, self._tick)

    # ---------- raccourcis ----------
    @property
    def values(self):
        return self.prefs.values

    @property
    def t(self):
        return self.trimestre.get()

    @property
    def current_class(self):
        cid = self.state["ui"].get("classe") if self.state else None
        return next((c for c in self.state["classes"] if c["id"] == cid), None) if self.state else None

    def _swap_frame(self):
        if self.frame is not None:
            self.frame.destroy()
        self.frame = ttk.Frame(self.root)
        self.frame.pack(fill="both", expand=True)
        return self.frame

    # ---------- connexion ----------
    def show_login(self, message=""):
        self.table = None
        creating = not self.vault.exists()
        f = self._swap_frame()
        box = ttk.Frame(f, padding=28)
        box.place(relx=0.5, rely=0.4, anchor="center")
        ttk.Label(box, text="SuiviClasse", font=("TkDefaultFont", 20, "bold")).grid(row=0, column=0, columnspan=2, sticky="w")
        ttk.Label(box, wraplength=380, foreground="#6b7385", text=(
            "Aucune donnée dans ce dossier : créez votre coffre protégé par mot de passe." if creating
            else "Entrez votre mot de passe pour déverrouiller les données.")).grid(row=1, column=0, columnspan=2, sticky="w", pady=(4, 12))
        pw, pw2 = tk.StringVar(), tk.StringVar()
        ttk.Label(box, text="Nouveau mot de passe" if creating else "Mot de passe").grid(row=2, column=0, sticky="w")
        e1 = ttk.Entry(box, textvariable=pw, show="•", width=34)
        e1.grid(row=3, column=0, columnspan=2, sticky="ew", pady=(2, 8))
        if creating:
            ttk.Label(box, text="Confirmer le mot de passe").grid(row=4, column=0, sticky="w")
            e2 = ttk.Entry(box, textvariable=pw2, show="•", width=34)
            e2.grid(row=5, column=0, columnspan=2, sticky="ew", pady=(2, 8))
            e2.bind("<Return>", lambda e: submit())
            tk.Label(box, wraplength=380, justify="left", bg="#ffe9c7", padx=8, pady=6,
                     text="⚠ Il n’existe aucun moyen de récupérer les données si le mot de passe est perdu."
                     ).grid(row=6, column=0, columnspan=2, sticky="ew", pady=(0, 6))
        err = ttk.Label(box, text=message, foreground="#b3261e", wraplength=380)
        err.grid(row=7, column=0, columnspan=2, sticky="w")

        def submit():
            err.configure(text="")
            try:
                if creating:
                    if len(pw.get()) < MIN_PW:
                        raise ValueError(f"Le mot de passe doit contenir au moins {MIN_PW} caractères.")
                    if pw.get() != pw2.get():
                        raise ValueError("Les deux mots de passe sont différents.")
                    self.state = model.new_data()
                    self.vault.create(pw.get(), self.state)
                else:
                    self.state = self.vault.unlock(pw.get())
                    self.archive("demarrage")
            except (ValueError, WrongPasswordError, OSError) as e:
                err.configure(text=str(e))
                return
            self.state.setdefault("ui", {"classe": None, "trimestre": 1})
            self.state["settings"].setdefault("annee", "")
            if self.current_class is None and self.state["classes"]:
                self.state["ui"]["classe"] = self.state["classes"][0]["id"]
            self.trimestre.set(self.state["ui"].get("trimestre", 1))
            self._last_archive = self._last_activity = time.time()
            self.render()

        e1.bind("<Return>", lambda e: submit())
        row = ttk.Frame(box)
        row.grid(row=8, column=0, columnspan=2, sticky="ew", pady=(10, 0))
        ttk.Button(row, text="Créer" if creating else "Déverrouiller", command=submit).pack(side="left")
        ttk.Button(row, text="Autre dossier…", command=self.choose_dir).pack(side="right")
        ttk.Label(box, foreground="#6b7385", wraplength=380, text=f"Dossier de données : {self.vault.dir}"
                  ).grid(row=9, column=0, columnspan=2, sticky="w", pady=(12, 0))
        e1.focus_set()

    def choose_dir(self):
        d = filedialog.askdirectory(title="Choisir le dossier de données", mustexist=False)
        if d:
            paths.remember_data_dir(d)
            self.vault, self.prefs = Vault(d), Prefs(d)
            self.show_login()

    # ---------- vue principale ----------
    def render(self):
        """Reconstruit toute la fenêtre principale."""
        s = self.state
        f = self._swap_frame()
        top = ttk.Frame(f, padding=(8, 6))
        top.pack(fill="x")
        for c in s["classes"]:
            ttk.Radiobutton(top, text=c["nom"], style="Toolbutton", value=c["id"], variable=self._class_var(),
                            command=lambda: self.select_class()).pack(side="left", padx=1)
        ttk.Button(top, text="＋ Classe", command=self.add_class).pack(side="left", padx=(6, 6))
        ttk.Button(top, text="⭳ Importer une liste PRONOTE", command=lambda: dialogs.ImportDialog(self, self.current_class)
                   ).pack(side="left")
        ttk.Button(top, text="🔒 Verrouiller", command=self.lock).pack(side="right")
        ttk.Button(top, text="🗂 Données", command=lambda: dialogs.DataDialog(self)).pack(side="right", padx=3)
        ttk.Button(top, text="🕘 Archives", command=lambda: dialogs.ArchivesDialog(self)).pack(side="right")
        ttk.Button(top, text="⚙ Préférences", command=self.show_prefs).pack(side="right", padx=3)
        ttk.Label(top, textvariable=self.status, foreground="#6b7385").pack(side="right", padx=8)
        self.status.set("Enregistré ✓" if not self.dirty else "Modifié…")
        self.body = ttk.Frame(f, padding=(8, 0, 8, 8))
        self.body.pack(fill="both", expand=True)
        self.show_class()

    def _class_var(self):
        if not hasattr(self, "_cv"):
            self._cv = tk.StringVar()
        self._cv.set(self.state["ui"].get("classe") or "")
        return self._cv

    def select_class(self):
        self.state["ui"]["classe"] = self._cv.get()
        self.show_class()

    def on_trimestre(self):
        self.state["ui"]["trimestre"] = self.t
        if self.table:
            self.table.build()

    def show_class(self):
        for w in self.body.winfo_children():
            w.destroy()
        self.table = None
        c = self.current_class
        if c is None:
            ttk.Label(self.body, foreground="#6b7385", justify="center", text=(
                "Aucune classe.\nCliquez sur « ⭳ Importer une liste PRONOTE » (les classes sont créées "
                "automatiquement) ou sur « ＋ Classe »."), padding=60).pack()
            return
        bar = ttk.Frame(self.body)
        bar.pack(fill="x", pady=(0, 6))
        ttk.Label(bar, text=c["nom"], font=("TkDefaultFont", 14, "bold")).pack(side="left")
        ttk.Label(bar, text=f"  — {len(c['eleves'])} élèves", foreground="#6b7385").pack(side="left")
        ttk.Button(bar, text="⭳ Importer / ajouter des élèves…", command=lambda: dialogs.ImportDialog(self, c)).pack(side="left", padx=(14, 4))
        ttk.Button(bar, text="⭱ Exporter (PRONOTE, tableur)…", command=lambda: dialogs.ExportDialog(self, c)).pack(side="left", padx=4)
        ttk.Button(bar, text="Renommer", command=lambda: self.rename_class(c)).pack(side="left", padx=4)
        ttk.Button(bar, text="Supprimer la classe", command=lambda: self.delete_class(c)).pack(side="left", padx=4)
        for t in (3, 2, 1):
            ttk.Radiobutton(bar, text=f"T{t}", style="Toolbutton", value=t, variable=self.trimestre, command=self.on_trimestre).pack(side="right")
        ttk.Entry(bar, textvariable=self.search, width=16).pack(side="right", padx=(2, 12))
        ttk.Label(bar, text="Rechercher :").pack(side="right")
        self.table = ClassTable(self.body, self, c)
        self.table.pack(fill="both", expand=True)

    def add_class(self):
        nom = dialogs.ask_text(self.root, "Nouvelle classe", "Nom de la classe (ex. 6A)")
        if nom:
            c = model.new_class(nom)
            self.state["classes"].append(c)
            self.state["ui"]["classe"] = c["id"]
            self.commit()
            self.render()

    def rename_class(self, c):
        nom = dialogs.ask_text(self.root, "Renommer la classe", "Nouveau nom", c["nom"])
        if nom:
            c["nom"] = nom
            self.commit()
            self.render()

    def delete_class(self, c):
        if messagebox.askyesno("Supprimer", f"Supprimer définitivement la classe {c['nom']} et ses {len(c['eleves'])} élèves ?", parent=self.root):
            self.state["classes"].remove(c)
            self.state["ui"]["classe"] = self.state["classes"][0]["id"] if self.state["classes"] else None
            self.commit()
            self.render()

    def show_prefs(self):
        if self.state:
            dialogs.PrefsDialog(self)

    # ---------- enregistrement ----------
    def commit(self):
        """À appeler après toute modification : enregistrement différé et groupé."""
        self.dirty = True
        self.status.set("Modifié…")
        if self._save_job:
            self.root.after_cancel(self._save_job)
        self._save_job = self.root.after(SAVE_DELAY_MS, self.flush)

    def flush(self):
        if self._save_job:
            self.root.after_cancel(self._save_job)
            self._save_job = None
        if not (self.dirty and self.state and self.vault.unlocked):
            return
        try:
            self.vault.save(self.state)
            self.dirty = False
            self.status.set("Enregistré ✓")
        except OSError as e:
            self.status.set("ÉCHEC enregistrement !")
            messagebox.showerror("Enregistrement impossible", str(e), parent=self.root)

    # ---------- archives, verrouillage ----------
    def archive(self, reason):
        try:
            name = self.vault.snapshot(reason)
            self.vault.prune(self.values["backupKeepRecent"], self.values["backupKeepDays"])
        except OSError:
            name = None
        self._last_archive = time.time()
        return name

    def _activity(self, _event=None):
        self._last_activity = time.time()

    def _tick(self):
        if self.state and self.vault.unlocked:
            now = time.time()
            minutes = self.values["backupMinutes"]
            if minutes > 0 and now - self._last_archive >= minutes * 60:
                self.flush()
                self.archive("auto")
            lock = self.values["autoLockMinutes"]
            if lock > 0 and now - self._last_activity >= lock * 60:
                self.lock()
        self.root.after(TICK_MS, self._tick)

    def lock(self):
        self.flush()
        if self.vault.unlocked:
            self.archive("fermeture")
        self.vault.lock()
        self.state = None
        self.close_student_window()
        for w in self.root.winfo_children():
            if isinstance(w, tk.Toplevel):
                w.destroy()
        self.show_login()

    def close_student_window(self):
        if self.student_window is not None and self.student_window.winfo_exists():
            self.student_window.destroy()
        self.student_window = None

    def set_state(self, data):
        """Remplace toutes les données (restauration d'une archive)."""
        self.state = data
        self.state.setdefault("ui", {"classe": None, "trimestre": 1})
        if self.current_class is None:
            self.state["ui"]["classe"] = self.state["classes"][0]["id"] if self.state["classes"] else None
        self.close_student_window()
        self.dirty = False
        self.render()

    def on_close(self):
        if self.state:
            self.flush()
            self.archive("fermeture")
            self.vault.lock()
        self.root.destroy()


def main():
    root = tk.Tk()
    App(root)
    root.mainloop()
