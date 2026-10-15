# Implementation

## Steps

### I-S01: 定义 preset 源和元数据模型

为 canonical repository identity、GitHub alias、仓库拥有的 preset 元数据、
用户 registry 和生成的 cache 增加经过验证的模型。

### I-S02: 实现 registry 和刷新操作

实现可移植的存储路径解析，以及添加、移除和刷新操作。元数据通过 Git 获取，
不把仓库元数据重复写入人工维护的 registry。

### I-S03: 通过 CLI 提供 preset 发现能力

增加 `preset` 命令组、稳定的人类可读与 JSON 输出、树形渲染、文档和聚焦测试，
同时保持现有 derive 与 update 行为。

## Acceptance criteria

### I-AC01: 源 identity 具有确定性且安全

测试证明 GitHub 的不同传输形式会解析为同一个 canonical URL 和 `owner/repo`
alias；其他源保留完整 identity，本地路径保持稳定，包含凭据的 URL 会被拒绝。

### I-AC02: Registry 和 cache 保持权威边界

测试证明添加、移除和刷新会原子更新文件；registry 只保留源定位信息；元数据从仓库
内容派生；刷新失败时保留原有有效 cache，并明确报告失败。

### I-AC03: Preset 可发现且不产生回归

CLI 测试证明 list、tree、JSON、show、add、remove 和 refresh 行为正确，同时仓库的
格式、lint、类型检查、测试、构建和 package 验证全部通过。
