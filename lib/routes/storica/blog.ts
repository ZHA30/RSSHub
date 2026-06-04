import { load } from 'cheerio';

import type { Data, DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const baseUrl = 'https://storica.club';
const listUrl = `${baseUrl}/blog/`;

export const route: Route = {
    path: '/blog',
    categories: ['blog'],
    example: '/storica/blog',
    parameters: {},
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
            source: ['storica.club/blog/'],
            target: '/blog',
        },
    ],
    name: 'Blog',
    maintainers: ['ZHA30'],
    handler,
    url: 'storica.club/blog/',
};

async function handler(): Promise<Data> {
    const response = await ofetch(listUrl);
    const $ = load(response);

    const list = parseList($);
    const items = await Promise.all(list.map((item) => getDetail(item)));

    return {
        title: 'The Storica blog',
        link: listUrl,
        description: $('meta[name="description"]').attr('content') ?? 'Notes on reading, writing, and getting fluent.',
        language: 'en',
        item: items,
    };
}

function parseList($: ReturnType<typeof load>): DataItem[] {
    return $('a.r-blog-featured[href^="/blog/"], a.post-card[href^="/blog/"]')
        .toArray()
        .map((element) => {
            const $element = $(element);
            const href = $element.attr('href')!;
            const link = new URL(href, baseUrl).href;

            const title = $element.find('h2, div[style*="font-size:21px"]').first().text().trim();
            const category = $element.attr('data-post-cat') || $element.find('span').eq(1).text().trim();
            const description = $element.find('p').first().html() ?? undefined;
            const dateText = $element
                .find('span, div')
                .toArray()
                .map((el) => $(el).text().trim())
                .find((text) => /\w+ \d{1,2}, \d{4}/.test(text))
                ?.match(/\w+ \d{1,2}, \d{4}/)?.[0];

            return {
                title,
                link,
                description,
                pubDate: dateText ? parseDate(dateText) : undefined,
                category: category ? [category] : undefined,
            };
        })
        .filter((item) => item.title && item.link);
}

async function getDetail(item: DataItem): Promise<DataItem> {
    try {
        return await cache.tryGet(`storica:detail:${item.link}`, async () => {
            const response = await ofetch(item.link!);
            return parseDetail(response, item);
        });
    } catch {
        return item;
    }
}

function parseDetail(response: string, item: DataItem): DataItem {
    const $ = load(response);
    const article = parseArticleJsonLd($);
    const description = $('.post-body').html()?.trim();
    const category = $('time').prevAll('span').first().text().trim();
    const pubDate = $('time').attr('datetime');

    return {
        ...item,
        title: article?.headline ?? item.title,
        description: description || article?.description || item.description,
        author: getAuthor(article),
        pubDate: pubDate ? parseDate(pubDate) : article?.datePublished ? parseDate(article.datePublished) : item.pubDate,
        category: category ? [category] : item.category,
    };
}

function parseArticleJsonLd($: ReturnType<typeof load>): Record<string, any> | undefined {
    const raw = $('script[type="application/ld+json"]').first().text();

    if (!raw) {
        return;
    }

    try {
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data.find((item) => item?.['@type'] === 'Article') : data;
    } catch {
        return;
    }
}

function getAuthor(article?: Record<string, any>) {
    const author = article?.author;

    if (!author) {
        return;
    }

    if (Array.isArray(author)) {
        return author
            .map((item) => item?.name)
            .filter(Boolean)
            .join(', ');
    }

    return author.name;
}
