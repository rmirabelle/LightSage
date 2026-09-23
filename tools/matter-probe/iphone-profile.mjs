import { X509Certificate } from 'node:crypto';

// Only the public root certificate is included. No keys, VPN, or MDM enrollment.
export function iphoneProfile(pem) {
  const certificate = new X509Certificate(pem).raw.toString('base64');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>PayloadType</key><string>Configuration</string>
<key>PayloadVersion</key><integer>1</integer>
<key>PayloadIdentifier</key><string>local.lightsage.https</string>
<key>PayloadUUID</key><string>895AA2D2-B5D2-48E7-B030-5D2DF107E33A</string>
<key>PayloadDisplayName</key><string>LightSage Local HTTPS</string>
<key>PayloadDescription</key><string>Installs the public certificate authority generated on your LightSage Windows PC for local HTTPS. No device management or VPN is configured.</string>
<key>PayloadRemovalDisallowed</key><false/>
<key>PayloadContent</key><array><dict>
<key>PayloadType</key><string>com.apple.security.root</string>
<key>PayloadVersion</key><integer>1</integer>
<key>PayloadIdentifier</key><string>local.lightsage.https.root</string>
<key>PayloadUUID</key><string>B788C540-E93B-4B71-B7D4-16A9D033CE43</string>
<key>PayloadDisplayName</key><string>LightSage Local CA</string>
<key>PayloadCertificateFileName</key><string>LightSage-Local-CA.cer</string>
<key>PayloadContent</key><data>${certificate}</data>
</dict></array></dict></plist>`;
}
