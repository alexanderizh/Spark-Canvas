[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ArtifactPath,
  [string]$PolicyPath = (Join-Path $PSScriptRoot "windows-signature-policy.mjs")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
  throw "Authenticode verification must run on Windows."
}

$artifact = (Resolve-Path -LiteralPath $ArtifactPath).Path
$policy = (Resolve-Path -LiteralPath $PolicyPath).Path

function Test-CertificateChain {
  param(
    [System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate
  )

  if (-not $Certificate) {
    return [PSCustomObject]@{ Trusted = $false; Status = @("MissingCertificate") }
  }

  $chain = [System.Security.Cryptography.X509Certificates.X509Chain]::new()
  try {
    $chain.ChainPolicy.RevocationMode =
      [System.Security.Cryptography.X509Certificates.X509RevocationMode]::Online
    $chain.ChainPolicy.RevocationFlag =
      [System.Security.Cryptography.X509Certificates.X509RevocationFlag]::ExcludeRoot
    $chain.ChainPolicy.VerificationFlags =
      [System.Security.Cryptography.X509Certificates.X509VerificationFlags]::NoFlag
    $chain.ChainPolicy.UrlRetrievalTimeout = [TimeSpan]::FromSeconds(30)

    # PowerShell 7 exposes TrustMode explicitly. Windows PowerShell uses the
    # system certificate stores by default and does not expose this property.
    if ($chain.ChainPolicy.PSObject.Properties.Name -contains "TrustMode") {
      $chain.ChainPolicy.TrustMode = "System"
    }

    $trusted = $chain.Build($Certificate)
    $statuses = @(
      $chain.ChainStatus | ForEach-Object {
        "{0}: {1}" -f $_.Status, $_.StatusInformation.Trim()
      }
    )
    return [PSCustomObject]@{ Trusted = $trusted; Status = $statuses }
  }
  finally {
    $chain.Dispose()
  }
}

function Test-Rfc3161TimestampAttribute {
  param([string]$Path)

  if (-not ("System.Security.Cryptography.Pkcs.SignedCms" -as [type])) {
    Add-Type -AssemblyName System.Security.Cryptography.Pkcs
  }

  [byte[]]$bytes = [IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -lt 64 -or [BitConverter]::ToUInt16($bytes, 0) -ne 0x5A4D) {
    throw "Windows artifact is not a valid PE file: $Path"
  }

  $peOffset = [BitConverter]::ToInt32($bytes, 0x3C)
  if ($peOffset -lt 0 -or $peOffset + 24 -gt $bytes.Length -or
      [BitConverter]::ToUInt32($bytes, $peOffset) -ne 0x00004550) {
    throw "Windows artifact has an invalid PE header: $Path"
  }

  $optionalHeaderOffset = $peOffset + 24
  $optionalHeaderMagic = [BitConverter]::ToUInt16($bytes, $optionalHeaderOffset)
  switch ($optionalHeaderMagic) {
    0x010B { $dataDirectoryOffset = $optionalHeaderOffset + 96 }
    0x020B { $dataDirectoryOffset = $optionalHeaderOffset + 112 }
    default { throw "Windows artifact has an unsupported PE optional header: $Path" }
  }

  # IMAGE_DIRECTORY_ENTRY_SECURITY is data-directory index 4. Its address is a
  # file offset, unlike the RVAs used by the other PE data directories.
  $securityDirectoryOffset = $dataDirectoryOffset + (4 * 8)
  if ($securityDirectoryOffset + 8 -gt $bytes.Length) {
    throw "Windows artifact has a truncated PE security directory: $Path"
  }
  [int64]$certificateTableOffset = [BitConverter]::ToUInt32($bytes, $securityDirectoryOffset)
  [int64]$certificateTableSize = [BitConverter]::ToUInt32($bytes, $securityDirectoryOffset + 4)
  if ($certificateTableOffset -eq 0 -or $certificateTableSize -eq 0) {
    return $false
  }

  [int64]$certificateTableEnd = $certificateTableOffset + $certificateTableSize
  if ($certificateTableOffset -lt 0 -or $certificateTableEnd -gt $bytes.LongLength) {
    throw "Windows artifact has an invalid PE certificate table: $Path"
  }

  [int64]$cursor = $certificateTableOffset
  while ($cursor + 8 -le $certificateTableEnd) {
    [int64]$certificateLength = [BitConverter]::ToUInt32($bytes, [int]$cursor)
    $certificateType = [BitConverter]::ToUInt16($bytes, [int]($cursor + 6))
    if ($certificateLength -lt 8 -or $cursor + $certificateLength -gt $certificateTableEnd) {
      throw "Windows artifact has a malformed WIN_CERTIFICATE entry: $Path"
    }

    if ($certificateType -eq 0x0002) {
      [int]$pkcs7Length = $certificateLength - 8
      [byte[]]$pkcs7 = [byte[]]::new($pkcs7Length)
      [Array]::Copy($bytes, $cursor + 8, $pkcs7, 0, $pkcs7Length)

      $signedCms = [System.Security.Cryptography.Pkcs.SignedCms]::new()
      $signedCms.Decode($pkcs7)
      foreach ($signerInfo in $signedCms.SignerInfos) {
        foreach ($attribute in $signerInfo.UnsignedAttributes) {
          # szOID_RFC3161_counterSign. Legacy Authenticode countersignatures use
          # 1.2.840.113549.1.9.6 and do not satisfy the public release gate.
          if ($attribute.Oid.Value -eq "1.3.6.1.4.1.311.3.3.1") {
            return $true
          }
        }
      }
    }

    # WIN_CERTIFICATE entries are padded to an eight-byte boundary.
    $alignedLength = ($certificateLength + 7) -band (-bnot 7)
    $cursor += $alignedLength
  }

  return $false
}

$signature = Get-AuthenticodeSignature -LiteralPath $artifact
$signerChain = Test-CertificateChain -Certificate $signature.SignerCertificate
$timestampChain = Test-CertificateChain -Certificate $signature.TimeStamperCertificate
$hasRfc3161Timestamp = Test-Rfc3161TimestampAttribute -Path $artifact
$signerSubject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { "" }
$signerIssuer = if ($signature.SignerCertificate) { $signature.SignerCertificate.Issuer } else { "" }
$timestampSubject = if ($signature.TimeStamperCertificate) { $signature.TimeStamperCertificate.Subject } else { "" }
$timestampIssuer = if ($signature.TimeStamperCertificate) { $signature.TimeStamperCertificate.Issuer } else { "" }

Write-Host ("  Status           : {0}" -f $signature.Status)
Write-Host ("  Message          : {0}" -f $signature.StatusMessage)
Write-Host ("  Signer subject   : {0}" -f $signerSubject)
Write-Host ("  Signer issuer    : {0}" -f $signerIssuer)
Write-Host ("  Signer chain     : {0}" -f $signerChain.Trusted)
Write-Host ("  Timestamp signer : {0}" -f $timestampSubject)
Write-Host ("  Timestamp chain  : {0}" -f $timestampChain.Trusted)
Write-Host ("  RFC3161 attribute: {0}" -f $hasRfc3161Timestamp)

$evidence = [PSCustomObject]@{
  status = [string]$signature.Status
  statusMessage = $signature.StatusMessage
  signerSubject = $signerSubject
  signerIssuer = $signerIssuer
  signerChainTrusted = $signerChain.Trusted
  signerChainStatus = $signerChain.Status
  timestampSubject = $timestampSubject
  timestampIssuer = $timestampIssuer
  timestampChainTrusted = $timestampChain.Trusted
  timestampChainStatus = $timestampChain.Status
  hasRfc3161Timestamp = $hasRfc3161Timestamp
}

$node = (Get-Command node -ErrorAction Stop).Source
$evidence | ConvertTo-Json -Compress -Depth 4 | & $node $policy
if ($LASTEXITCODE -ne 0) {
  throw "Windows signature release policy rejected the artifact."
}
