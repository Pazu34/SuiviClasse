"""Apparence : palettes (clair / sombre) et style des widgets ttk.

Le thème « clam » de ttk sert de base sur toutes les plateformes : il est dessiné par Tk lui-même,
donc identique partout, et entièrement personnalisable (aucune dépendance supplémentaire).
`P` est la palette courante : les autres modules y lisent leurs couleurs (P["surface"], …).
"""
import sys
import tkinter as tk
from tkinter import font as tkfont
from tkinter import ttk

PALETTES = {
    "clair": {
        "bg": "#f3f4f8", "surface": "#ffffff", "surface2": "#eceff6", "zebra": "#f8f9fc", "border": "#c9d0de",
        "text": "#1d2433", "muted": "#6b7385", "accent": "#2f5fd0", "accent_hover": "#244fb5", "accent_fg": "#ffffff",
        "hover": "#dde3f0", "ok": "#d7f0df", "warn": "#ffe8c2", "bad": "#fad4d4", "bad_text": "#b3261e",
        "danger": "#b3261e",
    },
    "sombre": {
        "bg": "#15171c", "surface": "#1e222a", "surface2": "#272c37", "zebra": "#222730", "border": "#454c5c",
        "text": "#e6e9ef", "muted": "#9aa3b2", "accent": "#7b9bff", "accent_hover": "#97b0ff", "accent_fg": "#0f1320",
        "hover": "#363d4c", "ok": "#1f4a33", "warn": "#5a4521", "bad": "#5c2b2b", "bad_text": "#ff9b92",
        "danger": "#ff9b92",
    },
}
P = dict(PALETTES["clair"])  # palette courante (modifiée en place par apply)

THEME_OPTIONS = [("clair", "Clair"), ("sombre", "Sombre"), ("auto", "Automatique (suit Windows)")]


def resolve(mode):
    """'auto' suit le réglage clair/sombre de Windows ; ailleurs, clair."""
    if mode in PALETTES:
        return mode
    if sys.platform.startswith("win"):
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize") as k:
                return "clair" if winreg.QueryValueEx(k, "AppsUseLightTheme")[0] else "sombre"
        except OSError:
            pass
    return "clair"


def apply(root, mode="clair"):
    """Applique la palette à la fenêtre : polices, styles ttk, couleurs par défaut des widgets Tk."""
    name = resolve(mode)
    P.clear()
    P.update(PALETTES[name])
    p = P
    style = ttk.Style(root)
    style.theme_use("clam")

    family = "Segoe UI" if "Segoe UI" in tkfont.families() else tkfont.nametofont("TkDefaultFont").actual("family")
    for fname in ("TkDefaultFont", "TkTextFont", "TkMenuFont", "TkHeadingFont", "TkCaptionFont"):
        tkfont.nametofont(fname).configure(family=family, size=10)
    tkfont.nametofont("TkFixedFont").configure(size=10)
    small = (family, 9)

    root.configure(bg=p["bg"])
    flat = dict(lightcolor=p["border"], darkcolor=p["border"], bordercolor=p["border"])
    style.configure(".", background=p["bg"], foreground=p["text"], fieldbackground=p["surface"], troughcolor=p["bg"],
                    bordercolor=p["border"], focuscolor=p["bg"], selectbackground=p["accent"], selectforeground=p["accent_fg"])
    style.configure("TFrame", background=p["bg"])
    style.configure("TLabel", background=p["bg"], foreground=p["text"])
    style.configure("Muted.TLabel", foreground=p["muted"])
    style.configure("Title.TLabel", font=(family, 22, "bold"), foreground=p["accent"])
    style.configure("H1.TLabel", font=(family, 15, "bold"))
    style.configure("Bold.TLabel", font=(family, 10, "bold"))
    style.configure("Error.TLabel", foreground=p["bad_text"])
    style.configure("Bar.TFrame", background=p["surface"])
    style.configure("Bar.TLabel", background=p["surface"], foreground=p["muted"])
    style.configure("BarStrong.TLabel", background=p["surface"], foreground=p["text"], font=(family, 10, "bold"))
    style.configure("BarTitle.TLabel", background=p["surface"], foreground=p["accent"], font=(family, 12, "bold"))
    style.configure("TSeparator", background=p["border"])

    # boutons : plats, discrets ; « Accent » pour l'action principale
    style.configure("TButton", background=p["surface2"], foreground=p["text"], padding=(11, 5), width=0, relief="flat", borderwidth=1, **flat)  # width=0 : largeur du texte
    style.map("TButton", background=[("pressed", p["hover"]), ("active", p["hover"])], bordercolor=[("focus", p["accent"])])
    style.configure("Accent.TButton", background=p["accent"], foreground=p["accent_fg"], bordercolor=p["accent"],
                    lightcolor=p["accent"], darkcolor=p["accent"], font=(family, 10, "bold"))
    style.map("Accent.TButton", background=[("pressed", p["accent_hover"]), ("active", p["accent_hover"])])
    style.configure("Danger.TButton", foreground=p["danger"])
    style.configure("Plus.TButton", padding=(9, 4), font=(family, 11, "bold"))
    style.configure("Mini.TButton", padding=(4, 1), font=small, width=0)
    # onglets / sélecteurs en « pilules »
    style.configure("Pill.Toolbutton", background=p["surface2"], foreground=p["text"], padding=(12, 5), relief="flat", borderwidth=0, **{**flat, "bordercolor": p["surface2"]})
    style.map("Pill.Toolbutton", background=[("selected", p["accent"]), ("active", p["hover"])],
              foreground=[("selected", p["accent_fg"])])
    style.configure("Bar.TRadiobutton", background=p["surface"])

    for w in ("TEntry", "TSpinbox", "TCombobox"):
        style.configure(w, fieldbackground=p["surface"], foreground=p["text"], insertcolor=p["text"], padding=4, **flat)
        style.map(w, bordercolor=[("focus", p["accent"])], lightcolor=[("focus", p["accent"])], darkcolor=[("focus", p["accent"])])
    style.configure("Cell.TEntry", padding=(3, 0))
    style.configure("TCombobox", background=p["surface2"], arrowcolor=p["muted"])
    style.configure("TSpinbox", background=p["surface2"], arrowcolor=p["muted"])
    style.map("TCombobox", fieldbackground=[("readonly", p["surface"])], foreground=[("readonly", p["text"])],
              selectbackground=[("readonly", p["surface"])], selectforeground=[("readonly", p["text"])])
    for w in ("TCheckbutton", "TRadiobutton"):
        style.configure(w, background=p["bg"], foreground=p["text"], indicatorbackground=p["surface"], indicatorforeground=p["accent"],
                        indicatorcolor=p["surface"], **flat)
        style.map(w, indicatorcolor=[("selected", p["accent"])], background=[("active", p["bg"])])
    style.configure("TLabelframe", background=p["bg"], **flat)
    style.configure("TLabelframe.Label", background=p["bg"], foreground=p["muted"], font=(family, 10, "bold"))
    style.configure("Treeview", background=p["surface"], fieldbackground=p["surface"], foreground=p["text"], rowheight=26, borderwidth=1, **flat)
    style.map("Treeview", background=[("selected", p["accent"])], foreground=[("selected", p["accent_fg"])])
    style.configure("Treeview.Heading", background=p["surface2"], foreground=p["muted"], relief="flat", padding=(6, 5), font=(family, 9, "bold"), **flat)
    style.map("Treeview.Heading", background=[("active", p["hover"])])
    for o in ("Vertical", "Horizontal"):
        style.configure(f"{o}.TScrollbar", background=p["border"], troughcolor=p["bg"], bordercolor=p["bg"], lightcolor=p["border"],
                        darkcolor=p["border"], arrowcolor=p["muted"], arrowsize=13, gripcount=0, relief="flat")
        style.map(f"{o}.TScrollbar", background=[("active", p["muted"])])

    # widgets Tk « classiques » (zones de texte, champs du tableau, listes déroulantes, fenêtres)
    for cls in ("Text", "Entry"):
        root.option_add(f"*{cls}.background", p["surface"])
        root.option_add(f"*{cls}.foreground", p["text"])
        root.option_add(f"*{cls}.insertBackground", p["text"])
        root.option_add(f"*{cls}.selectBackground", p["accent"])
        root.option_add(f"*{cls}.selectForeground", p["accent_fg"])
        root.option_add(f"*{cls}.highlightThickness", 1)
        root.option_add(f"*{cls}.highlightBackground", p["border"])
        root.option_add(f"*{cls}.highlightColor", p["accent"])
        root.option_add(f"*{cls}.relief", "flat")
        root.option_add(f"*{cls}.font", "TkTextFont")
    root.option_add("*Toplevel.background", p["bg"])
    root.option_add("*TCombobox*Listbox.background", p["surface"])
    root.option_add("*TCombobox*Listbox.foreground", p["text"])
    root.option_add("*TCombobox*Listbox.selectBackground", p["accent"])
    root.option_add("*TCombobox*Listbox.selectForeground", p["accent_fg"])
    root.option_add("*TCombobox*Listbox.font", "TkTextFont")
    return name
