# 让 Preset 谱系可发现

## Problem

用户目前必须事先知道 preset 仓库及其分支，才能从中派生项目。系统缺少一个本地目录，
无法发现常用 preset、说明其用途，也无法展示这些仓库之间的谱系关系。

## Outcome

用户可以在本地注册 preset 仓库源，并通过 `git-lineage preset` 命令添加、移除、
刷新、查看和列出它们。仓库中的元数据始终是权威来源；本地 registry 只保存源定位信息，
可替换的 cache 则让说明和谱系图能够离线使用。

## Boundaries

- Preset 的 canonical identity 是规范化后的完整仓库 URL；公开 GitHub 仓库还会
  获得派生的 `owner/repo` alias。
- 说明和父级谱系来自各 preset 仓库内受版本控制的文件，而不是 registry 中手工复制
  的字段。
- 第一版中每个 canonical repository 只跟踪一个分支，并且不会发布、修改或删除任何
  远端仓库。

## Acceptance criteria

- 用户可以用完整仓库 URL 添加和移除 preset 源，并通过无歧义的 `owner/repo`
  alias 引用已注册的公开 GitHub preset。
- 用户可以刷新仓库拥有的元数据，并列出或查看缓存的说明、源 commit、分支，以及
  直接或树形的谱系关系。
- Registry 与 cache 的行为具有确定性，能够安全处理凭据，可移植到受支持的平台，
  并由 CLI 和 library 测试覆盖。
