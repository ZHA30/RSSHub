import { load } from 'cheerio';

import type { Data, DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';

const baseUrl = 'https://www.yomiuri.co.jp';

type ListItem = {
    title: string;
    link: string;
    pubDate?: Date;
    locked: number;
};

const categoryMap = new Map([
    ['news', '速報ニュース一覧'],
    ['national', '社会'],
    ['politics', '政治'],
    ['economy', '経済'],
    ['sports', 'スポーツ'],
    ['world', '国際'],
    ['local', '地域'],
    ['science', '科学・IT'],
    ['culture', 'エンタメ・文化'],
    ['life', 'ライフ'],
    ['medical', '医療・健康'],
    ['kyoiku', '教育・就活'],
    ['election', '選挙・世論調査'],
    ['igoshougi', '囲碁・将棋'],
    ['editorial', '社説'],
    ['koushitsu', '皇室'],
]);

const resolveLink = (link: string | undefined, base: string) => {
    if (!link) {
        return;
    }

    return new URL(link, base).toString();
};

export const route: Route = {
    path: '/:category?',
    categories: ['traditional-media'],
    example: '/yomiuri/news',
    parameters: { category: 'Category, `news` by default' },
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
            source: ['www.yomiuri.co.jp/:category?'],
        },
    ],
    name: 'News',
    maintainers: ['Arracc'],
    handler,
    description: `Free articles only.

| Category       | Parameter |
| -------------- | --------- |
| 新着・速報     | news      |
| 社会           | national  |
| 政治           | politics  |
| 経済           | economy   |
| スポーツ       | sports    |
| 国際           | world     |
| 地域           | local     |
| 科学・ＩＴ     | science   |
| エンタメ・文化 | culture   |
| ライフ         | life      |
| 医療・健康     | medical   |
| 教育・就活     | kyoiku    |
| 選挙・世論調査 | election  |
| 囲碁・将棋     | igoshougi |
| 社説           | editorial |
| 皇室           | koushitsu |`,
};

async function handler(ctx): Promise<Data> {
    const { category = 'news' } = ctx.req.param();
    const url = `${baseUrl}/${category}/`;

    const response = await got(url);
    const data = response.data;
    const $ = load(data);

    let list: ListItem[] = [];
    if (category === 'news') {
        list = $('.news-top-latest__list .news-top-latest__list-item__inner')
            .toArray()
            .map((element) => {
                const item = $(element);
                const a = item.find('h3 a').first();
                const link = resolveLink(a.attr('href'), baseUrl);
                const pubDate = item.find('time').attr('datetime');

                if (!link) {
                    return;
                }

                return {
                    title: a.text().trim(),
                    link,
                    pubDate: pubDate ? parseDate(pubDate) : undefined,
                    locked: item.find('.icon-locked').length,
                } satisfies ListItem;
            })
            .filter(Boolean) as ListItem[];
    } else {
        $('.p-category-reading-recommend').remove();
        list = $('.layout-contents__main .p-category-organization .item, .layout-contents__main .c-list-title')
            .toArray()
            .map((element) => {
                const item = $(element);
                const a = item.find('h3 a, .title a').first();
                const container = item.hasClass('item') ? item : item.parent();
                const link = resolveLink(a.attr('href'), baseUrl);
                const pubDate = container.find('time').first().attr('datetime');

                if (!link) {
                    return;
                }

                return {
                    title: a.text().trim(),
                    link,
                    pubDate: pubDate ? parseDate(pubDate) : undefined,
                    locked: container.find('.c-list-member-only, .icon-locked').length,
                } satisfies ListItem;
            })
            .filter(Boolean) as ListItem[];
    }

    const items: DataItem[] = await Promise.all(
        list.map((item) =>
            cache.tryGet(`yomiuri:detail:${item.link}`, async () => {
                if (item.locked) {
                    return {
                        title: item.title,
                        link: item.link,
                        pubDate: item.pubDate,
                    };
                }

                const response = await got(item.link);
                const $ = load(response.data);
                const canonical = $('link[rel="canonical"]').attr('href') || $('meta[property="og:url"]').attr('content');
                const mainContent = $('.p-main-contents').first().clone();
                const detailItem: DataItem = {
                    title: item.title,
                    link: item.link,
                    pubDate: item.pubDate,
                };

                mainContent.find('script, style, noscript, svg, .p-related-series, .p-related-tags, .p-article-navigation, .c-article-btn, [class^=ev-article], [id^=ad-], .p-ad').remove();
                mainContent.find('img').each((_, img) => {
                    const src = img.attribs['data-src'] || img.attribs['data-original'] || img.attribs.src;
                    if (src) {
                        img.attribs.src = resolveLink(src, item.link)?.split('?')[0] ?? src.split('?')[0];
                    }
                });
                mainContent.find('a').each((_, a) => {
                    if (a.attribs.href) {
                        a.attribs.href = resolveLink(a.attribs.href, item.link) ?? a.attribs.href;
                    }
                });

                detailItem.link = canonical ?? item.link;
                detailItem.description = mainContent.html() ?? undefined;

                const publishedTime = $('meta[property="article:published_time"]').attr('content');
                const modifiedTime = $('meta[property="article:modified_time"]').attr('content');
                if (publishedTime) {
                    detailItem.pubDate = parseDate(publishedTime);
                }
                if (modifiedTime) {
                    detailItem.updated = parseDate(modifiedTime);
                }

                const tag = $('.p-header-category-breadcrumbs li a')
                    .toArray()
                    .map((element) => $(element).text().trim())
                    .findLast(Boolean);
                if (tag) {
                    detailItem.category = [tag];
                    detailItem.title = `[${tag}] ${item.title}`;
                }
                return detailItem;
            })
        )
    );

    return {
        title: `Yomiuri Shimbun - ${categoryMap.get(category) ?? $('head title').text().trim()}`,
        link: url,
        image: 'https://www.yomiuri.co.jp/apple-touch-icon.png',
        item: items,
    };
}
