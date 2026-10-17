import { load } from 'cheerio';

import type { DataItem, Route } from '@/types';
import got from '@/utils/got';

import { baseUrl, enrichBookDetail } from './utils';

const categories = {
    all: {
        name: '全部',
        prefixes: ['Boy', 'Girl', 'Novel'],
    },
    boy: {
        name: '少年漫畫',
        prefixes: ['Boy'],
    },
    girl: {
        name: '少女漫畫',
        prefixes: ['Girl'],
    },
    novel: {
        name: '小說',
        prefixes: ['Novel'],
    },
};

const categoryNames = {
    Boy: '少年漫畫',
    Girl: '少女漫畫',
    Novel: '小說',
};

export const route: Route = {
    path: '/ranking/:category?',
    categories: ['reading'],
    example: '/tongli/ranking/boy',
    parameters: { category: '分類，`all` 全部、`boy` 少年漫畫、`girl` 少女漫畫、`novel` 小說，默認為 `all`' },
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
            source: ['tongli.com.tw/Search3.aspx'],
            target: '/ranking',
        },
    ],
    name: '暢銷書排行榜',
    maintainers: ['ZHA30'],
    handler,
};

async function handler(ctx) {
    const { category = 'all' } = ctx.req.param();
    const config = categories[category] ?? categories.all;
    const currentUrl = new URL('Search3.aspx', baseUrl).href;
    const { data: response } = await got(currentUrl);
    const $ = load(response);
    const period = $('#ContentPlaceHolder1_HotMonth').text().trim();
    const list = config.prefixes.flatMap(
        (prefix) =>
            Array.from({ length: 10 }, (_, index) => {
                const rank = index + 1;
                const itemCategory = categoryNames[prefix];
                const image = $(`#ContentPlaceHolder1_${prefix}Pic${rank}`).attr('src');
                const href = $(`#ContentPlaceHolder1_${prefix}Pic${rank}`)
                    .attr('onclick')
                    ?.match(/BooksDetail\.aspx\?Bd=[\dA-Za-z]+/)?.[0];
                const title = $(`#ContentPlaceHolder1_${prefix}BookName${rank}`).text().replaceAll(/\s+/g, ' ').trim();
                const author = $(`#ContentPlaceHolder1_${prefix}Author${rank}`).text().trim();

                if (!href || !title) {
                    return;
                }

                const link = new URL(href, baseUrl).href;
                const metadata = [`<p>榜單：${itemCategory}</p>`, `<p>名次：#${rank}</p>`, period ? `<p>榜單期間：${period}</p>` : undefined].filter(Boolean).join('');

                return {
                    title: `#${rank} ${title}`,
                    author,
                    description: [image ? `<p><img src="${new URL(image, baseUrl).href}"></p>` : undefined, metadata].filter(Boolean).join(''),
                    link,
                    guid: `tongli:ranking:${period}:${prefix}:${rank}:${link}`,
                    category: [itemCategory],
                };
            }).filter(Boolean) as DataItem[]
    );

    const items = await Promise.all(list.map((item) => enrichBookDetail(item, undefined, false)));

    return {
        title: `東立出版社 - 暢銷書排行榜 - ${config.name}`,
        description: period ? `榜單期間：${period}` : undefined,
        link: currentUrl,
        item: items,
    };
}
