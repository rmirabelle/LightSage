$ErrorActionPreference = 'Stop'
$resultPath = Join-Path $PSScriptRoot '.state/firewall-result.json'
try {
    $rule = Get-NetFirewallRule -Name 'LightSage-Local-Prototype' -ErrorAction SilentlyContinue
    if (-not $rule) {
        $rule = New-NetFirewallRule -Name 'LightSage-Local-Prototype' -DisplayName 'LightSage local prototype' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3443,3444 -LocalAddress 10.0.0.250 -RemoteAddress LocalSubnet -InterfaceAlias 'Wi-Fi' -Profile Any
    }
    $port = $rule | Get-NetFirewallPortFilter
    $address = $rule | Get-NetFirewallAddressFilter
    $interface = $rule | Get-NetFirewallInterfaceFilter
    if ($rule.Enabled -ne 'True' -or $rule.Direction -ne 'Inbound' -or $rule.Action -ne 'Allow' -or $port.Protocol -ne 'TCP' -or ($port.LocalPort -join ',') -ne '3443,3444' -or ($address.LocalAddress -join ',') -ne '10.0.0.250' -or ($address.RemoteAddress -join ',') -ne 'LocalSubnet' -or ($interface.InterfaceAlias -join ',') -ne 'Wi-Fi') {
        throw 'The existing rule does not match the approved scope. It has not been modified.'
    }
    @{ ok = $true; ports = $port.LocalPort; localAddress = $address.LocalAddress; remoteAddress = $address.RemoteAddress; interface = $interface.InterfaceAlias } | ConvertTo-Json | Set-Content $resultPath
} catch {
    @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json | Set-Content $resultPath
    exit 1
}
