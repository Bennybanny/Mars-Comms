param([Parameter(Mandatory=$true)][string]$Executable,[Parameter(Mandatory=$true)][string]$DataDirectory)
$ErrorActionPreference='Stop'
$Executable=(Resolve-Path -LiteralPath $Executable).Path
$DataDirectory=[System.IO.Path]::GetFullPath($DataDirectory)
$originalData=$env:MARS_COMMS_TEST_DATA_DIR
$trackedWrappers=@()
$trackedApps=@()
try {
  $env:MARS_COMMS_TEST_DATA_DIR=$DataDirectory
  for($run=1;$run -le 2;$run++) {
    $wrapper=Start-Process -FilePath $Executable -PassThru -WindowStyle Normal
    $trackedWrappers+=$wrapper
    $native=$null
    for($attempt=0;$attempt -lt 60;$attempt++) {
      $child=Get-CimInstance Win32_Process -Filter "ParentProcessId=$($wrapper.Id)" | Where-Object {$_.Name -eq 'Mars Comms.exe'} | Select-Object -First 1
      if($child) {
        $candidate=Get-Process -Id $child.ProcessId -ErrorAction SilentlyContinue
        if($candidate -and $trackedApps.Id -notcontains $candidate.Id){$trackedApps+=$candidate}
        if($candidate -and $candidate.MainWindowHandle -ne 0){$native=$candidate;break}
      }
      if($wrapper.HasExited){throw "Portable launch $run exited before displaying its window (code $($wrapper.ExitCode))."}
      Start-Sleep -Milliseconds 250
    }
    if(!$native){throw "Portable launch $run did not display a native window."}
    Write-Output "Launch ${run}: visible '$($native.MainWindowTitle)' window."
    if(!$native.CloseMainWindow()){throw "Windows did not accept the close request for launch $run."}
    if(!$wrapper.WaitForExit(12000)){throw "Portable launch $run left its wrapper running after window close."}
    if($wrapper.ExitCode -ne 0){throw "Portable launch $run exited with code $($wrapper.ExitCode)."}
    Write-Output "Launch ${run}: app and portable wrapper exited cleanly."
  }
  $log=Get-Content -LiteralPath (Join-Path $DataDirectory 'logs\launcher.log') -Raw
  if($log -match 'Shutdown deadline reached'){throw 'The forced shutdown fallback was used.'}
  if(([regex]::Matches($log,'Shutdown complete')).Count -lt 2){throw 'Graceful shutdown was not recorded for both launches.'}
} finally {
  foreach($native in $trackedApps){if(!$native.HasExited){Stop-Process -Id $native.Id -ErrorAction SilentlyContinue}}
  foreach($wrapper in $trackedWrappers){if(!$wrapper.HasExited){Stop-Process -Id $wrapper.Id -ErrorAction SilentlyContinue}}
  if($null -eq $originalData){Remove-Item Env:\MARS_COMMS_TEST_DATA_DIR -ErrorAction SilentlyContinue}else{$env:MARS_COMMS_TEST_DATA_DIR=$originalData}
}
