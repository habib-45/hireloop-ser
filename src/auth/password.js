import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, KEY_LENGTH, SCRYPT_PARAMS);

  return [
    "scrypt",
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    salt,
    Buffer.from(derived).toString("hex"),
  ].join("$");
}

export async function verifyPassword(password, encoded) {
  if (typeof encoded !== "string") {
    return false;
  }

  const parts = encoded.split("$");

  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }

  const [, nRaw, rRaw, pRaw, salt, hashHex] = parts;
  const N = Number.parseInt(nRaw, 10);
  const r = Number.parseInt(rRaw, 10);
  const p = Number.parseInt(pRaw, 10);

  if (
    !Number.isFinite(N) ||
    !Number.isFinite(r) ||
    !Number.isFinite(p) ||
    !salt
  ) {
    return false;
  }

  const expected = Buffer.from(hashHex, "hex");

  if (expected.length === 0) {
    return false;
  }

  try {
    const derived = await scrypt(password, salt, expected.length, { N, r, p });
    return timingSafeEqual(expected, Buffer.from(derived));
  } catch {
    return false;
  }
}
