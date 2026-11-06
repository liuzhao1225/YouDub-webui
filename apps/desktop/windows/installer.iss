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
; The user exits YouDub before upgrading. Restart Manager can close any process
; holding an installation file, including the process supervising the installer.
CloseApplications=no
RestartApplications=no

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
Filename: "{app}\YouDub.exe"; Parameters: "--updated --user-data-dir=""{param:UPDATEUSERDATA}"""; Flags: nowait runasoriginaluser; Check: IsYouDubUpdate

[Code]
function OpenProcess(Access: LongWord; InheritHandle: Boolean; ProcessId: LongWord): THandle;
  external 'OpenProcess@kernel32.dll stdcall';
function WaitForSingleObject(Handle: THandle; Milliseconds: LongWord): LongWord;
  external 'WaitForSingleObject@kernel32.dll stdcall';
function CloseHandle(Handle: THandle): Boolean;
  external 'CloseHandle@kernel32.dll stdcall';

function IsYouDubUpdate: Boolean;
begin
  Result := ExpandConstant('{param:YOUDUBUPDATE|0}') <> '0';
end;

function InitializeSetup: Boolean;
var
  ProcessId: Integer;
  Handle: THandle;
  WaitResult: LongWord;
begin
  Result := True;
  if not IsYouDubUpdate then Exit;
  if ExpandConstant('{param:UPDATEUSERDATA|}') = '' then begin
    MsgBox('YouDub update: user data directory is missing.', mbError, MB_OK);
    Result := False;
    Exit;
  end;
  ProcessId := StrToIntDef(ExpandConstant('{param:UPDATEPID|0}'), 0);
  if ProcessId <= 0 then begin
    MsgBox('YouDub update: invalid application process ID.', mbError, MB_OK);
    Result := False;
    Exit;
  end;
  Handle := OpenProcess($00100000, False, ProcessId);
  if Handle = 0 then begin
    { ERROR_INVALID_PARAMETER means the parent already exited. Other errors must stop installation. }
    if DLLGetLastError <> 87 then begin
      MsgBox('YouDub update: cannot wait for the application: ' + SysErrorMessage(DLLGetLastError), mbError, MB_OK);
      Result := False;
    end;
    Exit;
  end;
  Log('YouDub update: waiting for application process ' + IntToStr(ProcessId));
  WaitResult := WaitForSingleObject(Handle, 30000);
  CloseHandle(Handle);
  if WaitResult <> 0 then begin
    MsgBox('YouDub update: the application did not exit. Close YouDub and try again. Wait result: ' + IntToStr(WaitResult), mbError, MB_OK);
    Result := False;
  end;
end;
