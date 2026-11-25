---
name: rsshub-route-dev
description: 用轻量系统工程方法设计、实现、修复和审查 RSSHub routes，明确订阅需求、系统接口、运行约束和验证证据。
---

# RSSHub Route Engineering

## 目的与适用范围

把 route 作为上游内容系统与 RSSHub 消费者之间的适配子系统。适用于新增、修改、迁移、排障和审查 route；不用于与 route 无关的阅读器、部署或通用网络任务。

系统链路：

`内容源及其接口 → route → RSSHub middleware / feed 序列化 → 订阅者与 Radar`

## 不可变约束

- 先确认用户目标、目标仓库和系统边界，再决定实现；不要从网页形态直接推导 route 身份。
- 公开 path、参数和输出字段属于消费者契约。变更前识别兼容影响；不伪造源站数据或 RSSHub 默认值。
- 区分有效空 feed、源站失败、解析失败和配置/授权缺失。
- 对内容源的访问限于用户任务和既有授权；明确要求检查某公开站点或执行实例测试时，可进行相应的正常公开请求。登录、凭据、批量抓取等额外范围按实际授权处理，详见来源集成参考。
- 不绕过登录、访问控制、签名校验、验证码或反自动化限制；不得把私人凭据放进源码、URL、日志、示例或公开输出。
- 本地以源码实例请求为主要验收，不默认执行构建或新增 route 专用测试文件。类型、格式和审计检查按变更选择；用户只要求静态审查时不扩成实时测试。
- 遵循目标仓库的 worktree、提交及审批约定；skill 维护命令从实际加载的 `<skill>` 根目录解析，route 仓库路径从目标 RSSHub 根目录解析。

## 本仓库的开发入口

本仓库是完整的 RSSHub 下游：`master` 同时包含上游源码和自有路由，路由统一位于 `lib/routes/`，配置与依赖直接使用 `lib/config.ts`、`package.json`、`pnpm-lock.yaml`。不再维护覆盖目录、组装脚本或第二棵运行树。

1. **开发前**，记录当前 `master` / 任务 HEAD，先查本地已有订阅、共享 helper 及调用方。需要对比原始实现时读取 `upstream/master`；该引用对应 `DIYgod/RSSHub`，`origin/master` 对应本仓库远端。常规路由任务不自动同步或合并上游。
2. **实现时**，按用户要求选择直接编辑或从 `master` 建立 `<工作区>/worktree/<任务>`。需要保持本地仅一个分支时使用 detached worktree。直接修改 `lib/routes/<namespace>/`；已有 namespace 优先补入缺失路由，已有 path 则整合必要差异并检查共享接口，不整目录覆盖。本仓库自有路由使用 `maintainers: ['ZHA30']`。
3. **验收时**，在编辑的同一棵源码树启动实例，逐条验证改动入口、主要参数分支和共享模块的受影响调用方。依实际改动选择静态或类型检查；本地不以构建代替运行证据。命令见[验证与运行交接](references/verification-and-operations.md)。

提交、合并沿用工作区审批；已有批准范围内按 namespace 分组提交，CI 独立提交。推送会触发相关发布，不把本地验收视为发布授权。当前发布入口为 `.github/workflows/docs.yml` 和 `image.yml`，只按相关 `master` push 触发并直接使用该提交；上游工作流保留源码、在远端关闭，不恢复旧的编排、独立验证或定时发布流程。

## 工程闭环

按变更风险裁剪步骤，不要求创建正式规格文档。用简短的决策记录把关键需求、代码选择和证据连起来。

1. **界定问题。** 确认用户/订阅者、目标系统、变更范围、限制和完成条件。存在会改变公开接口或访问授权的歧义时先询问。
2. **定义 route 接口。** 搜索现有 namespace/route，判断是否应扩展已有订阅；固定订阅身份、path、参数、metadata、消费者可见行为和兼容策略。
3. **设计上游集成。** 先查源站 feed 和目标仓库已有 helper，再按字段覆盖、稳定性、访问约束和成本选择 API、结构化数据或 HTML；仅在必要且获准时用 browser。说明证据、请求预算、配置、缓存、失败语义及未验证假设。
4. **落实 feed 契约。** 追踪 channel 和 item 字段从上游事实到 `Data` / `DataItem`，再到 RSS/Atom/JSON Feed。
5. **实现并交接。** 依据目标仓库当前类型和模式实现；按要求验证关键需求，说明运行依赖、证据边界和残余风险。

最小决策记录建议覆盖：`需求/约束 → 选择及理由 → 代码或接口位置 → 验证证据/未决风险`。只记录会影响订阅语义、兼容性、授权、运行成本或正确性的决定。

## 工程参考

按当前决策读取相应材料，不把文件顺序当作固定阶段门：

- 需求、参与者、系统责任或证据边界不清：`references/problem-and-context.md`
- namespace、path、参数、metadata、Radar 或兼容性：`references/route-interface.md`
- RSS/API/HTML、请求实现、缓存、browser、配置或认证边界：`references/source-integration.md`
- `Data` / `DataItem`、正文、日期、排序、链接或媒体输出：`references/feed-contract.md`
- 诊断、review、证据选择、交付和运行交接：`references/verification-and-operations.md`

按任务风险读取相关参考。最终交付只报告本次有关的需求、接口决定、证据和未验证项。

评审经验可提示需要核查的地方：是否已有等价 feed/route、类别和 maintainer 是否符合仓库约定、额外防御代码是否有依据，以及正文、日期、链接和缓存是否忠于源站事实。对 selector、文本清理或 fallback 的必要性，使用可观察的计数、schema、样本或文档作判断；字段规则以对应工程参考为准。
