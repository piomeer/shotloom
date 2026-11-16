# BATCH-09: runner only. Read system facts; create only job-owned scratch.
$ErrorActionPreference = 'Stop'
$taskScratch = Join-Path $env:GITHUB_WORKSPACE 'tmp/batch09/temp'
New-Item -ItemType Directory -Path $taskScratch -Force | Out-Null
Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors | ConvertTo-Json -Compress
Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,TotalVisibleMemorySize,FreePhysicalMemory | ConvertTo-Json -Compress
Get-PSDrive -PSProvider FileSystem | Select-Object Name,Root,Used,Free | ConvertTo-Json -Compress
"PowerShell=$($PSVersionTable.PSVersion)"
foreach($taskTool in @('node','npm','rustc','cargo','python')) {
  $taskCommand = Get-Command $taskTool -ErrorAction SilentlyContinue
  if($taskCommand) { & $taskCommand.Source --version } else { "$taskTool=NOT FOUND" }
}
$taskVswhere = Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Microsoft Visual Studio/Installer/vswhere.exe'
if(Test-Path -LiteralPath $taskVswhere) { & $taskVswhere -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -format json }
$taskSdk = Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Windows Kits/10/Include'
if(Test-Path -LiteralPath $taskSdk) { Get-ChildItem -LiteralPath $taskSdk -Directory | Select-Object Name | ConvertTo-Json -Compress }
git rev-parse HEAD
# No capacity threshold: inventory must run even when later stages are BLOCKED.
