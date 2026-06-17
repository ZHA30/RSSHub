import { load } from 'cheerio';

import type { Data, Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';

type ContentElement = {
    type?: string;
    content?: string;
    caption?: string;
    alt_text?: string;
    resized_urls?: {
        article_leadart?: string;
        article_lg?: string;
        article_md?: string;
        article_sm?: string;
        social_share?: string;
    };
    url?: string;
};

type GlobalContent = {
    headlines?: {
        basic?: string;
    };
    subheadlines?: {
        basic?: string;
    };
    description?: {
        basic?: string;
    };
    canonical_url?: string;
    display_date?: string;
    created_date?: string;
    first_publish_date?: string;
    credits?: {
        by?: Array<{
            additional_properties?: {
                original?: {
                    byline?: string;
                };
            };
            name?: string;
        }>;
    };
    content_elements?: ContentElement[];
    taxonomy?: {
        sections?: Array<{
            name?: string;
        }>;
    };
};

type NewsArticleMetadata = {
    headline?: string;
    datePublished?: string;
    author?: Array<{
        name?: string;
    }>;
};

const baseUrl = 'https://www.chosun.com';
const politicsUrl = `${baseUrl}/politics/`;
const categories = {
    politics_general: {
        name: '정치 일반',
        path: 'politics_general',
    },
    blue_house: {
        name: '대통령실',
        path: 'blue_house',
    },
    assembly: {
        name: '국회・정당',
        path: 'assembly',
    },
    north_korea: {
        name: '북한',
        path: 'north_korea',
    },
    'diplomacy-defense': {
        name: '외교・국방',
        path: 'diplomacy-defense',
    },
    goverment: {
        name: '행정',
        path: 'goverment',
    },
} as const;

const articlePathPattern = /^\/politics\/[^/]+\/\d{4}\/\d{2}\/\d{2}\/[A-Z0-9]+\/$/;

const renderDescription = (contentElements: ContentElement[] = [], subheadline?: string) => {
    const parts: string[] = [];

    if (subheadline) {
        parts.push(`<p>${subheadline}</p>`);
    }

    for (const element of contentElements) {
        if (element.type === 'text' && element.content) {
            parts.push(`<p>${element.content}</p>`);
        } else if (element.type === 'image') {
            const image = element.resized_urls?.article_leadart ?? element.resized_urls?.article_lg ?? element.resized_urls?.article_md ?? element.resized_urls?.article_sm ?? element.resized_urls?.social_share ?? element.url;
            if (image) {
                parts.push(`<figure><img src="${image}" alt="${element.alt_text ?? ''}">${element.caption ? `<figcaption>${element.caption}</figcaption>` : ''}</figure>`);
            }
        }
    }

    return parts.join('');
};

const getAuthor = (data: GlobalContent) =>
    data.credits?.by
        ?.map((author) => author.additional_properties?.original?.byline ?? author.name)
        .filter(Boolean)
        .join(', ');

const parseGlobalContent = (html: string) => {
    const match = html.match(/Fusion\.globalContent=(\{[\s\S]*?\});Fusion\.globalContentConfig=/);
    return match ? (JSON.parse(match[1]) as GlobalContent) : undefined;
};

export const route: Route = {
    path: '/politics/:category?',
    categories: ['traditional-media'],
    example: '/chosun/politics/assembly',
    parameters: {
        category: 'Category, see table below. Leave empty for the main politics page',
    },
    features: {
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
        requireConfig: false,
    },
    radar: [
        {
            source: ['www.chosun.com/politics/'],
            target: '/politics',
        },
        {
            source: ['www.chosun.com/politics/politics_general/'],
            target: '/politics/politics_general',
        },
        {
            source: ['www.chosun.com/politics/blue_house/'],
            target: '/politics/blue_house',
        },
        {
            source: ['www.chosun.com/politics/assembly/'],
            target: '/politics/assembly',
        },
        {
            source: ['www.chosun.com/politics/north_korea/'],
            target: '/politics/north_korea',
        },
        {
            source: ['www.chosun.com/politics/diplomacy-defense/'],
            target: '/politics/diplomacy-defense',
        },
        {
            source: ['www.chosun.com/politics/goverment/'],
            target: '/politics/goverment',
        },
    ],
    name: 'Politics',
    maintainers: ['ZHA30'],
    handler,
    url: 'www.chosun.com/politics/',
    description: `| Main      | Politics General  | Presidential Office | National Assembly & Parties | North Korea  | Diplomacy & Defense | Government |
| --------- | ----------------- | ------------------- | --------------------------- | ------------ | ------------------- | ---------- |
| /politics | politics\\_general | blue\\_house         | assembly                    | north\\_korea | diplomacy-defense   | goverment  |`,
};

async function handler(ctx): Promise<Data> {
    const category = ctx.req.param('category');
    const target = category ? categories[category as keyof typeof categories] : undefined;
    const link = target ? new URL(`/politics/${target.path}/`, baseUrl).href : politicsUrl;

    const response = await got(link);
    const $ = load(response.data);

    const scriptLinks = Array.from(response.data.matchAll(/"canonical_url":"(\/politics\/[^"]+\/\d{4}\/\d{2}\/\d{2}\/[A-Z0-9]+\/)"/g) as Iterable<RegExpMatchArray>, (match) => new URL(match[1], baseUrl).href);
    const list = [
        ...new Set(
            scriptLinks.length > 0
                ? scriptLinks
                : $('a[href]')
                      .toArray()
                      .map((item) => $(item).attr('href'))
                      .filter((href): href is string => typeof href === 'string' && articlePathPattern.test(href))
                      .map((href) => new URL(href, baseUrl).href)
        ),
    ].slice(0, 20);

    const items = await Promise.all(
        list.map((item) =>
            cache.tryGet(`chosun:detail:${item}`, async () => {
                const detailResponse = await got(item);
                const detailHtml = detailResponse.data;
                const content = load(detailHtml);
                const globalContent = parseGlobalContent(detailHtml);
                const metadataText = content('script[type="application/ld+json"]')
                    .toArray()
                    .map((script) => content(script).text())
                    .find((script) => script.includes('"@type":"NewsArticle"') || script.includes('"@type": "NewsArticle"'));
                const metadata = metadataText ? (JSON.parse(metadataText) as NewsArticleMetadata) : undefined;
                const pubDate = globalContent?.display_date ?? globalContent?.first_publish_date ?? globalContent?.created_date ?? metadata?.datePublished;
                const description = renderDescription(globalContent?.content_elements, globalContent?.subheadlines?.basic) || globalContent?.description?.basic || content('meta[name="description"]').attr('content') || '';
                const title = globalContent?.headlines?.basic ?? metadata?.headline ?? content('meta[property="og:title"]').attr('content') ?? item;
                const category = globalContent?.taxonomy?.sections?.flatMap((section) => (section.name ? [section.name] : []));

                return {
                    title,
                    link: globalContent?.canonical_url ? new URL(globalContent.canonical_url, baseUrl).href : item,
                    pubDate: pubDate ? parseDate(pubDate) : undefined,
                    author: getAuthor(globalContent ?? {}) ?? metadata?.author?.map?.((author) => author.name).join(', '),
                    category,
                    description,
                };
            })
        )
    );

    return {
        title: `Chosun Ilbo - ${target?.name ?? '정치'}`,
        link,
        item: items,
    };
}
