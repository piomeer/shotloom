#requires -Version 7.2
param([switch]$DescribeOnly)
$ErrorActionPreference = 'Stop'
$taskBase = [IO.Path]::GetFullPath($PSScriptRoot)
$taskPolicy = Get-Content -LiteralPath (Join-Path $taskBase 'candidate-policy.json') -Raw | ConvertFrom-Json
if($DescribeOnly) {
  [pscustomobject]@{Application=$taskPolicy.applicationId;RuntimeAuthorized=$taskPolicy.localRunAuthorized;Executable='win-unpacked/shotloom-local-test.exe';Data='data/batch09-<fresh-guid>';Updates='disabled'} | ConvertTo-Json
  return
}
if($taskPolicy.localRunAuthorized -ne $true) { throw 'BLOCKED: local candidate execution requires separate authorization and isolation review' }
if($taskPolicy.applicationId -ne 'com.shotloom.localtest.batch09') { throw 'Wrong candidate identity' }
$taskExe = Join-Path $taskBase 'win-unpacked/shotloom-local-test.exe'
if(-not (Test-Path -LiteralPath $taskExe -PathType Leaf)) { throw 'Missing complete candidate directory' }
for($taskPath=$taskBase; $taskPath; $taskPath=[IO.Path]::GetDirectoryName($taskPath)) {
  if((Get-Item -LiteralPath $taskPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Candidate base cannot contain links' }
}
$taskDataBase = Join-Path $taskBase 'data'
if(Test-Path -LiteralPath $taskDataBase) {
  $taskDataItem=Get-Item -LiteralPath $taskDataBase -Force
  if(-not $taskDataItem.PSIsContainer -or ($taskDataItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Candidate data parent cannot be a link or file' }
}
$taskRoot = Join-Path $taskDataBase ('batch09-' + [Guid]::NewGuid().ToString('N'))
if(Test-Path -LiteralPath $taskRoot) { throw 'Refusing existing test data' }
New-Item -ItemType Directory -Path $taskRoot | Out-Null
$taskMarker = @{applicationId='com.shotloom.localtest.batch09';freshRun=$true} | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $taskRoot '.batch09-isolation.json'),$taskMarker)
$taskPaths=@{application='application';webview='webview';session='session';profile='profile';temp='temp';logs='logs';downloads='downloads';documents='documents';roaming='profile/AppData/Roaming';local='profile/AppData/Local';projects='application/projects'}
foreach($taskPart in $taskPaths.Values) { New-Item -ItemType Directory -Path (Join-Path $taskRoot $taskPart) -Force | Out-Null }
$taskStart=[Diagnostics.ProcessStartInfo]::new()
$taskStart.FileName=$taskExe
$taskStart.WorkingDirectory=$taskRoot
$taskStart.UseShellExecute=$false
$taskStart.Environment.Clear()
foreach($taskKey in @('SystemRoot','WINDIR','COMSPEC','SYSTEMDRIVE','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','OS')) {
  $taskValue=[Environment]::GetEnvironmentVariable($taskKey)
  if($null -ne $taskValue) { $taskStart.Environment[$taskKey]=$taskValue }
}
$taskStart.Environment['PATH']=(Join-Path $env:SystemRoot 'System32') + ';' + $env:SystemRoot
$taskStart.Environment['HOME']=Join-Path $taskRoot 'profile'
$taskStart.Environment['USERPROFILE']=Join-Path $taskRoot 'profile'
$taskStart.Environment['APPDATA']=Join-Path $taskRoot 'profile/AppData/Roaming'
$taskStart.Environment['LOCALAPPDATA']=Join-Path $taskRoot 'profile/AppData/Local'
$taskStart.Environment['TEMP']=Join-Path $taskRoot 'temp'
$taskStart.Environment['TMP']=Join-Path $taskRoot 'temp'
$taskStart.Environment['SHOTLOOM_CANDIDATE_ROOT']=$taskRoot
$taskStart.Environment['SHOTLOOM_APPDATA_DIR']=Join-Path $taskRoot 'application'
$taskStart.Environment['SHOTLOOM_USER_DATA']=Join-Path $taskRoot 'webview'
$taskStart.Environment['SHOTLOOM_WINDOW']='{"title":"Shotloom Local Test - BATCH-09"}'
# No credentials, proxy variables, development overrides, candidate arguments or formal settings are inherited.
$taskProcess=[Diagnostics.Process]::Start($taskStart)
"Candidate PID=$($taskProcess.Id); isolated data=$taskRoot"
