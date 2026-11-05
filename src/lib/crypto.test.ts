import { randomBytes } from "node:crypto";
import { beforeAll, expect, it } from "vitest";
import { decrypt, encrypt } from "./crypto";

beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

it("round-trips and detects tampering", () => {
  const sealed = encrypt("refresh-token");
  expect(sealed).not.toContain("refresh-token");
  expect(decrypt(sealed)).toBe("refresh-token");
  const buf = Buffer.from(sealed, "base64");
  buf[buf.length - 1] ^= 1;
  expect(() => decrypt(buf.toString("base64"))).toThrow();
});
