// Worker : calcule scrypt hors du fil de l'interface (1 à 3 secondes sur une tablette).
import { scrypt } from "./scrypt.js";

self.onmessage = async (e) => {
  const { password, salt, N, r, p, dkLen } = e.data;
  try {
    const key = await scrypt(password, salt, N, r, p, dkLen, (x) => self.postMessage({ progress: x }));
    self.postMessage({ key }, [key.buffer]);
  } catch (err) {
    self.postMessage({ error: String(err && err.message || err) });
  }
};
