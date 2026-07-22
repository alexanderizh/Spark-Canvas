#!/usr/bin/env node
/**
 * Register one Spark Canvas matrix build as a v2 candidate release.
 *
 * Required environment variables:
 *   PRODUCT                    must be spark-canvas
 *   VERSION                    semantic version (for example 1.4.2)
 *   PLATFORM                   mac | win | linux
 *   ARCH                       arm64 | x64 | universal
 *   COMMIT                     source commit for the built artifact
 *   RELEASE_API_BASE           shared version-center base URL
 *   RELEASE_CI_TOKEN           scoped v2 CI token
 *   RELEASE_MANIFEST_SHA256    approved release-manifest digest
 *   SIGNATURE_EVIDENCE_DIGEST  approved signature-evidence digest
 *
 * Optional:
 *   CHANNEL                    defaults to stable
 *   DIST_DIR                   defaults to apps/desktop/dist
 *
 * The script never promotes or publishes a candidate. Promotion remains an
 * explicit, approved server-side action after release evidence is complete.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

const tag = '[register-release]'
const PRODUCT_ID = 'spark-canvas'
const APP_ID = 'com.spark.canvas.desktop'
const RELEASE_STATE = 'candidate'
const INSTALLER_EXTS = new Set(['.dmg', '.exe', '.AppImage', '.zip', '.deb', '.rpm'])

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) {
    console.error(`${tag} missing required env: ${name}`)
    process.exit(1)
  }
  return value
}

function isEncodedDigest(value, byteLength) {
  if (new RegExp(`^[a-fA-F0-9]{${byteLength * 2}}$`).test(value)) return true
  const base64Length = Math.ceil(byteLength / 3) * 4
  return (
    value.length === base64Length &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value) &&
    Buffer.from(value, 'base64').byteLength === byteLength
  )
}

const PRODUCT = required('PRODUCT')
if (PRODUCT !== PRODUCT_ID) {
  console.error(`${tag} PRODUCT must be ${PRODUCT_ID}`)
  process.exit(1)
}

const VERSION = required('VERSION')
const PLATFORM = required('PLATFORM').toLowerCase()
const ARCH = required('ARCH').toLowerCase()
const COMMIT = required('COMMIT')
const rawApiBase = required('RELEASE_API_BASE')
let apiBaseUrl
try {
  apiBaseUrl = new URL(rawApiBase)
} catch {
  console.error(`${tag} RELEASE_API_BASE must be credential-free HTTPS`)
  process.exit(1)
}
if (
  apiBaseUrl.protocol !== 'https:' ||
  apiBaseUrl.username.length > 0 ||
  apiBaseUrl.password.length > 0 ||
  apiBaseUrl.search.length > 0 ||
  apiBaseUrl.hash.length > 0
) {
  console.error(`${tag} RELEASE_API_BASE must be credential-free HTTPS`)
  process.exit(1)
}
const API_BASE = apiBaseUrl.toString().replace(/\/+$/, '')
const CI_TOKEN = required('RELEASE_CI_TOKEN')
const RELEASE_MANIFEST_SHA256 = required('RELEASE_MANIFEST_SHA256')
const SIGNATURE_EVIDENCE_DIGEST = required('SIGNATURE_EVIDENCE_DIGEST')
const CHANNEL = (process.env.CHANNEL || 'stable').trim().toLowerCase()
const DIST_DIR = process.env.DIST_DIR || 'apps/desktop/dist'
const OBJECT_PREFIX = `${PRODUCT_ID}/${RELEASE_STATE}/${CHANNEL}/${VERSION}`

if (!isEncodedDigest(RELEASE_MANIFEST_SHA256, 32)) {
  console.error(`${tag} RELEASE_MANIFEST_SHA256 must be a 256-bit digest`)
  process.exit(1)
}
if (!isEncodedDigest(SIGNATURE_EVIDENCE_DIGEST, 32)) {
  console.error(`${tag} SIGNATURE_EVIDENCE_DIGEST must be a 256-bit digest`)
  process.exit(1)
}

if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(VERSION)) {
  console.error(`${tag} VERSION must use semantic versioning`)
  process.exit(1)
}
if (!['mac', 'win', 'linux'].includes(PLATFORM)) {
  console.error(`${tag} unsupported PLATFORM: ${PLATFORM}`)
  process.exit(1)
}
if (!['arm64', 'x64', 'universal'].includes(ARCH)) {
  console.error(`${tag} unsupported ARCH: ${ARCH}`)
  process.exit(1)
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(CHANNEL)) {
  console.error(`${tag} CHANNEL must be a lowercase release channel name`)
  process.exit(1)
}

async function listDistFiles() {
  const entries = await readdir(DIST_DIR, { withFileTypes: true })
  return entries.filter(entry => entry.isFile()).map(entry => entry.name).sort()
}

function pickInstallers(platform, arch, names) {
  const prefix = `Spark Canvas-${VERSION}-${platform}-${arch}`
  return names.filter(name => {
    if (!name.startsWith(`${prefix}.`)) return false
    return INSTALLER_EXTS.has(name.slice(prefix.length))
  })
}

async function fileDigests(absPath) {
  return await new Promise((resolve, reject) => {
    const sha256 = createHash('sha256')
    const sha512 = createHash('sha512')
    const stream = createReadStream(absPath)
    stream.on('error', reject)
    stream.on('data', chunk => {
      sha256.update(chunk)
      sha512.update(chunk)
    })
    stream.on('end', () => {
      resolve({
        sha256: sha256.digest('hex'),
        sha512: sha512.digest('base64'),
      })
    })
  })
}

async function buildFileEntry(fileName) {
  const absPath = join(DIST_DIR, fileName)
  const [digests, fileStat] = await Promise.all([fileDigests(absPath), stat(absPath)])
  if (!fileStat.isFile() || fileStat.size <= 0) {
    throw new Error(`installer must be a non-empty file: ${fileName}`)
  }
  return {
    platform: PLATFORM,
    arch: ARCH,
    fileName,
    fileSize: fileStat.size,
    sha256: digests.sha256,
    sha512: digests.sha512,
    objectKey: `${OBJECT_PREFIX}/${fileName}`,
    signatureEvidenceDigest: SIGNATURE_EVIDENCE_DIGEST,
  }
}

function idempotencyDigest(files) {
  if (files.length === 1) return files[0].sha256
  const artifactSet = files.map(file => `${file.fileName}:${file.sha256}`).sort().join('\n')
  return createHash('sha256').update(artifactSet).digest('hex')
}

async function postRegister(body) {
  const url = `${API_BASE}/api/v2/ci/desktop/releases/register`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Release-Token': CI_TOKEN,
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 500)}`)
  }

  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`non-JSON response: ${text.slice(0, 500)}`)
  }
  if (typeof json.code !== 'number' || json.code !== 0) {
    throw new Error(`api code=${json.code} message=${json.message}`)
  }
  return json
}

async function withRetry(fn, attempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      console.warn(
        `${tag} attempt ${attempt}/${attempts} failed: ${error instanceof Error ? error.message : error}`,
      )
      if (attempt < attempts) {
        await new Promise(resolve => setTimeout(resolve, attempt * 2000))
      }
    }
  }
  throw lastError
}

async function main() {
  console.log(
    `${tag} product=${PRODUCT_ID} state=${RELEASE_STATE} version=${VERSION} channel=${CHANNEL} platform=${PLATFORM} arch=${ARCH} prefix=${OBJECT_PREFIX}`,
  )

  const names = await listDistFiles()
  const installers = pickInstallers(PLATFORM, ARCH, names)
  if (installers.length === 0) {
    const expected = `Spark Canvas-${VERSION}-${PLATFORM}-${ARCH}.<ext>`
    throw new Error(
      `no strict Spark Canvas installer found; expected ${expected}. dist contains:\n  ${names.join('\n  ')}`,
    )
  }

  const files = []
  for (const fileName of installers) {
    const entry = await buildFileEntry(fileName)
    console.log(
      `${tag} file=${entry.fileName} size=${entry.fileSize} sha256=${entry.sha256.slice(0, 16)}... sha512=${entry.sha512.slice(0, 16)}...`,
    )
    files.push(entry)
  }

  const body = {
    schemaVersion: 2,
    product: PRODUCT_ID,
    appId: APP_ID,
    version: VERSION,
    channel: CHANNEL,
    releaseState: RELEASE_STATE,
    commit: COMMIT,
    releaseManifestSha256: RELEASE_MANIFEST_SHA256,
    idempotencyKey: `${PRODUCT_ID}:${CHANNEL}:${VERSION}:${PLATFORM}:${ARCH}:${idempotencyDigest(files)}`,
    files,
  }

  const result = await withRetry(() => postRegister(body), 3)
  console.log(`${tag} registered candidate: ${JSON.stringify(result.data)}`)
}

main().catch(error => {
  console.error(`${tag} fatal:`, error instanceof Error ? error.stack : error)
  process.exit(1)
})
