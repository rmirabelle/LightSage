# Windows installer

Build with `npm run dist:win` from the repository root. This creates an offline NSIS installer for Windows x64. Administrator access is used for installation and local-subnet firewall configuration; the app runs as the signed-in user.

## Payload and data

- Electron shell in `resources/app.asar`.
- Controller and its dependencies in `resources/tools/matter-probe`.
- Private Node and Python/Bleak runtimes in `resources/desktop/runtime`.
- Per-user controller identity, certificates, settings, and logs in `%APPDATA%/LightSage/controller`.
- Upgrade/uninstall preserve user data. Uninstall removes the installer-owned firewall rule.
- Certificates use all detected IPv4 addresses and renew at startup when addresses change or expiration approaches. The CA is preserved so phones do not need to trust a new authority after each update.

Runtime downloads happen on the build machine only. Python uses its isolated `_pth` configuration and vendored dependencies; no Python installation, PATH change, or pip execution happens on the user's computer. `versions.json` records bundled runtime versions. Python and Node licenses accompany their runtimes; Python package distributions retain their metadata/licenses.

## Verification

```powershell
npm run test:installation
npm run test:service-controls
node desktop/test-packaged.cjs
```

The packaged test uses fresh temporary data and ports 3542–3544. It imports the packaged Bluetooth libraries, starts the packaged controller with the packaged Node executable, verifies trusted HTTPS login and the phone setup page, then shuts down. It does not commission or control lights.

Before distributing a release, verify on a clean Windows 10/11 x64 VM with no Node, Python, Git, or OpenSSL:

1. Disconnect internet, install, and launch. Verify the window/tray, empty light list, phone setup address, and first-run TLS generation.
2. Verify the firewall rule is program-scoped, LocalSubnet-only, and Private/Domain-only; test a real phone on the local network.
3. Add a Matter bulb and H6159 strip on suitable hardware; test controls and restart persistence.
4. Enable sign-in startup, sign out/in, and verify hidden launch plus tray restoration.
5. Upgrade over the installation and verify identity/scenes/certificates survive.
6. Uninstall and verify shortcuts/firewall removal and preserved user data.

This development build is unsigned. Configure electron-builder signing credentials before a signed public release. Publishing an installer does not happen as part of the build.

## Setup recovery

The controller File menu includes Back up setup, Restore setup, and Exit LightSage. Startup also exposes Restore setup without depending on the HTTP service. Backups are verified directories with a versioned manifest; the restore engine stages and verifies files before replacing state, preserves the prior directory as a reusable backup, and keeps a recovery journal until the restored worker reports ready. Run `npm run test:restore` and `npm run test:service-controls` for integrity, interrupted-operation, authorization, and startup-failure rollback checks.
