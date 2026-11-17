// scrypt (RFC 7914) en JavaScript pur : WebCrypto n'offre que PBKDF2, pas scrypt.
// Le résultat est identique à hashlib.scrypt de Python, ce qui permet d'ouvrir sur la tablette le fichier « suivi.enc » du PC.
// Seules les deux étapes PBKDF2-HMAC-SHA256 passent par WebCrypto ; le cœur (ROMix) tourne ici, de préférence dans un Worker.

async function pbkdf2(password, salt, length) {
  const key = await crypto.subtle.importKey("raw", password, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 1 }, key, length * 8);
  return new Uint8Array(bits);
}

function rotl(a, b) { return (a << b) | (a >>> (32 - b)); }

// Salsa20/8 sur 16 mots (little-endian), en place sur `x` ; `t` est un tampon de 16 mots.
function salsa8(x, t) {
  let x0 = t[0] = x[0], x1 = t[1] = x[1], x2 = t[2] = x[2], x3 = t[3] = x[3];
  let x4 = t[4] = x[4], x5 = t[5] = x[5], x6 = t[6] = x[6], x7 = t[7] = x[7];
  let x8 = t[8] = x[8], x9 = t[9] = x[9], x10 = t[10] = x[10], x11 = t[11] = x[11];
  let x12 = t[12] = x[12], x13 = t[13] = x[13], x14 = t[14] = x[14], x15 = t[15] = x[15];
  for (let i = 0; i < 8; i += 2) {
    x4 ^= rotl(x0 + x12 | 0, 7); x8 ^= rotl(x4 + x0 | 0, 9); x12 ^= rotl(x8 + x4 | 0, 13); x0 ^= rotl(x12 + x8 | 0, 18);
    x9 ^= rotl(x5 + x1 | 0, 7); x13 ^= rotl(x9 + x5 | 0, 9); x1 ^= rotl(x13 + x9 | 0, 13); x5 ^= rotl(x1 + x13 | 0, 18);
    x14 ^= rotl(x10 + x6 | 0, 7); x2 ^= rotl(x14 + x10 | 0, 9); x6 ^= rotl(x2 + x14 | 0, 13); x10 ^= rotl(x6 + x2 | 0, 18);
    x3 ^= rotl(x15 + x11 | 0, 7); x7 ^= rotl(x3 + x15 | 0, 9); x11 ^= rotl(x7 + x3 | 0, 13); x15 ^= rotl(x11 + x7 | 0, 18);
    x1 ^= rotl(x0 + x3 | 0, 7); x2 ^= rotl(x1 + x0 | 0, 9); x3 ^= rotl(x2 + x1 | 0, 13); x0 ^= rotl(x3 + x2 | 0, 18);
    x6 ^= rotl(x5 + x4 | 0, 7); x7 ^= rotl(x6 + x5 | 0, 9); x4 ^= rotl(x7 + x6 | 0, 13); x5 ^= rotl(x4 + x7 | 0, 18);
    x11 ^= rotl(x10 + x9 | 0, 7); x8 ^= rotl(x11 + x10 | 0, 9); x9 ^= rotl(x8 + x11 | 0, 13); x10 ^= rotl(x9 + x8 | 0, 18);
    x12 ^= rotl(x15 + x14 | 0, 7); x13 ^= rotl(x12 + x15 | 0, 9); x14 ^= rotl(x13 + x12 | 0, 13); x15 ^= rotl(x14 + x13 | 0, 18);
  }
  x[0] = x0 + t[0] | 0; x[1] = x1 + t[1] | 0; x[2] = x2 + t[2] | 0; x[3] = x3 + t[3] | 0;
  x[4] = x4 + t[4] | 0; x[5] = x5 + t[5] | 0; x[6] = x6 + t[6] | 0; x[7] = x7 + t[7] | 0;
  x[8] = x8 + t[8] | 0; x[9] = x9 + t[9] | 0; x[10] = x10 + t[10] | 0; x[11] = x11 + t[11] | 0;
  x[12] = x12 + t[12] | 0; x[13] = x13 + t[13] | 0; x[14] = x14 + t[14] | 0; x[15] = x15 + t[15] | 0;
}

// BlockMix : lit B (32*r mots à partir de `bo`), écrit le résultat dans `out` (à partir de `oo`).
function blockMix(B, bo, out, oo, r, X, T) {
  for (let i = 0; i < 16; i++) X[i] = B[bo + (2 * r - 1) * 16 + i];
  for (let i = 0; i < 2 * r; i++) {
    for (let k = 0; k < 16; k++) X[k] ^= B[bo + i * 16 + k];
    salsa8(X, T);
    const dest = oo + ((i & 1) ? r + (i >> 1) : (i >> 1)) * 16;
    for (let k = 0; k < 16; k++) out[dest + k] = X[k];
  }
}

// ROMix sur un bloc de 32*r mots (modifié en place).
function roMix(block, N, r, onProgress) {
  const size = 32 * r;
  const V = new Int32Array(size * N);
  const X = new Int32Array(size), Y = new Int32Array(size);
  const bx = new Int32Array(16), t = new Int32Array(16);
  X.set(block);
  const step = Math.max(1, N >> 6);
  for (let i = 0; i < N; i++) {
    V.set(X, i * size);
    blockMix(X, 0, Y, 0, r, bx, t);
    X.set(Y);
    if (onProgress && i % step === 0) onProgress(i / (2 * N));
  }
  for (let i = 0; i < N; i++) {
    const j = (X[(2 * r - 1) * 16] >>> 0) & (N - 1);  // N est une puissance de 2
    const base = j * size;
    for (let k = 0; k < size; k++) X[k] ^= V[base + k];
    blockMix(X, 0, Y, 0, r, bx, t);
    X.set(Y);
    if (onProgress && i % step === 0) onProgress(0.5 + i / (2 * N));
  }
  block.set(X);
}

function bytesToWords(bytes) {
  const w = new Int32Array(bytes.length / 4), dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  for (let i = 0; i < w.length; i++) w[i] = dv.getInt32(i * 4, true);
  return w;
}

function wordsToBytes(words) {
  const b = new Uint8Array(words.length * 4), dv = new DataView(b.buffer);
  for (let i = 0; i < words.length; i++) dv.setInt32(i * 4, words[i], true);
  return b;
}

/** scrypt(motDePasse, sel, N, r, p, longueur) -> Uint8Array ; onProgress(0..1) facultatif. */
export async function scrypt(password, salt, N, r, p, dkLen, onProgress) {
  if (N < 2 || (N & (N - 1)) !== 0) throw new Error("N doit être une puissance de 2");
  const B = await pbkdf2(password, salt, p * 128 * r);
  for (let i = 0; i < p; i++) {
    const words = bytesToWords(B.subarray(i * 128 * r, (i + 1) * 128 * r));
    roMix(words, N, r, onProgress ? (x) => onProgress((i + x) / p) : null);
    B.set(wordsToBytes(words), i * 128 * r);
  }
  return pbkdf2(password, B, dkLen);
}
