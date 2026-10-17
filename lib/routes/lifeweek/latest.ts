import { JSDOM } from 'jsdom';

import type { DataItem, Route } from '@/types';
import { ViewType } from '@/types';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

import { type LifeweekListItem } from './utils';

const rootUrl = 'https://www.lifeweek.com.cn/articleList';

type NuxtPayload = {
    data?: Array<{
        articleList?: LifeweekListItem[];
    }>;
};

export const buildListItem = (item: LifeweekListItem): DataItem => {
    const articleLink = `https://www.lifeweek.com.cn/article/${item.id}`;
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
        ...(description ? { content: { html: `<p>${description}</p>`, text: description } } : {}),
    };
};

const parseArticleList = (html: string) => {
    let dom: JSDOM | undefined;

    try {
        dom = new JSDOM(html, {
            runScripts: 'dangerously',
        });

        return ((dom.window.__NUXT__ as NuxtPayload | undefined)?.data?.[0]?.articleList ?? []).filter((item) => item?.id && item?.title);
    } catch {
        throw new Error('Failed to parse Lifeweek latest articles from Nuxt payload');
    } finally {
        dom?.window.close();
    }
};

export const route: Route = {
    path: '/latest',
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

async function handler() {
    const { data } = await got(rootUrl, {
        timeout: 30000,
    });
    const items = parseArticleList(typeof data === 'string' ? data : String(data))
        .slice(0, 20)
        .map((item) => buildListItem(item));

    return {
        title: '三联生活网 - 最新文章',
        link: rootUrl,
        item: items,
    };
}
