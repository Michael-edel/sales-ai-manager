# Device credentials for the local catalog bridge. Input and output are JSON on
# stdin/stdout; secrets are never accepted through arguments or environment.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$StorePath)
Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$data=$null; $bytes=$null
try {
  $request=[Console]::In.ReadToEnd() | ConvertFrom-Json
  if ($request.action -notin @('initialize','read')) { throw 'Invalid action' }
  $folder=Split-Path -Parent $StorePath
  if (-not (Test-Path -LiteralPath $folder)) {
    $created=New-Item -ItemType Directory -Path $folder -ErrorAction Stop
    $acl=$created.GetAccessControl()
    $acl.SetAccessRuleProtection($true,$false)
    $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
    $acl.AddAccessRule($rule)
    $created.SetAccessControl($acl)
  }
  $currentSid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $allowed=@($currentSid,'S-1-5-18','S-1-5-32-544')
  $existingAcl=(New-Object System.IO.DirectoryInfo($folder)).GetAccessControl()
  foreach ($entry in $existingAcl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])) {
    if ($entry.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and $entry.IdentityReference.Value -notin $allowed) { throw 'Unsafe credential folder permissions' }
  }
  if ($request.action -eq 'initialize') {
    if (Test-Path -LiteralPath $StorePath) { throw 'Already initialized' }
    $bytes=New-Object byte[] 32
    $rng=[System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $secret=([BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant()
    $id=[Guid]::NewGuid().ToString()
    $data=[Text.Encoding]::UTF8.GetBytes((@{id=$id;secret=$secret}|ConvertTo-Json -Compress))
    $encrypted=[System.Security.Cryptography.ProtectedData]::Protect($data,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    $stream=New-Object System.IO.FileStream($StorePath,[System.IO.FileMode]::CreateNew,[System.IO.FileAccess]::Write,[System.IO.FileShare]::None)
    try { $stream.Write($encrypted,0,$encrypted.Length) } finally { $stream.Dispose() }
    $sha=[System.Security.Cryptography.SHA256]::Create()
    try { $hash=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($secret)))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
    @{id=$id;hash=$hash}|ConvertTo-Json -Compress
  } else {
    $encrypted=[IO.File]::ReadAllBytes($StorePath)
    $data=[System.Security.Cryptography.ProtectedData]::Unprotect($encrypted,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    $value=[Text.Encoding]::UTF8.GetString($data)|ConvertFrom-Json
    if ($value.id -notmatch '^[a-f0-9-]{36}$' -or $value.secret -notmatch '^[a-f0-9]{64}$') { throw 'Invalid credential' }
    @{id=$value.id;secret=$value.secret}|ConvertTo-Json -Compress
  }
} catch {
  [Console]::Error.WriteLine('Credential operation failed: ' + $_.Exception.GetType().FullName + ' at line ' + $_.InvocationInfo.ScriptLineNumber)
  exit 1
} finally {
  if ($null -ne $data) { [Array]::Clear($data,0,$data.Length) }
  if ($null -ne $bytes) { [Array]::Clear($bytes,0,$bytes.Length) }
}
