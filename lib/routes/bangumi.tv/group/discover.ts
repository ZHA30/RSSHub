import type { CheerioAPI } from 'cheerio';
import { load } from 'cheerio';
import pMap from 'p-map';

import type { Data, DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

const rootUrl = 'https://bgm.tv';

type DiscoverItem = DataItem & {
    groupTitle?: string;
};

export const route: Route = {
    path: '/group/discover',
    categories: ['anime'],
    example: '/bangumi.tv/group/discover',
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
            source: ['bangumi.tv/group/discover', 'bgm.tv/group/discover'],
            target: '/group/discover',
        },
        {
            source: ['bangumi.tv/group', 'bgm.tv/group'],
            target: '/group/discover',
        },
    ],
    name: '小组发现',
    maintainers: ['ZHA30'],
    handler,
    url: 'bangumi.tv/group/discover',
    description: 'Bangumi 小组发现页的所有小组最新话题。Bangumi 公开 API 暂未提供等价的小组发现接口，因此使用页面 HTML。',
};

async function handler(ctx): Promise<Data> {
    const link = new URL('/group/discover', rootUrl).href;
    const response = await ofetch(link);
    const $ = load(response);
    const limit = ctx.req.query('limit') ? Number.parseInt(ctx.req.query('limit'), 10) : 20;

    const list: DiscoverItem[] = $('.topic_list tbody tr')
        .toArray()
        .map((element) => parseListItem($, element))
        .filter((item) => item.title && item.link)
        .slice(0, limit);

    const items = await pMap(
        list,
        (item) =>
            cache.tryGet(`bangumi.tv:group:discover:${item.link}`, async () => {
                const detailResponse = await ofetch(item.link!);
                const $$ = load(detailResponse);
                const content = $$('.postTopic .topic_content').first();

                normalizeLinks($$, content, item.link!);

                return {
                    ...item,
                    description: content.html()?.trim() ?? item.description,
                };
            }),
        { concurrency: 3 }
    );

    return {
        title: 'Bangumi · 小组发现',
        link,
        language: 'zh-CN',
        description: 'Bangumi 所有小组的最新话题',
        item: items,
    };
}

function parseListItem($: CheerioAPI, element): DiscoverItem {
    const row = $(element);
    const cells = row.find('td');
    const titleElement = cells.eq(0).find('a[href^="/group/topic/"]').first();
    const groupElement = cells.eq(1).find('a[href^="/group/"]').first();
    const authorElement = cells.eq(2).find('a[href^="/user/"]').first();
    const dateText = cells.eq(3).find('small.grey').first().text().trim();
    const link = getAbsoluteUrl(titleElement.attr('href'));
    const groupTitle = groupElement.text().trim();

    return {
        title: titleElement.text().trim(),
        link,
        guid: link,
        author: authorElement.text().trim(),
        pubDate: dateText ? timezone(parseDate(dateText, 'YYYY-M-D H:mm'), +8) : undefined,
        category: groupTitle ? [groupTitle] : undefined,
        groupTitle,
        description: titleElement.text().trim(),
    };
}

function normalizeLinks($: CheerioAPI, element, baseUrl: string) {
    element.find('a[href]').each((_, anchor) => {
        const href = $(anchor).attr('href');
        if (href) {
            $(anchor).attr('href', new URL(href, baseUrl).href);
        }
    });

    element.find('img[src]').each((_, image) => {
        const src = $(image).attr('src');
        if (src) {
            $(image).attr('src', getAbsoluteUrl(src, baseUrl));
        }
    });
}

function getAbsoluteUrl(url: string | undefined, baseUrl = rootUrl) {
    return url ? new URL(url, baseUrl).href : undefined;
}
