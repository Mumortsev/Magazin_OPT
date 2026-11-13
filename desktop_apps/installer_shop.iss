[Setup]
AppName=Курортник
AppVersion=28.1
DefaultDirName={localappdata}\Programs\Курортник
DefaultGroupName=Курортник
UninstallDisplayIcon={app}\Курортник.exe
Compression=lzma2
SolidCompression=yes
OutputDir=..\Kurortnik_Shop
OutputBaseFilename=Курортник_Установка
SetupIconFile=shop.ico
WizardStyle=modern

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[Files]
Source: "dist\Курортник.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Курортник"; Filename: "{app}\Курортник.exe"
Name: "{userdesktop}\Курортник"; Filename: "{app}\Курортник.exe"

[Run]
Filename: "{app}\Курортник.exe"; Description: "Запустить Курортник"; Flags: nowait postinstall skipifsilent
