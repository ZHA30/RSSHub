import { load } from 'cheerio';

import type { Data, DataItem, Route } from '@/types';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';

import { rootUrl } from './utils';

export const route: Route = {
    path: '/tag/:tag',
    categories: ['traditional-media'],
    example: '/ftchinese/tag/中国',
    parameters: { tag: '标签名称，可在标签页 URL 中找到' },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: '标签',
    maintainers: ['ZHA30'],
    handler,
    radar: [
        {
            source: ['ftchinese.com/tag/:tag'],
            target: '/tag/:tag',
        },
    ],
};

async function handler(ctx): Promise<Data> {
    const tag = ctx.req.param('tag');
    const currentUrl = `${rootUrl}/tag/${encodeURIComponent(tag)}`;
    const response = await got(currentUrl);
    const $ = load(response.data);
    const title =
        $('link[rel="canonical"]').attr('href')?.split('/').pop() ||
        $('title')
            .text()
            .replace(/ - FT中文网$/, '')
            .trim() ||
        tag;
    const description = $('.list-inner > .items .item-lead').first().text().trim();

    const items: DataItem[] = $('.item-container:has(a.item-headline-link)')
        .toArray()
        .map((item) => {
            const $item = $(item);
            const href = $item.find('a.item-headline-link').attr('href');
            const link = href ? new URL(href, rootUrl).href : undefined;
            const updatedAt = $item.attr('data-update');
            const categories = $item
                .attr('data-keywords')
                ?.split(',')
                .map((keyword) => keyword.trim())
                .filter(Boolean);
            return {
                title: $item.find('a.item-headline-link').text().trim(),
                link,
                description: $item.find('.item-lead').html() ?? undefined,
                pubDate: updatedAt ? parseDate(Number.parseInt(updatedAt, 10) * 1000) : undefined,
                category: categories,
            };
        });

    return {
        title: `FT 中文网 - ${decodeURIComponent(title)}`,
        link: currentUrl,
        description,
        item: items,
    };
}
