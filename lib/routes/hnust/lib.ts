import { load } from 'cheerio';

import type { DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

const rootUrl = 'https://lib.hnust.edu.cn';
const appId = 1_822_991;
const engineInstanceId = 2_597_947;
const pageId = 358371;
const websiteId = 199346;
const sign = '5f2966d57ffc73440edbcd84df2a66ea';

const categories = {
    all: {
        name: '新闻公告',
        typeIds: ['5739165', '5739169', '8899506', '6735278'],
    },
    notice: {
        name: '通知公告',
        typeIds: ['5739165'],
    },
    news: {
        name: '本馆新闻',
        typeIds: ['5739169'],
    },
    resource: {
        name: '资源动态',
        typeIds: ['8899506'],
    },
    lecture: {
        name: '活动讲座',
        typeIds: ['6735278'],
    },
};

type CategoryKey = keyof typeof categories;

type LibraryItem = {
    id: number;
    title: string;
    url: string;
    typeId: string;
    pageType: number;
    publishTime: string;
    author?: string;
    0?: {
        value?: string;
    };
};

const isCategoryKey = (category: string): category is CategoryKey => category in categories;

export const route: Route = {
    path: '/lib/:category?',
    categories: ['university'],
    example: '/hnust/lib/all',
    parameters: { category: '分类，默认为新闻公告聚合' },
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
            source: ['lib.hnust.edu.cn/engine2/m/0/1822991/2597947'],
            target: '/lib/all',
        },
    ],
    name: '图书馆新闻公告',
    maintainers: ['ZHA30'],
    handler,
    url: 'lib.hnust.edu.cn/engine2/m/0/1822991/2597947',
    description: `| 新闻公告 | 通知公告 | 本馆新闻 | 资源动态 | 活动讲座 |
| -------- | -------- | -------- | -------- | -------- |
| all      | notice   | news     | resource | lecture  |`,
};

async function handler(ctx) {
    const categoryParam = ctx.req.param('category') ?? 'all';
    const categoryKey = isCategoryKey(categoryParam) ? categoryParam : 'all';
    const category = categories[categoryKey];
    const currentUrl = `${rootUrl}/engine2/m/0/${appId}/${engineInstanceId}`;

    const list = (
        await Promise.all(
            category.typeIds.map(async (typeId) =>
                (await fetchList(typeId)).map((item) => ({
                    ...item,
                    link: getArticleLink(item),
                }))
            )
        )
    )
        .flat()
        .toSorted((a, b) => parseDate(b.publishTime).getTime() - parseDate(a.publishTime).getTime())
        .slice(0, 20);

    const items = await Promise.all(
        list.map((item) =>
            cache.tryGet(`hnust:lib:detail:${item.id}`, async () => {
                const result: DataItem = {
                    title: item.title,
                    link: item.link,
                    author: item.author || undefined,
                    pubDate: item.publishTime ? timezone(parseDate(item.publishTime), 8) : undefined,
                    image: item[0]?.value || undefined,
                    guid: String(item.id),
                };

                try {
                    const detail = await parseDetail(item.link);
                    return {
                        ...result,
                        ...detail,
                        pubDate: detail.pubDate ?? result.pubDate,
                    };
                } catch {
                    return result;
                }
            })
        )
    );

    return {
        title: `湖南科技大学图书馆 - ${category.name}`,
        link: categoryKey === 'all' ? currentUrl : `${currentUrl}?typeId=${category.typeIds[0]}`,
        description: `湖南科技大学图书馆 - ${category.name}`,
        item: items,
    };
}

async function fetchList(typeId: string): Promise<LibraryItem[]> {
    const response = await got.post(`${rootUrl}/engine2/general/${appId}/type/more-datas`, {
        form: {
            engineInstanceId,
            sign,
            pageNum: 1,
            pageSize: 20,
            typeId,
            topTypeId: '',
            sw: '',
            currentBranch: 0,
            websiteId,
            pageId,
            typeIdArray: '',
            relIdArray: '',
            relId: '',
            startDate: '',
            endDate: '',
            typeDataSort: 0,
            needViewNum: false,
            letter: '',
            groupTypeId: '',
        },
        headers: {
            'X-Requested-With': 'XMLHttpRequest',
        },
    });

    if (response.data.code !== 1) {
        throw new Error(`Failed to fetch library list: ${response.data.message ?? 'unknown error'}`);
    }

    return response.data.data.datas.datas;
}

async function parseDetail(link: string): Promise<Partial<DataItem>> {
    const response = await got(link);
    const data = extractDetailData(response.data);

    if (!data) {
        const redirectUrl = extractRedirectUrl(response.data);
        if (redirectUrl) {
            const redirectResponse = await got(new URL(redirectUrl, link).href);
            return parseDetailContent(redirectResponse.data);
        }
        return {};
    }

    return parseDetailContent(response.data);
}

function parseDetailContent(html: string): Partial<DataItem> {
    const data = extractDetailData(html);

    if (!data) {
        return {};
    }

    const content = data.content || '';
    const $ = load(`<div>${content}</div>`);

    $('script, style').remove();
    $('img, video, source').each((_, element) => {
        const node = $(element);
        const src = node.attr('src');
        if (src) {
            node.attr('src', new URL(src, rootUrl).href);
        }
        const poster = node.attr('poster');
        if (poster) {
            node.attr('poster', new URL(poster, rootUrl).href);
        }
    });
    $('a[href]').each((_, element) => {
        const node = $(element);
        const href = node.attr('href');
        if (href) {
            node.attr('href', new URL(href, rootUrl).href);
        }
    });

    return {
        title: data.title,
        description: $('div').html() || undefined,
        author: data.author || undefined,
        pubDate: data.publishTime ? timezone(parseDate(data.publishTime), 8) : undefined,
        image: data[0]?.value || undefined,
    };
}

function getArticleLink(item: LibraryItem): string {
    if (item.pageType === 1) {
        return `${rootUrl}/engine2/d/${item.id}/${engineInstanceId}/0/${appId}?t=${item.typeId}&p=1`;
    }

    const url = new URL(item.url, rootUrl);
    const target = url.searchParams.get('url');
    return target ? new URL(target, rootUrl).href : url.href;
}

function extractDetailData(html: string): (Partial<LibraryItem> & { content?: string }) | undefined {
    const dataIndex = html.indexOf('data: {"engineInstanceId"');
    if (dataIndex === -1) {
        return;
    }

    const start = html.indexOf('{', dataIndex);
    const end = findMatchingBrace(html, start);
    if (end < 0) {
        return;
    }

    return JSON.parse(html.slice(start, end + 1));
}

function extractRedirectUrl(html: string): string | undefined {
    const match = html.match(/var logoutUrl = "([^"]+)"/);
    return match?.[1]?.replaceAll(String.raw`\/`, '/').replaceAll(String.raw`\u0026`, '&');
}

function findMatchingBrace(text: string, start: number): number {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
        const char = text[i];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        switch (char) {
            case '"':
                inString = true;
                break;
            case '{':
                depth++;
                break;
            case '}':
                depth--;
                if (depth === 0) {
                    return i;
                }
                break;
            default:
                break;
        }
    }

    return -1;
}
