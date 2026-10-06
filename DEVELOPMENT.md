# LightSage developer guide

This guide is for people who build or change LightSage. For installation and everyday use, see the [readme](readme.md).

The current implementation uses Electron, Node.js, Matter.js, a browser UI, and local JSON state. [ARCHITECTURE.md](ARCHITECTURE.md) contains design notes and a proposed future structure; it is not a description of a completed React/TypeScript/SQLite rewrite. Installer details are in [desktop/installer/README.md](desktop/installer/README.md).

## Build from source

Use Windows x64 with Git, Node.js 22.13+ and npm, plus Python 3.14 with pip:

```powershell
git clone https://github.com/rmirabelle/LightSage.git
cd LightSage
npm ci
npm --prefix tools/matter-probe ci
npm run dist:win
```

The build downloads the embedded Python distribution and pinned Bluetooth packages into an ignored staging directory, copies the build machine's Node runtime, and produces `dist/LightSage-Setup-<version>.exe`. The app payload excludes local controller state, credentials, and virtual environments. Set `LIGHTSAGE_BUILD_PYTHON` if the build Python is not on PATH. Code-signing credentials must be supplied separately for signed releases.

The installer bundles Electron, Node, a private Python runtime, and the Bluetooth libraries. Installation and first launch need no dependency downloads. Setup adds a local-subnet firewall rule for Private and Domain networks; Public networks are intentionally excluded.

## Publish a release

"Publish" means a complete release: new version, tests, installer, commit, push, and a GitHub release that installed copies update from.

1. Raise the version and commit it with your changes: `npm version patch --no-git-tag-version`, then `git commit`.
2. Run `npm run publish:win` (it runs [publish.ps1](publish.ps1)). It stops at the first failure.

The script checks that the tree is clean and the version is new, runs the simulated tests, builds `dist/LightSage-Setup-<version>.exe`, tests the packaged app, and checks the build for credentials ([check-secrets.cjs](desktop/check-secrets.cjs)). Then it pushes `main` and a `v<version>` tag, creates the public GitHub release with the installer, confirms that `releases/latest` points to it, and deletes older releases. It needs the GitHub CLI signed in (`gh auth login`).

### Automatic updates

The installed app checks `releases/latest` on the public GitHub repository 20 seconds after start and every 12 hours ([updater.cjs](desktop/updater.cjs)). When a newer version exists, the File menu shows a dot and **Update to <version>**. The user confirms; the app downloads the installer, checks its size and source, stops the lighting service, and quits. Then electron-builder's `elevate.exe` runs the installer silently (`/S --updated --force-run`) after a Windows permission prompt, and LightSage starts again. Data in `%APPDATA%/LightSage` is kept.

Only the update check uses the internet. Without internet, the check fails quietly and lighting control works as before. Source checkouts report updates but do not install them.

## Development mode

Exit the installed app using **File → Exit LightSage**, then run `npm run dev` from this checkout.

- The window displays DEVELOPMENT and serves local source files with automatic UI reloads. No build or installer is needed.
- It reuses the installed lights, scenes, and certificates, with a separate development browser profile.
- Only one controller can run at a time.
- Use **Service → Restart** after backend edits. Relaunch `npm run dev` after desktop shell edits. Refresh the phone separately.
- If no installed setup exists, it uses `tools/matter-probe/.state`. Set `LIGHTSAGE_STATE_DIR` to select a different setup.
- To develop Bluetooth support, install `desktop/installer/requirements.txt` into a Python environment and set `LIGHTSAGE_BLE_PYTHON` to its executable.

## Data folder

Installed-app data lives in `%APPDATA%/LightSage/controller/`. Development checkouts without an installed setup use `tools/matter-probe/.state/`. The folder holds the Matter controller identity, paired-device records, rooms, scenes, access code, TLS keys, restore snapshots, `public-https.json`, and logs (`desktop.log`). Upgrades and uninstall preserve it. It is excluded from Git.

Losing the Matter identity can require commissioning devices again. Changing the access code invalidates saved sessions. Backups use `manifest.json` plus `state/`; restore verifies every file, keeps the previous setup in a separate backup, and writes a recovery journal that is checked before the next controller startup. Older source builds can back up with `node desktop/backup-state.cjs` while stopped.

## Network and certificates

| Port | Binding | Purpose |
| --- | --- | --- |
| 3442 | loopback only, HTTP | Desktop window |
| 3443 | LAN, HTTPS | Phone app and API |
| 3444 | LAN, HTTP | Public setup page and certificate profile only; no API, secrets, or authentication |

On first launch the controller creates a local certificate authority and a server certificate for all detected IPv4 addresses (`tls/root.*`, `tls/server.*`). The server certificate renews when addresses change or expiry approaches. The authority is preserved so phones keep their trust.

### Own-domain certificate

When `public-https.json` exists, the controller also uses a Let's Encrypt certificate (`tls/public.*`, account key `tls/acme-account.key`). See [the user guide](docs/own-domain.md) for setup. Code: [public-certificate.mjs](tools/matter-probe/public-certificate.mjs).

```json
{ "hostname": "lights.example.com", "cloudflareToken": "…", "staging": true }
```

- `zoneId` is optional; without it the token also needs **Zone → Zone → Read**.
- `staging` uses the Let's Encrypt staging service. Delete `tls/public.*` and `tls/acme-account.key` after testing.
- At startup and every 12 hours, the controller points the hostname's A record (DNS only, not proxied) at the PC's local address and renews the certificate when fewer than 30 days remain. Issuance uses a DNS-01 challenge through the Cloudflare API, so no port is opened to the internet.
- The HTTPS server selects the certificate by SNI: the public hostname gets the Let's Encrypt certificate; IP addresses and `localhost` get the local one.
- When the public certificate is active, the phone URL and QR code use the hostname, and port 3444 redirects to it.
- Some routers block public names that resolve to private addresses (DNS rebinding protection).

## Tests

These checks use simulations or temporary files and do not control your lights:

```powershell
npm run test:service-controls
npm run test:frontend-watch
npm run test:installation
npm run test:restore
npm --prefix tools/matter-probe run test:management
npm --prefix tools/matter-probe run test:scenes
npm --prefix tools/matter-probe run test:schedules
node tools/matter-probe/test-h6159.mjs
```

`npm run test:api` requires the configured controller to be running. `npm run test:desktop` requires the desktop to be fully exited first and exercises controller crash recovery. Standalone controller diagnostics share the Matter identity and must not run alongside the app's controller. Hardware tests such as `test:full-white` and `check-h6159-live.mjs` change real lights; inspect their prerequisites before running them.

## Testing an installer on the development PC

1. Stop the existing controller and take a fresh verified backup.
2. Fully exit the old desktop app before starting the installed app. Leave the original checkout and state folder in place.
3. Install the new version, choose **Restore setup**, and select the verified backup folder. Confirm its counts; do not reset or re-pair the existing lights.
4. Check rooms, scenes, and connections. Before returning to the source app, back up the installed controller's latest state, fully exit it, and restore that backup in the source app so pairing state stays current.

## Known gaps

- Broader device compatibility and complete hardware coverage of color restoration and failure recovery.
- Clean-machine validation of installer execution, upgrade, and uninstall.
- Internet-disconnected end-to-end testing.
- Matter manufacturer trust-chain validation needs an offline trust store. The prototype is not a production-certified Matter controller.
- The current build is unsigned.
