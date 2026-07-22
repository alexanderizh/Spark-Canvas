# Spark Canvas 版本中心产品隔离与更新完整性审计

> 审计快照: 2026-07-17 | 代码基线: `6cfbfcd` | 线上基线: Spark Agent `0.5.3` | 本阶段只形成拆分依据，不修改版本中心或业务代码

## 1. 目的与边界

本文件下钻 E-004，审计从 CI 产物上传、版本注册、latest 查询、官网快照到桌面下载/启动安装包的完整链路。它回答：

1. 当前服务是否真正区分 Spark Agent 与 Spark Canvas。
2. 当前客户端是否验证版本中心返回的产品身份和安装包完整性。
3. D-015 已选择共享基础设施后，服务端 schema、API、对象键和迁移必须满足哪些 Gate。

核验依据包括：

- `.github/workflows/publish-desktop-release.yml`；
- `apps/desktop/scripts/register-release.mjs`；
- `apps/desktop/src/main/services/UpdateService.ts`；
- `apps/website/src/lib/releases.ts` 与 `apps/website/scripts/fetch-downloads.mjs`；
- 2026-07-17 对 `https://spark.yiqibyte.com/api/v1/desktop/releases/latest` 的只读 GET 矩阵；
- 当前 MinIO 安装包的只读响应头。

服务端代码和数据库 schema 不在当前仓库，常见公开 OpenAPI 路径都返回旧 Spark Agent SPA，而不是机器可读 schema。因此本文件能证明线上行为和客户端契约，不能假装已经看见服务端唯一键或 token 表；这些仍需在实施时提交 schema diff 和真实数据库验收证据。

## 2. 结论摘要

1. 当前 CI 注册 body 没有 `product`、`appId`、commit、release manifest digest 或签名证据；默认对象前缀只有 `{channel}/{version}`。
2. 桌面查询只发送 `channel + platform + arch`，官网只发送 `channel`；两个响应类型都没有 `product`。
3. 线上服务实际忽略 `product` 和 `appId`：`spark-canvas`、`spark-agent`、任意不存在的 product 和 `com.spark.canvas.desktop` 都返回同一 Spark Agent 记录。
4. `product=spark-canvas&channel=stable` 的官网形态查询仍返回三条 Spark Agent `0.5.3`；对象键均为 `stable/0.5.3/...`，没有产品 namespace。
5. 未知 channel 和非法 platform 返回 HTTP 200 + JSON `code: 1`，而不是 HTTP 4xx；客户端必须同时理解传输状态和业务状态。
6. 服务响应已经包含安装包 `sha512`，但 `VersionCenterRelease` 类型没有该字段；`toGithubLikeRelease()` 只保留 URL、文件名和大小，hash 被主动丢弃。
7. 下载链不校验 expected size、实际传输字节、SHA-256/SHA-512、产品身份、URL scheme/host、重定向目标或平台签名；下载结束就把临时文件 rename 为最终安装包。
8. 已缓存安装包只检查路径存在且 `isFile()`，不核对大小、hash 或签名；被截断、过期或本地替换的文件仍被标记为 downloaded。
9. Windows 会直接发起启动该 `.exe`，macOS 会 `open` 该 `.dmg`。操作系统可能额外警告，但不能替代应用自己的产品、hash 和签名 Gate，尤其当前 Windows 发布链还允许未签名降级。
10. 当前 MinIO ETag 为 multipart 形式，不能替代响应中的 SHA-512；而客户端连响应 SHA-512 也没有使用。
11. 版本中心 GET 对测试的同源、未来 Canvas 域名和无关 Origin 都没有返回 `Access-Control-Allow-Origin`。桌面 Node fetch 不受影响，但独立 Canvas 官网不能直接跨域调用，必须配置明确 CORS allowlist 或使用同源代理。
12. 当前自建双写在缺 Secret 或 MinIO 上传失败时会跳过/降级，GitHub Release 主链继续；若版本中心被定义为 stable 必备源，就必须在候选提升前变成硬 Gate，而不是 warning。
13. 结论是：**D-015 未实施前，Spark Canvas 禁止调用 v1 版本中心获取或启动更新。** 只增加 query 参数不够，必须同时修复服务端分区、对象前缀、客户端 fail-closed 完整性和发布状态机。

## 3. 当前端到端契约

### 3.1 CI 与 MinIO

workflow 当前上传到：

```text
s3://{RELEASE_MINIO_BUCKET}/stable/{version}/{artifact}
```

`register-release.mjs` 默认构造：

```json
{
  "version": "0.5.3",
  "channel": "stable",
  "files": [
    {
      "platform": "mac",
      "arch": "arm64",
      "fileName": "Spark Agent-0.5.3-mac-arm64.dmg",
      "fileSize": 409837252,
      "sha512": "...",
      "objectKey": "stable/0.5.3/Spark Agent-0.5.3-mac-arm64.dmg",
      "blockmapKey": "stable/0.5.3/Spark Agent-0.5.3-mac-arm64.dmg.blockmap"
    }
  ],
  "autoPublish": true
}
```

关键问题：

- `pickInstallersFor()` 故意不校验 productName，只按 `-{platform}-{arch}.` 匹配；dist 同时出现旧/新产品文件时可能一起注册。
- `RELEASE_OBJECT_PREFIX` 默认没有 product；workflow 没有覆盖该默认值。
- `X-Release-Token` 只有一个 Secret 名称，客户端契约看不出 token 是否限制 product/channel/object prefix。
- 三次 retry 没有 idempotency key；首次请求已提交但响应丢失时，是否重复插入完全依赖不可见服务端行为。
- `autoPublish` 默认 true，与 T-011 的 candidate 先验证、stable 后提升不一致。
- MinIO upload 使用 `continue-on-error: true`；上传失败只跳过注册，不阻止同一 workflow 的 GitHub 发布链。

### 3.2 latest 查询

桌面端：

```text
GET /api/v1/desktop/releases/latest
  ?channel={stable|beta}
  &platform={mac|win|linux}
  &arch={arm64|x64}
```

官网构建期和运行时：

```text
GET /api/v1/desktop/releases/latest?channel=stable
```

二者都没有 product。官网返回数组，桌面返回单条；同一路径的响应 shape 随筛选参数变化。公开响应包含 `sha512`、object key、rollout 和 minSupported，但仓库内的桌面/官网 TypeScript 类型并未覆盖全部字段，也没有运行时 schema 验证。

### 3.3 桌面下载与缓存

当前链路：

```text
VersionCenterRelease.publicUrl
  -> toGithubLikeRelease() 丢弃 sha512/product/objectKey
  -> fetch(publicUrl)，默认跟随 redirect
  -> Content-Length 只用于进度显示
  -> 流写入 {cache}/{version}/{file}.download
  -> 不验长度/hash/签名
  -> rename 为最终文件
  -> 状态 downloaded
  -> open dmg / spawn exe
```

`resolveCachedDownloadPath()` 更弱：只要 `{cache}/{version}/{assetName}` 是普通文件就直接复用。当前 updater cache 还是 `spark-agent-updater`，所以新产品若只改显示名还会与旧应用共享缓存路径。

版本中心返回的 `publicUrl` 没有 HTTPS/host allowlist，也没有逐跳 redirect 校验。服务端误配置或响应被破坏时，下载链会尝试任意 URL；安装包最终能否执行可能受 Gatekeeper/SmartScreen 影响，但应用侧没有建立可信边界。

### 3.4 官网快照

官网 build-time fetch 失败时保留磁盘旧快照且不阻断构建；运行时 fetch 失败时也继续显示 baked snapshot。这对可用性有利，但当前 snapshot 没有 product 字段：旧 Spark Agent 下载数据可能在 Spark Canvas 官网持续显示，且不会因身份不匹配失败。

独立域名若直接请求 `spark.yiqibyte.com`，浏览器还会受 CORS 限制。2026-07-17 三个测试 Origin 都没有得到 `Access-Control-Allow-Origin`；目标方案必须选择：

1. Canvas 官网通过自己的同源 `/api/...` 反代版本中心；或
2. 版本中心只允许明确的 Spark Canvas 官网 origin，不能开放任意 credentialed origin。

## 4. 线上行为矩阵

基线记录是 Spark Agent `0.5.3`：macOS arm64 `id=111`，macOS x64 `id=110`，Windows x64 `id=112`。

| 请求差异                                      | HTTP / JSON | 实际 data                         | 判定                        |
| --------------------------------------------- | ----------- | --------------------------------- | --------------------------- |
| 无 product，mac arm64                         | 200 / 0     | `id=111`，Spark Agent DMG         | 当前 legacy 基线            |
| `product=spark-canvas`，mac arm64             | 200 / 0     | 与基线逐字段相同                  | product 被忽略              |
| `product=spark-agent`，mac arm64              | 200 / 0     | 与基线逐字段相同                  | 无法证明按 product 过滤     |
| `product=definitely-not-a-product`，mac arm64 | 200 / 0     | 与基线逐字段相同                  | 未知 product 错误回退旧产品 |
| `appId=com.spark.canvas.desktop`，mac arm64   | 200 / 0     | 与基线逐字段相同                  | appId 被忽略                |
| `product=spark-canvas`，Windows x64           | 200 / 0     | `id=112`，Spark Agent EXE         | Windows 同样串产品          |
| 只有 `channel=stable`                         | 200 / 0     | `id=111,110,112` 三条 Spark Agent | 官网当前数据                |
| `product=spark-canvas&channel=stable`         | 200 / 0     | 仍为同三条                        | 官网 query 同样忽略 product |
| 未知 channel                                  | 200 / 1     | `通道无效`                        | 业务错误未使用 HTTP 4xx     |
| 非法 platform                                 | 200 / 1     | `平台无效`                        | 业务错误未使用 HTTP 4xx     |

响应对象本身没有 product/appId。macOS arm64 对象键与 URL 是：

```text
stable/0.5.3/Spark Agent-0.5.3-mac-arm64.dmg
https://minio.yiqibyte.com/spark-desktop/stable/0.5.3/Spark Agent-0.5.3-mac-arm64.dmg
```

对象 HEAD 返回 `Content-Length: 409837252`，与 API fileSize 一致；ETag 为 `5ed632e31ccd20650a6272181f2fd1e1-49`，是 multipart 标识而不是客户端可依赖的内容摘要。API 提供的 SHA-512 才是现有可用完整性字段，但桌面端未消费。

常见 `/openapi.json`、`/api/openapi.json`、`/swagger-json`、`/api-docs` 都由前端 catch-all 返回旧 Spark Agent HTML。该结果只说明没有公开 schema，不能推断私有服务端没有 schema。

## 5. 风险分级

### P0：产品身份错误

Spark Canvas 即使主动发送自己的 product/appId，也会收到 Spark Agent 安装包。若直接沿用 v1，自动更新、官网按钮和缓存都可能把用户带回旧产品。

### P0：安装包完整性 fail-open

版本中心已经返回 SHA-512，但客户端丢弃它；任意 URL、redirect、截断下载和已存在缓存都没有 hash/signature 验证。这个问题独立于 TLS：TLS 保护传输通道，不证明服务端选择了正确产品，也不防止合法服务端/对象配置错误。

### P1：对象覆盖与元数据竞争

两个产品发布相同 channel/version 时会进入同一前缀。文件名通常不同只能降低偶然覆盖，不能建立数据库唯一键、latest 指针或清理任务的产品边界。

### P1：发布状态不一致

GitHub Release、MinIO 上传和版本注册不是同一候选提升事务；`autoPublish=true` 与 `continue-on-error` 会产生“一个源已 stable、另一个源缺失或仍旧”的状态。

### P1：官网旧快照污染

构建/运行失败保留旧 snapshot，但 snapshot 无 product 和 digest。即使新接口短暂失败，Spark Canvas 官网仍可能继续展示旧 Agent 安装包且没有显式错误门。

## 6. 目标 API 契约

### 6.1 使用 v2 隔离 legacy

推荐共享基础设施时新增严格 v2，而不是在 v1 上继续增加可忽略参数：

```text
POST /api/v2/ci/desktop/releases/register
GET  /api/v2/desktop/releases/latest
```

v2 的 `product` 必填、不可缺省、不可忽略；允许值至少为 `spark-agent`、`spark-canvas`。缺失或未知 product 返回 HTTP 400/422，存在但无 release 返回 HTTP 200 + `data: null`，绝不回退另一产品。

旧 Spark Agent 已发布客户端可继续使用 v1/旧 host 的 legacy 缺省；Spark Canvas 永不调用 v1。这样才能兼容旧二进制，同时让新产品的“漏传 product”立即失败。

### 6.2 注册请求

最低请求应类似：

```json
{
  "schemaVersion": 2,
  "product": "spark-canvas",
  "appId": "com.spark.canvas.desktop",
  "version": "1.0.0",
  "channel": "stable",
  "releaseState": "candidate",
  "commit": "...",
  "releaseManifestSha256": "...",
  "idempotencyKey": "spark-canvas:stable:1.0.0:mac:arm64:<artifact-sha256>",
  "files": [
    {
      "platform": "mac",
      "arch": "arm64",
      "fileName": "Spark Canvas-1.0.0-mac-arm64.dmg",
      "fileSize": 123,
      "sha256": "...",
      "sha512": "...",
      "objectKey": "spark-canvas/candidate/1.0.0/Spark Canvas-1.0.0-mac-arm64.dmg",
      "signatureEvidenceDigest": "..."
    }
  ]
}
```

服务端必须：

- 从 CI token scope 得到允许的 product/channel/prefix，并与 body 逐项一致；
- 在提交 DB 前读取对象 metadata 或流式复算 size/hash，不能只信客户端 JSON；
- 幂等注册，重试不会产生重复记录或错改 latest；
- candidate 只可见于受控验收，stable 通过显式 promote API 提升同一组字节；
- promote 时绑定签名 evidence、资源 approved manifest 和 Release manifest；
- product、version、platform、arch 或 hash 变化时禁止复用原审批。

### 6.3 latest 响应

v2 单条响应至少包含：

```json
{
  "product": "spark-canvas",
  "appId": "com.spark.canvas.desktop",
  "version": "1.0.0",
  "channel": "stable",
  "platform": "mac",
  "arch": "arm64",
  "fileName": "Spark Canvas-1.0.0-mac-arm64.dmg",
  "fileSize": 123,
  "sha256": "...",
  "sha512": "...",
  "publicUrl": "https://approved-host/...",
  "releaseManifestSha256": "...",
  "signatureEvidenceDigest": "...",
  "publishedAt": "..."
}
```

桌面和官网都必须运行时解析 schema，并逐项断言 product/appId/platform/arch/channel。身份不匹配属于安全错误，不得静默回退 GitHub；纯网络不可用才可回退 D-014 已批准的 `alexanderizh/Spark-Canvas` GitHub Release。

## 7. 数据与对象模型

### 7.1 最低数据约束

- 稳定 `product_id` 使用 `spark-agent` / `spark-canvas`，不使用可变显示名。
- artifact 唯一键至少为 `product_id + channel + version + platform + arch + file_name`。
- `object_key` 全局唯一，且必须以 token 允许的 `{product_id}/` 开头。
- 每个 `product_id + channel + platform + arch` 最多一个 published latest。
- rollout、minSupported、撤销、审计日志和清理任务全部带 product 条件。
- releaseState 明确区分 candidate/stable，不用 `autoPublish` 布尔值替代状态机。
- promotion 在事务内切换 latest；失败时旧 stable 仍可查询。

具体表拆分可服从现有服务端框架，但以上约束必须由数据库索引/约束和服务端授权共同实现，不能只靠调用方约定。

### 7.2 对象前缀

目标：

```text
spark-agent/{state}/{channel}/{version}/{artifact}
spark-canvas/{state}/{channel}/{version}/{artifact}
```

若 bucket 完全独立，仍保留 product 前缀，便于清单审计、token scope 和未来迁移；不能因为 bucket 名不同就让 API 丢失 product。

## 8. 客户端与 CI Gate

### 8.1 Desktop

- 固定 `product=spark-canvas`、`appId=com.spark.canvas.desktop` 和 v2 endpoint。
- 响应先做 schema/身份/host 校验，再进入版本比较。
- 只允许 HTTPS 和批准 host；每次 redirect 重新校验 scheme/host。
- 下载时同时限制最大字节、核对 Content-Length、实际 transferred、SHA-256/SHA-512。
- hash 通过后再做 macOS/Windows 签名验证，全部通过后原子 rename。
- 缓存命名使用 `spark-canvas-updater`；每次命中缓存仍重验 size/hash/signature。
- 身份、hash、签名错误 fail closed；网络不可用才允许回退已批准的 Spark Canvas GitHub 源。

### 8.2 Website

- build-time、runtime 和 baked snapshot 都固定 product/appId/schemaVersion。
- snapshot 文件携带 release manifest digest；不匹配时显示无下载，不展示旧 Agent fallback。
- 独立域名使用同源代理或精确 CORS allowlist。
- 下载按钮只接受批准 host 和 `Spark Canvas` 文件身份。

### 8.3 CI

- `PRODUCT=spark-canvas` 必填，installer 文件名必须匹配产品、平台和架构。
- 上传到 `spark-canvas/candidate/...`，注册 candidate，完成签名/资源/安装旅程后再 promote。
- CI token 只允许 Spark Canvas prefix 和指定 channel。
- 若版本中心是 stable 对外源，MinIO、register 和 promote 任一步失败都不能发布 stable；GitHub 可先保留 draft/candidate。
- 每次注册和 promote 保存 commit、artifact hash、release manifest、签名证据和 workflow run。

## 9. 迁移顺序

1. 导出当前 DB schema、索引、token scope 和全部 release/object inventory，形成 E-004 服务端 evidence packet。
2. 暂停清理/latest 重算任务，去重当前记录；现有记录显式回填 `product_id=spark-agent`。
3. 建立 v2 表约束/API/token，不改变 v1 legacy 查询。
4. 把旧对象复制到 `spark-agent/...` 并双向对账 size/hash；旧 key 在旧客户端退役前只读保留。
5. 创建 Spark Canvas 专用 token、prefix、candidate 数据和空 latest；未发布时必须返回 `data:null`。
6. 让新 Desktop/Website/CI 只使用 v2，执行双产品同版本验收。
7. 通过 candidate evidence 后提升 Spark Canvas stable，再启用官网/桌面查询。
8. 观察期结束后停止 legacy 写入；删除旧 key 前再次证明没有受支持旧客户端依赖。

共享或独立部署只改变 API base、bucket 和运维边界，不改变迁移中的 product/schema/hash Gate。

## 10. 强制验收矩阵

| 场景                                               | 必须结果                                     |
| -------------------------------------------------- | -------------------------------------------- |
| 两产品同时发布 `1.0.0` mac arm64                   | 各自 latest、对象键、缓存和官网只返回本产品  |
| v2 缺 product / 未知 product                       | HTTP 4xx；不返回 Agent，不查默认分区         |
| 服务返回 product/appId 不匹配                      | Desktop/Website fail closed，不静默回退      |
| token 注册其他 product/prefix                      | 403；DB 和对象均无变化                       |
| 同一 idempotency key 重试                          | 返回同一记录，不新增、不重复 promote         |
| object 缺失、size/hash 不一致                      | 注册或 promote 失败                          |
| download URL 为 HTTP、未知 host 或跨 host redirect | 下载前拒绝                                   |
| 下载截断、超长、SHA-256/SHA-512 错误               | 删除 staging，旧版本和旧缓存仍可用           |
| 本地缓存被替换                                     | 命中时重验失败并重新下载，不进入 downloaded  |
| 安装包签名无效                                     | 不启动安装包，不允许 stable                  |
| version center 网络不可用                          | 只回退 `alexanderizh/Spark-Canvas` GitHub 源 |
| version center 返回身份/hash 安全错误              | 不回退；上报安全错误                         |
| Canvas 官网在独立域名                              | 同源代理或精确 CORS allowlist 实测通过       |
| 旧 Spark Agent v1 客户端                           | 迁移期仍拿旧产品；不会看到 Canvas            |
| stable promote 中任一外部源失败                    | stable 不可见，原 stable 保持                |

## 11. D-015 与 E-004 状态

D-015 已冻结为：**共享原服务/对象存储基础设施，实施严格 v2 `spark-canvas` 全链 product 分区。** 独立 API、DB/bucket 和 token 不再是当前实施目标。

“继续复用当前 v1 并多传一个可忽略 query”已经被线上矩阵排除；“只换 bucket”也不能修复 DB latest、客户端身份和 hash fail-open。

E-004 当前状态从“未知服务端 schema”推进为：**客户端/CI/官网契约与线上错误行为已完整核验，D-015 和目标 v2 schema、迁移顺序、验收 Gate 已冻结；真实服务端 schema diff、token scope、数据迁移与运行验收仍待实施。**
