import type { CheerioAPI } from 'cheerio';
import { load } from 'cheerio';
import type { Context } from 'hono';
import iconv from 'iconv-lite';

import { config } from '@/config';
import InvalidParameterError from '@/errors/types/invalid-parameter';
import type { Data, DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

const rootUrl = 'https://www.biketo.com';
const apiUrl = new URL('/app.php', rootUrl).href;

const categoryMap = {
    news: {
        title: '骑闻',
        path: '/news/',
        type: 'channel',
        id: '1',
    },
    industry: {
        title: '业界',
        path: '/industry/',
        type: 'channel',
        id: '2',
    },
    product: {
        title: '产品',
        path: '/product/',
        type: 'channel',
        id: '3',
    },
    racing: {
        title: '赛事',
        path: '/racing/',
        type: 'channel',
        id: '4',
    },
    tour: {
        title: '旅行',
        path: '/tour/',
        type: 'channel',
        id: '5',
    },
    knowledge: {
        title: '知识',
        path: '/knowledge/',
        type: 'channel',
        id: '6',
    },
    video: {
        title: '视频',
        path: '/video/',
        type: 'channel',
        id: '9',
    },
    hotnews: {
        title: '热点快报',
        path: '/hotnews/',
        type: 'column',
        id: '4',
    },
    activities: {
        title: '骑行活动',
        path: '/activities/',
        type: 'column',
        id: '47',
    },
    cyclexpress: {
        title: '美骑快讯',
        path: '/cyclexpress/',
        type: 'column',
        id: '43',
    },
    beauty: {
        title: '单车美人',
        path: '/beauty/',
        type: 'column',
        id: '33',
    },
    life: {
        title: '单车生活',
        path: '/life/',
        type: 'column',
        id: '5',
    },
    daily: {
        title: '每日一图',
        path: '/daily/',
        type: 'column',
        id: '30',
    },
    road: {
        title: '公路车',
        path: '/road/',
        type: 'column',
        id: '48',
    },
    mtb: {
        title: '山地车',
        path: '/mtb/',
        type: 'column',
        id: '49',
    },
    city: {
        title: '城市车',
        path: '/city/',
        type: 'column',
        id: '50',
    },
    touringbike: {
        title: '旅行车',
        path: '/touringbike/',
        type: 'column',
        id: '51',
    },
    'e-bike': {
        title: '电助力',
        path: '/e-bike/',
        type: 'column',
        id: '44',
    },
    racingnews: {
        title: '赛事新闻',
        path: '/racingnews/',
        type: 'column',
        id: '14',
    },
    raceonspot: {
        title: '赛场直击',
        path: '/raceonspot/',
        type: 'column',
        id: '15',
    },
    racingcolumn: {
        title: '赛事专栏',
        path: '/racingcolumn/',
        type: 'column',
        id: '17',
    },
    notes: {
        title: '骑行游记',
        path: '/notes/',
        type: 'column',
        id: '18',
    },
    routes: {
        title: '路线攻略',
        path: '/routes/',
        type: 'column',
        id: '19',
    },
    inspiration: {
        title: '旅行感悟',
        path: '/inspiration/',
        type: 'column',
        id: '21',
    },
    holiday: {
        title: '美骑假日',
        path: '/holiday/',
        type: 'column',
        id: '52',
    },
    experience: {
        title: '经验技巧',
        path: '/experience/',
        type: 'column',
        id: '23',
    },
    health: {
        title: '体能健康',
        path: '/health/',
        type: 'column',
        id: '24',
    },
    repair: {
        title: '维修保养',
        path: '/repair/',
        type: 'column',
        id: '25',
    },
    beginner: {
        title: '新手入门',
        path: '/beginner/',
        type: 'column',
        id: '42',
    },
    business: {
        title: '行业动态',
        path: '/business/',
        type: 'column',
        id: '1',
    },
    insight: {
        title: '美骑观察',
        path: '/insight/',
        type: 'column',
        id: '3',
    },
    enterprise: {
        title: '企业探秘',
        path: '/enterprise/',
        type: 'column',
        id: '6',
    },
    shop: {
        title: '精品车店',
        path: '/shop/',
        type: 'column',
        id: '7',
    },
    interview: {
        title: '人物访谈',
        path: '/interview/',
        type: 'column',
        id: '8',
    },
    cyclebibi: {
        title: '骑葩说',
        path: '/cyclebibi/',
        type: 'column',
        id: '53',
    },
    racexpress: {
        title: '赛事直击',
        path: '/racexpress/',
        type: 'column',
        id: '38',
    },
    bikemovie: {
        title: '单车大片',
        path: '/bikemovie/',
        type: 'column',
        id: '45',
    },
    activityonspot: {
        title: '活动报道',
        path: '/activityonspot/',
        type: 'column',
        id: '39',
    },
    newproduct: {
        title: '产品&知识',
        path: '/newproduct/',
        type: 'column',
        id: '37',
    },
} as const;

type Category = keyof typeof categoryMap;
type CategoryConfig = (typeof categoryMap)[Category];
type ListItem = DataItem & {
    title: string;
    link: string;
};

type ApiItem = {
    title?: string;
    smalltext?: string;
    newstime?: string;
    writer?: string;
    titlepic?: string;
    newsurl?: string;
    column_name?: string;
    id?: string;
};

type ApiResponse = {
    status?: boolean;
    message?: string;
    data?: ApiItem[];
};

const categories = Object.keys(categoryMap) as Category[];
const routeDescription = `| 栏目 | 路由 |
| --- | --- |
${categories.map((category) => `| [${categoryMap[category].title}](${getPageUrl(categoryMap[category])}) | [/biketo/${category}](https://rsshub.app/biketo/${category}) |`).join('\n')}`;

const getCategory = (category?: string): Category => {
    if (!category || !Object.hasOwn(categoryMap, category)) {
        throw new InvalidParameterError(`不支持的栏目：${category || '空'}。可用栏目为 ${categories.join('、')}。`);
    }

    return category as Category;
};

function getPageUrl(category: CategoryConfig) {
    return new URL(category.path, rootUrl).href;
}

const getAbsoluteUrl = (url: string, baseUrl = rootUrl) => new URL(url, baseUrl).href;

const getRequestHeaders = (referer: string) => ({
    'User-Agent': config.trueUA,
    Referer: referer,
    'biketo-version': '1.0',
    'biketo-channel': 'web',
});

const fetchGb2312Page = async (url: string, referer = rootUrl) => {
    const { data } = await got(url, {
        responseType: 'buffer',
        headers: getRequestHeaders(referer),
    });

    return iconv.decode(data, 'gb2312');
};

const getDetailFetchUrl = (link: string) => {
    const url = new URL(link);

    url.searchParams.set('all', '1');

    return url.href;
};

const normalizeText = (text?: string) => text?.replaceAll(/\s+/g, ' ').trim() ?? '';

const parsePubDate = (dateText?: string) => (dateText ? timezone(parseDate(dateText, dateText.includes(':') ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD'), +8) : undefined);

const normalizeContentLinks = ($: CheerioAPI, content) => {
    content.find('img').each((_, element) => {
        const image = $(element);
        const src = image.attr('src') || image.attr('data-src') || image.attr('data-original');

        if (src) {
            image.attr('src', getAbsoluteUrl(src));
            image.removeAttr('data-src data-original');
        }
    });

    content.find('a').each((_, element) => {
        const anchor = $(element);
        const href = anchor.attr('href');

        if (href && !href.startsWith('javascript:')) {
            anchor.attr('href', getAbsoluteUrl(href));
        }
    });

    content.find('iframe').each((_, element) => {
        const iframe = $(element);
        const src = iframe.attr('src');

        if (src) {
            iframe.attr('src', getAbsoluteUrl(src));
        }
    });
};

const cleanContent = ($: CheerioAPI) => {
    const content = $('.article-main').first().clone();

    if (!content.length) {
        return;
    }

    content.find('script, style, .co-article-nav').remove();
    normalizeContentLinks($, content);

    const video = $('iframe.video-top').first().clone();

    if (video.length) {
        normalizeContentLinks($, video);
    }

    const html = [video.length ? $.html(video) : undefined, content.html()].filter(Boolean).join('');

    return {
        html,
        text: normalizeText(content.text()),
    };
};

const parseDetailTitle = ($: CheerioAPI, fallback: string) => {
    const title = normalizeText($('.article-title').first().text());

    return title || normalizeText($('title').text().split(' - ')[0]) || fallback;
};

const parseDetailAuthor = ($: CheerioAPI, fallback?: string) =>
    normalizeText($('.article-info .author span').first().text()) ||
    normalizeText(
        $('.article-info .author')
            .first()
            .text()
            .replace(/^作者\s*[:：]\s*/, '')
    ) ||
    fallback;

const parseDetailCategories = ($: CheerioAPI, fallback?: string) => {
    const categories = $('.article-cate .cate')
        .toArray()
        .map((element) => normalizeText($(element).text()))
        .filter(Boolean);

    return categories.length > 0 ? categories : fallback ? [fallback] : undefined;
};

const parseListItems = (items: ApiItem[]): ListItem[] =>
    items
        .map((item) => {
            if (!item.title || !item.newsurl) {
                return;
            }

            const link = getAbsoluteUrl(item.newsurl);
            const image = item.titlepic ? getAbsoluteUrl(item.titlepic) : undefined;

            return {
                title: item.title,
                link,
                guid: item.id || link,
                description: item.smalltext,
                pubDate: parsePubDate(item.newstime),
                author: item.writer,
                category: item.column_name ? [item.column_name] : undefined,
                image,
            };
        })
        .filter(Boolean) as ListItem[];

const getItem = async (item: ListItem): Promise<ListItem> => {
    try {
        return await cache.tryGet(`biketo:detail:${item.link}`, async () => {
            const response = await fetchGb2312Page(getDetailFetchUrl(item.link), item.link);
            const $ = load(response);
            const content = cleanContent($);
            const pubDate = parsePubDate(normalizeText($('.article-info .time').first().text()));
            const description = content?.html || item.description;

            return {
                ...item,
                title: parseDetailTitle($, item.title),
                description,
                pubDate: pubDate || item.pubDate,
                author: parseDetailAuthor($, typeof item.author === 'string' ? item.author : undefined),
                category: parseDetailCategories($, item.category?.[0]),
                content: content
                    ? {
                          html: content.html,
                          text: content.text,
                      }
                    : undefined,
            };
        });
    } catch {
        return item;
    }
};

const handler = async (ctx: Context): Promise<Data> => {
    const category = getCategory(ctx.req.param('category'));
    const categoryConfig = categoryMap[category];
    const pageUrl = getPageUrl(categoryConfig);
    const { data } = await got(apiUrl, {
        searchParams: {
            m: 'info',
            a: 'getNewsList',
            type: categoryConfig.type,
            id: categoryConfig.id,
            page: '1',
        },
        headers: getRequestHeaders(pageUrl),
    });
    const response = data as ApiResponse;

    if (!response.status || !Array.isArray(response.data)) {
        throw new Error(response.message || '美骑网列表接口返回异常');
    }

    const items = await Promise.all(parseListItems(response.data).map((item) => getItem(item)));

    return {
        title: `${categoryConfig.title} - 美骑网`,
        description: '美骑网自行车资讯',
        link: pageUrl,
        item: items,
        language: 'zh-CN',
        image: getAbsoluteUrl('/skin/2016/public/images/hm-logo.png'),
        icon: getAbsoluteUrl('/skin/2016/public/images/favicon.ico'),
        logo: getAbsoluteUrl('/skin/2016/public/images/favicon.ico'),
    };
};

export const route: Route = {
    path: '/:category',
    name: '栏目',
    url: 'www.biketo.com',
    maintainers: ['ZHA30'],
    handler,
    example: '/biketo/news',
    parameters: {
        category: {
            description: '栏目',
            options: categories.map((category) => ({
                label: categoryMap[category].title,
                value: category,
            })),
        },
    },
    description: routeDescription,
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
    radar: categories.map((category) => ({
        title: categoryMap[category].title,
        source: [`www.biketo.com${categoryMap[category].path}`],
        target: `/${category}`,
    })),
};
