import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '../../..')
const policyPath = join(scriptDir, 'windows-signature-policy.mjs')

function trustedEvidence(overrides = {}) {
  return {
    status: 'Valid',
    statusMessage: 'Signature verified.',
    signerSubject: 'CN=Spark Foundation Code Signing',
    signerIssuer: 'CN=Trusted Public Code Signing CA',
    signerChainTrusted: true,
    signerChainStatus: [],
    timestampSubject: 'CN=Trusted Timestamp Authority',
    timestampIssuer: 'CN=Trusted Timestamp Root',
    timestampChainTrusted: true,
    timestampChainStatus: [],
    hasRfc3161Timestamp: true,
    ...overrides,
  }
}

async function loadPolicy() {
  return import(`${pathToFileURL(policyPath).href}?test=${Date.now()}`)
}

test('strict public release accepts only a fully trusted RFC3161 signature', async () => {
  const { evaluateWindowsSignatureEvidence } = await loadPolicy()

  assert.deepEqual(
    evaluateWindowsSignatureEvidence(trustedEvidence(), {
      requireSigning: true,
      allowUnsigned: false,
    }),
    { accepted: true, warnings: [] },
  )
})

test('strict public release rejects invalid Authenticode status and self-signed signers', async () => {
  const { evaluateWindowsSignatureEvidence } = await loadPolicy()
  const strict = { requireSigning: true, allowUnsigned: false }

  assert.throws(
    () => evaluateWindowsSignatureEvidence(trustedEvidence({ status: 'NotTrusted' }), strict),
    /Authenticode status must be Valid.*NotTrusted/,
  )
  assert.throws(
    () =>
      evaluateWindowsSignatureEvidence(
        trustedEvidence({
          signerSubject: 'CN=Local Test Certificate',
          signerIssuer: 'cn=local test certificate',
        }),
        strict,
      ),
    /self-signed signer certificate is forbidden/,
  )
})

test('strict public release requires trusted signer and timestamp chains', async () => {
  const { evaluateWindowsSignatureEvidence } = await loadPolicy()
  const strict = { requireSigning: true, allowUnsigned: false }

  assert.throws(
    () =>
      evaluateWindowsSignatureEvidence(
        trustedEvidence({
          signerChainTrusted: false,
          signerChainStatus: ['UntrustedRoot: A certificate chain processed correctly.'],
        }),
        strict,
      ),
    /signer certificate chain is not trusted.*UntrustedRoot/i,
  )
  assert.throws(
    () =>
      evaluateWindowsSignatureEvidence(
        trustedEvidence({
          timestampChainTrusted: false,
          timestampChainStatus: ['PartialChain: unable to build chain'],
        }),
        strict,
      ),
    /timestamp certificate chain is not trusted.*PartialChain/i,
  )
})

test('strict public release requires an RFC3161 timestamp certificate', async () => {
  const { evaluateWindowsSignatureEvidence } = await loadPolicy()
  const strict = { requireSigning: true, allowUnsigned: false }

  assert.throws(
    () =>
      evaluateWindowsSignatureEvidence(
        trustedEvidence({ timestampSubject: '', timestampIssuer: '' }),
        strict,
      ),
    /timestamp certificate is required/,
  )
  assert.throws(
    () => evaluateWindowsSignatureEvidence(trustedEvidence({ hasRfc3161Timestamp: false }), strict),
    /RFC3161 timestamp is required/,
  )
})

test('strict public release cannot be weakened with the unsigned fallback flag', async () => {
  const { evaluateWindowsSignatureEvidence } = await loadPolicy()

  assert.throws(
    () =>
      evaluateWindowsSignatureEvidence(trustedEvidence(), {
        requireSigning: true,
        allowUnsigned: true,
      }),
    /ALLOW_UNSIGNED_WINDOWS_RELEASE=1 cannot be combined with REQUIRE_WINDOWS_SIGNING=1/,
  )
})

test('local non-public packaging may retain the explicit unsigned fallback', async () => {
  const { evaluateWindowsSignatureEvidence } = await loadPolicy()

  const result = evaluateWindowsSignatureEvidence(
    trustedEvidence({
      status: 'NotTrusted',
      signerSubject: 'CN=Local Test Certificate',
      signerIssuer: 'CN=Local Test Certificate',
      signerChainTrusted: false,
      timestampSubject: '',
      timestampIssuer: '',
      timestampChainTrusted: false,
      hasRfc3161Timestamp: false,
    }),
    { requireSigning: false, allowUnsigned: true },
  )

  assert.equal(result.accepted, true)
  assert.equal(result.warnings.length, 1)
  assert.match(result.warnings[0], /local non-public build/)

  const missingTimestamp = evaluateWindowsSignatureEvidence(
    trustedEvidence({
      timestampSubject: '',
      timestampIssuer: '',
      timestampChainTrusted: false,
      hasRfc3161Timestamp: false,
    }),
    { requireSigning: false, allowUnsigned: true },
  )
  assert.equal(missingTimestamp.accepted, true)
  assert.match(missingTimestamp.warnings[0], /local non-public build/)
})

test('Windows release scripts never add a certificate to a root trust store', async () => {
  const [buildScript, verifier] = await Promise.all([
    readFile(join(scriptDir, 'build-win-release.sh'), 'utf8'),
    readFile(join(scriptDir, 'verify-windows-signature.ps1'), 'utf8'),
  ])

  assert.match(buildScript, /verify-windows-signature\.ps1/)
  assert.match(buildScript, /REQUIRE_WINDOWS_SIGNING:-0.*ALLOW_UNSIGNED_WINDOWS_RELEASE:-0/s)
  assert.doesNotMatch(buildScript, /X509Store|StoreName\]\:\:Root|temporary CurrentUser trust/)
  assert.doesNotMatch(verifier, /X509Store|StoreName\]\:\:Root|CurrentUser|\.Add\s*\(/)
  assert.match(verifier, /Get-AuthenticodeSignature/)
  assert.match(verifier, /X509Chain/)
  assert.match(verifier, /X509RevocationMode\]\:\:Online/)
  assert.doesNotMatch(verifier, /X509RevocationMode\]\:\:NoCheck|AllowUnknownCertificateAuthority/)
  assert.match(verifier, /1\.3\.6\.1\.4\.1\.311\.3\.3\.1/)
  assert.match(verifier, /windows-signature-policy\.mjs/)
})

test('release workflow continuously checks the Windows stable signing gate', async () => {
  const [workflow, electronBuilder] = await Promise.all([
    readFile(join(repoRoot, '.github/workflows/publish-desktop-release.yml'), 'utf8'),
    readFile(join(repoRoot, 'apps/desktop/electron-builder.yml'), 'utf8'),
  ])

  for (const trackedPath of [
    'apps/desktop/electron-builder.yml',
    'apps/desktop/scripts/build-win-release.sh',
    'apps/desktop/scripts/verify-windows-signature.ps1',
    'apps/desktop/scripts/windows-signature-policy.mjs',
    'apps/desktop/scripts/verify-win-release-gate.test.mjs',
  ]) {
    assert.match(workflow, new RegExp(`- ${trackedPath.replaceAll('.', '\\.')}`))
  }
  assert.match(
    workflow,
    /node --test[\s\S]*apps\/desktop\/scripts\/verify-win-release-gate\.test\.mjs/,
  )
  assert.match(workflow, /ALLOW_UNSIGNED_WINDOWS_RELEASE:\s*'0'/)
  assert.match(workflow, /REQUIRE_WINDOWS_SIGNING:[^\n]+publish_to_release/)
  assert.match(electronBuilder, /^\s+rfc3161TimeStampServer:\s*https?:\/\//m)
  assert.match(electronBuilder, /signingHashAlgorithms:\s*\n\s+- sha256/)
})
