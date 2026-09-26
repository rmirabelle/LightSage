# Use your own domain for phone access

Normally, your phone needs a LightSage security profile before it can connect. If you own a domain name, you can skip that step. LightSage then gets a free security certificate that every phone already trusts. With this setup, **Music** can also use your phone's microphone.

Your lights stay on your home network. Nothing on your PC is opened to the internet. The domain only gives your phone a trusted name for your PC, such as `lights.example.com`.

## What you need

- A domain name that you own, for example `example.com`.
- A free [Cloudflare](https://www.cloudflare.com) account to manage the domain's DNS. Your domain stays with the company where you bought it.
- A PC with a fixed address on your home network, for example `10.0.0.250`. Set a manual address in Windows, or reserve the address in your router.

## 1. Move your domain's DNS to Cloudflare

1. Sign in to Cloudflare and choose **Add a domain**. Enter your domain and pick the **Free** plan.
2. Cloudflare copies your existing DNS records. Compare them with the list at your domain company, especially your website and email (**MX**) records.
3. Email records must show **DNS only** (grey cloud), not **Proxied** (orange cloud). If a record such as `smtp`, `mail`, `pop`, or `imap` shows **Proxied**, edit it and switch it to **DNS only**.
4. Cloudflare shows two name servers. At your domain company, replace the domain's name servers with these two.
5. Wait for Cloudflare's email that says the domain is active. This usually takes a few hours or less.

## 2. Create a Cloudflare token for LightSage

1. In Cloudflare, go to **My Profile → API Tokens → Create Token**.
2. Choose the **Edit zone DNS** template.
3. Under **Permissions**, add the row **Zone → Zone → Read**. Keep the **Zone → DNS → Edit** row from the template.
4. Under **Zone Resources**, choose **Include → Specific zone → your domain**.
5. Choose **Continue to summary**, then **Create Token**. Copy the token. Cloudflare shows it only once.

If LightSage later reports "Authentication error", create a new token from the template. Editing an existing token's permissions did not always take effect in our tests.

## 3. Tell LightSage about your domain

1. Open the folder `%APPDATA%\LightSage\controller` (paste this into the File Explorer address bar).
2. Create a file named `public-https.json` with this text. Use your own name and token:

   ```json
   {
     "hostname": "lights.example.com",
     "cloudflareToken": "PASTE-YOUR-TOKEN-HERE"
   }
   ```

3. In LightSage, choose **Restart** on the Service tab.

LightSage creates the `lights` name in Cloudflare and gets the certificate. This takes about one minute. The Service tab then shows `https://lights.example.com:3443` and a new QR code.

## 4. Connect your phone

1. Connect the phone to your home Wi-Fi.
2. Scan the QR code on the Service tab, or type the address into Safari or Chrome.
3. Sign in with a code from **Connect another device** in the desktop app.
4. Add LightSage to your Home Screen from the browser's **Share** menu.

You do not need the security profile. You can remove an old LightSage profile from **Settings → General → VPN & Device Management**.

## Good to know

- LightSage renews the certificate by itself. It also updates the Cloudflare record if your PC's address changes.
- Keep the token private. It can change your domain's DNS records. It is included in LightSage backups, so keep backups private too.
- By creating `public-https.json`, you accept the [Let's Encrypt Subscriber Agreement](https://letsencrypt.org/repository/).
- If the phone cannot find `lights.example.com` but your PC can, your router may block names that point to home addresses. Look for **DNS rebinding protection** in the router settings and allow your domain.
- To stop using your domain, delete `public-https.json` and restart LightSage. The phone then needs the security profile again.
