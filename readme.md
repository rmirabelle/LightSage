# LightSage

Local-only lighting management for approximately 20 Govee H6013 bulbs, using an
iPhone PWA and an always-on Windows controller. No cloud APIs, Mac, or Apple
developer account required.

## Working prototype

### Govee H6159 Bluetooth strip

Add light now includes **Govee H6159 · Bluetooth**. Select that device type, choose
**Find nearby strips**, select the strip, give it a name and optionally choose a
room, then choose **Add strip**. No Matter code or cloud account is needed.
Restart the controller service after installing backend changes; refresh the phone.

The Windows PC needs Bluetooth and Python with Bleak. This checkout already has
`tools/matter-probe/.ble-venv/Scripts/python.exe`. For a fresh installation, run
`python -m venv tools/matter-probe/.ble-venv`, then
`tools/matter-probe/.ble-venv/Scripts/python.exe -m pip install bleak==3.0.2`.
Alternatively set `LIGHTSAGE_BLE_PYTHON` to a Python executable containing Bleak.
The helper runs hidden and uses local Bluetooth only. Close Govee Home if the
strip is busy with the phone. Each bounded request disconnects afterward.

Supported controls are power, brightness and whole-strip RGB color, with device
readback after writes. Rooms and saved scenes include the strip. Scenes preserve
exact RGB and brightness bytes; an active Govee effect cannot be saved as a solid
color scene. White temperature, Full White/Restore, Identify, Gradient and Music
are disabled for this model. Mixed rooms apply those controls only to supported
lights. Bluetooth reconnection adds latency, so these controls are slower than
Matter bulbs. Failed reads show unavailable instead of cached state.

Run `node tools/matter-probe/test-h6159.mjs` for simulated integration checks.
`node tools/matter-probe/check-h6159-live.mjs <Bluetooth-address>` is an explicit
hardware test: it briefly changes power, brightness and color, then restores the
original solid-color state. A recovery snapshot is saved in `.state` first.
The H6159 in this workspace passed live power, brightness and RGB readback tests.

The primary view is a full-width room selector with **ALL ROOMS** first (including
unassigned bulbs). Power, Full White/Restore (flashlight off/on icons), and Lights are in the toolbar
directly below it. Lights toggles between the room controls and an inline light list.
The pencil beside the room selector renames the selected room; ALL ROOMS stays fixed.
White mode shows temperature;
Color mode shows a large wheel and applies changes while dragging, coalescing pending
positions. Color appears first and is the default control view, without changing bulbs
on load. The wheel marker shows the observed hue/saturation (including conversion from
XY); white is centered and mixed/unknown colors have no single marker. Individual
controls are available from each bulb on the Lights screen.

The header uses `resource/logo.png` and background `#222612`; the supplied app icon
is used for the desktop and PWA. Connection status is indicated next to the logo.
Refresh, Add room, Add light, and Settings have icons in the right hamburger menu. Naming,
pairing, desktop startup, and device connection remain in Settings; Add room,
Settings, Lights, and individual controls are full-screen views. Their close buttons
return to the previous screen.
UI verification is performed by the user. Automated checks cover backend behavior.

The controller fills missing device details in the background while a visible app
is polling. It uses already connected, available lights, one at a time, and yields
between attributes when controls, pairing, reconnection, Music or Gradient need
the connection. Hardware reads stay outside the command queue; an in-flight read
may finish, but no further metadata reads begin until idle. Failed attempts wait
at least a minute before retrying. Fetching stops when clients stop polling
(within 15 seconds). Existing details, including partial records, are preserved;
use Refresh details to reread them. Normal state updates populate the phone cache.

Two real bulbs, **Dining R** and **Dining L**, are paired with the Windows Matter
controller and belong to **Dining Room**. The room selector controls rooms or all
lights; the Lights tab provides individual controls. Mixed settings are shown explicitly.
The browser interface provides power, brightness, white temperature, and a
**Full White toggle**: 100% at 4400 K, with a second tap restoring the previous
power, brightness, and active color settings. The restore snapshot survives a
controller restart. Group Full White saves each member independently. Individual
and group overrides cannot overwrite one another: restore the existing override
first. Partial restores retain the unsuccessful bulbs' snapshots for retry.

Launch **LightSage.lnk** or **LightSage.cmd** in this directory, or run `npm start`.
This opens the Windows desktop app and starts its bundled controller. The desktop
signs in automatically; existing iPhone sessions and paired bulbs are preserved.
In this development checkout, changes to frontend files in `tools/matter-probe/web`
or image assets in `resource` automatically reload the desktop window after a short
pause. The lighting controller stays running. This is a full UI reload, so open
forms reset; the iPhone still requires a manual reload. Backend changes require
**Restart** on the Service tab; changes to the Electron shell require ending the LightSage desktop process
in Task Manager and launching it again. Run `npm run test:frontend-watch` to check
the file watcher without connecting to bulbs.
Closing the window hides it to the tray. Left-click the tray icon to restore it.
Use **Stop** on the Service tab to stop the controller.

The Controller's Service tab shows a colored status dot and matching bold status:
neon green for Running, amber for transitions, salmon for Stopped, and red for a startup
error. **Stop** shuts down the lighting service while leaving the desktop window
available; it stays stopped until **Start** is chosen. **Restart** stops and starts
it again. Unexpected exits still trigger automatic recovery. Stop and Restart are
blocked while pairing. Run `npm run test:service-controls` for simulated lifecycle
and control authorization checks without changing bulbs.

The **Log** tab shows the latest 180 lines from the last 48 KB of
`tools/matter-probe/.state/desktop.log`. Click its file path to open Explorer with
the file selected. Logs append across restarts with no automatic rotation or
deletion. The Live checkbox pauses display refresh only; file logging continues.
Windows startup changes are read back after saving so failed registrations show
an error instead of appearing to succeed.

**Start with Windows** in the app enables launch at Windows sign-in,
with the window hidden. It is off by default. Controller crashes restart automatically
while the desktop app is running. This is a development desktop shell, not yet a
signed installer; its launcher and startup entry depend on this project staying here.

For a fresh checkout: install root and `tools/matter-probe` dependencies with
`npm ci` in each directory, then `npm run setup:desktop` to copy the current Node
runtime and download Electron. Controller identity and TLS setup remain prerequisites.
Use `npm run start:controller` only when running without the desktop app.

- Desktop: http://127.0.0.1:3442
- iPhone certificate setup, once the local firewall permits it: http://10.0.0.250:3444
- iPhone app: https://10.0.0.250:3443
- Controller access code: `tools/matter-probe/.state/access-code.txt`

The desktop app must stay running, and startup occurs at sign-in, not before Windows
login. It is not a Windows service. Its private controller identity, access code,
TLS keys, and restore snapshot live in `tools/matter-probe/.state`; preserve this
directory and do not commit or share its contents. Stop the server before running
the standalone Matter diagnostics, which use the same controller identity.
Desktop logs and the smoke-test report also live in that private directory.
`npm run test:desktop` (with LightSage quit first) verifies desktop authentication,
renderer isolation, close-to-tray behavior, and controller crash recovery without
changing light settings. It exits when done.

## Saved scenes

The Scenes strip below the room toolbar saves and recalls lighting for the selected
room. Select **ALL ROOMS** for whole-house scenes, including unassigned bulbs.
Adjust the lights, choose **＋ Save**, and enter a name. Saving does not change the
lights. Each scene stores every member's power, brightness, and active color or
white settings separately. Gradients save their colors, speed, and repeat setting
and restart when applied. Stop Music and restore affected Full White overrides
before saving; Music sessions are not saved.

Tap a scene to apply it. Its **⋯** menu offers Rename, Replace with current settings,
and Delete; replacement and deletion ask for confirmation. Whole-house scenes are
independent snapshots, not references to room scenes. Scenes live in the Windows
controller's existing local settings file and are shared across phone and desktop.

Saving copies the controller's last confirmed settings, which normal polling and
control responses keep current. It reads only lights whose settings are missing,
incomplete, or known to be unavailable, and refuses to save a partial scene.
The save response reuses those observations instead of reading the lights again.
Changes made outside LightSage are included once observed by the controller.
Applying reports
per-bulb failures and offers **Retry failed lights** without reapplying successful
bulbs. Full White must be restored before applying a scene to affected bulbs.
Room membership changes mark scenes **Update** and require replacement before
application, preventing an old room scene from controlling a moved bulb. New bulbs
are not automatically added to whole-house scenes; replace the scene to include
them. Applying a whole-house scene otherwise affects only its saved bulbs.

Run `npm --prefix tools/matter-probe run test:scenes` for simulated scene persistence,
restoration, failure, retry, gradient, override, and membership checks. Visual UI
and real-bulb scene verification are performed by the user.

## Bulbs and rooms

Open **Bulbs and rooms** below the lighting controls on either Windows or iPhone.
Create rooms under **Manage rooms**. **Add light** takes a numeric Matter setup code,
a name, and an existing room (or Unassigned). The bulb must already be on the local
Wi-Fi network with its Matter pairing window open; this flow does not provision Wi-Fi
over Bluetooth. An existing Matter controller may need to supply a sharing code.
Pairing runs on the desktop and its status survives closing/reopening the UI, but not
a controller restart. Light controls pause while pairing. Setup codes are not stored
in application settings or returned in job status.

**Edit a bulb** provides Identify for five seconds, renaming, and moving between
rooms. Room membership changes are blocked while any affected room/bulb has saved
Full White settings. Names may still be edited. Empty rooms have no active controls.
The first UI pairing of an additional physical bulb remains to be verified; the
pairing code uses the same local Matter path used for Dining R and Dining L.

Run `npm --prefix tools/matter-probe run test:management` for simulated management,
failure, and pairing tests.

## iPhone setup

After one successful load with the lighting service running, the installed iPhone
app saves its interface and last confirmed rooms locally. It can then open with
disabled controls when the service is stopped or unreachable. Cached rooms never
establish a live connection; only a fresh lighting response re-enables controls.
Without saved rooms, the app shows a waiting message. API responses and commands
are not cached by the service worker, and signing out via an expired session clears
the saved room snapshot. Frontend changes generate a new shell fingerprint; the
phone installs a complete updated shell before switching to it.

Run `npm --prefix tools/matter-probe run test:offline-shell` and
`npm --prefix tools/matter-probe run test:ui-connection` for simulated unavailable
service, offline launch, and reconnection checks. An iPhone must load this update
once while the service is running before its offline launch behavior changes.

Use the same home network as the desktop. Open the certificate setup address above,
download **LightSage Local CA**, and install the profile through Settings → General
→ VPN & Device Management. Then enable its trust under Settings → General → About
→ Certificate Trust Settings. Open the HTTPS app, enter the controller access code,
then use Safari's Share → Add to Home Screen.

This explicitly trusts a certificate authority owned by your Windows PC. Its private
key stays on the PC. The HTTP setup port serves only the public certificate and
instructions; lighting control and login on the LAN use HTTPS. See
[Apple's certificate-trust instructions](https://support.apple.com/en-us/102390).

Addresses and certificates currently use the PC's IP `10.0.0.250`. A router DHCP
reservation or stable local naming is needed before long-term use. Local signed
sessions have no application expiration and survive service restarts. Browser cookies
use a 400-day lifetime renewed on use (subject to browser retention policies). Changing the controller
access code invalidates existing sessions. Clearing browser data also removes login.

The installed iPhone Home Screen app may keep its login separate from Chrome.
In a connected browser, select **Connect another device** to generate a six-digit
code, then open LightSage directly from the Home Screen and enter it there.
The setup code is single-use, valid for ten minutes, and limited to five guesses;
the resulting saved session has no application expiration. Generating another code
replaces the previous unused code. A controller restart discards unused setup codes.
For desktop setup, `node tools/matter-probe/create-link-code.mjs` prints a fresh code.

## Verified

Group commands and state reads run concurrently across bulbs. Each bulb's Full
White and Restore steps remain ordered and confirmed, with bounded retries.
All original snapshots are saved before Full White begins; restore snapshot writes
remain sequential to protect saved settings. Updates overlap but are not guaranteed
to occur at exactly the same instant.

- Local pairing with product H6013 and fresh state reads after controller restart.
- Brightness command and confirmed restoration of the original brightness.
- Full White at 4400 K (227 mireds, approximately 4405 K), persisted snapshot across restart, and confirmed restoration
  of the bulb's original white state.
- Browser Full White and Restore actions against the real bulb.
- Local HTTPS certificate validation, access-code login, secure session cookies,
  rejection of unauthenticated reads and cross-origin writes.

Run `npm run test:api` with the server running. Run
`npm --prefix tools/matter-probe run test:groups` for simulated failure/retry checks.
The hardware group Full White test is
`npm --prefix tools/matter-probe run test:full-white` with the server stopped; it
temporarily changes both Dining Room bulbs and restores their individual settings.
Independent levels (18 and 254) were verified across restart and restore. Color-mode restore branches and
bulb-outage recovery still need dedicated hardware validation.

## Architecture status

This first vertical slice uses Node.js, a small browser UI, and local JSON state to
prove hardware integration. The React/TypeScript/SQLite structure in
[ARCHITECTURE.md](ARCHITECTURE.md) remains the proposed product foundation.

The prototype performs local attestation checks but needs an offline manufacturer
trust store for full attestation. Internet-disconnected end-to-end testing, iPhone
additional iPhone group testing, persistent subscriptions, Windows startup packaging,
and additional bulbs remain outstanding. The user verified single-bulb control on
iPhone after installing the local CA. The existing sign-in QR still works after
restarting the service. Pre-update in-memory sessions require one final sign-in;
new sessions were verified across a real server restart.
