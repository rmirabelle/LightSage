# Light Sage

Control your lights from your Windows PC or your iPhone. Light Sage runs on your PC and talks to your lights directly over your home network or Bluetooth. It does not use the Govee cloud, and you do not need a Mac or an Apple developer account.

**Status: working prototype.** 

Light Sage PC will act as your controller and must be running Light Sage for your phone to control the lights.

## What you can do

- Turn lights on and off, and change brightness, color, and white tone.
- Group lights into rooms, and control one room or all rooms at once.
- Save scenes and use them on the PC or the phone.
- Switch lights to bright white for a while, then put them back as they were.
- Make lights pulse with music, and show color gradients across several bulbs.
- Start Light Sage when you sign in to Windows, and keep it in the system tray.

## Lights that work

| Light | Connects by | Status |
| --- | --- | --- |
| **Govee H6013** bulb | Wi-Fi (Matter) | Tested. All features. |
| **Govee H6159** light strip | Bluetooth from the PC | Tested. Power, brightness, and color. No white tone, bright white, gradients, or music. |
| Other Govee or Matter lights | — | Not tested. They may not work. |

## Install Light Sage for Windows

Light Sage for Windows includes the Light Sage Controller as well as a fully functional copy of the mobile UI.

1. Run **LightSage-Setup.exe** on a Windows 10 or 11 PC.
2. Approve the administrator prompt. Windows may warn about an unknown publisher, because the app is not signed yet.
3. Open **Light Sage** from the Start menu.
4. Wait until the Service tab shows **Running**.

>  Your home network must be set to **Private** in Windows network settings.

Get the newest installer from the [GitHub releases page](https://github.com/rmirabelle/LightSage/releases/latest). After you install it, Light Sage checks for updates. When a new version is available, the **File** menu shows **Update to** and the version number. Your lights, rooms, and scenes stay when you update. Lighting control does not need the internet; only the update check does.

## Prepare your phone

Your phone must be on the same home Wi-Fi as the PC.

The phone app is a Progressive Web App (PWA), which is a web page that you add to your Home Screen. It is not a native iPhone or Android app. The first time, you must set up a secure connection to the PC in one of two ways.

**Option A: Install the Light Sage certificate (no domain needed)**

On iPhone:

1. On the PC, open the Service tab. Note the setup address, for example `http://10.0.0.250:3444`.
2. On the iPhone, open that address in **Safari**. Download the profile when asked.
3. Go to **Settings → General → VPN & Device Management**. Install **LightSage Local HTTPS**.
4. Go to **Settings → General → About → Certificate Trust Settings**. Turn on **LightSage Local CA**.
5. Scan the QR code on the Service tab.

On Android (not tested yet):

1. On the PC, open the Service tab. Note the setup address, for example `http://10.0.0.250:3444`.
2. On the phone, open that address in **Chrome**. Tap **Download Android certificate**.
3. Open **Settings** and search for **CA certificate**. It is usually under **Security → Encryption & credentials → Install a certificate**.
4. Tap **CA certificate**, then **Install anyway**, and pick **LightSage-Local-CA.crt** from Downloads. Android asks for a screen lock if you do not have one.
5. Scan the QR code on the Service tab.

Android may then show "Network may be monitored". This message only means that you installed a certificate yourself.

**Option B: Use your own domain name (no certificate on the phone)**

If you own a domain, follow [Use your own domain for phone access](docs/own-domain.md). This works on iPhone and Android, and **Music** can also use the phone's microphone. After setup, scan the QR code on the Service tab.

**Then, for both options:**

1. On the PC, choose **Connect another device**. Enter the six-digit code on the phone. The code works once and expires after ten minutes.
2. Add Light Sage to your Home Screen:
   - iPhone: in the browser's **Share** menu, choose **Add to Home Screen**.
   - Android: in the Chrome **⋮** menu, choose **Add to Home screen** or **Install app**.

If the phone asks you to sign in again, get a new code from **Connect another device**.

## Use Light Sage Mobile

### Add lights

Open the menu and choose **Add light**. You can also create rooms there.

**Govee H6013 bulbs (Matter)**

1. Set up the bulb on your Wi-Fi with its own app first.
2. Get the bulb's Matter setup code. If the bulb already belongs to another app, such as Apple Home or Google Home, ask that app to share it. The app then shows a new code.
3. In Light Sage, choose the Matter light type. Enter the code, a name, and a room if you want.
4. Wait for pairing to finish. The light controls pause until pairing is done.

**Govee H6159 strips (Bluetooth)**

1. Close the Govee app on your phone, because it can hold the connection.
2. Choose **Govee H6159 · Bluetooth**, then **Find nearby strips**.
3. Select the strip, give it a name and a room, and choose **Add strip**.

Keep the strip near the PC. Bluetooth controls are a little slower than Wi-Fi controls.

## Everyday use

- **Rooms:** Choose a room, or **ALL ROOMS**, to control those lights together. Open **Lights** to control one light.
- **Scenes:** Set your lights, choose **＋ Save**, and name the scene. Stop Music and turn off bright white before you save.
- **Schedules:** Choose the clock button, then **New Action**. Pick a room, an action (load a scene, power on, or power off), a time, and the days. Schedules run on the PC even when the app is closed. If the PC is off or asleep at that time, the action is skipped. Actions set for the same time run one after another; use the arrows on their cards to set the order.
- **Full White:** Sets bulbs to bright white. Choose **Restore** to put them back as they were, even after a restart.
- **Music:** Makes bulbs pulse to sound from the microphone.
- **Tray:** Closing the window keeps Light Sage running in the tray. Click the tray icon to open it again.
- **Start with Windows:** Turn this on to start Light Sage when you sign in.
- **Stop or exit:** **Stop** on the Service tab turns off phone control. To close Light Sage completely, choose **File → Exit Light Sage**.

## Back up your setup

Your lights, rooms, scenes, and pairing information are stored on the PC. Make a backup so you do not need to pair your lights again after a problem.

- **Back up:** Choose **File → Back up setup** and pick a folder.
- **Restore:** Choose **File → Restore setup**, pick the backup folder, and check the counts of lights, rooms, and scenes. Light Sage keeps your current setup as a separate backup before it restores.

Keep backups private, because they contain pairing information. A backup cannot undo a factory reset on a light. Updating or uninstalling Light Sage keeps your setup.

## Problems

| Problem | What to try |
| --- | --- |
| Light Sage stays on "Starting" | Open the Log tab and read the last lines. If a part is missing, reinstall Light Sage. Your setup is kept. |
| Phone cannot connect | Check that the PC is awake and shows **Running**, and that both devices use the same Wi-Fi. Guest networks and VPNs can block the connection. |
| Phone shows a security warning | Do the phone setup again (Option A or B above). |
| A new bulb is not found | Make sure the bulb is on your Wi-Fi and ready to pair, and that Windows marks your network as **Private**. |
| Light strip is missing or slow | Move the PC or strip closer together, and close the Govee app. |
| "Bluetooth helper unavailable" | Reinstall Light Sage. |

## For developers

See the [developer guide](DEVELOPMENT.md) for build steps, development mode, tests, and technical details.
