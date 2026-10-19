import { config } from '@/config';
import InvalidParameterError from '@/errors/types/invalid-parameter';
import type { Data, Route } from '@/types';
import ofetch from '@/utils/ofetch';
import { getRouteLimit } from '@/utils/route-limit';

const defaultLanguage = 'zh';
const defaultLimit = 10;
// MediaWiki caps the random generator at ten pages per request.
const maxRandomPages = 10;
const languagePattern = /^[a-z][a-z0-9-]{1,11}$/;
const thumbnailSize = 400;

type RandomPage = {
    title: string;
    fullurl?: string;
    extract?: string;
    description?: string;
    thumbnail?: {
        source: string;
    };
};

const escapeHtml = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const renderParagraphs = (text: string): string =>
    text
        .split(/\n+/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
        .join('');

const getLanguage = (ctx): string => {
    const language = (ctx.req.param('lang') ?? defaultLanguage).toLowerCase();

    if (!languagePattern.test(language)) {
        throw new InvalidParameterError(`Invalid Wikipedia language code: ${language}`);
    }

    return language;
};

const getPageLink = (language: string, page: RandomPage): string => page.fullurl ?? `https://${language}.wikipedia.org/wiki/${encodeURIComponent(page.title.replaceAll(' ', '_'))}`;

async function fetchRandomPages(language: string, limit: number): Promise<RandomPage[]> {
    const data = await ofetch(`https://${language}.wikipedia.org/w/api.php`, {
        query: {
            action: 'query',
            format: 'json',
            formatversion: 2,
            generator: 'random',
            grnnamespace: 0,
            grnlimit: limit,
            prop: 'extracts|description|pageimages|info',
            exintro: 1,
            explaintext: 1,
            exsentences: 5,
            piprop: 'thumbnail',
            pithumbsize: thumbnailSize,
            inprop: 'url',
        },
        headers: {
            'User-Agent': config.trueUA,
        },
    });

    if (data.error) {
        throw new Error(`Wikipedia API error: ${data.error.info ?? data.error.code}`);
    }

    return Array.isArray(data.query?.pages) ? data.query.pages : [];
}

async function handler(ctx): Promise<Data> {
    const language = getLanguage(ctx);
    const limit = Math.min(getRouteLimit(ctx, defaultLimit), maxRandomPages);
    const pages = await fetchRandomPages(language, limit);

    const items = pages.map((page) => {
        // The API returns a plain-text intro; fall back to the Wikidata short description for pages without one.
        const summary = page.extract?.trim() || page.description?.trim();

        return {
            title: page.title,
            link: getPageLink(language, page),
            description: summary ? renderParagraphs(summary) : undefined,
            image: page.thumbnail?.source,
        };
    });

    return {
        title: `Wikipedia random articles (${language})`,
        link: `https://${language}.wikipedia.org/wiki/Special:Random`,
        description: `A randomly rotating selection of Wikipedia (${language}) articles. Up to ${maxRandomPages} articles are returned per request, so items are replaced on every refresh.`,
        item: items,
    };
}

export const route: Route = {
    path: '/random/:lang?',
    categories: ['reading'],
    example: '/wikipedia/random',
    parameters: {
        lang: {
            description: 'Wikipedia language code, `zh` by default',
            default: 'zh',
        },
    },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportRadar: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: 'Random Articles',
    maintainers: ['ZHA30'],
    handler,
    description: 'Randomly selected Wikipedia articles. Each request draws a fresh set of up to 10 articles, so the feed keeps changing instead of accumulating history; use the common `limit` parameter to receive fewer articles.',
    zh: {
        path: '/random/:lang?',
        name: '随机条目',
        maintainers: ['ZHA30'],
        handler,
        example: '/wikipedia/random',
        parameters: {
            lang: {
                description: '维基百科语言代码，默认为 `zh`，例如 `en`、`ja`、`zh-yue`',
                default: 'zh',
            },
        },
        description: '随机抽取的维基百科条目。每次请求最多返回 10 篇新的随机条目，因此每次刷新都会替换旧条目，不会累积历史；可使用通用 `limit` 参数减少返回条数。',
    },
};
