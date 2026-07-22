# Spark Canvas FFmpeg 分发物来源与发布门审计

> 审计快照: 2026-07-17 | 代码基线: `6cfbfcd` | 在线 manifest 原文 SHA-256: `388573f42fb98e0999b7abde3ffeb581b35c40f6391b1da86a7cc964a0a4fef7` | 本阶段只形成拆分依据，不修改业务代码

## 1. 目的与边界

本文件下钻 E-005，判断当前 Spark artifact manifest 中四个 FFmpeg 归档能否作为 Spark Canvas 的 candidate/stable 分发基线。D-018 已冻结为沿用原按需显式下载加系统回退体验；本文件回答三件事：

1. manifest 声明与真实字节是否一致。
2. 两个可执行文件实际来自哪里、版本和 codec profile 是什么。
3. 当前归档还缺什么，才能进入公开商业发布链。

核验使用：

- 仓库中的 `FfmpegIntegrityService.ts`、`FfmpegRunner.ts`、FFmpeg IPC 和 artifact installer；
- 2026-07-17 只读获取的 [Spark artifact manifest](https://minio.yiqibyte.com/spark-desktop/artifact-repository/v1/index.json)；
- 实际下载的四个 Spark ZIP，以及其中八个可执行文件；
- Martin Riedl、evermeet.cx、John Van Sickle 和 npm registry 的原始分发物；
- [FFmpeg License and Legal Considerations](https://ffmpeg.org/legal.html)与[FFmpeg License / external libraries](https://ffmpeg.org/doxygen/8.0/md_LICENSE.html)。

方法是先核对 archive 字节数和 SHA-256，再检查归档清单、内层文件 SHA-256、`file`、`-version`、configure 字符串、encoder 清单和平台签名；最后把内层 SHA-256 与声明来源的原始包逐一对账。本文件不是法律意见，最终商业发行仍需有权限的负责人或法律顾问检查最终二进制、源码供给和专利/商业 codec 风险。

## 2. 结论摘要

1. 四个 Spark ZIP 共 `220,221,981` 字节，实测字节数和 SHA-256 全部与在线 manifest 一致；对象传输完整性没有发现偏差。
2. 每个 Spark ZIP 都只含 `ffmpeg`/`ffprobe` 两个可执行文件，没有许可证、notices、源码、source offer、构建脚本、补丁、SBOM 或可通过验证的签名/sidecar。
3. macOS arm64 manifest 声明 `7.1.1`，真实二进制却是 2026-07-04 的开发快照 `N-125450-gfad2e0bc50`；内层哈希与 Martin Riedl 该快照精确一致。版本标签错误，不能进入 candidate。
4. macOS x64 的真实版本是 `8.1.2-tessus`，内层哈希与 evermeet.cx 8.1.2 精确一致；但两个 Mach-O 都完全未签名。
5. Linux x64 的真实版本是 `7.0.2-static`，内层哈希与 John Van Sickle 原始 7.0.2 release 精确一致；原包含 `GPLv3.txt`、readme、manpages 和模型，Spark 重打包全部移除。
6. Windows ZIP 不是同一版本的一对工具：`ffmpeg.exe` 精确来自 `@ffmpeg-installer/win32-x64@4.1.0`，真实快照为 `N-92722-gf22fcd4483`；`ffprobe.exe` 精确来自 `@ffprobe-installer/win32-x64@5.1.0`，真实构建为 `2023-02-13-git-2296078397`。manifest 却把整包统一标成 `4.1`。
7. macOS arm64 两个可执行文件的严格 codesign 验证都失败；x64 两个可执行文件未签名；Windows 两个 PE 的 Security Directory 均为零。当前包不能满足生产分发物签名门。
8. 四个平台可见 configure 均启用 GPL、`libx264`、`libx265` 和 `libvpx`，未发现 `--enable-nonfree`；这符合当前视频功能依赖，但意味着不能按 LGPL-only 包处理。arm64 还单独启用 OpenSSL，需要结合精确源码和依赖版本做额外许可核验。
9. 当前完整性服务只运行 `-version`，既不会发现 arm64 的错误标签和 Windows 的 ffmpeg/ffprobe 混版，也不会验证 `-buildconf`、encoder profile、内层哈希、许可证材料或平台签名。
10. 结论是：**当前四个 Spark FFmpeg ZIP 只允许 local/internal 研究，不允许 candidate/stable。** D-018 只沿用原按需下载体验，受控下载必须先换成通过本文件 Gate 的新基线。
11. D-017 已冻结首发 macOS arm64、macOS x64、Windows x64；这三个目标都必须取得独立 approved descriptor 和 candidate evidence packet。Linux x64 的当前包仍保留审计拒绝结论，但替代 Linux 基线不阻塞首版。

## 3. 在线 manifest 快照

manifest 声明 `schemaVersion: 1`、`updatedAt: 2026-07-12`，原文 SHA-256 为：

```text
388573f42fb98e0999b7abde3ffeb581b35c40f6391b1da86a7cc964a0a4fef7
```

四个条目实测如下：

| 平台        | artifact id                        | manifest 版本 | archive SHA-256                                                    |         字节 |
| ----------- | ---------------------------------- | ------------- | ------------------------------------------------------------------ | -----------: |
| macOS arm64 | `binary.ffmpeg-7.1.1.darwin-arm64` | 7.1.1         | `5e05cec07f836b58a76ab57f7ebba6f8208a589d17bf0f84a22750627792f26e` | 56,562,590 B |
| macOS x64   | `binary.ffmpeg-8.1.2.darwin-x64`   | 8.1.2         | `e9875d36bda1a7feba975a5e2aa11545f0b4a1824c1e2cb49f2c3d70ff41397f` | 53,549,382 B |
| Linux x64   | `binary.ffmpeg-7.0.2.linux-x64`    | 7.0.2         | `c2aaecbe4b77b3971e8c703521f3291250b3f49989e01e5121c4ff71147bbb6a` | 58,935,098 B |
| Windows x64 | `binary.ffmpeg-4.1.win32-x64`      | 4.1           | `72c994c2c1450a7ed250f5e31937fa70ca35e7a9c2d81799604cda1c56a20ba3` | 51,174,911 B |

SHA-256 证明“下载到的 ZIP 是 manifest 指定的 ZIP”，不能证明 manifest 本身受签名保护、版本标签正确、内层文件获授权或归档满足再分发义务。当前 manifest 与 hash 位于同一可变远端信任域，也没有产品 ID、签名或审批状态。

## 4. 真实二进制身份

### 4.1 版本与来源对账

| 平台        | manifest 声明 | `ffmpeg` 真实身份                                    | `ffprobe` 真实身份                                         | 上游精确对账                                                                                                                                          |
| ----------- | ------------- | ---------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS arm64 | 7.1.1         | `N-125450-gfad2e0bc50-https://www.martin-riedl.de`   | 同一快照                                                   | 与 [2026-07-04 Martin Riedl snapshot](https://ffmpeg.martin-riedl.de/info/detail/macos/arm64/1783164229_N-125450-gfad2e0bc50) 两个 ZIP 的内层哈希一致 |
| macOS x64   | 8.1.2         | `8.1.2-tessus`                                       | `8.1.2-tessus`                                             | 与 [evermeet.cx 8.1.2 release](https://evermeet.cx/ffmpeg/) 的 `ffmpeg-8.1.2.zip`、`ffprobe-8.1.2.zip` 内层哈希一致                                   |
| Linux x64   | 7.0.2         | `7.0.2-static https://johnvansickle.com/ffmpeg/`     | 同一 release                                               | 与 [John Van Sickle 7.0.2 release](https://johnvansickle.com/ffmpeg/) 原始 tar.xz 的内层哈希一致                                                      |
| Windows x64 | 4.1           | `N-92722-gf22fcd4483`，npm 包标识 `20181217-f22fcd4` | `2023-02-13-git-2296078397`，npm 包标识 `20230213-2296078` | 分别与 npm `@ffmpeg-installer/win32-x64@4.1.0` 和 `@ffprobe-installer/win32-x64@5.1.0` 精确一致                                                       |

arm64 的实际 libav ABI 为 `libavutil 61.2.100`、`libavcodec 63.3.100`，也与 FFmpeg 7.1.1 不符。Windows 则把 2018 和 2023 的两个构建装进同一 `4.1` 归档。客户端目前只解析 ffmpeg 首行版本，不比较 descriptor，也不检查 ffprobe 版本，所以两类错误都会被判定 ready。

### 4.2 内层文件 SHA-256

| 平台        | 文件          | SHA-256                                                            |
| ----------- | ------------- | ------------------------------------------------------------------ |
| macOS arm64 | `ffmpeg`      | `be2c39e5c9ef923f60da6cb62f5a209ed98b4da8a732d9f06de4355d5ea99e58` |
| macOS arm64 | `ffprobe`     | `2abffb693846e171a65b149fc48286672cb502bcbd9c8c5491bfa862986b187c` |
| macOS x64   | `ffmpeg`      | `60725ea0467ccaf900bf294d3567c302a802dc661f03bdde6aa7ecc9ccf05c4f` |
| macOS x64   | `ffprobe`     | `a45033d0e45ede2683cee401545becd7ef1a9873ea6f640c0acf0b90f7730b67` |
| Linux x64   | `ffmpeg`      | `e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99` |
| Linux x64   | `ffprobe`     | `4f231a1960d83e403d08f7971e271707bec278a9ae18e21b8b5b03186668450d` |
| Windows x64 | `ffmpeg.exe`  | `c8abc49e7be62dde8e12972af373959e0076a7b8dc8040eb45978e0608f8781e` |
| Windows x64 | `ffprobe.exe` | `f28c4751e7367205267025aaf0fcfc921e34d9b7edaa46bd9c8abaf367fc9051` |

可复核的上游容器证据：

- Martin Riedl 两个原始 ZIP SHA-256 分别为 `b5ce8b77f8c0686e4f68a46f8e4d094fe7e6f4ded50bcfacd9944ad1efdf66e9` 和 `fadcf23296a4b57921c70d6d7d8b9930a4c8d4e0658b8e696f188bae1dcc47d8`。
- evermeet 两个原始 ZIP SHA-256 分别为 `e91df72a1ee7c26606f90dd2dd4dcccc6a75140ff9ea6fdd50faae828b82ba69` 和 `399b93f0b9862f69767afa343e90c2f48d7e7958cadbb6deb76a012d0e3b7ce3`。
- John Van Sickle 原始 release tar.xz SHA-256 为 `abda8d77ce8309141f83ab8edf0596834087c52467f6badf376a6a2a4c87cf67`。
- npm 两个原始 tgz SHA-1 分别为 `17e8699b5798d4c60e36e2d6326a8ebe5e95a2c5` 和 `87841123e8b903cc327f1e5b9aa69e5d2fbe6d7b`；registry 还提供 SRI/signature metadata，但 Spark manifest 未引用。

## 5. Codec 与许可事实

### 5.1 当前不是 LGPL-only profile

四个平台的 ffmpeg configure 都包含：

- `--enable-gpl`、`--enable-version3`；
- `--enable-libx264`、`--enable-libx265`、`--enable-libvpx`；
- 没有发现 `--enable-nonfree`。

macOS 两个平台实跑 `-encoders` 均确认 `libx264`、`libx265` 和 `libvpx-vp9` 存在；Linux/Windows 二进制内嵌 configure 与当前业务需要一致。FFmpeg 官方许可证说明明确把 libx264、libx265 等列为 GPL 组合，因此当前功能基线必须按最终 GPL 构建事实处理，不能只写“FFmpeg 默认 LGPL”。

macOS arm64 还是唯一启用 `--enable-openssl` 的包。FFmpeg 官方 external libraries 说明把 OpenSSL 组合列为需要额外关注的许可边界；最终是否可再分发必须结合该快照、OpenSSL 精确版本、构建脚本和适用许可证核验，不能仅凭“没有 `--enable-nonfree`”放行。

### 5.2 重打包丢失的材料

| 来源                             | 原始包可见材料                                         | Spark ZIP 中保留                     |
| -------------------------------- | ------------------------------------------------------ | ------------------------------------ |
| Martin Riedl snapshot            | 独立 ffmpeg/ffprobe ZIP、SHA-256、build server/source  | 只保留两个可执行文件                 |
| evermeet 8.1.2                   | 独立 ZIP、GPG signature、构建信息和 external libs      | 只保留两个未签名可执行文件           |
| John Van Sickle 7.0.2            | `GPLv3.txt`、readme、manpages、models、source 链       | 只保留两个可执行文件                 |
| npm FFmpeg 4.1.0 + FFprobe 5.1.0 | package.json 的版本、来源和 GPL metadata、registry SRI | 只保留两个不同年代的未签名可执行文件 |

因此“可以从网络重新找到来源”不能替代随分发物履行许可义务。candidate 前必须把精确对应源码、构建说明、修改/补丁、适用许可证文本和第三方 notices 绑定到同一 release evidence packet。

## 6. 平台签名结果

| 平台        | 实测结果                                                                                                                        | 判定                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| macOS arm64 | `codesign -d` 可见 ffmpeg `TeamIdentifier=KU3N25YGLU`，但 ffmpeg/ffprobe 的 `codesign --verify --strict` 均报 invalid signature | 不能把“存在签名 blob”当成有效生产签名                     |
| macOS x64   | ffmpeg/ffprobe 均为 `code object is not signed at all`                                                                          | 下载后执行链没有有效 Mach-O 代码签名                      |
| Windows x64 | ffmpeg/ffprobe 的 PE Security Directory 均为 `0000000000000000 00000000`                                                        | 两个文件都没有 Authenticode                               |
| Linux x64   | 上游只提供 archive/hash 证据，Spark manifest 没有独立签名字段                                                                   | 只能证明当前 archive hash，不能证明生产发布审批或来源签名 |

本机 `spctl` 对两个临时解压文件返回 Code Signing subsystem internal error，因此不能作为通过或拒绝证据；上表只采用可重复的 codesign/PE 结构事实。未来 macOS/Windows candidate 应使用已批准的 Spark Canvas 分发身份签名并生成签名 evidence packet，或者保存并验证等价的上游签名后再由发布流程明确批准。

## 7. 当前实现为什么会误放行

当前链路是：

```text
Renderer ffmpeg:install
  -> 旧 Spark 在线 manifest
  -> archive URL + 同域可选 SHA-256
  -> SkillRegistryService.installBinaryArtifact
  -> {userData}/bin/<remote-name>/
  -> FfmpegIntegrityService 扫描目录
  -> 仅运行 ffmpeg -version
```

它没有验证：

- descriptor 版本与 `ffmpeg -version`、`ffprobe -version` 同时一致；
- ffmpeg 和 ffprobe 来自同一 source revision 和 codec profile；
- `-buildconf`、`-encoders`、`-protocols` 与产品批准基线一致；
- archive 内只能出现 manifest 列出的文件，且每个内层文件 hash 固定；
- macOS codesign/notarization 或 Windows Authenticode；
- source archive、构建脚本、SBOM、license、notices 和 source offer；
- manifest 本身的产品 namespace、签名、审批状态和回滚保护。

所以当前 `ffmpegReady=true` 只表示某个二进制能返回版本文本，不表示它是 manifest 声称的版本、满足当前 codec 能力、获准再分发或通过平台信任链。

## 8. 新基线发布契约

### 8.1 默认拒绝规则

当前四个 artifact id 全部标记为：

```text
local/internal: 可用于研究和迁移对照
candidate/stable: DENY
```

不能通过修改 manifest 名称、补一个 LICENSE 文件或仅重新签 Spark ZIP 放行。版本身份、ffmpeg/ffprobe 配对、源码/构建链、codec profile、内层签名和许可材料必须一起替换或补齐。

### 8.2 Approved descriptor 最低字段

Spark Canvas 专用 descriptor 至少固定：

- `product=spark-canvas`、artifact schema、platform、arch、最低 OS；
- archive URL、字节数、SHA-256、签名和每个内层文件的 path/bytes/SHA-256；
- ffmpeg 与 ffprobe 的真实 `versionLine`、source tag/commit，且两者必须同 revision；
- 完整 configure、批准的 encoder/decoder/filter/protocol profile 及其 digest；
- build script/toolchain revision、外部库版本和 SBOM；
- `licenseId`、许可证文件、copyright/notices、source archive/hash、patches 和 source offer；
- macOS Team/signature/notarization 或 Windows Subject/Authenticode/timestamp 预期值；
- 审批状态、审批人、复核日期、撤销原因和 previous-version rollback 规则。

### 8.3 Candidate evidence packet

每个平台 candidate 必须保存：

1. archive 和内层文件 hash 对账。
2. `-version`、`-buildconf`、`-encoders`、`-decoders`、`-filters` 和 `-protocols` 的机器可读快照。
3. 真实 probe、抽帧、裁剪、拼接、H.264/H.265/VP9 导出和异常输入旅程。
4. macOS codesign/notarization/Gatekeeper 或 Windows Authenticode/RFC 3161 验证结果。
5. source、build、SBOM、license、notices 和 source offer 的 digest。
6. 与 Spark Canvas Release manifest 的 commit、版本、平台、arch 和产物 SHA-256 绑定。

D-017 首版要求 macOS arm64、macOS x64、Windows x64 三份 evidence packet 全部通过；不能用一个平台的 codec、签名或视频工作台结果替代另一个平台。Linux/Windows arm64 后续进入支持矩阵时重新执行同一 Gate。

stable 只能提升同一组 candidate 字节和 evidence packet，不重新下载“latest”、不重新打包，也不允许系统 FFmpeg 的一次成功结果替代 managed artifact 验收。

## 9. D-018 与 E-005 状态

D-018 已冻结：FFmpeg 不随安装包捆绑，用户在设置或视频工作台按需显式下载；Spark Canvas managed 版本是主路径，兼容的系统 PATH FFmpeg 是回退。

受控下载只能使用新 approved descriptor 和通过 Gate 的新基线。系统版本只在 managed 缺失/损坏且同 revision ffmpeg/ffprobe、codec profile、真实 probe smoke 全部通过时临时回退。两者都不可用时进入 `setup-required`，不得请求当前旧包、任意 URL 或静默切云端。每个任务固定来源类型、descriptor 和二进制 digest，运行中不切换二进制。下载模式仍是 Spark 分发，不减少 GPL、source、notices 或专利核验义务。

E-005 当前状态从“只知道四包来源异构”推进为：**manifest 与真实分发物已逐包审计、上游内层哈希已对账、当前四包已明确拒绝 candidate/stable；替代构建、许可交付、SBOM、三个首发平台 evidence packet 和法律批准仍待实施。** 这些是实施/发布 Gate，不是审计决策阻塞项。
