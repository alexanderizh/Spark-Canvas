import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, test } from 'node:test'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '../../..')
const scriptPath = join(scriptDir, 'register-release.mjs')
const workflowPath = join(repoRoot, '.github/workflows/publish-desktop-release.yml')
const electronBuilderPath = join(repoRoot, 'apps/desktop/electron-builder.yml')
const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })),
  )
})

async function makeFixture(fileName, contents = 'signed Spark Canvas fixture') {
  const distDir = await mkdtemp(join(tmpdir(), 'spark-canvas-release-'))
  temporaryDirectories.push(distDir)
  const bytes = Buffer.from(contents)
  await writeFile(join(distDir, fileName), bytes)
  return { distDir, bytes }
}

async function runRegister({ distDir, env = {} }) {
  const capturePath = join(distDir, 'captured-request.json')
  const preloadPath = join(distDir, 'capture-fetch.mjs')
  await writeFile(
    preloadPath,
    `import { writeFileSync } from 'node:fs'
globalThis.fetch = async (input, init = {}) => {
  const headers = Object.fromEntries(new Headers(init.headers).entries())
  writeFileSync(process.env.CAPTURE_PATH, JSON.stringify({
    method: init.method,
    url: String(input),
    headers,
    body: JSON.parse(init.body),
  }))
  return new Response(JSON.stringify({ code: 0, data: { registered: true } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
`,
  )
  const childEnv = {
    ...process.env,
    VERSION: '1.2.3',
    PRODUCT: 'spark-canvas',
    PLATFORM: 'mac',
    ARCH: 'arm64',
    RELEASE_API_BASE: 'https://release.example.test',
    RELEASE_CI_TOKEN: 'test-token',
    CHANNEL: 'stable',
    COMMIT: '0123456789abcdef0123456789abcdef01234567',
    RELEASE_MANIFEST_SHA256: 'a'.repeat(64),
    SIGNATURE_EVIDENCE_DIGEST: 'b'.repeat(64),
    DIST_DIR: distDir,
    CAPTURE_PATH: capturePath,
    ...env,
  }
  for (const [key, value] of Object.entries(childEnv)) {
    if (value === undefined) delete childEnv[key]
  }

  const result = await new Promise(resolveChild => {
    execFile(
      process.execPath,
      ['--import', preloadPath, scriptPath],
      { cwd: repoRoot, env: childEnv },
      (error, stdout, stderr) => {
        resolveChild({ code: error?.code ?? 0, stdout, stderr })
      },
    )
  })
  let request
  try {
    request = JSON.parse(await readFile(capturePath, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return { ...result, request }
}

test('registers a Spark Canvas candidate through the strict v2 contract', async () => {
  const fileName = 'Spark Canvas-1.2.3-mac-arm64.dmg'
  const { distDir, bytes } = await makeFixture(fileName)
  const result = await runRegister({ distDir })

  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.request.method, 'POST')
  assert.equal(
    result.request.url,
    'https://release.example.test/api/v2/ci/desktop/releases/register',
  )
  assert.equal(result.request.headers['x-release-token'], 'test-token')

  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const sha512 = createHash('sha512').update(bytes).digest('base64')
  assert.deepEqual(result.request.body, {
    schemaVersion: 2,
    product: 'spark-canvas',
    appId: 'com.spark.canvas.desktop',
    version: '1.2.3',
    channel: 'stable',
    releaseState: 'candidate',
    commit: '0123456789abcdef0123456789abcdef01234567',
    releaseManifestSha256: 'a'.repeat(64),
    idempotencyKey: `spark-canvas:stable:1.2.3:mac:arm64:${sha256}`,
    files: [
      {
        platform: 'mac',
        arch: 'arm64',
        fileName,
        fileSize: bytes.length,
        sha256,
        sha512,
        objectKey: `spark-canvas/candidate/stable/1.2.3/${fileName}`,
        signatureEvidenceDigest: 'b'.repeat(64),
      },
    ],
  })
  assert.equal('autoPublish' in result.request.body, false)
})

test('rejects an installer that belongs to the old Spark Agent product', async () => {
  const { distDir } = await makeFixture('Spark Agent-1.2.3-mac-arm64.dmg')
  const result = await runRegister({ distDir })

  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /Spark Canvas-1\.2\.3-mac-arm64/)
  assert.equal(result.request, undefined)
})

test('rejects a release job scoped to another product', async () => {
  const { distDir } = await makeFixture('Spark Canvas-1.2.3-mac-arm64.dmg')
  const result = await runRegister({ distDir, env: { PRODUCT: 'spark-agent' } })

  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /PRODUCT must be spark-canvas/)
  assert.equal(result.request, undefined)
})

test('fails closed when release manifest evidence is missing', async () => {
  const { distDir } = await makeFixture('Spark Canvas-1.2.3-mac-arm64.dmg')
  const result = await runRegister({
    distDir,
    env: { RELEASE_MANIFEST_SHA256: undefined },
  })

  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /missing required env: RELEASE_MANIFEST_SHA256/)
  assert.equal(result.request, undefined)
})

test('fails closed when signature evidence is missing', async () => {
  const { distDir } = await makeFixture('Spark Canvas-1.2.3-mac-arm64.dmg')
  const result = await runRegister({
    distDir,
    env: { SIGNATURE_EVIDENCE_DIGEST: undefined },
  })

  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /missing required env: SIGNATURE_EVIDENCE_DIGEST/)
  assert.equal(result.request, undefined)
})

test('refuses to send the release token to a non-HTTPS version center', async () => {
  const { distDir } = await makeFixture('Spark Canvas-1.2.3-mac-arm64.dmg')
  const result = await runRegister({
    distDir,
    env: { RELEASE_API_BASE: 'http://release.example.test' },
  })

  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /RELEASE_API_BASE must be credential-free HTTPS/)
  assert.equal(result.request, undefined)
})

test('rejects malformed release and signature evidence digests', async () => {
  const { distDir } = await makeFixture('Spark Canvas-1.2.3-mac-arm64.dmg')
  const invalidManifest = await runRegister({
    distDir,
    env: { RELEASE_MANIFEST_SHA256: 'not-a-digest' },
  })
  const invalidSignature = await runRegister({
    distDir,
    env: { SIGNATURE_EVIDENCE_DIGEST: 'not-a-digest' },
  })

  assert.notEqual(invalidManifest.code, 0)
  assert.match(invalidManifest.stderr, /RELEASE_MANIFEST_SHA256 must be a 256-bit digest/)
  assert.equal(invalidManifest.request, undefined)
  assert.notEqual(invalidSignature.code, 0)
  assert.match(invalidSignature.stderr, /SIGNATURE_EVIDENCE_DIGEST must be a 256-bit digest/)
  assert.equal(invalidSignature.request, undefined)
})

test('desktop release workflow enforces the public v2 candidate gate', async () => {
  const workflow = await readFile(workflowPath, 'utf8')
  const electronBuilder = await readFile(electronBuilderPath, 'utf8')

  assert.match(workflow, /branches:\s*\n\s*- main\b/)
  assert.doesNotMatch(workflow, /branches:\s*\n\s*- master\b/)
  assert.match(workflow, /- apps\/desktop\/scripts\/register-release\.mjs/)
  assert.match(workflow, /- apps\/desktop\/scripts\/register-release\.test\.mjs/)
  assert.match(workflow, /node --test apps\/desktop\/scripts\/register-release\.test\.mjs/)
  assert.match(workflow, /ALLOW_UNSIGNED_WINDOWS_RELEASE:\s*'0'/)
  assert.doesNotMatch(workflow, /ALLOW_UNSIGNED_WINDOWS_RELEASE:\s*'1'/)

  const gateIndex = workflow.indexOf('- name: Validate public release configuration')
  const publishIndex = workflow.indexOf('- name: Publish desktop artifacts')
  assert.notEqual(gateIndex, -1)
  assert.notEqual(publishIndex, -1)
  assert(gateIndex < publishIndex, 'the v2 configuration gate must run before GitHub publication')
  for (const requiredName of [
    'RELEASE_API_BASE',
    'RELEASE_CI_TOKEN',
    'RELEASE_MINIO_ENDPOINT',
    'RELEASE_MINIO_BUCKET',
    'RELEASE_MINIO_ACCESS_KEY',
    'RELEASE_MINIO_SECRET_KEY',
    'RELEASE_MANIFEST_SHA256',
    'SIGNATURE_EVIDENCE_DIGEST',
  ]) {
    assert.match(workflow.slice(gateIndex, publishIndex), new RegExp(`\\b${requiredName}\\b`))
  }

  assert.doesNotMatch(workflow, /continue-on-error:\s*true/)
  assert.match(workflow, /PRODUCT:\s*spark-canvas/)
  assert.match(workflow, /spark-canvas\/candidate\/\$\{CHANNEL\}\/\$\{VERSION\}\//)
  assert.match(workflow, /RELEASE_STATE:\s*candidate/)
  assert.doesNotMatch(workflow, /RELEASE_AUTO_PUBLISH|autoPublish/)
  assert.match(workflow, /- name: Upload installers as workflow artifacts[\s\S]*?if:\s*always\(\)/)
  assert.match(
    electronBuilder,
    /publish:\s*\n(?:\s+.*\n)*?\s+releaseType:\s+draft\b/,
    'GitHub artifacts must remain draft until the v2 candidate is explicitly promoted',
  )
  assert.doesNotMatch(electronBuilder, /releaseType:\s+release\b/)
})
