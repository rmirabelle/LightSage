!macro customInstall
  nsExec::ExecToStack '"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="LightSage local network"'
  Pop $0
  Pop $1
  nsExec::ExecToStack '"$SYSDIR\netsh.exe" advfirewall firewall add rule name="LightSage local network" dir=in action=allow program="$INSTDIR\resources\desktop\runtime\node.exe" remoteip=LocalSubnet profile=private,domain enable=yes'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "Windows could not configure local network access for LightSage. Setup cannot finish."
    Abort
  ${EndIf}
!macroend

!macro customUnInstall
  nsExec::ExecToStack '"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="LightSage local network"'
  Pop $0
  Pop $1
!macroend
