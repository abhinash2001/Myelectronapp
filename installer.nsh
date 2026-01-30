!include "FileFunc.nsh"

Section "Install ODBC Driver 17"
  SetOutPath "$TEMP"
  File "build\\odbc17.msi"
  ExecWait 'msiexec /i "$TEMP\\odbc17.msi" /quiet /qn /norestart'
SectionEnd
