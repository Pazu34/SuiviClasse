"""Fenêtre principale : connexion, barre du haut, enregistrement automatique, archives, verrouillage."""
import copy
import os
import subprocess
import sys
import time
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from .. import model, paths
from ..prefs import Prefs
from ..vault import Vault, WrongPasswordError
from . import dialogs, theme
from .table import ClassTable
from .theme import P

MIN_PW = 8
TICK_MS = 5000          # vérification des archives automatiques et du verrouillage
SAVE_DELAY_MS = 500     # enregistrement une demi-seconde après la dernière modification
UNDO_MAX = 100          # nombre de modifications que l'on peut annuler


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
        self.undo, self.redo, self._last = [], [], None  # historique des modifications (voir commit)
        self.btn_undo = self.btn_redo = None
        self.search.trace_add("write", lambda *a: self.table and self.table.build())
        theme.apply(root, self.values["theme"])
        for ev in ("<Key>", "<Button>", "<Motion>"):
            root.bind_all(ev, self._activity, add="+")
        root.bind_all("<Control-comma>", lambda e: self.show_prefs())
        for seq, fn in (("<Control-z>", self.undo_action), ("<Control-y>", self.redo_action), ("<Control-Shift-Z>", self.redo_action)):
            root.bind_all(seq, lambda e, fn=fn: self._history_key(fn))
        root.protocol("WM_DELETE_WINDOW", self.on_close)
        self.show_login()
        self.root.after(TICK_MS, self._tick)

    # ---------- raccourcis ----------
    @property
    def values(self):
        return self.prefs.values

    @property
    def per(self):
        """Découpage de l'année (trimestres ou semestres) : voir model.periods."""
        return model.periods(self.values["periodes"])

    @property
    def t(self):
        """Période affichée (1 à 3 en trimestres, 1 à 2 en semestres)."""
        return min(max(1, self.trimestre.get()), self.per["n"])

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
        box.place(relx=0.5, rely=0.42, anchor="center")
        ttk.Label(box, text="SuiviClasse", style="Title.TLabel").grid(row=0, column=0, columnspan=2, sticky="w")
        ttk.Label(box, wraplength=380, style="Muted.TLabel", text=(
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
            tk.Label(box, wraplength=380, justify="left", bg=P["warn"], fg=P["text"], padx=10, pady=8,
                     text="⚠ Il n’existe aucun moyen de récupérer les données si le mot de passe est perdu."
                     ).grid(row=6, column=0, columnspan=2, sticky="ew", pady=(0, 6))
        err = ttk.Label(box, text=message, style="Error.TLabel", wraplength=380)
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
            for c in self.state["classes"]:
                model.ensure_numbers(c)  # données créées avant l'ajout des n° d'élèves
            if self.current_class is None and self.state["classes"]:
                self.state["ui"]["classe"] = self.state["classes"][0]["id"]
            self.reset_history()
            self.trimestre.set(self.state["ui"].get("trimestre", 1))
            self._last_archive = self._last_activity = time.time()
            self.render()

        e1.bind("<Return>", lambda e: submit())
        row = ttk.Frame(box)
        row.grid(row=8, column=0, columnspan=2, sticky="ew", pady=(10, 0))
        ttk.Button(row, text="Créer le coffre" if creating else "Déverrouiller", style="Accent.TButton", command=submit).pack(side="left")
        ttk.Button(row, text="Autre dossier…", command=self.choose_dir).pack(side="right")
        ttk.Label(box, style="Muted.TLabel", wraplength=380, text=f"Dossier de données : {self.vault.dir}"
                  ).grid(row=9, column=0, columnspan=2, sticky="w", pady=(12, 0))
        e1.focus_set()

    def choose_dir(self):
        d = filedialog.askdirectory(title="Choisir le dossier de données", mustexist=False)
        if d:
            paths.remember_data_dir(d)
            self.vault, self.prefs = Vault(d), Prefs(d)
            theme.apply(self.root, self.values["theme"])
            self.show_login()

    # ---------- vue principale ----------
    def render(self):
        """Reconstruit toute la fenêtre principale."""
        s = self.state
        if self.trimestre.get() > self.per["n"]:  # passage de trimestres à semestres : on revient à la 1re période
            self.trimestre.set(1)
            self.state["ui"]["trimestre"] = 1
        f = self._swap_frame()
        top = ttk.Frame(f, style="Bar.TFrame", padding=(14, 9))
        top.pack(fill="x")
        ttk.Label(top, text="Classes :", style="BarStrong.TLabel").pack(side="left", padx=(0, 8))
        for c in s["classes"]:
            ttk.Radiobutton(top, text=c["nom"], style="Pill.Toolbutton", value=c["id"], variable=self._class_var(),
                            command=lambda: self.select_class()).pack(side="left", padx=2)
        ttk.Button(top, text="+", style="Plus.TButton", command=self.add_class).pack(side="left", padx=(4, 4))
        ttk.Button(top, text="Importer une liste PRONOTE", command=lambda: dialogs.ImportDialog(self, None),
                   style="TButton" if s["classes"] else "Accent.TButton").pack(side="left", padx=4)
        ttk.Button(top, text="Verrouiller", command=self.lock).pack(side="right")
        ttk.Button(top, text="Données", command=lambda: dialogs.DataDialog(self)).pack(side="right", padx=4)
        ttk.Button(top, text="Archives", command=lambda: dialogs.ArchivesDialog(self)).pack(side="right")
        ttk.Button(top, text="Préférences", command=self.show_prefs).pack(side="right", padx=4)
        ttk.Label(top, textvariable=self.status, style="Bar.TLabel").pack(side="right", padx=12)
        self.btn_redo = ttk.Button(top, text="↷ Rétablir", command=self.redo_action)
        self.btn_redo.pack(side="right", padx=(2, 4))
        self.btn_undo = ttk.Button(top, text="↶ Annuler", command=self.undo_action)
        self.btn_undo.pack(side="right", padx=2)
        self.update_history_buttons()
        ttk.Separator(f).pack(fill="x")
        self.status.set("Enregistré ✓" if not self.dirty else "Modifié…")
        self.body = ttk.Frame(f, padding=(14, 12, 14, 12))
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
            ttk.Label(self.body, style="Muted.TLabel", justify="center", text=(
                "Aucune classe.\nCliquez sur « Importer une liste PRONOTE » (les classes sont créées "
                "automatiquement) ou sur « + Classe »."), padding=60).pack()
            return
        bar = ttk.Frame(self.body)
        bar.pack(fill="x", pady=(0, 10))
        ttk.Label(bar, text=c["nom"], style="H1.TLabel").pack(side="left")
        ttk.Label(bar, text=f"   {len(c['eleves'])} élèves", style="Muted.TLabel").pack(side="left")
        for t in range(1, self.per["n"] + 1):
            ttk.Radiobutton(bar, text=f"{self.per['prefix']}{t}", style="Pill.Toolbutton", value=t, variable=self.trimestre, command=self.on_trimestre).pack(side="left", padx=(14 if t == 1 else 1, 1))
        ttk.Button(bar, text="Importer des élèves…", command=lambda: dialogs.ImportDialog(self, c)).pack(side="left", padx=(18, 4))
        ttk.Button(bar, text="Exporter (PRONOTE, tableur)…", command=lambda: dialogs.ExportDialog(self, c)).pack(side="left", padx=4)
        ttk.Button(bar, text="Renommer", command=lambda: self.rename_class(c)).pack(side="left", padx=4)
        ttk.Button(bar, text="Supprimer la classe", style="Danger.TButton", command=lambda: self.delete_class(c)).pack(side="left", padx=4)
        ttk.Label(bar, text="Rechercher", style="Muted.TLabel").pack(side="left", padx=(4, 4))
        ttk.Entry(bar, textvariable=self.search, width=16).pack(side="left")
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
        """Supprime une classe (la classe Test comme les autres). Une archive de l'état précédent est créée
        juste avant : « Archives » permet de revenir en arrière."""
        if messagebox.askyesno("Supprimer la classe", f"Supprimer la classe {c['nom']} et ses {len(c['eleves'])} élèves ?\n\n"
                               "Une archive des données actuelles est créée juste avant, vous pourrez la restaurer "
                               "depuis « Archives » en cas d’erreur.", parent=self.root):
            self.flush()
            self.archive("suppression")
            self.state["classes"].remove(c)
            self.state["ui"]["classe"] = self.state["classes"][0]["id"] if self.state["classes"] else None
            self.commit()
            self.render()

    def restyle(self):
        """Réapplique le thème (clair/sombre) puis reconstruit la fenêtre ; les fenêtres annexes sont fermées."""
        theme.apply(self.root, self.values["theme"])
        self.close_student_window()
        self.render()

    def show_prefs(self):
        if self.state:
            dialogs.PrefsDialog(self)

    # ---------- enregistrement ----------
    def commit(self):
        """À appeler après toute modification : l'enregistre (différé et groupé) et la range dans l'historique."""
        self._push_history()
        self.dirty = True
        self.status.set("Modifié…")
        if self._save_job:
            self.root.after_cancel(self._save_job)
        self._save_job = self.root.after(SAVE_DELAY_MS, self.flush)

    # ---------- annuler / rétablir ----------
    def _snap(self):
        """Copie des données (sans l'état de l'affichage : classe et trimestre choisis)."""
        return copy.deepcopy({k: v for k, v in self.state.items() if k != "ui"})

    def reset_history(self):
        self.undo, self.redo, self._last = [], [], self._snap() if self.state else None
        self.update_history_buttons()

    def _push_history(self):
        if self._last is None or not self.state:
            return
        snap = self._snap()
        if snap != self._last:
            self.undo.append(self._last)
            del self.undo[:-UNDO_MAX]
            self.redo.clear()
            self._last = snap
            self.update_history_buttons()

    def update_history_buttons(self):
        for btn, stack in ((self.btn_undo, self.undo), (self.btn_redo, self.redo)):
            if btn is not None and btn.winfo_exists():
                btn.state(["!disabled"] if stack else ["disabled"])

    def _history_key(self, action):
        """Ctrl+Z / Ctrl+Y : dans un champ de saisie, c'est l'annulation du texte qui s'applique, pas celle du tableau."""
        w = self.root.focus_get()
        if self.state and not isinstance(w, (tk.Entry, tk.Text, ttk.Entry, ttk.Combobox, ttk.Spinbox)):
            action()

    def undo_action(self):
        self._travel(self.undo, self.redo, "Modification annulée")

    def redo_action(self):
        self._travel(self.redo, self.undo, "Modification rétablie")

    def _travel(self, source, target, message):
        if not self.state:
            return
        self.root.focus_set()  # valide d'abord ce qui est en cours de saisie
        self.root.update_idletasks()
        self._push_history()
        if not source:
            return
        target.append(self._snap())
        snap = source.pop()
        y = self.table.body.yview()[0] if self.table else 0
        self.state.update(copy.deepcopy(snap))
        self._last = copy.deepcopy(snap)
        if self.current_class is None:
            self.state["ui"]["classe"] = self.state["classes"][0]["id"] if self.state["classes"] else None
        self.close_student_window()
        self.dirty = True
        self.render()
        if self.table:
            self.table.update_idletasks()
            self.table.body.yview_moveto(y)
        self.flush()
        self.update_history_buttons()
        self.status.set(message + " ✓")

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
        for c in self.state["classes"]:
            model.ensure_numbers(c)
        if self.current_class is None:
            self.state["ui"]["classe"] = self.state["classes"][0]["id"] if self.state["classes"] else None
        self.close_student_window()
        self.dirty = False
        self.reset_history()
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
