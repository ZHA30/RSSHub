import { load } from 'cheerio';

import { config } from '@/config';
import type { Route } from '@/types';
import { ViewType } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

import { namespace } from './namespace';

const baseUrl = `http://${namespace.url}`;
const listUrl = `${baseUrl}/selectedPage`;
const requestTimeout = 20000;
const requestHeaders = {
    'User-Agent': config.trueUA,
};

interface CnuListItem {
    title: string;
    link: string;
    author?: string;
    category?: string[];
    image?: string;
    pubDate?: Date;
    summary?: string;
}

interface CnuDetail {
    author?: string;
    pubDate?: Date;
    description?: string;
    image?: string;
}

export const route: Route = {
    path: '/',
    categories: ['picture'],
    view: ViewType.Pictures,
    example: '/cnu.cc',
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
            source: ['www.cnu.cc/', 'www.cnu.cc/selectedPage'],
            target: '/',
        },
    ],
    name: '每日精选',
    description: '镜像 CNU 首页 “每日精选” 列表。',
    maintainers: ['ZHA30'],
    handler,
    url: 'www.cnu.cc',
};

async function handler() {
    const html = await ofetch<string, 'text'>(listUrl, {
        responseType: 'text',
        headers: requestHeaders,
        timeout: requestTimeout,
    });
    const $ = load(html);

    const items = await Promise.all(
        extractListItems($).map(async (item) => {
            const detail = await fetchCachedDetail(item.link);

            return {
                title: item.title,
                link: item.link,
                author: detail.author ?? item.author,
                category: item.category,
                pubDate: detail.pubDate ?? item.pubDate,
                description: detail.description ?? item.summary,
                image: detail.image ?? item.image,
                banner: detail.image ?? item.image,
                guid: item.link,
            };
        })
    );

    const sectionTitle = $('h2.ulTitle').first().text().trim() || '每日精选';

    return {
        title: `${namespace.name} - ${sectionTitle}`,
        link: baseUrl,
        description: $('meta[name="description"]').attr('content')?.trim() || undefined,
        language: namespace.lang,
        item: items,
    };
}

async function fetchCachedDetail(url: string): Promise<CnuDetail> {
    try {
        return await cache.tryGet(url, () => fetchDetail(url));
    } catch {
        return {};
    }
}

async function fetchDetail(url: string): Promise<CnuDetail> {
    const html = await ofetch<string, 'text'>(url, {
        responseType: 'text',
        headers: requestHeaders,
        timeout: requestTimeout,
    });
    const $ = load(html);
    const workBody = $('#work_body').first().clone();
    const images = extractImages($);

    for (const image of images) {
        workBody.append(`<img src="${image}" />`);
    }

    return {
        author: cleanText($('.author-info a').first().text()) || undefined,
        pubDate: parseWorkDate($('.author-info .timeago').first().attr('title') ?? $('.author-info .timeago').first().text()),
        description: workBody.html()?.trim() || undefined,
        image: $('div.jumbotron img').first().attr('src') || images[0],
    };
}

function extractImages($): string[] {
    const imagesText = $('#imgs_json').first().text().trim();
    if (!imagesText) {
        return [];
    }

    try {
        const images = JSON.parse(imagesText);

        if (!Array.isArray(images)) {
            return [];
        }

        return images.map((image) => buildImageUrl(image?.img, image?.height)).filter((image): image is string => image !== undefined);
    } catch {
        return [];
    }
}

function buildImageUrl(path?: string, height?: string | number): string | undefined {
    if (!path) {
        return undefined;
    }

    if (height === 'auto') {
        return `http://img.cnu.cc/forum/${path}`;
    }

    return `http://imgoss.cnu.cc/${path}?x-oss-process=style/content`;
}

function parseWorkDate(value?: string): Date | undefined {
    const text = cleanText(value);
    return text ? timezone(parseDate(text), 8) : undefined;
}

function extractListItems($): CnuListItem[] {
    const items: CnuListItem[] = [];
    let currentDate: string | undefined;

    for (const element of $('#selected').children().toArray()) {
        const node = $(element);

        if (node.hasClass('date')) {
            currentDate = cleanText(node.text());
            continue;
        }

        if (element.tagName !== 'li') {
            continue;
        }

        const link = node.find('a.workCover').first().attr('href');
        if (!link) {
            continue;
        }

        const workType = cleanText(node.find('.workType').first().text());

        items.push({
            title: cleanText(node.find('.workTitle').first().text()),
            link,
            author: cleanText(node.find('.authorInfo a.author').first().text()) || undefined,
            category: workType ? [workType] : undefined,
            image: node.find('a.workCover img').first().attr('src') || undefined,
            pubDate: currentDate ? timezone(parseDate(currentDate), 8) : undefined,
            summary: node.find('.workBody').first().html()?.trim() || undefined,
        });
    }

    return items;
}

function cleanText(value?: string): string {
    return value?.replaceAll(/\s+/g, ' ').trim() ?? '';
}
