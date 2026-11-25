# 验证、审查与运行交接

## 验证方式

本地优先在同一棵源码树启动实例验证，不默认运行 `pnpm build`、`build:routes`、`build:docs` 或完整测试套件。静态审查任务只做对应检查；handler 改动用实际 feed 验收，metadata、类型和格式用最窄相关检查补充。不新增 route 专用测试文件。

| 改动 | 直接证据 |
|---|---|
| path、namespace、parameters、Radar | 从源码导入的 metadata；请求 example 与主要参数分支，检查命中 handler |
| handler / 正文解析 | 本地实例 JSON Feed；核对条目、正文、链接、日期、分类和附件 |
| 链接模式、排序、筛选、limit | 对比相同条目的 GUID、顺序与内容；确认详情请求前的候选数符合 common parameters |
| 共享 helper | 搜索调用方，逐条请求受影响的既有路由 |
| 类型 / 格式 | `pnpm typecheck`，或对改动文件执行 `pnpm exec oxlint --type-aware ...`、`pnpm exec oxfmt --check ...` |
| 构建 | 交给发布 CI；只有用户明确要求本地构建时才执行相应命令 |

状态码 200 不能证明字段正确。源码证明实现路径，类型检查证明类型关系，实例样本证明该环境和该次请求的输出；分别报告结论和未验证范围。

## 审计脚本

`<skill>` 指实际加载的 skill 目录，文件路径相对目标 RSSHub 根目录。脚本默认运行类型检查、源码 metadata 和启发式检查，不构建、不调用 handler。metadata 使用目标树中已安装的 tsx 导入目标顶层目录内的模块，不主动发起站点请求，但导入的模块可能有初始化副作用；只需文本分析时用 `--static-only`。

```sh
node "$skill_root/scripts/route-audit.mjs" lib/routes/tongli/comic.ts
node "$skill_root/scripts/route-audit.mjs" --types-only lib/routes/tongli/utils.ts
node "$skill_root/scripts/route-audit.mjs" --static-only lib/routes/tongli/comic.ts
RSSHUB_ROOT="$route_root" node "$skill_root/scripts/route-audit.mjs" lib/routes/tongli/comic.ts
```

未给文件时只检查当前树相对 HEAD 修改或新增的 route 文件；已提交的改动显式传入文件。namespace 和 helper 文件参与类型/文本检查，没有 route 导出时不强行要求 route metadata。脚本提示是启发式结果，不能替代当前类型、真实注册或实例输出；它也不能证明 Radar 在扩展端的实际匹配行为。删除路由需要另查调用方与实际旧 URL，删除的文件不会参与上述默认文件选择。

## 源码实例

在修改的源码树内选择空闲专用端口，直接启动 tsx。此方式设置 `NODE_ENV=dev`，由 `lib/registry-dev.ts` 懒加载源码，既不依赖也不生成 `assets/build/routes.*`；`pnpm start` 则运行旧 `dist`，不用于这次源码验收。

```sh
cd "$route_root"
NODE_ENV=dev PORT=1201 LISTEN_INADDR_ANY=false CACHE_TYPE=memory DEBUG_INFO=true pnpm exec tsx watch --clear-screen=false lib/index.ts
```

先确认监听日志和实际端口。新增顶层 namespace 需重启实例；修改已导入的文件也要确认 watch 已重启，不能用旧 handler 的缓存结果声称修复有效。需要排查缓存时重启本任务实例，或使用当前配置支持的缓存过期方式，不清理其他任务的缓存。

在另一个终端请求。此操作会访问内容源，授权范围见 `source-integration.md`。起初使用小 `limit` 控制详情成本，再根据订阅语义验证主要参数、筛选和排序：

```sh
curl -fsS 'http://127.0.0.1:1201/tongli/comic/books?format=json&limit=1'
curl -fsS 'http://127.0.0.1:1201/tongli/comic/books?format=rss&limit=1'
curl -fsS 'http://127.0.0.1:1201/tongli/comic/books?format=atom&limit=1'
curl -fsS 'http://127.0.0.1:1201/tongli/comic/books?format=0.debug.html&limit=1'
```

替换为本次实际 path，路径参数按需 URL 编码。JSON Feed 查看 `items[].url`、`id`、`content_html`、`date_published`，不是 handler 的 `item[].link`、`guid`、`description`、`pubDate`。正文较短时对照源站，不仅凭字符数推断漏抓；抽查相对资源链接、图片、日期时区、唯一标识和语义顺序。

`format=0.debug.html` 与 `format=debug.json` 都受 `lib/middleware/template.tsx` 的 debug 开关保护。前者返回第一个条目的正文，后者还要求 handler 设置 `ctx.set('json', ...)`，并不是通用原始 `Data` 转储。不要为调试全局暴露已有 secret。

对 403、验证码、源站错误和网络连接失败分别记录。一个来源失效不自动证明通用转换路由失效；可在任务范围内换用正常公开 feed 验证转换链路，不绕过阻断。需要配置的 route 在本实例环境中提供已获准配置，结束时移除本次临时值。

记录实例端口、实际请求、返回条目和未验证项。停止本任务实例并确认端口释放；用户要求保留时说明生命周期。样本不包含凭据和个人信息。

## 当前源码查证入口

- `lib/types.ts`：`Data`、`DataItem`、`Route`、`Namespace`。
- `lib/registry-dev.ts`、`lib/registry-helpers.ts`：懒加载、namespace 归属、注册覆盖及静态/参数路径优先级。
- `lib/utils/route-limit.ts`、`lib/middleware/parameter.ts`：候选池、过滤、排序、最终 limit 和全文提取。
- `lib/utils/time/`、`lib/utils/cache/`：Temporal 日期、序列化及 namespace 缓存隔离。
- `lib/middleware/template.tsx`、`lib/views/rss.tsx`、`atom.tsx`、`json.ts`：输出字段、日期格式、标识和 debug 行为。

## 发布与交接

`docs.yml`、`image.yml` 是独立的 `master` push 发布入口，均 checkout `github.sha`。docs 构建本提交的路由数据并交给独立文档站构建，image 通过本提交的 Dockerfile 构建镜像。没有覆盖组装、编排工作流、独立 validate 或定时任务。触发路径以这两个 YAML 为准；route、类型与依赖等改动可能合理地触发两者，普通技能/Markdown 改动不触发发布。

上游工作流文件保留在仓库中，但按本仓库约定在 GitHub 设置中禁用；不能仅看到文件就认定 CI 会运行。日常路由开发不改这些远端开关，也不自动执行推送、发布或同步上游。

获准提交/合并时按 namespace 分组，共享实现跟随相关路由，CI 另作提交。从 detached worktree 交接时以实际提交 SHA 快进本地 `master`，不要把工作树目录当 Git ref。删除临时工作树前确认提交已可达、未提交改动有去向，并保留用户仍需的内容。

## Review 风险分类

优先审查消费者接口、数据正确性、外部依赖和失败语义：

**高严重度**：route 无法注册或 example 不匹配；破坏既有 path/订阅语义却无迁移依据；合并不同订阅身份；正常响应引发异常；重复 link/GUID；伪造日期；详情循环无缓存或 browser 并发失控；features 与 handler 不符；解析/上游失败被伪装成空 feed；仅凭静态样本声称上游实时行为，或臆测认证并依赖未经授权的凭据；正文、摘要或标识与当前 view 的字段映射不符。

**中严重度**：metadata/radar 分类不当；channel link 指向 API；正文混入专用字段；复制 common parameters；日期排序破坏置顶或排名顺序；验证复用了其他任务的实例。

每个 finding 说明严重度、受影响接口、证据、用户可见后果和最小修正方向。区分确认缺陷、风险与信息不足；未获授权时不要把实时访问第三方系统写成审查步骤。

## 交付判定与运维交接

分别回答：

1. **需求**：订阅身份、输出和兼容目标是否满足？
2. **风险**：授权、数据真实性、请求成本、缓存、配置和错误处理如何处置？
3. **证据**：哪些检查实际执行、证明了什么；哪些仍未验证？
4. **运行**：依赖和配置由谁维护；哪些错误信号需要观察；必要时如何回退或迁移？

结论可以是可交付、带限制可交付、需返工或暂不能判断。没有运行证据不自动等于通过或失败。只有存在获准真实样本时才展示实际输出；不得伪造样本。无样本时说明验证边界和取得证据所需的授权/输入。

若用户明确要求准备或跟进 PR，再读取目标仓库当前 PR 模板、自动审查规则和协作约定。模板、规则编号和 CI 可能变化，不照搬历史快照；提交、推送、合并或清理动作按目标仓库的审批流程执行。
