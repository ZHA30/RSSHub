# Feed 接口契约

## Data 与序列化边界

handler 返回 RSSHub 当前类型支持的 `Data`、`DataItem` 或 `Response`。只使用类型允许的字段，不添加自定义 item properties。区分 handler 内部字段与最终 RSS、Atom、JSON Feed 序列化字段。

当前正文映射：

| 含义 | handler 字段 | 说明 |
|---|---|---|
| HTML 正文 | `content.html` 或 `item.description` | parameter middleware 将 `content.html` 补入缺失的 `description`；各 view 使用处理后的 `description` |
| 纯文本正文 | `content.text` | Atom/JSON Feed 可表达；不输出到 RSS 2.0 |
| 纯文本摘要 | `summary` | 摘要而非全文；Atom/JSON Feed 可表达 |
| channel 摘要 | `description` | feed/channel 摘要，与 item 正文无关 |

现有路由使用 `description` 符合当前类型和 view；不为统一写法批量改字段。`description` 非空时优先于 `content.html`，二者不能提供矛盾内容。不要把 title、author、date、tags 或统计数拼入正文或 summary；有专用字段就使用专用字段。

## Channel 与 Item 契约

- channel `title`、`link`、`description` 表达用户订阅的页面；`link` 指向人类可读页面，不指向 API。`image`、`icon`、`logo`、`language`、`author` 只在有稳定来源或目标格式需要时填。
- item `title` 保留源站标题，不手动 trim 或截断；`link` 稳定、规范化且唯一。GUID/id 使用源站 id、业务 id 或稳定复合键，仅在比 link 更稳定时显式设置。
- `lib/views/rss.tsx`、`atom.tsx` 的标识回退为 `guid → link → title`，`json.ts` 为 `guid → id → link`。要让跨格式身份一致，使用稳定的 `guid`；不要以为只填 `id` 就会改变 RSS/Atom 标识。原文/阅读页等链接模式如不改变订阅身份，应保持 GUID 稳定。
- 源站文章 tags/categories 映射到 item `category`，不要塞进正文。
- `author`、`category`、`pubDate`、`updated`、`enclosure` 和 `attachments` 只按源站事实填充。
- `updated` 表示真实修改时间，不为格式完整复制 `pubDate`。
- 无值字段省略，不写 `null`。源站明确返回有效空列表才考虑 `allowEmpty: true`；网络/解析错误不能转换成空 Data。

## 日期、顺序与链接

- 源站提供发布时间时应填入 `pubDate`，使用目标仓库现有日期和时区工具（如 `parseDate`）；不要把活动举办时间当作发布时间。没有日期就省略 `pubDate`；只有日期时不补假时间；禁止以当前时间作 fallback。源站未提供时区时，仅在其时区可确定时进行归一化。
- 当前 `@/utils/time` 基于 Temporal：`parseDate()` 返回 `Temporal.Instant | undefined`。数字输入默认毫秒，`'X'` 为秒、`'x'` 为毫秒；无偏移时间默认 UTC，需要显式传入已知时区（如 `8` 或 `'Asia/Shanghai'`）。非 ISO/RFC 日期传入格式；不要再调用 Date/dayjs 的实例方法。缓存序列化后可能是字符串，应按最终语义或用 `toInstant()` / `toISOString()` 比较，而非要求对象类型不变。
- canonical link 优先级：源站 canonical/`og:url`/`html_url` → 详情页人类 URL → 稳定业务 URL。列表/API/搜索 endpoint、播放器页和下载跳转页通常不适合作为 channel/item link。
- 清除会导致身份抖动的临时 token、tracking、分页和易变 hash；必要时以稳定源站 ID 作为 GUID。
- 核心默认按 `pubDate` 排序。源站置顶、排名或时间线顺序有语义时设置 `Data.sortItems: false`；用户传入 common `sorted` 时以显式用户选项为准。
- HTML 内容定位正文容器后清理 script/style/noscript、导航、广告、分享、推荐、隐藏内容和重复标题/作者/日期。`a[href]`、`img[src]`、lazy image、video/audio/source、iframe/embed/track、poster 等资源 URL 转为绝对地址。TSX 用 `renderToString`；`raw()` 只包装已清理 HTML。

## 媒体与 Attachments

只填真实可解释的媒体数据：

- `enclosure_url` 指向媒体文件直链，不指向播放器；使用有效且准确的 MIME type，大小未知就省略。
- 多个源站附件使用 `attachments`，包含直链 `url`、真实 `mime_type`，可选真实 title/size/duration。RSS 使用 enclosure 或第一个附件；Atom/JSON Feed 可输出多个。
- `enclosure=true` 是 RSSHub common parameter，可从正文提取可识别的直链媒体；route 不重复造附件，也不解析播放器背后的下载地址。
- 视频缩略图优先作为 `<video poster="...">`；普通文章图片不伪装成音视频附件。当前 RSS view 在未提供其他附件时可将 `item.image` 输出为 enclosure，检查时区分核心回退与 route 显式设置的附件。
- BT/magnet：直链放 `enclosure_url`，类型为 `application/x-bittorrent`，并设置 `features.supportBT`。
- Podcast：channel 的 `itunes_author`、`itunes_category` 和 `image`，以及 item 音频直链、真实 MIME、可选 duration/image 可支持 podcast 输出；只有行为实际符合时才设置 `features.supportPodcast`。
- Sci-Hub/journal：仅源站提供 DOI 时填 `doi`，并据实设置 `features.supportScihub`。Media RSS 仅在需要 `media:*` 语义且字段来源可解释时使用。
- 不写 route-local `referrerpolicy`；不要把网页 URL、格式标签或媒体平台特有类型伪装成 MIME type。

## 追踪与检查

为关键字段保留简短 mapping：`上游字段/页面 → Data/DataItem 字段 → RSS/Atom/JSON Feed 字段`。按目标仓库当前 schema 核对类型；用户要求验证时按实际 format 检查输出字段，避免把 `content_html` 或 RSS `<description>` 当成 handler 输入字段。
