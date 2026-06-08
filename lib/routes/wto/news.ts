import { load } from 'cheerio';
import iconv from 'iconv-lite';
import type { Item } from 'rss-parser';

import type { DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';
import parser from '@/utils/rss-parser';

const rootUrl = 'https://www.wto.org';
const currentUrl = `${rootUrl}/english/news_e/news_e.htm`;
const feedUrl = `${rootUrl}/library/rss/latest_news_e.xml`;

type WtoFeedItem = Item & {
    link: string;
    title?: string;
    content?: string;
    contentSnippet?: string;
    categories?: string[];
    pubDate?: string;
    isoDate?: string;
};

const resolveUrl = (url?: string) => {
    if (!url) {
        return;
    }

    return url.startsWith('http://') || url.startsWith('https://') ? url : new URL(url, rootUrl).href;
};

const normalizeText = (text?: string) => text?.replaceAll(/\s+/g, ' ').trim() ?? '';

const parseWtoDate = (date?: string) => {
    if (!date) {
        return;
    }

    return parseDate(date);
};

const extractDescription = (item: WtoFeedItem, html: string): DataItem => {
    const $ = load(html);
    const intro = normalizeText($('#newsIntro').first().text());
    const content = $('.centerCol#mainContent').first();
    const hero = $('.introTextDiv figure').first();
    const category = normalizeText($('.introTextDiv .kickertext').first().text());
    const image = resolveUrl($('meta[property="og:image"]').attr('content') || hero.find('img').first().attr('src'));

    content.find('script, style').remove();

    content.find('img').each((_, element) => {
        const node = $(element);
        const src = resolveUrl(node.attr('src'));

        if (src) {
            node.attr('src', src);
        }
    });

    content.find('a').each((_, element) => {
        const node = $(element);
        const href = resolveUrl(node.attr('href'));

        if (href) {
            node.attr('href', href);
        }
    });

    const heroHtml = (() => {
        if (!hero.length) {
            return '';
        }

        hero.find('img').each((_, element) => {
            const node = $(element);
            const src = resolveUrl(node.attr('src'));

            if (src) {
                node.attr('src', src);
            }
        });

        hero.find('a').each((_, element) => {
            const node = $(element);
            const href = resolveUrl(node.attr('href'));

            if (href) {
                node.attr('href', href);
            }
        });

        return hero.html()?.trim() ?? '';
    })();

    const descriptionParts = [heroHtml, intro ? `<p>${intro}</p>` : '', content.html()?.trim() ?? ''].filter(Boolean);
    const description = descriptionParts.join('');
    const pubDate = parseWtoDate(item.isoDate ?? item.pubDate);

    return {
        title: item.title ?? item.link,
        link: item.link,
        ...(description ? { description } : item.content ? { description: item.content } : item.contentSnippet ? { description: item.contentSnippet } : {}),
        ...(pubDate ? { pubDate } : {}),
        ...(category ? { category: [category, ...(item.categories ?? [])] } : item.categories ? { category: item.categories } : {}),
        ...(image ? { image } : {}),
    };
};

const fetchArticle = (item: WtoFeedItem) =>
    cache.tryGet(item.link, async () => {
        try {
            const response = await ofetch<ArrayBuffer, 'arrayBuffer'>(item.link, {
                responseType: 'arrayBuffer',
            });
            const html = iconv.decode(Buffer.from(response), 'latin1');

            return extractDescription(item, html);
        } catch {
            return {
                title: item.title ?? item.link,
                link: item.link,
                ...(item.content ? { description: item.content } : item.contentSnippet ? { description: item.contentSnippet } : {}),
                ...((item.isoDate ?? item.pubDate) ? { pubDate: parseWtoDate(item.isoDate ?? item.pubDate) } : {}),
                ...(item.categories ? { category: item.categories } : {}),
            };
        }
    });

export const route: Route = {
    path: '/news',
    categories: ['government'],
    example: '/wto/news',
    url: 'www.wto.org/english/news_e/news_e.htm',
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
            source: ['www.wto.org/english/news_e/news_e.htm'],
            target: '/news',
        },
    ],
    name: 'News',
    maintainers: ['ZHA30'],
    handler,
    description: 'Latest news from the World Trade Organization',
};

async function handler() {
    const feedResponse = await ofetch(feedUrl, {
        parseResponse: (text) => text,
    });
    const feed = await parser.parseString(feedResponse);
    const list = feed.items
        .map((item) => {
            if (!item.link) {
                return null;
            }

            return item as WtoFeedItem;
        })
        .filter((item): item is WtoFeedItem => item !== null);
    const items = await Promise.all(list.map((item) => fetchArticle(item)));

    return {
        title: feed.title ?? 'WTO News and Events',
        link: currentUrl,
        feedLink: feedUrl,
        description: feed.description ?? 'World Trade Organization — Latest news',
        item: items,
        language: 'en' as const,
    };
}
