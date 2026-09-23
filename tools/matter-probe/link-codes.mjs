import { randomInt, createHash, timingSafeEqual } from 'node:crypto';
const hash = code => createHash('sha256').update(code).digest();
export function linkCodes() {
  let pending;
  return {
    issue(now = Date.now()) {
      const code = String(randomInt(100000, 1000000));
      pending = { hash: hash(code), expires: now + 10 * 60 * 1000, remaining: 5 };
      return { code, expiresInMinutes: 10 };
    },
    consume(code, now = Date.now()) {
      if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return false;
      if (!pending || pending.expires <= now || pending.remaining <= 0) return false;
      pending.remaining--;
      if (!timingSafeEqual(hash(code), pending.hash)) return false;
      pending = undefined;
      return true;
    },
  };
}
