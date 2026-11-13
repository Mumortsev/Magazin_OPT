[Setup]
AppName=Админ Курортник
AppVersion=28.1
DefaultDirName={localappdata}\Programs\Админ Курортник
DefaultGroupName=Админ Курортник
UninstallDisplayIcon={app}\Админ Курортник.exe
Compression=lzma2
SolidCompression=yes
OutputDir=..\Kurortnik_Admin
OutputBaseFilename=Админ_Курортник_Установка
SetupIconFile=admin.ico
WizardStyle=modern

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[Files]
Source: "dist\Админ Курортник.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Админ Курортник"; Filename: "{app}\Админ Курортник.exe"
Name: "{userdesktop}\Админ Курортник"; Filename: "{app}\Админ Курортник.exe"

[Run]
Filename: "{app}\Админ Курортник.exe"; Description: "Запустить Админ Курортник"; Flags: nowait postinstall skipifsilent
