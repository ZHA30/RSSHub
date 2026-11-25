# Route 接口规格

## Route 是消费者接口

公开 RSSHub URL 由第一层 namespace 与 route-local `path` 构成。文件名、网页 URL、上游 API URL 和 route path 相关但不可互换。先建模用户订阅的身份，再决定如何组织代码。

新 route 通常放在目标仓库 `lib/routes/<namespace>/<route>.ts[x]`，导出 `route: Route`；新 namespace 在首层目录提供 `namespace.ts` 并导出 `namespace: Namespace`。以目标仓库当前类型和邻近代码为准。

动手前按域名和订阅对象搜索 `lib/routes/`。只有订阅身份和 item 集合语义一致时才扩展已有 route；同域名、相似页面或可复用解析代码本身不足以证明应合并。若源站已经提供满足需求的官方 feed，先判断是否需要新 route。

path 和 metadata 设计确定后，新 route 可先查看目标仓库 `pnpm new:route --help` 并选用脚手架。生成的代码只是初始化产物，不替代接口决定或实现依据。

## 订阅身份与 path

- namespace 通常对应用户认知中的主站、产品或平台；栏目、地区和产品线优先由 path 区分。
- 只有订阅身份相同、item 集合语义一致时才参数化或共用 route。HTML、API 或 helper 相似不构成合并理由。
- path params 表达会改变订阅对象或 item 集合的维度，例如栏目、作者、标签、搜索词、榜单类型或对象 ID。
- `limit`、展示格式、全文/摘要、客户端过滤和只改变展示顺序的参数通常由 RSSHub common parameters 处理，不重复建 route 参数。具体先核对当前 middleware 是否已有 `limit`、`filter` / `filterout`、`sorted`、fulltext、OpenCC、format、debug 或媒体选项；不要假定上游页码是 RSSHub common parameter。
- route 配置参数使用 path params；不要新增 query-string 配置或自定义 tag/category 筛选。筛选优先使用目标仓库已有 common parameters。
- 源站默认入口与参数化入口要显式比较；不能仅为镜像网页目录结构而设计 RSSHub path。
- `routeParams`、`:param{.+}` 和 `*` 只用于无法合理枚举、且路径本身确实定义订阅身份的情况；应说明可用键、默认值、取值、编码规则并给出具体示例。解析组合参数使用 `URLSearchParams` 或等价方式，不用它承载 common parameters 已支持的能力。
- 已有 path 默认是兼容契约。修改前识别订阅者和 Radar 影响；若改为不兼容 path，明确迁移策略或由用户确认。
- 已有参数的默认值也是接口的一部分；除非已失效，否则应保留，变更时说明兼容影响。
- 默认值、path 或 example 变更时同步更新 `parameters`、文档示例和 Radar 映射。

## Metadata 与 Radar

metadata 与 path 一起构成接口规格：`name`、`url`、`categories`、`features`、`view`、`parameters`、`example`、`radar` 和 `maintainers` 应描述同一订阅身份。

- `route.example` 是以 `/` 开头、完整具体的 RSSHub path，如 `/example/news`；不能是源站 URL、参数模板或 API endpoint。已有可用 example 除非已失效，否则应保留。
- `route.path` 与 `radar[].target` 是 route-local path，不包含 namespace。
- `namespace.url` 不含协议；`radar[].source` 使用目标仓库要求的无协议域名/path，避免把不同 registrable domain 混在一个规则中。`route.url` 指向人类可读页面。
- `parameters` keys 与 path params 一致；说明取值、默认值和编码边界。
- `features` 反映 handler 实际依赖。只有确实依赖 browser 或配置时，才声明 `requirePuppeteer` / `requireConfig`；`supportBT`、`supportPodcast`、`supportScihub`、`supportRadar`、`antiCrawler` 等也必须有字段、行为或源站证据支持。
- `radar.target` 可以留空；若非空，必须匹配 route-local path 和参数。source 与 target 能表达源站页面到 route 的映射。新增 route 默认优先静态 target。
- Radar 规则通常直接写在 `Route['radar']`；按目标仓库当前模式实现，不新增独立 `radar.ts`。
- `maintainers` 使用已验证存在的 GitHub 用户名；具体默认值遵循目标仓库的贡献指南。
- `categories` 只声明一个最合适的主分类；`view` 与 feed 内容主形态一致。
- `route.path` 数组仅用于同一 handler 的别名或同构入口，不用来混合不同订阅身份。

`lib/registry-helpers.ts` 的 `collectNamespaceRoots()` / `resolveModuleNamespace()` 将最近的 `namespace.ts` 目录作为 namespace root，缺失时回退到首层目录。普通深层目录只用于代码组织；在已有 namespace 内补入路由时不随意新增深层 `namespace.ts`，否则会改变公开 URL 前缀。确需独立嵌套 namespace 时按当前 registry 行为核对，不能一概判为非法。

共享解析、类型、API client、缓存和 TSX 模板放入 helper；修改前检查调用方。`applyModulesToNamespaces()` 对相同 path 会覆盖注册结果，文件名不同并不排除冲突。`sortRoutes()` 让静态路径优先于参数路径，但仍需通过真实注册或实例请求验证新增入口和原有通用入口分别命中正确 handler。

## 接口决策记录

遇到多个可行方案时，简要比较订阅身份、消费者可见行为、兼容性和维护成本：

```text
选择：<固定 path / 参数化 path / 新 namespace / 兼容迁移>
依据：<源站导航与用户订阅对象>
影响：<URL、item 集合、Radar 或现有消费者>
未决：<仍需确认的假设>
```

## 检查条件

- 没有重复 route；静态或获准运行证据支持 `example` 与 path 匹配。
- `example`、`parameters`、`radar.target`、`features` 与 route 身份一致。
- `categories` 只有一个最合适的主分类；`maintainers` 遵循目标仓库的贡献约定。
- 改 path 时同步检查 Radar、文档示例、别名和迁移影响；只改文件名时确认公开 URL 不变。
- namespace/route 的 `url` 指向人类可读页面；按允许的验证范围确认链接有效。无法实时确认时说明未验证。
- 本地从源码加载目标 namespace 或请求实例核对注册，使用 `route-audit.mjs` 时不产生构建产物。只有用户明确要求构建时才运行 `build:routes` 等命令；生成的 registry/radar 文件不是另一份待维护源码。
- 避免 namespace 根部 catch-all、把 middleware 参数复制到 route、或因代码复用混合不同订阅对象。
