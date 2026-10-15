# Deployment

## Steps

### D-S01: 验证打包后的 CLI

构建可发布 package，并让打包后的 binary 使用隔离的 registry 与 cache 路径运行。

### D-S02: 确认 release readiness

确认 package 内容、命令帮助和用户文档已经呈现新的 preset 工作流，但不发布 release。

## Acceptance criteria

### D-AC01: 打包后的命令可以隔离运行

对构建产物执行隔离 smoke
test，能够显示 preset 帮助并离线读取目录，且不使用开发者真实的 registry 或 cache。

### D-AC02: Package 已为后续 release 做好准备

Package 验证和文档审阅证明所需 runtime 文件与使用说明均已就绪；npm 发布仍不在本 idea 范围内。
