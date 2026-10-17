import { load } from 'cheerio';

import type { Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

import { extractDoc } from './utils';

const categories = {
    zhengnengliang: {
        name: '政能亮',
        type: 'channel',
        path: 'original/21-35136-',
    },
    fengsheng: {
        name: '风声',
        type: 'media',
        id: '7408',
    },
    fengdong: {
        name: '风洞',
        type: 'media',
        id: '1602814',
    },
    fengxiang: {
        name: '风向',
        type: 'channel',
        url: 'https://news.ifeng.com/shanklist/3-245389-',
    },
    warmstory: {
        name: '暖新闻',
        type: 'channel',
        url: 'https://news.ifeng.com/warmstory/',
    },
};

export const route: Route = {
    path: '/opinion/:category?',
    categories: ['new-media'],
    example: '/ifeng/opinion',
    parameters: { category: '分类，见下表，置空为首页' },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: '评论',
    maintainers: ['ZHA30'],
    handler,
    description: `| 首页 | 政能亮         | 风声      | 风洞     | 风向      | 暖新闻    |
| ---- | -------------- | --------- | -------- | --------- | --------- |
|      | zhengnengliang | fengsheng | fengdong | fengxiang | warmstory |`,
    radar: [
        {
            source: ['pl.ifeng.com/shanklist/original/:id', 'pl.ifeng.com/'],
            target: (_, url) => (url.includes(categories.zhengnengliang.path) ? '/opinion/zhengnengliang' : '/opinion'),
        },
        {
            source: ['ishare.ifeng.com/mediaShare/home/7408/media'],
            target: '/opinion/fengsheng',
        },
        {
            source: ['ishare.ifeng.com/mediaShare/home/1602814/media'],
            target: '/opinion/fengdong',
        },
        {
            source: ['news.ifeng.com/shanklist/3-245389-'],
            target: '/opinion/fengxiang',
        },
        {
            source: ['news.ifeng.com/warmstory/'],
            target: '/opinion/warmstory',
        },
    ],
};

async function handler(ctx) {
    const categoryKey = ctx.req.param('category');
    const category = categoryKey ? categories[categoryKey] : undefined;

    if (categoryKey && !category) {
        throw new Error(`Unsupported category: ${categoryKey}`);
    }

    const rootUrl = 'https://pl.ifeng.com';
    const currentUrl = getCurrentUrl(rootUrl, category);
    const response = category?.type === 'media' ? undefined : await got(currentUrl);
    const $ = load(response?.data ?? '');
    const newsstream = category?.type === 'media' ? await getMediaNewsstream(category.id) : extractNewsstream(response.data);

    const items = await Promise.all(newsstream.slice(0, 20).map((item) => parseItem(item)));

    return {
        title: category ? `凤凰网评论 - ${category.name}` : $('title').text(),
        link: currentUrl,
        allowEmpty: categoryKey === 'fengdong',
        item: items,
    };
}

function normalizeUrl(url: string) {
    return url.startsWith('//') ? `https:${url}` : url;
}

function getCurrentUrl(rootUrl: string, category) {
    if (!category) {
        return `${rootUrl}/`;
    }
    if (category.type === 'media') {
        return `https://ishare.ifeng.com/mediaShare/home/${category.id}/media`;
    }
    return category.url ?? `${rootUrl}/shanklist/${category.path}`;
}

async function getMediaNewsstream(id: string) {
    const response = await got(`https://shankapi.ifeng.com/season/ishare/getShareListData/${id}/doc/1/ifengnewsh5/getListData`);
    return JSON.parse(response.data.match(/getListData\((.*)\)/s)[1]).data;
}

function extractNewsstream(data: string) {
    const start = data.indexOf('"newsstream":[');
    if (start === -1) {
        throw new Error('newsstream not found');
    }

    const arrayStart = data.indexOf('[', start);
    let depth = 0;
    for (let i = arrayStart; i < data.length; i++) {
        if (data[i] === '[') {
            depth++;
        } else if (data[i] === ']') {
            depth--;
            if (depth === 0) {
                return JSON.parse(data.slice(arrayStart, i + 1));
            }
        }
    }

    throw new Error('newsstream is incomplete');
}

function parseItem(item) {
    const link = normalizeUrl(item.url);
    const image = item.thumbnail ? { url: item.thumbnail } : item.thumbnails?.image?.[0];

    return cache.tryGet(`ifeng:opinion:detail:${item.base62Id || item.id || link}`, async () => {
        const detailResponse = await got(link);
        const detail = detailResponse.data;
        const contentListMatch = detail.match(/"contentList":(\[.*?\]),"currentPage"/s);
        const contentList = contentListMatch ? JSON.parse(contentListMatch[1]) : undefined;
        const author = getLastMatchedValue(detail, /"editorName":"(.*?)"/g);
        const keywords = getLastMatchedValue(detail, /"keywords":"(.*?)"/g);

        return {
            title: item.title,
            link,
            guid: item.guid || item.id,
            pubDate: item.newsTime ? timezone(parseDate(item.newsTime), +8) : undefined,
            author: author || undefined,
            category: keywords ? keywords.split(',').filter(Boolean) : undefined,
            description: contentList ? extractDoc(contentList) : image ? `<img src="${image.url}" width="${image.width ?? ''}" height="${image.height ?? ''}">` : undefined,
        };
    });
}

function getLastMatchedValue(text: string, regexp: RegExp) {
    return [...text.matchAll(regexp)].pop()?.[1];
}
