import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Browsers require a finite cookie lifetime. Renew it during use; signed tokens
// themselves have no expiration and never cause a scheduled logout.
export const cookieLifetimeSeconds = 400 * 24 * 60 * 60;
export function sessionTokens(accessCode) {
  // Stable local secret; changing the controller access code invalidates sessions.
  const key = createHmac('sha256', accessCode).update('LightSage session signing v1').digest();
  const sign = payload => createHmac('sha256', key).update(payload).digest('base64url');
  return {
    issue() {
      const payload = `v2.${randomBytes(24).toString('base64url')}`;
      return `${payload}.${sign(payload)}`;
    },
    valid(token) {
      if (typeof token !== 'string' || token.length > 160) return false;
      // Honor previously issued, correctly signed v1 sessions and upgrade their
      // cookies transparently. The user explicitly requested no expiration.
      const match = /^((?:v2|v1\.[0-9]{10})\.[A-Za-z0-9_-]{32})\.([A-Za-z0-9_-]{43})$/.exec(token);
      if (!match) return false;
      return timingSafeEqual(Buffer.from(match[2]), Buffer.from(sign(match[1])));
    },
  };
}
