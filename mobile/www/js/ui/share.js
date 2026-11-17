// Envoi d'un fichier avec un message clair si le partage échoue.
import { shareFile } from "../platform.js";
import { toast } from "./dom.js";

export async function shareOrWarn(name, text, mime) {
  const r = await shareFile(name, text, mime);
  if (r === "failed") toast("Envoi impossible : le fichier n'a pas pu être partagé.", "bad");
  return r;
}
