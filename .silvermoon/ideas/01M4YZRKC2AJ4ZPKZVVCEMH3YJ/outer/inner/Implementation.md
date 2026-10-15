# Implementation

## Steps

### I-S01: 定义 preset 源和元数据模型

增加 `.git-lineage-preset.yaml` manifest，并为 canonical repository
identity、GitHub
alias、仓库拥有的 preset 元数据、用户 registry 和生成的 cache 增加经过验证的模型。公开 GitHub 的 HTTPS、SSH 和 SCP
locator 归一为同一个 identity；其他完整 URL 和本地绝对 `file://`
identity 保持明确。

### I-S02: 实现 registry 和刷新操作

实现可移植的 config/cache 路径解析，以及添加、移除和刷新操作。使用隔离的 bare
Git repository 浅 fetch 指定分支并读取 manifest 与
`.git-lineage.yaml`，不执行远端代码，也不把仓库元数据重复写入人工维护的 registry。失败刷新保留原有有效 cache。

### I-S03: 通过 CLI 提供 preset 发现能力

增加 `preset add`、`remove`、`refresh`、`list` 和
`show`，提供稳定的人类可读与 JSON 输出、ASCII 树形渲染、显式 storage
override、文档和聚焦测试，同时保持现有 derive 与 update 行为。

## Acceptance criteria

### I-AC01: 源 identity 具有确定性且安全

测试证明 GitHub 的不同传输形式会解析为同一个 canonical URL 和 `owner/repo`
alias；其他源保留完整 identity，本地路径保持稳定，包含凭据的 URL 会被拒绝。

### I-AC02: Registry 和 cache 保持权威边界

测试证明添加、移除和刷新会通过临时文件原子替换各自的持久化文件；registry 只保留源定位信息；元数据从仓库内容派生；刷新失败时保留原有有效 cache，并明确报告失败。

### I-AC03: Preset 可发现且不产生回归

CLI 测试证明 list、tree、JSON、show、add、remove 和 refresh 行为正确，同时仓库的格式、lint、类型检查、测试、构建和 package 验证全部通过。
