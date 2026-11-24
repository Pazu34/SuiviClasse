"""Assistant d'appréciation de bulletin : mots-clés de l'élève, note, phrases types à valider d'un clic, accords selon le genre,
pour rédiger à la suite les appréciations de toute une classe. Et l'éditeur des mots-clés et phrases types."""
import copy
import tkinter as tk
from tkinter import messagebox, ttk

from .. import appreciation as A
from .. import columns, exchange
from .dialogs import Dialog, student_summary
from .theme import P

TONE_BG = {"+": "ok", "-": "warn", "=": "surface2"}
SYNTAX = ("Accords : {prénom}  {il} / {Il}  {e}  {masculin|féminin}  {période}.  Exemple : « {Il} est {sérieux|sérieuse} et {investi|investie}. »")


class KeywordBar(ttk.Frame):
    """Pastilles des mots-clés notés pour un élève pendant la période affichée : clic = une fois de plus, « − » = en retirer une,
    « + Mot-clé » = en ajouter un. Utilisée dans la fiche élève et dans l'assistant d'appréciation."""

    def __init__(self, parent, app, student, on_change=None):
        super().__init__(parent)
        self.app, self.s, self.on_change = app, student, on_change
        self.refresh()

    def set_student(self, student):
        self.s = student
        self.refresh()

    def refresh(self):
        for w in self.winfo_children():
            w.destroy()
        t = self.app.t
        bank = A.bank(self.app.state["settings"])
        by_id = {m["id"]: m for m in bank["mots"]}
        known = A.keywords(self.s, t)
        for k, n in known:
            m = by_id.get(k, {"titre": k, "emoji": "", "ton": "="})
            chip = tk.Frame(self, bg=P[TONE_BG[m["ton"]]], highlightthickness=1, highlightbackground=P["border"])
            chip.pack(side="left", padx=(0, 5), pady=2)
            text = f"{m['emoji']} {m['titre']}".strip() + (f" ×{n}" if n > 1 else "")
            lab = tk.Label(chip, text=text, bg=P[TONE_BG[m["ton"]]], fg=P["text"], padx=6, pady=2, cursor="hand2")
            lab.pack(side="left")
            lab.bind("<Button-1>", lambda e, k=k: self.add(k))
            minus = tk.Label(chip, text="−", bg=P[TONE_BG[m["ton"]]], fg=P["muted"], padx=5, cursor="hand2")
            minus.pack(side="left")
            minus.bind("<Button-1>", lambda e, k=k: self.remove(k))
        if not known:
            ttk.Label(self, text="Aucun mot-clé noté", style="Muted.TLabel").pack(side="left", padx=(0, 8))
        mb = ttk.Menubutton(self, text="＋ Mot-clé")
        menu = tk.Menu(mb, tearoff=0)
        for m in bank["mots"]:
            menu.add_command(label=f"{m['emoji']} {m['titre']}".strip(), command=lambda k=m["id"]: self.add(k))
        mb["menu"] = menu
        mb.pack(side="left", pady=2)

    def add(self, k):
        A.add_keyword(self.s, k, self.app.t)
        self.changed()

    def remove(self, k):
        A.remove_keyword(self.s, k, self.app.t)
        self.changed()

    def changed(self):
        self.app.commit()
        self.refresh()
        if self.on_change:
            self.on_change()


class AppreciationDialog(Dialog):
    """Une fenêtre pour rédiger les appréciations d'une classe, élève après élève."""

    def __init__(self, app, cls, student=None):
        super().__init__(app, f"Appréciations — {cls['nom']}", modal=False, size="1120x720")
        self.cls, self.t = cls, app.t
        self.scale = columns.scale(app.state["settings"])
        self.word = app.per["word"]
        self.students = list(cls["eleves"])
        self.index = self.students.index(student) if student in self.students else 0
        self.used = set()
        self.minsize(900, 560)
        self.protocol("WM_DELETE_WINDOW", self.close)
        self.buttons(("Fermer", self.close, "right"), ("Enregistrer et suivant ▶", self.save_next, "right"), ("Enregistrer", self.save, "right"),
                     ("Phrases types et mots-clés…", self.edit_bank, "left"))
        self.bind("<Control-Return>", lambda e: self.save_next())

        top = ttk.Frame(self, padding=(10, 8, 10, 0))
        top.pack(fill="x")
        ttk.Label(top, text=f"Classe {cls['nom']} · {app.per['prefix']}{self.t}", style="Bold.TLabel").pack(side="left")
        self.progress = ttk.Label(top, style="Muted.TLabel")
        self.progress.pack(side="left", padx=14)
        ttk.Button(top, text="Suivant ▶", command=lambda: self.go(1)).pack(side="right")
        ttk.Button(top, text="◀ Précédent", command=lambda: self.go(-1)).pack(side="right", padx=4)

        panes = ttk.PanedWindow(self, orient="horizontal")
        panes.pack(fill="both", expand=True, padx=10, pady=8)
        left = ttk.Frame(panes)
        self.tree = ttk.Treeview(left, columns=("etat",), show="tree headings", selectmode="browse", height=20)
        self.tree.heading("#0", text="Élève")
        self.tree.heading("etat", text="")
        self.tree.column("#0", width=190)
        self.tree.column("etat", width=34, anchor="center", stretch=False)
        sb = ttk.Scrollbar(left, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=sb.set)
        self.tree.pack(side="left", fill="both", expand=True)
        sb.pack(side="left", fill="y")
        self.tree.bind("<<TreeviewSelect>>", self.on_select)
        panes.add(left, weight=0)

        right = ttk.Frame(panes)
        panes.add(right, weight=1)
        head = ttk.Frame(right)
        head.pack(fill="x")
        self.name = ttk.Label(head, font=("TkDefaultFont", 14, "bold"))
        self.name.pack(side="left")
        self.genre = tk.StringVar()
        self.genre_hint = ttk.Label(head, style="Muted.TLabel")
        self.genre_hint.pack(side="right")
        for value, label in (("m", "♂ Garçon"), ("f", "♀ Fille")):
            ttk.Radiobutton(head, text=label, value=value, variable=self.genre, command=self.set_genre).pack(side="right", padx=4)
        self.facts = ttk.Label(right, style="Muted.TLabel", wraplength=720, justify="left")
        self.facts.pack(anchor="w", pady=(3, 0))
        self.infos = ttk.Label(right, foreground=P["bad_text"], wraplength=720, justify="left")
        self.infos.pack(anchor="w")
        ttk.Label(right, text="Mots-clés notés pendant la période (cliquer = une fois de plus)", font=("TkDefaultFont", 9, "bold")).pack(anchor="w", pady=(8, 0))
        self.kwbar = KeywordBar(right, app, self.students[self.index] if self.students else {"events": []}, on_change=self.refresh_suggestions)
        self.kwbar.pack(fill="x")
        ttk.Label(right, text="Phrases proposées (cliquer pour ajouter à l'appréciation)", font=("TkDefaultFont", 9, "bold")).pack(anchor="w", pady=(8, 0))
        box = ttk.Frame(right)
        box.pack(fill="both", expand=True)
        self.canvas = tk.Canvas(box, highlightthickness=0, bg=P["bg"], height=230)
        vsb = ttk.Scrollbar(box, orient="vertical", command=self.canvas.yview)
        self.canvas.configure(yscrollcommand=vsb.set)
        self.canvas.pack(side="left", fill="both", expand=True)
        vsb.pack(side="left", fill="y")
        self.inner = tk.Frame(self.canvas, bg=P["bg"])
        self.win = self.canvas.create_window(0, 0, window=self.inner, anchor="nw")
        self.inner.bind("<Configure>", lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all")))
        self.canvas.bind("<Configure>", self.on_canvas)
        for w in (self.canvas, self.inner):
            w.bind("<Enter>", lambda e: self._wheel(True))
            w.bind("<Leave>", lambda e: self._wheel(False))
        row = ttk.Frame(right)
        row.pack(fill="x", pady=(8, 0))
        ttk.Label(row, text="Appréciation", font=("TkDefaultFont", 9, "bold")).pack(side="left")
        self.counter = ttk.Label(row, style="Muted.TLabel")
        self.counter.pack(side="right")
        ttk.Button(row, text="Effacer", command=self.clear).pack(side="right", padx=8)
        self.text = tk.Text(right, height=5, wrap="word", undo=True, font=("TkDefaultFont", 11), padx=6, pady=4)
        self.text.pack(fill="x")
        self.text.bind("<KeyRelease>", lambda e: self.update_counter())
        ttk.Label(right, text=SYNTAX, style="Muted.TLabel", wraplength=720).pack(anchor="w", pady=(4, 0))
        self.fill_tree()
        self.show(self.index)

    # ---------- liste des élèves ----------
    def label(self, s):
        return f"{s['nom']} {s['prenom']}"

    def fill_tree(self):
        self.tree.delete(*self.tree.get_children())
        for s in self.students:
            self.tree.insert("", "end", iid=s["id"], text=self.label(s), values=("✓" if s["comms"].get(str(self.t)) else "",))

    def on_select(self, e):
        sel = self.tree.selection()
        if sel:
            i = next(n for n, s in enumerate(self.students) if s["id"] == sel[0])
            if i != self.index:
                self.save()
                self.show(i)

    def go(self, d):
        if self.students:
            self.save()
            self.show(max(0, min(len(self.students) - 1, self.index + d)))

    # ---------- élève affiché ----------
    @property
    def s(self):
        return self.students[self.index]

    def show(self, i):
        if not self.students:
            return
        self.index = i
        s, t = self.s, self.t
        self.used = set()
        self.name.configure(text=self.label(s))
        self.tree.selection_set(s["id"])
        self.tree.see(s["id"])
        self.progress.configure(text=f"Élève {i + 1} / {len(self.students)}")
        saved = s.get("genre") in ("f", "m")
        self.genre.set(A.genre_of(s))
        self.genre_hint.configure(text="" if saved else ("genre deviné d'après le prénom — à vérifier" if A.guess_genre(s["prenom"])
                                                          else "genre inconnu : accords au masculin, à choisir"))
        notes = " · ".join(f"{self.app.per['prefix']}{k} : {exchange.note_text(s['notes'][k]) or '–'}" for k in self.app.per["keys"])
        summary = student_summary(self.app, s, t)
        ev, delta = A.evolution(s, t, self.scale)
        trend = "" if ev is None else {"hausse": "  ↗ +", "baisse": "  ↘ ", "stable": "  → "}[ev] + (exchange.fmt_num(delta) if ev != "stable" else "stable")
        self.facts.configure(text=f"Notes (sur {exchange.fmt_num(self.scale)}) : {notes}{trend}" + (f"\n{summary}" if summary else ""))
        infos = " · ".join(x.strip() for x in s["infos"].splitlines() if x.strip())
        self.infos.configure(text=f"⚠ {infos}" if infos else "")
        self.kwbar.set_student(s)
        self.text.delete("1.0", "end")
        self.text.insert("1.0", s["comms"].get(str(t), ""))
        self.text.edit_reset()
        self.update_counter()
        self.refresh_suggestions()

    def set_genre(self):
        self.s["genre"] = self.genre.get()
        self.app.commit()
        self.genre_hint.configure(text="")
        self.refresh_suggestions()

    # ---------- phrases proposées ----------
    def on_canvas(self, e):
        self.canvas.itemconfigure(self.win, width=e.width)
        for lab in self.phrase_labels():
            lab.configure(wraplength=max(200, e.width - 40))

    def phrase_labels(self):
        return [w for g in self.inner.winfo_children() for w in g.winfo_children() if getattr(w, "is_phrase", False)]

    def refresh_suggestions(self):
        for w in self.inner.winfo_children():
            w.destroy()
        s = self.s
        genre = A.genre_of(s)
        groups = A.suggestions(self.app.state["settings"], s, self.t, self.scale)
        if not groups:
            tk.Label(self.inner, bg=P["bg"], fg=P["muted"], justify="left", wraplength=620, padx=6, pady=10,
                     text="Aucune suggestion : l'élève n'a pas de note pour cette période et aucun mot-clé noté. Ajoutez des mots-clés ci-dessus.").pack(anchor="w")
        names = {"resultats": "Résultats", "evolution": "Évolution", "conclusion": "Conclusion"}
        width = max(200, self.canvas.winfo_width() - 40)
        for g in groups:
            frame = tk.Frame(self.inner, bg=P["bg"])
            frame.pack(fill="x", pady=(6, 0))
            title = names.get(g["kind"], f"{g.get('emoji', '')} {g['titre']}".strip() + (f"  ×{g['count']}" if g["count"] > 1 else ""))
            if g["kind"] in names:
                title += f" — {g['titre'].lower()}"
            tk.Label(frame, text=title, bg=P["bg"], fg=P["muted"], font=("TkDefaultFont", 9, "bold")).pack(anchor="w")
            if not g["phrases"]:
                tk.Label(frame, text="(aucune phrase : à ajouter dans « Phrases types et mots-clés… »)", bg=P["bg"], fg=P["muted"]).pack(anchor="w")
            for raw in g["phrases"]:
                txt = A.render(raw, s["prenom"], genre, self.word)
                lab = tk.Label(frame, text=txt, bg=P[TONE_BG.get(g.get("ton", "="), "surface2")] if g["kind"] == "mot" else P["surface"], fg=P["text"],
                               justify="left", anchor="w", wraplength=width, padx=8, pady=4, relief="groove", borderwidth=1, cursor="hand2")
                lab.is_phrase = True
                lab.pack(fill="x", pady=1)
                lab.bind("<Button-1>", lambda e, lab=lab, txt=txt: self.add_phrase(lab, txt))
                if txt in self.used:
                    lab.configure(fg=P["muted"], relief="sunken")
        self.canvas.yview_moveto(0)

    def add_phrase(self, lab, txt):
        cur = self.text.get("1.0", "end-1c")
        self.text.insert("end", (" " if cur and not cur.endswith((" ", "\n")) else "") + txt)
        self.text.see("end")
        self.used.add(txt)
        lab.configure(fg=P["muted"], relief="sunken")
        self.update_counter()

    def _wheel(self, on):
        root = self.winfo_toplevel()
        for ev in ("<MouseWheel>", "<Button-4>", "<Button-5>"):
            if on:
                root.bind(ev, self._on_wheel)
            else:
                root.unbind(ev)

    def _on_wheel(self, e):
        self.canvas.yview_scroll(-1 if (e.num == 4 or e.delta > 0) else 1, "units")

    # ---------- texte ----------
    def clear(self):
        self.text.delete("1.0", "end")
        self.used = set()
        self.refresh_suggestions()
        self.update_counter()

    def update_counter(self):
        n, mx = len(" ".join(self.text.get("1.0", "end-1c").split())), self.app.values["appreciationMax"]
        self.counter.configure(text=f"{n} / {mx} caractères", foreground=P["bad_text"] if n > mx else P["muted"])

    def save(self):
        if not self.students:
            return
        s, k = self.s, str(self.t)
        value = " ".join(self.text.get("1.0", "end-1c").split())
        if value != s["comms"].get(k, ""):
            s["comms"][k] = value
            self.app.commit()
            self.app.rebuild_view()
        self.tree.set(s["id"], "etat", "✓" if value else "")

    def save_next(self):
        self.save()
        if self.index + 1 < len(self.students):
            self.show(self.index + 1)

    def close(self):
        self.save()
        self.destroy()

    def edit_bank(self):
        BankDialog(self.app, self, on_close=self.refresh_all)

    def refresh_all(self):
        self.kwbar.refresh()
        self.refresh_suggestions()


class BankDialog(Dialog):
    """Mots-clés et phrases types : une phrase par ligne, accords avec {sérieux|sérieuse}, {Il}, {prénom}…"""

    def __init__(self, app, parent, on_close=None):
        super().__init__(app, "Phrases types et mots-clés", modal=True, size="940x660", parent=parent)
        self.on_close = on_close
        self.bank = copy.deepcopy(A.bank(app.state["settings"]))
        self.current = None
        self.buttons(("Enregistrer", self.save, "right"), ("Annuler", self.destroy, "right"), ("Ajouter un mot-clé", self.add_keyword, "left"),
                     ("Supprimer ce mot-clé", self.delete_keyword, "left"), ("Rétablir les phrases par défaut", self.reset, "left"))
        body = ttk.Frame(self, padding=10)
        body.pack(fill="both", expand=True)
        left = ttk.Frame(body)
        left.pack(side="left", fill="y")
        self.tree = ttk.Treeview(left, show="tree", selectmode="browse", height=12)
        self.tree.column("#0", width=250)
        vs = ttk.Scrollbar(left, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=vs.set)
        self.tree.pack(side="left", fill="y")
        vs.pack(side="left", fill="y")
        self.tree.bind("<<TreeviewSelect>>", self.on_select)
        right = ttk.Frame(body)
        right.pack(side="left", fill="both", expand=True, padx=(12, 0))
        self.title_var, self.emoji_var, self.tone_var = tk.StringVar(), tk.StringVar(), tk.StringVar()
        self.head = ttk.Frame(right)
        self.head.pack(fill="x")
        ttk.Label(self.head, text="Titre").grid(row=0, column=0, sticky="w")
        self.title_entry = ttk.Entry(self.head, textvariable=self.title_var, width=20)
        self.title_entry.grid(row=0, column=1, padx=6, pady=2, sticky="w")
        ttk.Label(self.head, text="Pictogramme").grid(row=0, column=2, sticky="w", padx=(8, 0))
        self.emoji_entry = ttk.Entry(self.head, textvariable=self.emoji_var, width=4)
        self.emoji_entry.grid(row=0, column=3, padx=6, sticky="w")
        ttk.Label(self.head, text="Teinte").grid(row=0, column=4, sticky="w", padx=(10, 0))
        self.tone_box = ttk.Combobox(self.head, state="readonly", width=9, values=["positif", "négatif", "neutre"])
        self.tone_box.grid(row=0, column=5, padx=6, sticky="w")
        self.subtitle = ttk.Label(right, style="Muted.TLabel", wraplength=560, justify="left")
        self.subtitle.pack(anchor="w", pady=(8, 2))
        ttk.Label(right, style="Muted.TLabel", wraplength=640, justify="left", text=(
            "Une phrase par ligne. Accords : {prénom}, {il} / {Il} (il, elle), {masculin|féminin} (ex. {sérieux|sérieuse}, {concentré|concentrée}), "
            "{e} (rien ou « e »), {période} (trimestre ou semestre). Les phrases d'une rubrique « résultats » ou « conclusion » sont proposées selon la "
            "note de l'élève, celles d'« évolution » selon l'écart avec la période précédente.")).pack(side="bottom", anchor="w", pady=(6, 0))
        self.phrases = tk.Text(right, wrap="word", undo=True, font=("TkDefaultFont", 10), padx=6, pady=4)
        self.phrases.pack(fill="both", expand=True)
        self.fill()
        first = self.tree.get_children("mots")
        self.tree.selection_set(first[0] if first else "resultats")

    def fill(self, select=None):
        self.tree.delete(*self.tree.get_children())
        for key, name in (("mots", "Mots-clés"), ("resultats", "Résultats selon la note"), ("evolution", "Évolution depuis la période précédente"),
                          ("conclusions", "Conclusion selon la note")):
            self.tree.insert("", "end", iid=key, text=name, open=True)
            for r in self.bank[key]:
                label = f"{r.get('emoji', '')} {r['titre']}".strip()
                self.tree.insert(key, "end", iid=f"{key}:{r['id']}", text=label)
        if select:
            self.tree.selection_set(select)

    def rubrique(self, iid):
        if ":" not in iid:
            return None, None
        key, rid = iid.split(":", 1)
        return key, next((r for r in self.bank[key] if r["id"] == rid), None)

    def store(self):
        """Reporte l'éditeur dans la rubrique en cours."""
        if not self.current:
            return
        key, r = self.rubrique(self.current)
        if r is None:
            return
        r["phrases"] = [" ".join(line.split()) for line in self.phrases.get("1.0", "end-1c").splitlines() if line.strip()]
        if key == "mots":
            r["titre"] = " ".join(self.title_var.get().split())[:40] or r["titre"]
            r["emoji"] = self.emoji_var.get().strip()[:8]
            r["ton"] = {"positif": "+", "négatif": "-", "neutre": "="}.get(self.tone_box.get(), "=")
            self.tree.item(self.current, text=f"{r['emoji']} {r['titre']}".strip())

    def on_select(self, e):
        sel = self.tree.selection()
        if not sel:
            return
        self.store()
        self.current = sel[0]
        key, r = self.rubrique(sel[0])
        is_kw = key == "mots"
        for w in (self.title_entry, self.emoji_entry):
            w.configure(state="normal" if is_kw else "disabled")
        self.tone_box.configure(state="readonly" if is_kw else "disabled")
        self.phrases.configure(state="normal" if r else "disabled")
        self.phrases.delete("1.0", "end")
        if r is None:
            self.title_var.set("")
            self.emoji_var.set("")
            self.tone_box.set("")
            self.subtitle.configure(text="Choisissez une rubrique dans la liste.")
            return
        self.title_var.set(r["titre"])
        self.emoji_var.set(r.get("emoji", ""))
        self.tone_box.set({"+": "positif", "-": "négatif", "=": "neutre"}.get(r.get("ton", "="), "neutre"))
        self.phrases.insert("1.0", "\n".join(r["phrases"]))
        self.subtitle.configure(text="Phrases proposées quand ce mot-clé a été noté pour l'élève :" if is_kw else
                                {"resultats": "Phrases proposées pour une note dans cette tranche (ramenée sur 20) :",
                                 "evolution": "Phrases proposées selon l'évolution de la note :",
                                 "conclusions": "Phrases de conclusion proposées pour une note dans cette tranche :"}[key])

    def add_keyword(self):
        self.store()
        from tkinter import simpledialog
        titre = simpledialog.askstring("Nouveau mot-clé", "Titre du mot-clé (ex. Oral) :", parent=self)
        titre = " ".join((titre or "").split())[:40]
        if not titre:
            return
        rid = A.new_keyword_id(titre, self.bank)
        self.bank["mots"].append({"id": rid, "titre": titre, "emoji": "", "ton": "=", "phrases": []})
        self.current = None
        self.fill(f"mots:{rid}")

    def delete_keyword(self):
        key, r = self.rubrique(self.tree.selection()[0]) if self.tree.selection() else (None, None)
        if key != "mots" or r is None:
            messagebox.showinfo("Mots-clés", "Sélectionnez un mot-clé dans la liste.", parent=self)
            return
        if messagebox.askyesno("Supprimer le mot-clé", f"Supprimer « {r['titre']} » et ses phrases ?\n(Les mots-clés déjà notés pour des élèves restent dans leur journal.)", parent=self):
            self.bank["mots"].remove(r)
            self.current = None
            self.fill("mots")

    def reset(self):
        if messagebox.askyesno("Phrases par défaut", "Remplacer tous les mots-clés et toutes les phrases par ceux du programme ?", parent=self):
            self.bank = A.default_bank()
            self.current = None
            self.fill("mots")

    def save(self):
        self.store()
        self.app.state["settings"]["appreciation"] = A.sanitize_bank(self.bank)
        self.app.commit()
        cb = self.on_close
        self.destroy()
        if cb:
            cb()
