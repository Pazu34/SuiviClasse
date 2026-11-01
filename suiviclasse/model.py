"""Données de l'application : de simples dictionnaires (ce qui est écrit dans le coffre chiffré)
et quelques fonctions de calcul.

    {"version": 1, "settings": {"annee": ""}, "classes": [classe, …], "ui": {"classe": id, "trimestre": 1}}
    classe = {"id", "nom", "eleves": [eleve, …]}
    eleve  = {"id", "nom", "prenom", "naissance", "infos",
              "notes": {"1": 14.5 | None, "2": …, "3": …}, "comms": {"1": "", …}, "events": [evenement, …]}
    evenement = {"id", "type": "seance" | "travail" | "oubli", "t": 1..3, "v": ±0.5, ±1 (séance) ou 1,
                 "date": ISO 8601 UTC, "note": ""}
Les notes et commentaires sont indexés par le numéro de trimestre écrit en texte ("1", "2", "3").
"""
import secrets
from datetime import datetime, timezone

from .exchange import norm

TYPES = {"seance": "Séance", "travail": "Travail non fait", "oubli": "Oubli de matériel"}


def uid():
    return secrets.token_hex(5)


def new_data():
    return {"version": 1, "settings": {"annee": ""}, "classes": [], "ui": {"classe": None, "trimestre": 1}}


def new_class(nom):
    return {"id": uid(), "nom": nom.strip(), "eleves": []}


def new_student(nom, prenom="", infos=""):
    return {"id": uid(), "nom": nom.strip(), "prenom": prenom.strip(), "naissance": "", "infos": infos,
            "notes": {"1": None, "2": None, "3": None}, "comms": {"1": "", "2": "", "3": ""}, "events": []}


def sort_students(cls):
    cls["eleves"].sort(key=lambda s: (norm(s["nom"]), norm(s["prenom"])))


def sort_classes(data):
    data["classes"].sort(key=lambda c: norm(c["nom"]))


def count(student, type_, t):
    return sum(1 for e in student["events"] if e["type"] == type_ and e["t"] == t)


def seance(student, t):
    """(total des points positifs, total des points négatifs) du trimestre."""
    vals = [e["v"] for e in student["events"] if e["type"] == "seance" and e["t"] == t]
    return sum(v for v in vals if v > 0), sum(v for v in vals if v < 0)


def stats(student, t):
    plus, moins = seance(student, t)
    return plus, moins, count(student, "travail", t), count(student, "oubli", t)


def moyenne(student):
    vals = [v for v in student["notes"].values() if v is not None]
    return sum(vals) / len(vals) if vals else None


def add_event(student, type_, t, v, note=""):
    student["events"].append({"id": uid(), "type": type_, "t": t, "v": v, "note": note,
                              "date": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")})


def remove_last(student, type_, t):
    for i in range(len(student["events"]) - 1, -1, -1):
        e = student["events"][i]
        if e["type"] == type_ and e["t"] == t:
            del student["events"][i]
            return


def event_datetime(event):
    """Date locale d'un événement."""
    return datetime.fromisoformat(event["date"].replace("Z", "+00:00")).astimezone()


def level(n, orange, rouge):
    """Couleur d'un compteur : 'ok' (0), 'warn' (≥ orange), 'bad' (≥ rouge) ou '' ."""
    return "bad" if n >= rouge else "warn" if n >= orange else "ok" if n == 0 else ""
