# Tauri's bundle.windows.signCommand, set by the release workflow only: signs one
# file (app exe, NSIS plugins, uninstaller, installer) with Azure Trusted Signing.
param([Parameter(Mandatory)][string]$File)
$ErrorActionPreference = 'Stop'

Invoke-TrustedSigning `
  -Endpoint $env:AZURE_TRUSTED_SIGNING_ENDPOINT `
  -CodeSigningAccountName $env:AZURE_TRUSTED_SIGNING_ACCOUNT `
  -CertificateProfileName $env:AZURE_TRUSTED_SIGNING_PROFILE `
  -Files $File `
  -FileDigest SHA256 `
  -TimestampRfc3161 http://timestamp.acs.microsoft.com `
  -TimestampDigest SHA256
