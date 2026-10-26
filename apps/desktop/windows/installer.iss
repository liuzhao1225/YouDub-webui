; Built from the already validated desktop bundle; runtime data lives outside {app}.
#ifndef AppVersion
  #error AppVersion is required
#endif
#ifndef RepoRoot
  #error RepoRoot is required
#endif
[Setup]
AppId={{C28A6869-1C98-4FA0-BBE5-E5C579B0A602}
AppName=YouDub
AppVersion={#AppVersion}
AppPublisher=YouDub
AppPublisherURL=https://github.com/liuzhao1225/YouDub-webui
DefaultDirName={localappdata}\Programs\YouDub
DefaultGroupName=YouDub
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19045
OutputDir={#RepoRoot}\dist
OutputBaseFilename=YouDub-{#AppVersion}-windows-x64-Setup
SetupIconFile={#RepoRoot}\.cache\windows\YouDub.ico
UninstallDisplayIcon={app}\YouDub.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
; Upgrade only closes this product; never the upstream Harness executable.
CloseApplicationsFilter=YouDub.exe

[Languages]
Name: "chinesesimplified"; MessagesFile: "{#RepoRoot}\apps\desktop\windows\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#RepoRoot}\dist\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; Replace application-owned code on upgrade. Runtime, models and credentials
; live in YouDub's separate data directory and are never installer payloads.
Type: filesandordirs; Name: "{app}\resources\app"
Type: filesandordirs; Name: "{app}\resources\youdub"

[Icons]
Name: "{group}\YouDub"; Filename: "{app}\YouDub.exe"; AppUserModelID: "com.youdub.desktop"
Name: "{autodesktop}\YouDub"; Filename: "{app}\YouDub.exe"; Tasks: desktopicon; AppUserModelID: "com.youdub.desktop"

[Run]
Filename: "{app}\YouDub.exe"; Description: "{cm:LaunchProgram,YouDub}"; Flags: nowait postinstall skipifsilent
