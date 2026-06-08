import { load } from 'cheerio';

import type { Data, DataItem, Route } from '@/types';
import { ViewType } from '@/types';
import { toTitleCase } from '@/utils/common-utils';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const baseUrl = 'https://www.thefabricator.com';
const targetUrl = `${baseUrl}/?filter=webcast`;
const sitemapUrl = `${baseUrl}/webcasts.xml`;
const targetFilterUrl = `${baseUrl}?filter=webcast`;

const parseTitleFromLink = (link: string) => {
    try {
        const { pathname } = new URL(link);
        const slug = pathname.split('/').findLast((segment) => segment.length > 0);

        return slug ? toTitleCase(slug.replaceAll('-', ' ')) : link;
    } catch {
        return link;
    }
};

export const route: Route = {
    path: '/webcast',
    name: 'Webcasts',
    url: 'www.thefabricator.com',
    categories: ['traditional-media'],
    example: '/thefabricator/webcast',
    maintainers: ['ZHA30'],
    view: ViewType.Articles,
    radar: [
        {
            source: ['www.thefabricator.com/?filter=webcast'],
            target: '/webcast',
        },
    ],
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    handler,
};

async function handler(ctx) {
    void ctx;

    const response = await ofetch(sitemapUrl);
    const $ = load(response, { xmlMode: true });

    const items: DataItem[] = $('urlset url')
        .toArray()
        .flatMap((item) => {
            const link = $(item).find('loc').text().trim();

            if (!link || link === targetUrl || link === targetFilterUrl) {
                return [];
            }

            const pubDateText = $(item).find('lastmod').text().trim();
            const pubDate = pubDateText ? parseDate(pubDateText) : undefined;

            return [
                {
                    title: parseTitleFromLink(link),
                    link,
                    pubDate,
                    guid: link,
                },
            ];
        });

    return {
        title: 'The Fabricator Webcasts',
        link: targetUrl,
        language: 'en',
        item: items,
    } as Data;
}
