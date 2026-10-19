import { load } from 'cheerio';
import pMap from 'p-map';

import type { Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import { getRouteLimit } from '@/utils/route-limit';
import timezone from '@/utils/timezone';

import { extractDoc, extractIfengData, extractNewsstream } from './utils';

const categories = {
    news: {
        name: '文化资讯',
        path: '17-35104-',
    },
    insight: {
        name: '洞见',
        path: '17-35105-',
    },
    artist: {
        name: '文艺家',
        path: '17-35106-',
    },
    salon: {
        name: '风沙龙',
        path: '17-35107-',
    },
    book: {
        name: '读书',
        path: '17-35108-',
    },
};

export const route: Route = {
    path: '/culture/:category?',
    categories: ['new-media'],
    example: '/ifeng/culture',
    parameters: { category: '分类，见下表，置空为首页' },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: '文化',
    maintainers: ['ZHA30'],
    handler,
    description: `| 首页 | 文化资讯 | 洞见    | 文艺家 | 风沙龙 | 读书 |
| ---- | -------- | ------- | ------ | ------ | ---- |
|      | news     | insight | artist | salon  | book |`,
    radar: [
        {
            source: ['culture.ifeng.com/shanklist/:id', 'culture.ifeng.com/'],
            target: (_, url) => {
                const matchedCategory = Object.entries(categories).find(([, category]) => url.includes(category.path))?.[0];
                return matchedCategory ? `/culture/${matchedCategory}` : '/culture';
            },
        },
    ],
};

async function handler(ctx) {
    const categoryKey = ctx.req.param('category');
    const category = categoryKey ? categories[categoryKey] : undefined;

    if (categoryKey && !category) {
        throw new Error(`Unsupported category: ${categoryKey}`);
    }

    const rootUrl = 'https://culture.ifeng.com';
    const currentUrl = category ? `${rootUrl}/shanklist/${category.path}` : `${rootUrl}/`;

    const response = await got(currentUrl);
    const $ = load(response.data);
    const newsstream = extractNewsstream(response.data);

    const items = await pMap(
        newsstream.slice(0, getRouteLimit(ctx, 20)),
        (item) => {
            const link = normalizeUrl(item.url);
            const image = item.thumbnails?.image?.[0];

            return cache.tryGet(`ifeng:culture:detail:${item.base62Id || link}`, async () => {
                const detailResponse = await got(link);
                const detail = extractIfengData(detailResponse.data);
                const contentList = detail?.docData?.contentData?.contentList;
                const author = detail?.docData?.editorName;
                const keywords = detail?.keywords ?? detail?.docData?.keywords;

                return {
                    title: item.title,
                    link,
                    guid: item.id,
                    pubDate: item.newsTime ? timezone(parseDate(item.newsTime), +8) : undefined,
                    author: author || undefined,
                    category: keywords ? keywords.split(',').filter(Boolean) : undefined,
                    description: contentList ? extractDoc(contentList) : image ? `<img src="${image.url}" width="${image.width}" height="${image.height}">` : undefined,
                };
            });
        },
        { concurrency: 3 }
    );

    return {
        title: category ? `凤凰网文化 - ${category.name}` : $('title').text(),
        link: currentUrl,
        item: items,
    };
}

function normalizeUrl(url: string) {
    return url.startsWith('//') ? `https:${url}` : url;
}
