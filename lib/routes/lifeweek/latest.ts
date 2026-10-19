import { load } from 'cheerio';
import pMap from 'p-map';

import type { DataItem, Route } from '@/types';
import { ViewType } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import { getRouteLimit } from '@/utils/route-limit';
import timezone from '@/utils/timezone';

import { getRssItem } from './utils';

const rootUrl = 'https://www.lifeweek.com.cn/articleList';
const listApiUrl = 'https://www.lifeweek.com.cn/api/article';

type LifeweekListItem = {
    id?: number | string;
    title?: string;
    daodu?: string;
    summary?: string;
    pubTime?: string | number;
    pic?: string;
    tag?: string;
    articleTags?: Array<{ name?: string }>;
    teacherList?: Array<{ name?: string }>;
};

type ArticleListResponse = {
    model?: {
        list?: LifeweekListItem[];
    };
};

export const buildListItem = (item: LifeweekListItem): DataItem => {    const articleLink = `https://www.lifeweek.com.cn/article/${item.id}`;
    const description = item.daodu || item.summary || '';
    const category = [...new Set([...(item.articleTags?.map((tag) => tag.name).filter((name): name is string => !!name) ?? []), ...(item.tag?.split('、').filter(Boolean) ?? [])])];
    const author = [...new Set(item.teacherList?.map((teacher) => teacher.name).filter(Boolean))].join(', ');

    return {
        title: item.title || articleLink,
        link: articleLink,
        description,
        pubDate: item.pubTime ? timezone(parseDate(item.pubTime), +8) : undefined,
        author: author || undefined,
        category,
        image: item.pic,
        banner: item.pic,
        guid: `lifeweek:${item.id}`,
        id: `lifeweek:${item.id}`,
    };
};

function cleanDescription(html: string, link: string) {
    const $ = load(html);
    $('script, style').remove();
    $('[style]').removeAttr('style');
    $('[class]').removeAttr('class');
    $('img, video, source').each((_, element) => {
        const node = $(element);
        const src = node.attr('src');
        if (src) {
            node.attr('src', new URL(src, link).href);
        }
    });
    $('a[href]').each((_, element) => {
        const node = $(element);
        const href = node.attr('href');
        if (href && !href.startsWith('javascript:')) {
            node.attr('href', new URL(href, link).href);
        }
    });

    return $('body').html() ?? html;
}

export const route: Route = {    path: '/latest',
    categories: ['traditional-media'],
    view: ViewType.Articles,
    example: '/lifeweek/latest',
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
            source: ['lifeweek.com.cn/articleList'],
            target: '/latest',
        },
    ],
    name: '最新文章',
    maintainers: ['ZHA30'],
    handler,
    url: 'lifeweek.com.cn/articleList',
    description: '三联生活网最新文章列表。',
};

async function handler(ctx) {
    const limit = getRouteLimit(ctx, 20);
    const { data } = await got(listApiUrl, {
        searchParams: {
            pgNo: 1,
            rowNum: limit,
        },
        timeout: 30000,
    });
    const list = ((data as ArticleListResponse).model?.list ?? []).filter((item) => item.id && item.title);
    const items = await pMap(
        list,
        (item) =>
            cache.tryGet(`lifeweek:article:${item.id}`, async () => {
                const baseItem = buildListItem(item);

                try {
                    const detail = await getRssItem(item, baseItem.link!);
                    return {
                        ...baseItem,
                        description: detail.description ? cleanDescription(detail.description, baseItem.link!) : baseItem.description,
                        pubDate: baseItem.pubDate ?? detail.pubDate,
                    };
                } catch {
                    return baseItem;
                }
            }),
        { concurrency: 3 }
    );

    return {
        title: '三联生活网 - 最新文章',
        link: rootUrl,
        item: items,
    };
}
