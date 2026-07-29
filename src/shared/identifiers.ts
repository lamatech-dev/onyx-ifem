import { randomBytes } from "node:crypto";

export function uuidV7(now = new Date()): string {
  const bytes = randomBytes(16);
  const milliseconds = BigInt(now.getTime());

  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number((milliseconds >> BigInt((5 - index) * 8)) & 0xffn);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function utcInstant(now: Date): string {
  return now.toISOString().replace(/\.(\d{3})Z$/, ".$1000Z");
}

