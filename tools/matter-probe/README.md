# Local Matter discovery probe

From this directory, run `npm run discover -- 20 Wi-Fi` on this PC.
The optional arguments are duration in seconds (1-60) and network interface name.

This reads local Matter commissioning advertisements over mDNS. It does not pair,
reset, or control bulbs, start a controller, or use cloud APIs. No pairing code is
required for discovery. It uses the installed Matter library; package installation
is a development download, not a runtime dependency on the internet.

A zero result means no pairable devices were discovered during that window, not
that Matter is unsupported. Confirm one bulb is accepting Matter pairing and that
the PC and bulb can communicate over the local network. Do not factory-reset the
lighting installation merely to perform this probe.

Initial result: 20-second scan on Wi-Fi completed with zero devices, September 19,
2026. IPv4 and IPv6 mDNS sockets opened successfully. No bulb settings were changed.

Follow-up: after a bulb power cycle, a 30-second scan outside the execution sandbox
found two pairable devices advertising vendor 4999 and product 0x6013. The adjacent
sandboxed scan returned zero. Run hardware discovery with authorized local-network
access; the earlier empty results did not establish network or bulb incompatibility.
Pairing subsequently succeeded using `controller.mjs pair` with the setup code on
stdin. `npm run status` reconnects using the identity saved in `.state` and reads
fresh device attributes. Restart/reconnect verified successfully on one H6013.
No light-changing command has been sent. Preserve `.state` and keep it private.

The controller disables OTA and does not register DCL. Local cryptographic checks
run, but manufacturer root-chain and CD signer verification require an offline
trust store before production use. HTTP fetch is disabled. The status probe disables
subscriptions to avoid a shutdown race in a short-lived process.

The installed upstream shell is a diagnostic dependency, not a production service;
its cloud-backed certificate and firmware features are not used by this script.
