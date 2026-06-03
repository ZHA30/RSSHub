import type { DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import { parseDate } from '@/utils/parse-date';

import { defaultNovelProviders, displayTitle, fetchApi, formatNumber, md, type NovelDetailResponse, type NovelListItem, type NovelListResponse, relativeDate, rootUrl } from './utils';

const typeMap = {
    all: '0',
    ongoing: '1',
    completed: '2',
    short: '3',
};

const translateMap = {
    all: '0',
    gpt: '1',
    sakura: '2',
};

const sortMap = {
    update: '0',
    click: '1',
    relevance: '2',
};

export const route: Route = {
    path: '/novel',
    categories: ['reading'],
    example: '/novelia/novel',
    parameters: {},
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    radar: [
        {
            source: ['n.novelia.cc/novel'],
            target: '/novel',
        },
    ],
    name: '网络小说列表',
    maintainers: ['ZHA30'],
    handler,
    url: 'n.novelia.cc/novel',
    description: `支持 query 参数：

| 参数      | 说明                                                                                 | 默认   |
| --------- | ------------------------------------------------------------------------------------ | ------ |
| query     | 搜索关键词                                                                           | 空     |
| provider  | 来源，多个用英文逗号分隔，可选 kakuyomu、syosetu、novelup、hameln、pixiv、alphapolis | 全部   |
| type      | 类型，可选 all、ongoing、completed、short 或源站数字                                 | all    |
| translate | 翻译状态，可选 all、gpt、sakura 或源站数字                                           | all    |
| sort      | 排序，可选 update、click、relevance 或源站数字                                       | update |
| level     | 分级                                                                                 | 1      |
| limit     | 返回数量                                                                             | 20     |`,
};

async function handler(ctx) {
    const query = ctx.req.query('query') ?? '';
    const provider = ctx.req.query('provider') ?? defaultNovelProviders;
    const type = typeMap[ctx.req.query('type')] ?? ctx.req.query('type') ?? typeMap.all;
    const translate = translateMap[ctx.req.query('translate')] ?? ctx.req.query('translate') ?? translateMap.all;
    const sort = sortMap[ctx.req.query('sort')] ?? ctx.req.query('sort') ?? sortMap.update;
    const level = ctx.req.query('level') ?? '1';
    const limit = Number.parseInt(ctx.req.query('limit') ?? '20', 10);

    const params = new URLSearchParams({
        page: '0',
        pageSize: String(limit),
        query,
        provider,
        type,
        level,
        translate,
        sort,
    });

    const response = await fetchApi<NovelListResponse>(`/api/novel?${params.toString()}`);
    const items: DataItem[] = await Promise.all(response.items.map((item) => cache.tryGet(`novelia:novel:${item.providerId}:${item.novelId}`, () => getNovelItem(item))));

    return {
        title: `轻小说机翻机器人 - 网络小说${query ? ` - ${query}` : ''}`,
        link: `${rootUrl}/novel`,
        item: items,
    };
}

async function getNovelItem(item: NovelListItem): Promise<DataItem> {
    const detail = await fetchApi<NovelDetailResponse>(`/api/novel/${item.providerId}/${item.novelId}`);
    const link = `${rootUrl}/novel/${item.providerId}/${item.novelId}`;

    return {
        title: displayTitle(item.titleJp, item.titleZh),
        link,
        guid: `novelia:novel:${item.providerId}:${item.novelId}`,
        pubDate: item.updateAt ? parseDate(item.updateAt * 1000) : undefined,
        updated: item.updateAt ? parseDate(item.updateAt * 1000) : undefined,
        category: [...(item.attentions ?? []), ...(item.keywords ?? [])],
        description: [
            [
                detail.type,
                detail.totalCharacters === undefined ? undefined : `${formatNumber(detail.totalCharacters)}字`,
                relativeDate(detail.syncAt),
                detail.visited === undefined ? undefined : `${formatNumber(detail.visited)}次浏览`,
            ]
                .filter(Boolean)
                .join(' / '),
            md.render(detail.introductionZh ?? ''),
        ]
            .filter(Boolean)
            .join('<br>'),
    };
}
