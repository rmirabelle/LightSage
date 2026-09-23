$ErrorActionPreference = 'Stop'
$tlsPath = Join-Path $PSScriptRoot '.state/tls'
$opensslPath = 'C:\Program Files\Git\usr\bin\openssl.exe'
New-Item -ItemType Directory -Force -Path $tlsPath | Out-Null
Push-Location $tlsPath
try {
    if (-not (Test-Path root.key)) {
        & $opensslPath req -x509 -newkey rsa:3072 -nodes -keyout root.key -out root.crt -sha256 -days 3650 -subj '/CN=LightSage Local CA' -addext 'basicConstraints=critical,CA:TRUE,pathlen:0' -addext 'keyUsage=critical,keyCertSign,cRLSign' 2>$null
        if ($LASTEXITCODE -ne 0) { throw 'Could not create local CA.' }
    }
    if (-not (Test-Path server.crt)) {
        & $opensslPath req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj '/CN=LightSage Local' 2>$null
        if ($LASTEXITCODE -ne 0) { throw 'Could not create server key.' }
        @('subjectAltName=IP:10.0.0.250,IP:127.0.0.1,DNS:localhost', 'basicConstraints=critical,CA:FALSE', 'keyUsage=critical,digitalSignature,keyEncipherment', 'extendedKeyUsage=serverAuth') | Set-Content -Encoding ascii server.ext
        & $opensslPath x509 -req -in server.csr -CA root.crt -CAkey root.key -CAcreateserial -out server.crt -days 365 -sha256 -extfile server.ext 2>$null
        if ($LASTEXITCODE -ne 0) { throw 'Could not sign local server certificate.' }
    }
    & $opensslPath verify -CAfile root.crt server.crt
    if ($LASTEXITCODE -ne 0) { throw 'Certificate verification failed.' }
} finally { Pop-Location }
