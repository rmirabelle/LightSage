# Plan: shared domain for trusted phone access

Status: proposal. Goal: a friend installs Light Sage, enters an invite code, and the phone connects with no certificate setup and no Cloudflare account.

## How it works

- Each install gets its own name under your domain, for example `k7p2x9.lights.robertmirabelle.com`.
- A small Cloudflare Worker, `lights-api.robertmirabelle.com`, holds your Cloudflare token. Friends' PCs never get the token.
- A friend's PC asks the Worker to (1) point its name at the PC's home address and (2) publish the Let's Encrypt proof record. The PC creates its own certificate key and asks Let's Encrypt directly, so the key never leaves the PC.
- Lighting traffic stays on each home network. The Worker only takes part in setup and renewal, about once every two months.

## Worker

Cloudflare Workers and Workers KV (a simple key-value store) are free at this size.

| Request | Does |
| --- | --- |
| `POST /v1/register` `{invite}` | Uses up a one-time invite. Returns `{id, secret, hostname}`. |
| `PUT /v1/address` `{ip}` | Sets the A record `<id>.lights…` (DNS only). Accepts only home-network addresses: 10.x, 172.16–31.x, 192.168.x. |
| `PUT /v1/challenge` `{value}` | Sets the TXT record `_acme-challenge.<id>.lights…`. |
| `DELETE /v1/challenge` | Removes that TXT record. |

- Each request after registration sends `Authorization: Bearer <secret>`. KV stores only a SHA-256 hash of the secret.
- The Worker can change only the two record names that belong to the calling install. Your website and email records stay safe.
- Limits: 10 challenge writes per install per day, and names must be `[a-z0-9]{6}`.
- Admin (you only, using the `wrangler` command-line tool): create an invite, list installs, and revoke an install. Revoking deletes the install's KV entry and its DNS records.
- Secrets: the Cloudflare token is stored with `wrangler secret put CF_TOKEN`, never in source or in the Light Sage app.

Source goes in `services/lights-api/` in this repository. Deploy with `wrangler deploy`.

## Light Sage changes

1. **`public-certificate.mjs`**: split the DNS steps into two providers with the same three functions (set address, set challenge, remove challenge):
   - `cloudflare`: the current direct mode, for your own PC.
   - `shared`: calls the Worker.
   The certificate request, the wait for the record, renewal, and the SNI selection stay the same.
2. **Config** (`public-https.json`, written by the app, not by hand):
   ```json
   { "mode": "shared", "service": "https://lights-api.robertmirabelle.com", "id": "k7p2x9", "secret": "…", "hostname": "k7p2x9.lights.robertmirabelle.com" }
   ```
   The service URL is not a secret and can ship in the app. The install secret stays in the data folder and in backups.
3. **Service tab card, "Trusted phone address"**: an invite code field and a **Turn on** button. The card then shows the phone address, the certificate end date, and the last error. A **Turn off** button deletes the config and returns the phone to Option A.
4. **Controller API**: `POST /api/public-https` (register and start issuing) and `GET /api/public-https` (status). Desktop only, not from the phone.

## Limits and failure cases

- Let's Encrypt allows 50 new certificates per week for `robertmirabelle.com`. Two or three installs use about one or two per month.
- If the Worker is down, current certificates keep working for up to 90 days. Renewal starts 30 days early and retries every 12 hours.
- Routers with DNS rebinding protection can block these names. The troubleshooting table already covers this.
- If you give up the domain or the Worker, friends go back to Option A.

## Steps

1. Build and deploy the Worker. Test it with `curl` against a test name.
2. Add the provider split and `shared` mode. Test against the Let's Encrypt staging service.
3. Add the Service tab card and the controller API.
4. Test the whole flow on a second Windows user account, first with staging, then for real.
5. Update the readme: Option B becomes "Enter an invite code". Move the own-domain guide to an advanced section.

## Simpler option (not recommended)

Buy a second, cheap domain only for Light Sage. Give each friend a Cloudflare token for that domain and a hand-written `public-https.json`. This needs no new code. But each friend's PC can change every record in that domain, and each friend must edit a file by hand.
