import { load } from 'cheerio';
import type { Item } from 'rss-parser';

import type { Route } from '@/types';
import { ViewType } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import parser from '@/utils/rss-parser';

const baseUrl = 'https://www.asahi.com';
const newsUrl = `${baseUrl}/news/`;
const feedUrl = `${baseUrl}/rss/google/feed/news.rdf`;
const defaultLimit = 50;

const toArray = <T>(value: T | T[] | undefined): T[] => (Array.isArray(value) ? value : value ? [value] : []);

const getStructuredData = ($: ReturnType<typeof load>) => {
    for (const element of $('script[type="application/ld+json"]').toArray()) {
        const text = $(element).contents().text().trim();

        if (!text) {
            continue;
        }

        try {
            const data = JSON.parse(text);
            if (data['@type'] === 'NewsArticle') {
                return data;
            }
        } catch {
            // Ignore unrelated structured data blocks.
        }
    }
};

const fetchArticle = (item: Item & { link: string }) =>
    cache.tryGet(`asahi:detail:${item.link}`, async () => {
        const { data: response } = await got(item.link);
        const $ = load(response);
        const structuredData = getStructuredData($);
        const category = [$('meta[name="cXenseParse:ash-category"]').attr('content'), $('meta[name="cXenseParse:ash-subcategory"]').attr('content')].filter(Boolean);
        const creator = structuredData?.creator;
        const author = typeof creator === 'string' ? creator : Array.isArray(creator) ? creator.join(', ') : undefined;

        return {
            title: $('meta[name="TITLE"]').attr('content') ?? item.title ?? item.link,
            link: item.link,
            description: item.content || item.contentSnippet || $('meta[name="description"]').attr('content') || undefined,
            pubDate: parseDate($('meta[property="article:published_time"]').attr('content') ?? item.pubDate ?? item.isoDate),
            updated: parseDate($('meta[property="article:modified_time"]').attr('content')),
            author,
            category: category.length > 0 ? category : toArray(item.categories),
            image:
                $('meta[property="og:image"]').attr('content') ??
                toArray(structuredData?.image)
                    .map((image) => (typeof image === 'string' ? image : image?.url))
                    .find(Boolean),
        };
    });

async function handler(ctx) {
    const limit = Math.max(Number.parseInt(ctx.req.query('limit') ?? '', 10) || defaultLimit, 1);
    const feed = await parser.parseURL(feedUrl);

    const items = await Promise.all(
        (feed.items as Item[])
            .slice(0, limit)
            .filter((item): item is Item & { link: string } => Boolean(item.link))
            .map((item) => fetchArticle(item))
    );

    return {
        title: '朝日新聞 - 速報・新着ニュース一覧',
        link: newsUrl,
        feedLink: feedUrl,
        description: feed.description,
        language: feed.language ?? 'ja',
        image: feed.image?.url,
        item: items,
    };
}

export const route: Route = {
    path: '/news',
    name: '速報・新着ニュース一覧',
    url: 'www.asahi.com/news/',
    maintainers: ['ZHA30'],
    example: '/asahi/news',
    categories: ['traditional-media'],
    view: ViewType.Articles,
    radar: [
        {
            source: ['www.asahi.com/news/'],
            target: '/news',
        },
    ],
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportRadar: true,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    handler,
};
