# Spark Canvas 签名、发布与更新链审计

> 审计快照: 2026-07-17 | 代码基线: `6cfbfcd` | 本阶段只形成拆分依据，不修改发布或业务代码

> 决策更新: D-013 已选择方案 1；Spark Canvas 在同一合法发行主体且证书可用时复用原 macOS/Windows 生产签名身份，实际证书与授权核验仍是公开发布硬门

## 1. 审计目的

本文件补齐 Spark Canvas 独立化中的生产发布边界，回答五个问题：

1. 当前 macOS 和 Windows 安装包由什么配置、证书和 CI Secret 完成签名。
2. 复用原 Spark Agent 签名主体与新建 Spark Canvas 签名主体分别影响什么。
3. 当前流水线能否保证公开产物一定经过有效签名和平台验证。
4. GitHub Release、自建版本中心、MinIO 和官网是否能把两个产品隔离。
5. 后续应拆成哪些可独立验收的发布改造批次。

本文件只审计仓库可见事实。GitHub Secrets、证书私钥、Apple Developer 账户和自建版本中心服务端不在当前仓库内，因此实际证书 Subject、Team ID、证书有效期和服务端唯一键不能从源码推定，必须在实施发布前单独核验。

关联文档：

- [范围冻结](../plans/2026-07-16-ai-film-workbench-scope-freeze.md)
- [架构与功能总审计](../plans/2026-07-16-canvas-standalone-audit.md)
- [模块处置总账](./2026-07-16-canvas-module-disposition-ledger.md)
- [旧身份与云耦合审计](./2026-07-16-canvas-identity-cloud-coupling.md)
- [旧平台删除顺序与生产发布安全门](./2026-07-17-canvas-platform-removal-release-gates.md)
- [发行决策就绪审计](./2026-07-17-canvas-release-decisions-readiness.md)

## 2. 结论摘要

1. 当前仓库远端已经是 `alexanderizh/Spark-Canvas`，默认分支是 `main`；两个发布 workflow 仍只监听 `master`，所以向当前默认分支 push 不会自动发布桌面端或官网。
2. `electron-builder`、开发更新配置和 `UpdateService` 仍指向 `alexanderizh/spark-agent`。如果直接发布，安装包和更新检查仍会进入原产品的 GitHub Release。
3. macOS CI 强制导入 `Developer ID Application` 证书，并要求 Apple ID、app-specific password 和 Team ID；仓库无法证明 Secret 中实际证书主体。构建脚本示例提到 `yang zhang`，但它只是日志判定提示，不是对 CI 证书的可信核验。
4. Windows 配置声明 publisher 为 `Spark Foundation`，仓库也提供同名自签名证书生成器；但无法证明 `WIN_CSC_LINK` 当前实际使用何种证书。
5. Windows 公开发布 workflow 显式设置 `ALLOW_UNSIGNED_WINDOWS_RELEASE=1`。证书缺失、签名失败、证书不受信任或时间戳缺失时，流水线仍可能生成并上传未签名或验证失败的安装包。这是生产发布 P0 阻塞项，与选择哪个 publisher 无关。
6. 自建版本中心的注册 body、最新版本查询和官网查询都没有 `product` / `appId` 维度；MinIO 对象前缀也只有 `{channel}/{version}`。除非服务端存在仓库外的隐式隔离，否则 Spark Agent 与 Spark Canvas 不能被客户端契约可靠区分。
7. Spark Auth、账户、计费、托管模型和 `/api/v1/upload` 已批准共享；桌面 Release、更新元数据和下载产物不在该共享授权内，必须至少做产品级 namespace 隔离。
8. `apps/website` 仍是旧 Spark Agent 官网。网站源码树共 69 个文件（68 个生产文件和 1 个测试文件），其中 49 个文件仍含 `Spark Agent`、`SparkWork` 或 `spark-agent` 标识；它不能直接作为 Spark Canvas 官网发布。
9. 负责人已确认 D-013 采用方案 1。该决定冻结“复用原生产发行身份”，不等于仓库已经证明当前 Secrets、证书、公证权限或 Windows 信任链可用；外部核验失败时必须退回内部构建，而不是公开未签名包。
10. T-011 已冻结为 local、internal、candidate、stable 四级发布状态机；stable 只能提升同一组已签名和验证的候选产物，不能在批准后重新构建或降级为未签名包。
11. 2026-07-17 本机核验未发现有效代码签名身份、签名环境变量或仓库内证书文件；这只证明当前开发环境无法提供生产签名证据，不证明 CI Secret 或其他受控设备中的原证书不存在。
12. 版本中心虽然返回安装包 SHA-512，`UpdateService` 却在类型转换时丢弃它；新下载和缓存都不验证 size/hash/signature，且直接信任任意 `publicUrl`。严格 v2 全链 product 分区与下载完整性必须作为同一个 P0 Gate 修复。

## 3. 当前签名链

### 3.1 macOS

| 环节       | 当前实现                                                            | 独立化要求                                                                  |
| ---------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 证书注入   | `CSC_LINK` + `CSC_KEY_PASSWORD`，导入临时 `spark-build.keychain-db` | 新仓库重新配置 Secret；不得把 p12 或密码写入仓库                            |
| 证书类型   | 只检查名称包含 `Developer ID Application`                           | 固定允许的证书 Subject、TeamIdentifier 和有效期                             |
| Bundle ID  | 当前 `com.spark-agent.desktop`                                      | 使用已冻结的 `com.spark.canvas.desktop`                                     |
| 公证凭据   | `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`          | 证书 Team 与公证 Team 必须一致                                              |
| 公证       | `afterSign` 调用 `notarytool`，成功后 staple                        | 生产构建缺凭据或公证失败必须终止                                            |
| 构建后检查 | 输出 `codesign`、`spctl` 和 `stapler` 结果                          | 对 Identifier、Authority、TeamIdentifier、Gatekeeper 和 staple 建立失败门槛 |
| CI 清理    | job 结束删除临时 Keychain                                           | 保留                                                                        |

当前 macOS 链比 Windows 严格：CI 缺少 p12 会在导入脚本失败，构建脚本缺少公证凭据也会失败。仍需补的是“证书是谁”的确定性校验，而不是只匹配通用证书类型。

`build-mac-release.sh` 的理想输出文案写有 `Developer ID Application: yang zhang`。这能说明原开发环境曾按该名称人工判断，但不能证明 GitHub Secret 仍是该证书，也不能替代对真实 Subject、TeamIdentifier、有效期和 Spark Canvas 使用授权的核验。

### 3.2 Windows

| 环节           | 当前实现                                                                      | 独立化要求                                         |
| -------------- | ----------------------------------------------------------------------------- | -------------------------------------------------- |
| Publisher 配置 | `publisherName: Spark Foundation`                                             | 必须与最终证书 Subject 的 Common Name 匹配         |
| 证书注入       | `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD`                                       | 新仓库重新配置 Secret                              |
| 本地证书工具   | 默认生成 `CN=Spark Foundation, O=Spark Foundation, OU=Spark Agent` 自签名证书 | 只可用于开发或受控分发；不能宣称等同于公开信任证书 |
| 签名算法       | SHA-256                                                                       | 保留                                               |
| 时间戳         | DigiCert RFC 3161                                                             | 生产签名必须验证时间戳存在                         |
| 构建失败回退   | 签名打包失败可重试未签名打包                                                  | 生产发布禁止回退                                   |
| 构建后验证     | `Get-AuthenticodeSignature`，但可被 `ALLOW_UNSIGNED_WINDOWS_RELEASE=1` 降级   | 生产必须要求 `Valid`、匹配 Subject 且有时间戳      |

自签名证书只能证明文件由持有相应私钥的人签过，不能让全新用户设备天然信任发行者。若原 Spark Agent 只有当前自签名证书，即使选择“复用原主体”，也仍需决定是否申请公开信任的代码签名证书；这与品牌名称是否沿用是两个问题。

### 3.3 Secret 清单

| Secret                        | 作用                   | 是否可直接判断可复用                       |
| ----------------------------- | ---------------------- | ------------------------------------------ |
| `CSC_LINK`                    | macOS Developer ID p12 | 否，需核验证书 Subject、Team 和授权        |
| `CSC_KEY_PASSWORD`            | macOS p12 密码         | 否，只能安全迁入目标仓库 Secret            |
| `APPLE_ID`                    | Apple 公证账户         | 否，需确认账户仍可为目标 Team 公证         |
| `APPLE_APP_SPECIFIC_PASSWORD` | Apple 公证密码         | 否，需验证或重新生成                       |
| `APPLE_TEAM_ID`               | Apple Developer Team   | 否，仓库不含当前值                         |
| `WIN_CSC_LINK`                | Windows pfx            | 否，需核验 Subject、Issuer、有效期和信任链 |
| `WIN_CSC_KEY_PASSWORD`        | Windows pfx 密码       | 否，只能安全迁入目标仓库 Secret            |

按已确认的复用方案，这七项仍需在目标 Spark Canvas 仓库单独配置并核验；GitHub 仓库之间不会自动继承 Secrets。

### 3.4 本机与仓库可见证据

2026-07-17 在当前开发机、当前仓库和同级原 `spark-agent` 仓库执行只读核验：

| 核验范围         | 结果                                                                 | 能证明什么                                             |
| ---------------- | -------------------------------------------------------------------- | ------------------------------------------------------ |
| 用户 Keychain    | `security list-keychains -d user` 只列出 `login.keychain-db`         | 当前用户签名身份只可能来自该可见 Keychain              |
| 代码签名身份     | `security find-identity -v -p codesigning` 返回 `0 valid identities` | 当前开发机不能直接执行有效的 macOS 生产代码签名        |
| 当前进程环境     | 没有 `CSC_*`、`APPLE_*` 或 `WIN_CSC_*` 环境变量名                    | 当前进程没有 CI 式证书、公证或 Windows 签名凭据注入    |
| 两个仓库文件扫描 | 没有 `.p12`、`.pfx`、`.cer`、`.crt` 或 `.pem` 文件                   | 证书未作为普通文件进入当前仓库或同级原仓库的当前工作树 |

该结果把 E-002、E-003 收敛为“本机可见范围已核对、生产证据仍待取得”。它不能读取 GitHub Secrets，也不能替代 Apple Developer 账户、受控签名机或 Windows 证书服务中的证据；更不能据此断言原生产证书已经丢失。当前环境只能生成 local/internal 产物，不能满足 candidate/stable 签名门。

### 3.5 生产签名证据包契约

每个平台首次 candidate 构建、证书轮换和证书续期后，都必须生成一份与产物哈希绑定的 evidence packet。证据包只保存公开证书信息和验证结果，不保存或打印 `.p12`、`.pfx`、私钥、证书密码、Apple app-specific password、CI token 或完整环境变量。

公共 manifest 至少包含：

- evidence schema 版本、UTC 采集时间、仓库、commit、tag、应用版本、workflow run ID/URL；
- 产物文件名、平台、架构、字节数和 SHA-256；
- 预期应用 ID、签名主体和团队/发行者；
- 每个验证步骤的命令版本、退出码、结论和原始日志文件名；
- 授权核验记录的引用，只记录审批人、日期和受控记录编号，不把合同或账户密钥放进构建产物。

| 平台    | 必须记录的公开身份信息                                                            | 必须保存的产物验证结果                                                                                                            | 通过条件                                                                                                         |
| ------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| macOS   | Subject、Issuer、TeamIdentifier、serial 或 SHA-256 fingerprint、有效期、公证 Team | `codesign` 严格验证与详细信息、`spctl --assess`、`stapler validate`、公证 request ID/status；同时覆盖 `.app` 与对外 `.dmg`/`.zip` | Identifier 为 `com.spark.canvas.desktop`；Authority/Team 与批准身份一致；签名有效；公证 Accepted 且 staple 有效  |
| Windows | Subject、Issuer、serial 或 SHA-256 thumbprint、有效期、证书链状态、时间戳证书信息 | `Get-AuthenticodeSignature` 的公开字段、`signtool verify /pa /all /v`、RFC 3161 时间戳和最终安装包 SHA-256                        | Authenticode 为 `Valid`；Subject 与 `publisherName` 一致；公开信任链通过；签名和时间戳均使用允许算法且时间戳存在 |

candidate 和 stable 必须引用同一组产物 SHA-256 与证据包 digest。stable 只提升已经通过的 candidate，不重新签名、不重新打包；任何字段缺失、日志无法解析、产物哈希变化或身份不匹配都按失败处理。证据包可以作为受控 CI artifact 保存，并在公开 Release manifest 中仅发布非敏感摘要和 digest。

## 4. 签名主体方案

### 方案 1：复用原 Spark Agent 生产签名身份

适用前提：Spark Canvas 与原 Spark Agent 属于同一合法发行主体，并且负责人仍控制原 Apple Developer Team 与受信任 Windows 证书，证书条款允许用于 Spark Canvas。

优点：

- 用户看到的发行者连续。
- macOS Team 和 Windows 证书信誉可以延续。
- 不必等待新账户或新证书签发。

仍然必须完成：

- 核验实际 Apple Subject、TeamIdentifier、证书有效期和公证权限。
- 核验 Windows 证书是否为公开信任证书；如果只是自签名证书，不能把复用视为生产信任已解决。
- Windows `publisherName` 必须与实际证书 Subject 匹配，不能只因为旧配置写着 `Spark Foundation` 就认定正确。
- 在新仓库重新配置全部 Secrets，并把生产签名变成不可降级的硬门槛。

### 方案 2：新建 Spark Canvas 独立签名身份

适用前提：产品由不同法人/团队发行，原证书无使用授权，或希望在操作系统层完全分离发行主体。

代价：

- 新 Apple Team 或证书、公证凭据需要准备。
- Windows 需要新的受信任代码签名证书，SmartScreen 信誉从零建立。
- CI Secrets、publisher 配置、验收基线和运维交接全部重建。

收益是发行权责完全独立，不再依赖原产品证书生命周期。

### 方案 3：开发阶段暂缓生产签名

只适用于本地或内部验证。可以使用 ad-hoc、自签名或未签名产物，但不能通过生产发布 Gate，也不能上传到公开稳定下载源。该方案不是正式发行方案。

### 已确认处置

负责人已选择方案 1：如果两个产品确属同一发行主体，并且现有证书是合法可用且获授权的生产证书，Spark Canvas 复用原生产签名身份。若主体不同、证书无授权、证书失效，或 Windows 只有仓库中可生成的自签名证书，该选择的前提不成立，只允许内部构建并准备合格证书；不能依赖 `ALLOW_UNSIGNED_WINDOWS_RELEASE` 维持公开发布。

## 5. GitHub Release 与默认分支

当前实际状态：

| 项目                     | 当前值                                             | 目标状态                                |
| ------------------------ | -------------------------------------------------- | --------------------------------------- |
| Git remote               | `https://github.com/alexanderizh/Spark-Canvas.git` | 已是独立仓库                            |
| 默认分支                 | `main`                                             | 发布 workflow 应监听 `main`             |
| Desktop workflow         | 监听 `master`                                      | 替换为目标默认分支                      |
| Website workflow         | 监听 `master`                                      | 官网保留时替换；官网移除时删除 workflow |
| electron-builder publish | `alexanderizh/spark-agent`                         | 改为 `alexanderizh/Spark-Canvas`        |
| UpdateService fallback   | `alexanderizh/spark-agent`                         | 改为 `alexanderizh/Spark-Canvas`        |
| 开发更新配置             | `alexanderizh/spark-agent`                         | 改为 `alexanderizh/Spark-Canvas`        |

2026-07-17 GitHub API 核验：`alexanderizh/Spark-Canvas` 是公开、未归档仓库，默认分支为 `main`，当前 Release 列表为空。因此使用当前仓库不会覆盖既有 Spark Canvas Release；负责人已通过 D-014 接受公开仓库和同仓发布权限边界。

D-014 已冻结把当前 `alexanderizh/Spark-Canvas` 作为桌面 Release 仓库，因为它已经是本项目远端，能避免再引入第二个代码/产物仓库。实际发布配置仍需在实施阶段修改并通过签名、tag/commit 和 updater 回归 Gate。

## 6. 自建版本中心隔离风险

### 6.1 当前客户端契约没有产品维度

发布注册 body 只有：

```json
{
  "version": "...",
  "channel": "stable",
  "files": [],
  "autoPublish": true
}
```

更新检查只发送 `channel`、`platform` 和 `arch`；官网只发送 `channel`。以下位置都没有 `product`、`appId` 或仓库标识：

- `POST /api/v1/ci/desktop/releases/register`
- `GET /api/v1/desktop/releases/latest`
- `register-release.mjs` body
- `UpdateService` 查询参数
- 官网构建期快照和运行时查询
- TypeScript `LatestRelease` / `VersionCenterRelease` 类型

因此当前契约无法证明返回的是 Spark Canvas 而不是 Spark Agent。即使两个产品安装包文件名不同，最新版本查询也没有选择产品的条件。

2026-07-17 在线核验进一步证明该风险已经存在：macOS arm64 stable 查询返回 `Spark Agent-0.5.3-mac-arm64.dmg` 和 `stable/0.5.3/...` 对象键；即使请求显式增加 `product=spark-canvas`，服务仍返回同一旧产品记录。D-015 实施前禁止 Spark Canvas 使用该接口做稳定更新。

### 6.2 当前对象存储前缀也未隔离

workflow 上传到：

```text
{bucket}/stable/{version}/{artifact}
```

`register-release.mjs` 默认也使用 `{channel}/{version}`。若复用同一个桶，相同版本号下会混放两个产品；若产物同名则存在覆盖风险。

### 6.3 两种有效目标

**A. 共用版本中心基础设施，但实施严格 v2 全链 product 分区。**

- 固定 `product=spark-canvas` 或等价稳定 ID。
- 注册、查询、数据库唯一键、管理后台和下载清单都按 product 分区。
- MinIO 前缀改为 `spark-canvas/{state}/{channel}/{version}`。
- CI token 只允许注册和提升 `spark-canvas`，candidate/stable 状态分别按 product 隔离。
- Desktop/Website 校验 product、appId、platform、arch、channel、hash 和签名；缓存键也包含这些维度。
- 旧 Spark Agent 明确使用 `spark-agent`，不能靠缺省值长期区分。

**B. Spark Canvas 使用独立版本中心和发布桶。**

- 新 API base、CI token、bucket 和下载域名。
- 与账户/计费/上传服务完全分开。
- 运维成本更高，但隔离最直接。

若原版本中心服务端可以修改，推荐 A；它复用基础设施但保留产品级数据边界。无论选择 A 或 B，都不能继续使用当前无产品维度的接口直接公开发布。

线上 product/appId 矩阵、下载 hash fail-open、目标 v2 契约和迁移 Gate 见[版本中心产品隔离与更新完整性审计](./2026-07-17-canvas-version-center-product-isolation.md)。只给 v1 增加一个 query 参数或只换 bucket 均不满足发布门。

## 7. 官网发布边界

`apps/website` 与桌面端运行闭包无依赖，可以独立删除或重建。当前发布链仍使用：

- `spark-website` 镜像和容器名。
- 旧 `Spark Agent` OCI metadata。
- `spark-agent.dev` sitemap/robots。
- 旧版本中心无产品维度的下载接口。
- 旧产品首页、Agent、Team、Workflow、MCP、浏览器和远程连接内容。

D-016 已冻结为顺序执行：

1. 第一阶段从 workspace、CI 和发布链移除当前旧站，桌面独立化与 stable 不等待官网。
2. 画布视频工作台稳定后，再作为单独产品流重建，使用 Spark Canvas 品牌、真实功能截图、新域名、新镜像/容器和严格 v2 product 下载 API。

不能直接运行当前 `publish-website.yml` 把旧官网部署成 Spark Canvas 官网。

## 8. 可执行改造批次

| 批次                   | 范围                                             | 关键文件                                    | 退出条件                                   |
| ---------------------- | ------------------------------------------------ | ------------------------------------------- | ------------------------------------------ |
| R1 应用身份            | productName、appId、scheme、显示名、产物名       | `electron-builder.yml`、main 深链、品牌测试 | 两应用可并存，Spark Canvas 不注册旧 scheme |
| R2 签名硬门            | macOS Subject/Team、公证；Windows Subject/时间戳 | signing scripts、desktop workflow           | 稳定发布无法生成或上传未签名/验证失败产物  |
| R3 独立 GitHub Release | 默认分支、owner/repo、tag、Secret                | desktop workflow、builder、UpdateService    | 只从目标 Spark Canvas 仓库发布和更新       |
| R4 版本中心全链分区    | schema/API/object key/CI token/cache/state       | CI 脚本、UpdateService、官网、服务端        | 两产品同版本/同平台不会串包或覆盖          |
| R5 官网                | 首版移除旧站，稳定后单独重建                     | `apps/website`、website workflow            | 旧官网不再进入 workspace/CI/发布链         |
| R6 安装升级验收        | macOS arm64/x64、Windows x64                     | 打包产物与测试清单                          | 安装、升级、卸载、重装、双应用并存全部通过 |
| R7 视频工作台发布门    | 探测、抽帧、裁剪、转码/分段、全部产物回填        | videoWorkbench、FFmpeg、打包应用 E2E        | 核心旅程通过后才允许 stable                |

R2 与 R4 是生产安全硬门；R1、R3 完成但 R2/R4 未完成时，只允许内部构建，不允许发布稳定下载链接。

上述批次的发布级别、CI 失败策略、双产品安装/更新/卸载旅程和旧平台删除依赖，统一以[旧平台删除顺序与生产发布安全门](./2026-07-17-canvas-platform-removal-release-gates.md)为实施 Gate。

## 9. 发布验收门

### Gate P1：签名主体已冻结

- 已选择复用原生产主体，且记录“同一合法发行主体、证书可用并获授权”的适用前提。
- 生成第 3.5 节定义的 production evidence packet，并与候选产物 SHA-256 绑定。
- 记录 macOS 证书 Subject、TeamIdentifier、有效期、公证 Team 和平台验证结果，但不记录私钥或密码。
- 记录 Windows 证书 Subject、Issuer、有效期、公开信任链和 RFC 3161 时间戳验证结果。
- Windows `publisherName` 与证书匹配。

### Gate P2：公开产物不可降级

- macOS 缺证书、公证凭据、有效 staple 或 Gatekeeper 验证失败时终止。
- Windows 缺证书、签名无效、Subject 不匹配或无 RFC 3161 时间戳时终止。
- 稳定发布不设置 `ALLOW_UNSIGNED_WINDOWS_RELEASE=1`，也不执行未签名重试。
- 仅内部 artifact 可以显式选择开发签名或未签名，并与公开 Release 隔离。

### Gate P3：更新源已隔离

- 默认分支触发正确。
- GitHub Release owner/repo 不再指向原 Spark Agent。
- 自建版本中心 schema、注册、查询、对象键、CI token、缓存和发布状态均按 `spark-canvas` 分区，或已切到独立服务。
- latest 响应 product/appId 与应用一致，unknown product 不回退旧产品。
- 安装包下载和缓存均验证 size、SHA-256/SHA-512、批准 host 和平台签名后才进入 downloaded。
- 同版本号同时发布两个产品时，客户端和官网各自只得到正确安装包。

### Gate P4：安装旅程通过

- macOS arm64/x64 的 Identifier、Authority、TeamIdentifier、notarization 和 staple 正确。
- Windows x64 Authenticode 为 `Valid`，Subject 正确且带时间戳。
- Spark Agent 与 Spark Canvas 可同时安装、启动、更新和卸载。
- 更新不会降级到旧产品、覆盖另一个应用或读取另一个应用的 updater cache。

## 10. 已确认决策

按一次只确认一个关键问题的顺序：

1. D-013 生产签名：**已确认方案 1；同一合法发行主体且证书可用时复用原生产身份**。
2. D-014 GitHub Release：**已确认方案 1；使用当前 `alexanderizh/Spark-Canvas` 仓库**。
3. D-015 自建版本中心：**已确认共享原基础设施并实施严格 v2 `spark-canvas` 全链 product 分区**。
4. D-016 第一阶段官网：**已确认移除当前旧站、桌面稳定后单独重建；画布视频工作台可用为首版 P0**。
5. D-017 首发平台：**已确认 macOS arm64、macOS x64、Windows x64；Linux/Windows arm64 后续**。
6. D-018 FFmpeg 分发与许可路线：**已确认沿用原按需显式下载，不随安装包捆绑；managed 优先、兼容系统版回退，并以 Spark Canvas 新受信链和合规制品替换旧链**。

D-014 至 D-018 已全部冻结，不再有待负责人选择的发行决策。D-015 的服务端改造、三个首发目标各自的生产签名/native ABI、合规 FFmpeg 制品和画布视频工作台核心旅程仍是发布硬门。
