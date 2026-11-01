import base64
import json
import tempfile
import unittest
from pathlib import Path

from suiviclasse.vault import NeedPasswordError, Vault, WrongPasswordError


def tmp():
    return Path(tempfile.mkdtemp(prefix="vault-"))


class VaultTest(unittest.TestCase):
    def test_creation_relecture_et_mauvais_mot_de_passe(self):
        d = tmp()
        secret = "Classe-confidentielle-6A"  # assez long pour qu'une rencontre par hasard dans du texte chiffré soit impossible
        Vault(d).create("Pässwörd é", {"classes": [{"nom": secret, "eleves": [{"nom": "Élève Très Particulier"}]}]})
        raw = (d / "suivi.enc").read_text(encoding="utf-8")
        cipher = base64.b64decode(json.loads(raw)["data"])
        for clair in (secret, "Élève Très Particulier"):
            self.assertNotIn(clair, raw)
            self.assertNotIn(clair.encode("utf-8"), cipher)
        with self.assertRaises(WrongPasswordError):
            Vault(d).unlock("mauvais")
        self.assertEqual(Vault(d).unlock("Pässwörd é")["classes"][0]["nom"], secret)

    def test_sauvegarde_et_detection_de_modification(self):
        d = tmp()
        v = Vault(d)
        v.create("secret", {"n": 1})
        v.save({"n": 2})
        self.assertEqual(Vault(d).unlock("secret")["n"], 2)
        f = d / "suivi.enc"
        j = json.loads(f.read_text(encoding="utf-8"))
        j["v"] = 99  # en-tête modifié
        f.write_text(json.dumps(j), encoding="utf-8")
        with self.assertRaises(WrongPasswordError):
            Vault(d).unlock("secret")

    def test_changement_de_mot_de_passe(self):
        d = tmp()
        v = Vault(d)
        v.create("ancien", {"n": 1})
        with self.assertRaises(WrongPasswordError):
            v.change_password("faux", "nouveau", {"n": 1})
        v.change_password("ancien", "nouveau", {"n": 3})
        with self.assertRaises(WrongPasswordError):
            Vault(d).unlock("ancien")
        self.assertEqual(Vault(d).unlock("nouveau")["n"], 3)

    def test_archives(self):
        d = tmp()
        v = Vault(d)
        v.create("secret", {"n": 1})
        self.assertTrue(v.snapshot("auto"))
        self.assertIsNone(v.snapshot("auto"), "rien n'a changé : pas de nouvelle archive")
        v.save({"n": 2})
        second = v.snapshot("manuel")
        self.assertTrue(second)
        archives = v.list_archives()
        self.assertEqual([a["name"] for a in archives][0], second)
        self.assertEqual(v.read_archive(archives[1]["name"])["n"], 1)
        self.assertEqual(v.read_archive(archives[0]["name"])["n"], 2)
        with self.assertRaises(ValueError):
            v.read_archive("../suivi.enc")

        # changement de mot de passe : les anciennes archives demandent l'ancien mot de passe
        v.change_password("secret", "autre", {"n": 3})
        with self.assertRaises(NeedPasswordError):
            v.read_archive(second)
        with self.assertRaises(WrongPasswordError):
            v.read_archive(second, "faux")
        self.assertEqual(v.read_archive(second, "secret")["n"], 2)

    def test_elagage(self):
        d = tmp()
        v = Vault(d)
        v.create("secret", {"n": 1})
        (d / "sauvegardes").mkdir()
        for name in ("suivi-2026-01-01_10-00-00-auto.enc", "suivi-2026-01-01_09-00-00-auto.enc",
                     "suivi-2026-01-02.enc", "suivi-2026-01-03_08-00-00-auto.enc", "suivi-2026-01-04_08-00-00-auto.enc"):
            (d / "sauvegardes" / name).write_bytes(b"{}")
        self.assertEqual(v.prune(2, 1), 2)  # 2 récentes + la plus récente d'un jour plus ancien
        self.assertEqual(len(v.list_archives()), 3)
        self.assertEqual(v.list_archives()[2]["name"], "suivi-2026-01-02.enc")


if __name__ == "__main__":
    unittest.main()
