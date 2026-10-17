import { load } from 'cheerio';

import type { DataItem, Route } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const rootUrl = 'https://www.hnmuseum.com';

const categories = {
    xiangbo_dongtai_news: '湘博动态',
    news_guanyi_zixun: '译文资讯',
    domestic_overseas_news: '文博资讯',
    wenming_chuangjian: '文明创建',
    announcement: '通知公告',
};

type CategoryKey = keyof typeof categories;

const isCategoryKey = (category: string): category is CategoryKey => category in categories;

async function handler(ctx) {
    const categoryParam = ctx.req.param('category') ?? 'xiangbo_dongtai_news';
    const categoryKey = isCategoryKey(categoryParam) ? categoryParam : 'xiangbo_dongtai_news';
    const categoryName = categories[categoryKey];
    const currentUrl = new URL(`/zh-hans/${categoryKey}`, rootUrl).href;

    const response = await ofetch(currentUrl);
    const $ = load(response);

    return {
        title: `湖南博物院 - ${categoryName}`,
        link: currentUrl,
        description: `湖南博物院 - ${categoryName}`,
        item: parseItems($, currentUrl),
    };
}

function parseItems($: ReturnType<typeof load>, currentUrl: string): DataItem[] {
    return $('.view-content .views-row')
        .toArray()
        .map((element) => {
            const item = $(element);
            const titleElement = item.find('.views-field-title a, .views-field-title-1 a').first();
            const title = titleElement.text().trim();
            const href = titleElement.attr('href');
            const date = item.find('.date-display-single').attr('content') ?? item.find('.date-display-single').text().trim();

            return {
                title,
                link: new URL(href ?? '', currentUrl).href,
                pubDate: date ? parseDate(date) : undefined,
            };
        })
        .filter((item) => item.title);
}

export const route: Route = {
    path: '/news/:category?',
    categories: ['travel'],
    example: '/hnmuseum/news/xiangbo_dongtai_news',
    parameters: { category: '分类，默认为湘博动态，见下表' },
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
            source: ['www.hnmuseum.com/zh-hans/xiangbo_dongtai_news'],
            target: '/news/xiangbo_dongtai_news',
        },
        {
            source: ['www.hnmuseum.com/zh-hans/news_guanyi_zixun'],
            target: '/news/news_guanyi_zixun',
        },
        {
            source: ['www.hnmuseum.com/zh-hans/domestic_overseas_news'],
            target: '/news/domestic_overseas_news',
        },
        {
            source: ['www.hnmuseum.com/zh-hans/wenming_chuangjian'],
            target: '/news/wenming_chuangjian',
        },
        {
            source: ['www.hnmuseum.com/zh-hans/announcement'],
            target: '/news/announcement',
        },
    ],
    name: '新闻',
    maintainers: ['ZHA30'],
    handler,
    url: 'www.hnmuseum.com/zh-hans/content/新闻',
    description: `| 湘博动态               | 译文资讯            | 文博资讯                 | 文明创建            | 通知公告     |
| ---------------------- | ------------------- | ------------------------ | ------------------- | ------------ |
| xiangbo\\_dongtai\\_news | news\\_guanyi\\_zixun | domestic\\_overseas\\_news | wenming\\_chuangjian | announcement |`,
};
