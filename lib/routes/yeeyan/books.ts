import { load } from 'cheerio';
import pMap from 'p-map';

import InvalidParameterError from '@/errors/types/invalid-parameter';
import type { Data, Route } from '@/types';
import cache from '@/utils/cache';
import logger from '@/utils/logger';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';
import { getRouteLimit } from '@/utils/route-limit';
import timezone from '@/utils/timezone';

const baseUrl = 'https://g.yeeyan.com';
const cdnUrl = 'https://cdn.yeeyan.com';
const defaultLimit = 10;
const detailConcurrency = 3;

const sections = {
    all: { path: '/books', title: '所有书目' },
    onsale: { path: '/books/onsale', title: '新品上架' },
    translating: { path: '/books/translating', title: '正在翻译' },
    applying: { path: '/books/applying', title: '译者招募' },
} as const;

type Section = keyof typeof sections;

type BookCard = {
    id: string;
    link: string;
    title: string;
    image?: string;
};

type BookDetail = {
    chinese_title?: string;
    original_title?: string;
    author?: string;
    description?: string;
    cover?: string;
    created?: string;
    tags?: string[];
};

const escapeHtml = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const renderParagraphs = (text: string): string =>
    text
        .split(/\n+/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
        .join('');

const getSection = (ctx): Section => {
    const type = ctx.req.param('type') ?? 'all';

    if (!Object.hasOwn(sections, type)) {
        throw new InvalidParameterError(`Invalid book section: ${type}. Allowed values: ${Object.keys(sections).join(', ')}`);
    }

    return type as Section;
};

const parseCards = (html: string): BookCard[] => {
    const $ = load(html);
    const cards: BookCard[] = [];

    for (const element of $('.asided .book > a').toArray()) {
        const anchor = $(element);
        const href = anchor.attr('href');
        const id = href?.match(/\/books\/(\d+)/)?.[1];

        if (!href || !id) {
            continue;
        }

        cards.push({
            id,
            link: new URL(href, baseUrl).href,
            title: anchor.find('.name').text().trim(),
            image: anchor.find('img').attr('src'),
        });
    }

    return cards;
};

const fetchBookDetail = async (id: string): Promise<BookDetail> =>
    await cache.tryGet(`yeeyan:gutenberg:book:${id}`, async () => {
        const html = await ofetch(`${baseUrl}/books/${id}`);
        const $ = load(html);
        const raw = $('script[type="text/json"][data-name="book"]').first().text();

        if (!raw) {
            throw new Error(`Yeeyan book page ${id} has no embedded data`);
        }

        return JSON.parse(raw) as BookDetail;
    });

async function handler(ctx): Promise<Data> {
    const section = getSection(ctx);
    const { path, title: sectionTitle } = sections[section];
    const listingUrl = `${baseUrl}${path}`;
    const cards = parseCards(await ofetch(listingUrl));

    if (!cards.length) {
        throw new Error(`No books found on ${listingUrl}`);
    }

    // Details cost one request per book, so only fetch them for the selected items.
    // `getRouteLimit` keeps the default candidate pool when common filters are present.
    const selected = cards.slice(0, getRouteLimit(ctx, defaultLimit));

    const items = await pMap(
        selected,
        async (card) => {
            // A single unavailable book should degrade to its list card instead of failing the feed.
            let detail: BookDetail | undefined;
            try {
                detail = await fetchBookDetail(card.id);
            } catch (error) {
                logger.error(`Failed to load Yeeyan book ${card.id}: ${error}`);
            }

            const summary = detail?.description?.trim();

            return {
                title: detail?.chinese_title?.trim() || detail?.original_title?.trim() || card.title,
                link: card.link,
                description: summary ? renderParagraphs(summary) : undefined,
                author: detail?.author?.trim() || undefined,
                category: detail?.tags?.length ? detail.tags : undefined,
                image: detail?.cover ? new URL(detail.cover, cdnUrl).href : card.image,
                pubDate: detail?.created ? timezone(parseDate(detail.created), 8) : undefined,
            };
        },
        { concurrency: detailConcurrency }
    );

    const title = `译言古登堡计划 - ${sectionTitle}`;

    return {
        title,
        link: listingUrl,
        description: `${title}，译言古登堡计划图书项目的书目、简介与译者招募信息。`,
        language: 'zh-CN',
        item: items,
    };
}

export const route: Route = {
    path: '/books/:type?',
    categories: ['reading'],
    example: '/yeeyan/books',
    parameters: {
        type: {
            description: 'Book list section, `all` by default',
            default: 'all',
            options: [
                { value: 'all', label: 'All books' },
                { value: 'onsale', label: 'Newly on sale' },
                { value: 'translating', label: 'In translation' },
                { value: 'applying', label: 'Recruiting translators' },
            ],
        },
    },
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
            source: ['g.yeeyan.com/books'],
            target: '/books',
        },
        {
            source: ['g.yeeyan.com/books/onsale'],
            target: '/books/onsale',
        },
        {
            source: ['g.yeeyan.com/books/translating'],
            target: '/books/translating',
        },
        {
            source: ['g.yeeyan.com/books/applying'],
            target: '/books/applying',
        },
    ],
    name: 'Books',
    maintainers: ['ZHA30'],
    handler,
    description:
        'Book projects from the Yeeyan Gutenberg Project, including the Chinese and original titles, author, introduction, tags and cover. Ten books from the first page are returned by default and up to 20 can be requested with the common `limit` parameter. Use the `type` parameter for books on sale, in translation or recruiting translators.',
    zh: {
        path: '/books/:type?',
        name: '书目',
        maintainers: ['ZHA30'],
        handler,
        example: '/yeeyan/books',
        parameters: {
            type: {
                description: '书目列表类型，默认为 `all`',
                default: 'all',
                options: [
                    { value: 'all', label: '所有书目' },
                    { value: 'onsale', label: '新品上架' },
                    { value: 'translating', label: '正在翻译' },
                    { value: 'applying', label: '译者招募' },
                ],
            },
        },
        description:
            '译言古登堡计划的图书项目列表，包含中英文书名、原作者、简介、标签与封面，默认返回列表首页的前 10 本，可用通用 `limit` 参数最多取到 20 本；`onsale`、`translating`、`applying` 分别对应新品上架、正在翻译与译者招募。',
    },
};
