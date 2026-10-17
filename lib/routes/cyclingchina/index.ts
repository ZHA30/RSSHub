import type { CheerioAPI } from 'cheerio';
import { load } from 'cheerio';
import type { Context } from 'hono';

import InvalidParameterError from '@/errors/types/invalid-parameter';
import type { Data, DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

const rootUrl = 'http://www.cyclingchina.net';
const categoryMap = {
    latest: {
        title: '最新资讯',
        path: '/site/index.php?m=content&c=index&a=lists&catid=42',
    },
    news: {
        title: '新闻',
        path: '/site/html/news/',
    },
    events: {
        title: '赛事',
        path: '/site/html/events/',
    },
    products: {
        title: '产品',
        path: '/site/html/new_product/',
    },
    technology: {
        title: '技术',
        path: '/site/html/must_know/',
    },
} as const;

type Category = keyof typeof categoryMap;
type ListItem = DataItem & {
    title: string;
    link: string;
};

const categories = Object.keys(categoryMap) as Category[];

const getCategory = (category?: string): Category => {
    if (!category || !Object.hasOwn(categoryMap, category)) {
        throw new InvalidParameterError(`不支持的栏目：${category || '空'}。可用栏目为 ${categories.join('、')}。`);
    }

    return category as Category;
};

const getPageUrl = (category: Category) => new URL(categoryMap[category].path, rootUrl).href;

const getAbsoluteUrl = (url: string, baseUrl: string) => new URL(url, baseUrl).href;

const cleanContent = ($: CheerioAPI) => {
    const content = $('#Article .content').first();

    if (!content.length) {
        return;
    }

    content.find('script, style').remove();
    content.find('img').each((_, element) => {
        const image = $(element);
        const src = image.attr('src') || image.attr('data-original');

        if (src) {
            image.attr('src', getAbsoluteUrl(src, rootUrl));
        }
    });
    content.find('a').each((_, element) => {
        const anchor = $(element);
        const href = anchor.attr('href');

        if (href && !href.startsWith('javascript:')) {
            anchor.attr('href', getAbsoluteUrl(href, rootUrl));
        }
    });

    return content.html() || undefined;
};

const parseDetailTitle = ($: CheerioAPI, fallback: string) => {
    const title = $('#Article h1').first().clone().find('script, span, img').remove().end().text().trim();

    return title || $('title').text().split(' - ')[0]?.trim() || fallback;
};

const parseDetailDate = ($: CheerioAPI) => {
    const dateText = $('#Article h1 span')
        .toArray()
        .map((element) => $(element).text().trim())
        .find((text) => /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(text));

    return dateText ? timezone(parseDate(dateText, 'YYYY-MM-DD HH:mm'), +8) : undefined;
};

const parseDetailCategory = ($: CheerioAPI, fallback: string) => {
    const titleParts = $('title')
        .text()
        .split(' - ')
        .map((part) => part.trim())
        .filter(Boolean);
    const category = titleParts.length > 2 ? titleParts.at(-2) : undefined;

    return category || fallback;
};

const parseLatestListItems = ($: CheerioAPI, pageUrl: string, links: Set<string>): ListItem[] =>
    $('.conment_news1')
        .toArray()
        .map((element) => {
            const item = $(element);
            const anchor = item.find('.conment_act_title a[href*="/site/html/"]').first();
            const href = anchor.attr('href');
            const title = item.find('.conment_act_title h2').first().text().trim() || anchor.text().trim();

            if (!href || !title) {
                return;
            }

            const link = getAbsoluteUrl(href, pageUrl);

            if (links.has(link)) {
                return;
            }

            links.add(link);

            const image = item.find('.conment_news1_pic img').first();
            const imageUrl = image.attr('data-original') || image.attr('src');

            return {
                title,
                link,
                description: item.find('.conment_act_content').first().text().trim() || undefined,
                image: imageUrl ? getAbsoluteUrl(imageUrl, pageUrl) : undefined,
            };
        })
        .filter(Boolean) as ListItem[];

const parseCategoryListItems = ($: CheerioAPI, pageUrl: string, links: Set<string>): ListItem[] =>
    $('.col-left > div > a[href*="/site/html/"]')
        .toArray()
        .map((element) => {
            const item = $(element);
            const href = item.attr('href');
            const title = item.find('.news2_title h4').first().text().trim() || item.attr('title')?.trim();

            if (!href || !title) {
                return;
            }

            const link = getAbsoluteUrl(href, pageUrl);

            if (links.has(link)) {
                return;
            }

            links.add(link);

            const image = item.find('img').first();
            const imageUrl = image.attr('data-original') || image.attr('src');

            return {
                title,
                link,
                description: item.find('.news2_con').first().text().trim() || undefined,
                image: imageUrl ? getAbsoluteUrl(imageUrl, pageUrl) : undefined,
            };
        })
        .filter(Boolean) as ListItem[];

const parseListItems = ($: CheerioAPI, pageUrl: string): ListItem[] => {
    const links = new Set<string>();
    const latestItems = parseLatestListItems($, pageUrl, links);

    return latestItems.length > 0 ? latestItems : parseCategoryListItems($, pageUrl, links);
};

const getItem = (item: ListItem, channelName: string): Promise<ListItem> =>
    cache.tryGet(`cyclingchina:detail:${item.link}`, async () => {
        const { data: response } = await got(item.link);
        const $ = load(response);
        const description = cleanContent($);

        return {
            ...item,
            title: parseDetailTitle($, item.title),
            description: description || item.description,
            pubDate: parseDetailDate($),
            category: [parseDetailCategory($, channelName)],
            content: description
                ? {
                      html: description,
                      text: $('#Article .content').text().trim(),
                  }
                : undefined,
        };
    });

const handler = async (ctx: Context): Promise<Data> => {
    const category = getCategory(ctx.req.param('category'));
    const channelName = categoryMap[category].title;
    const pageUrl = getPageUrl(category);

    const { data: response } = await got(pageUrl);
    const $ = load(response);
    const list = parseListItems($, pageUrl);
    const items = await Promise.all(list.map((item) => getItem(item, channelName)));
    const icon = getAbsoluteUrl('/site/favicon.ico', rootUrl);

    return {
        title: `${channelName} - 骑行家`,
        description: $('meta[name="description"]').attr('content') || '自行车与骑行热点聚焦',
        link: pageUrl,
        item: items,
        language: 'zh-CN',
        image: getAbsoluteUrl('/site/statics/images/images/logo-white.png', rootUrl),
        icon,
        logo: icon,
    };
};

export const route: Route = {
    path: '/:category',
    name: '栏目',
    url: 'www.cyclingchina.net',
    maintainers: ['ZHA30'],
    handler,
    example: '/cyclingchina/latest',
    parameters: {
        category: {
            description: '栏目',
            options: [
                {
                    label: '最新资讯',
                    value: 'latest',
                },
                {
                    label: '新闻',
                    value: 'news',
                },
                {
                    label: '赛事',
                    value: 'events',
                },
                {
                    label: '产品',
                    value: 'products',
                },
                {
                    label: '技术',
                    value: 'technology',
                },
            ],
        },
    },
    description:
        '| 栏目 | 路由 |\n' +
        '| --- | --- |\n' +
        '| [最新资讯](http://www.cyclingchina.net/site/index.php?m=content&c=index&a=lists&catid=42) | [/cyclingchina/latest](https://rsshub.app/cyclingchina/latest) |\n' +
        '| [新闻](http://www.cyclingchina.net/site/html/news/) | [/cyclingchina/news](https://rsshub.app/cyclingchina/news) |\n' +
        '| [赛事](http://www.cyclingchina.net/site/html/events/) | [/cyclingchina/events](https://rsshub.app/cyclingchina/events) |\n' +
        '| [产品](http://www.cyclingchina.net/site/html/new_product/) | [/cyclingchina/products](https://rsshub.app/cyclingchina/products) |\n' +
        '| [技术](http://www.cyclingchina.net/site/html/must_know/) | [/cyclingchina/technology](https://rsshub.app/cyclingchina/technology) |',
    categories: ['sport'],
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportRadar: true,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    radar: [
        {
            title: '最新资讯',
            source: ['www.cyclingchina.net/site/index.php?m=content&c=index&a=lists&catid=42'],
            target: '/latest',
        },
        {
            title: '新闻',
            source: ['www.cyclingchina.net/site/html/news/'],
            target: '/news',
        },
        {
            title: '赛事',
            source: ['www.cyclingchina.net/site/html/events/'],
            target: '/events',
        },
        {
            title: '产品',
            source: ['www.cyclingchina.net/site/html/new_product/'],
            target: '/products',
        },
        {
            title: '技术',
            source: ['www.cyclingchina.net/site/html/must_know/'],
            target: '/technology',
        },
    ],
};
