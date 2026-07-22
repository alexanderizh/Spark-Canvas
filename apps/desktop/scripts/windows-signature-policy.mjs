import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

function normalizedDistinguishedName(value) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('en-US')
}

function chainFailure(label, statuses) {
  const details = Array.isArray(statuses) ? statuses.filter(Boolean).join('; ') : ''
  return `${label} certificate chain is not trusted${details ? `: ${details}` : ''}`
}

export function evaluateWindowsSignatureEvidence(
  evidence,
  { requireSigning = false, allowUnsigned = false } = {},
) {
  if (requireSigning && allowUnsigned) {
    throw new Error(
      'ALLOW_UNSIGNED_WINDOWS_RELEASE=1 cannot be combined with REQUIRE_WINDOWS_SIGNING=1',
    )
  }

  const localVerificationPassed =
    evidence?.status === 'Valid' &&
    Boolean(evidence?.signerSubject) &&
    Boolean(evidence?.signerIssuer) &&
    Boolean(evidence?.timestampSubject) &&
    Boolean(evidence?.timestampIssuer)
  if (!requireSigning && allowUnsigned && !localVerificationPassed) {
    return {
      accepted: true,
      warnings: [
        `Signature verification did not pass for this local non-public build: ${evidence?.status ?? 'Missing'} - ${evidence?.statusMessage ?? 'missing signer or timestamp certificate'}`,
      ],
    }
  }

  if (evidence?.status !== 'Valid') {
    throw new Error(
      `Authenticode status must be Valid, received ${evidence?.status ?? 'Missing'}: ${evidence?.statusMessage ?? 'no status message'}`,
    )
  }

  if (!evidence.signerSubject || !evidence.signerIssuer) {
    throw new Error('Authenticode signer certificate is required')
  }
  if (
    requireSigning &&
    normalizedDistinguishedName(evidence.signerSubject) ===
      normalizedDistinguishedName(evidence.signerIssuer)
  ) {
    throw new Error('A self-signed signer certificate is forbidden for public stable releases')
  }
  if (requireSigning && evidence.signerChainTrusted !== true) {
    throw new Error(chainFailure('Signer', evidence.signerChainStatus))
  }

  if (!evidence.timestampSubject || !evidence.timestampIssuer) {
    throw new Error('An Authenticode timestamp certificate is required')
  }
  if (requireSigning && evidence.hasRfc3161Timestamp !== true) {
    throw new Error('An RFC3161 timestamp is required for public stable releases')
  }
  if (requireSigning && evidence.timestampChainTrusted !== true) {
    throw new Error(chainFailure('Timestamp', evidence.timestampChainStatus))
  }

  return { accepted: true, warnings: [] }
}

function envFlag(name) {
  return process.env[name] === '1'
}

function runCli() {
  try {
    const evidence = JSON.parse(readFileSync(0, 'utf8'))
    const result = evaluateWindowsSignatureEvidence(evidence, {
      requireSigning: envFlag('REQUIRE_WINDOWS_SIGNING'),
      allowUnsigned: envFlag('ALLOW_UNSIGNED_WINDOWS_RELEASE'),
    })
    for (const warning of result.warnings) console.warn(`[WARN] ${warning}`)
    console.log('[OK] Windows Authenticode release policy passed')
  } catch (error) {
    console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runCli()
}
