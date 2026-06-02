import type { Cheerio } from 'cheerio';
import { load } from 'cheerio';
import type { AnyNode } from 'domhandler';
import iconv from 'iconv-lite';
import pMap from 'p-map';

import { config } from '@/config';
import type { Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

type Edition = {
    title: string;
    link: string;
};

type Article = {
    title: string;
    link: string;
    category: string[];
    issueDate?: string;
};

const rootUrl = 'https://newspaper.jcrb.com';
const rootPageUrl = rootUrl + '/';

const normalizeText = (value?: string) => value?.replaceAll(/\s+/g, ' ').trim() ?? '';

const normalizeEditionTitle = (title: string) => {
    const normalizedTitle = normalizeText(title).replace(/^第\s+/, '第');
    const matched = normalizedTitle.match(/^(第\d+版)\s*[:：]?\s*(.*)$/);

    if (!matched) {
        return normalizedTitle;
    }

    const [, edition, name] = matched;

    return name ? `${edition}：${name}` : edition;
};

const formatItemTitle = (title: string, category?: string[]) => {
    const categoryLabel = normalizeText(category?.[0]);

    if (!categoryLabel || title.startsWith(`【${categoryLabel}】`)) {
        return title;
    }

    return `【${categoryLabel}】${title}`;
};

const dedupeByLink = <T extends { link: string }>(items: T[]) => {
    const seenLinks = new Set<string>();

    return items.filter((item) => {
        if (seenLinks.has(item.link)) {
            return false;
        }

        seenLinks.add(item.link);

        return true;
    });
};

const resolveRelativeUrl = (url: string, baseUrl: string) => {
    if (url.startsWith('http') || url.startsWith('data:') || url.startsWith('mailto:') || url.startsWith('javascript:') || url.startsWith('#')) {
        return url;
    }

    return new URL(url, baseUrl).href;
};

const resolveRelativeLinks = ($: ReturnType<typeof load>, content: Cheerio<AnyNode>, baseUrl: string) => {
    content.find('img').each((_, element) => {
        const item = $(element);
        const src = item.attr('src');

        if (src) {
            item.attr('src', resolveRelativeUrl(src, baseUrl));
        }
    });

    content.find('a').each((_, element) => {
        const item = $(element);
        const href = item.attr('href');

        if (href) {
            item.attr('href', resolveRelativeUrl(href, baseUrl));
        }
    });
};

const detectEncoding = (buffer: Buffer) => {
    const utf8Decoded = iconv.decode(buffer, 'utf-8');
    const metaCharset = utf8Decoded.match(/<meta[^>]+charset=["']?([^"'>\s/;]+)/i)?.[1] ?? utf8Decoded.match(/<meta[^>]+content=["'][^"']*charset=([^"'>\s;]+)/i)?.[1];

    return metaCharset?.toLowerCase() ?? 'utf-8';
};

const fetchPage = async (url: string) => {
    const { data } = await got({
        method: 'get',
        url,
        responseType: 'buffer',
        headers: {
            'User-Agent': config.trueUA,
        },
    });

    return iconv.decode(data, detectEncoding(data));
};

const extractLatestIssueEntry = (html: string) => {
    const $ = load(html);
    const refreshContent = $('meta[http-equiv="REFRESH"], meta[http-equiv="refresh"]').attr('content');
    const refreshPath = refreshContent?.match(/URL=(.+)$/i)?.[1]?.trim() ?? html.match(/URL=([^"' >]+)/i)?.[1]?.trim();

    if (refreshPath) {
        return refreshPath;
    }

    const legacyIssueMatch = html.match(/(?:\.\/)?(\d{4}\/\d{8}\/\d{8}_\d{3}\/\d{8}_\d{3}_\d+\.htm)/);
    if (legacyIssueMatch) {
        return legacyIssueMatch[1];
    }

    throw new Error('Failed to detect the latest issue page from the homepage.');
};

const extractIssueDate = ($: ReturnType<typeof load>, pageUrl: string) => {
    const pageDate = normalizeText($('#showDateID').first().text());

    if (pageDate) {
        return pageDate;
    }

    const matched = pageUrl.match(/\/html\/(\d{4})-(\d{2})\/(\d{2})\//);

    return matched ? `${matched[1]}-${matched[2]}-${matched[3]}` : undefined;
};

const extractEditionTitle = ($: ReturnType<typeof load>) => {
    const editionNo = normalizeText($('#curbanci').first().text());
    const editionName = normalizeText($('td strong').first().text());

    if (editionNo && editionName) {
        return `第${editionNo}版：${editionName}`;
    }

    return editionName ? normalizeEditionTitle(editionName) : undefined;
};

const parseEditionList = ($: ReturnType<typeof load>, baseUrl: string): Edition[] =>
    dedupeByLink(
        $('div.bancititle a[href*="node_"]')
            .toArray()
            .map((element) => {
                const item = $(element);
                const href = item.attr('href');

                if (!href) {
                    return null;
                }

                return {
                    title: normalizeEditionTitle(item.text()),
                    link: new URL(href, baseUrl).href,
                };
            })
            .filter((item): item is Edition => item !== null)
    );

const parseArticleList = ($: ReturnType<typeof load>, baseUrl: string, editionTitle: string, issueDate?: string): Article[] =>
    dedupeByLink(
        [
            ...$('tr.page-item[data-url]')
                .toArray()
                .map<Article | null>((element) => {
                    const item = $(element);
                    const href = item.attr('data-url');
                    const title = normalizeText(item.find('td').last().text());

                    if (!href || !title) {
                        return null;
                    }

                    return {
                        title,
                        link: new URL(href, baseUrl).href,
                        category: [editionTitle],
                        issueDate,
                    };
                }),
            ...$('area.areablock')
                .toArray()
                .map<Article | null>((element) => {
                    const item = $(element);
                    const href = item.attr('href');
                    const title = normalizeText(item.attr('name') || item.attr('title'));

                    if (!href || !title) {
                        return null;
                    }

                    return {
                        title,
                        link: new URL(href, baseUrl).href,
                        category: [editionTitle],
                        issueDate,
                    };
                }),
        ].filter((item): item is Article => item !== null)
    );

const parsePubDate = (dateText?: string) => {
    const normalizedDate = normalizeText(dateText);

    if (!normalizedDate) {
        return;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
        return timezone(parseDate(normalizedDate, 'YYYY-MM-DD'), +8);
    }

    if (/^\d{4}年\d{2}月\d{2}日$/.test(normalizedDate)) {
        return timezone(parseDate(normalizedDate, 'YYYY年MM月DD日'), +8);
    }
};

const extractDescription = ($: ReturnType<typeof load>, baseUrl: string) => {
    const descriptionFragments = $('.article-content')
        .toArray()
        .map((element) => {
            const content = $(element).clone();

            content.find('#ozoom, script, style').remove();
            resolveRelativeLinks($, content, baseUrl);

            const hasMeaningfulText = normalizeText(content.text()).length > 0;
            const hasMedia = content.find('img, audio, video, iframe').length > 0;

            if (!hasMeaningfulText && !hasMedia) {
                return null;
            }

            const html = content
                .html()
                ?.replaceAll(/<!--[\s\S]*?-->/g, '')
                .trim();

            return html || null;
        })
        .filter((fragment): fragment is string => fragment !== null);

    if (descriptionFragments.length > 0) {
        return descriptionFragments.join('<br>');
    }

    return $('meta[name="description"]').attr('content')?.trim() || undefined;
};

const extractDetail = (html: string, baseUrl: string, fallbackTitle: string, category: string[], fallbackDate?: string) => {
    const $ = load(html);
    const title = normalizeText($('.font01.title, td.font01').first().text()) || fallbackTitle;
    const font02Texts = $('.font02')
        .toArray()
        .map((element) => normalizeText($(element).text()))
        .filter(Boolean);
    const author = normalizeText($('.font02.author').first().text()) || (font02Texts.length > 0 ? font02Texts.at(-1) : undefined);
    const dateText = extractIssueDate($, baseUrl) ?? fallbackDate;
    const description = extractDescription($, baseUrl);

    return {
        title: formatItemTitle(title, category),
        ...(author ? { author } : {}),
        ...(description ? { description } : {}),
        ...(dateText ? { pubDate: parsePubDate(dateText) } : {}),
    };
};

async function handler(ctx) {
    const rootHtml = await fetchPage(rootPageUrl);
    const latestIssueEntry = extractLatestIssueEntry(rootHtml);
    const firstPageUrl = new URL(latestIssueEntry, rootPageUrl).href;
    const firstPageHtml = await fetchPage(firstPageUrl);
    const firstPage = load(firstPageHtml);
    const editions = parseEditionList(firstPage, firstPageUrl);

    if (editions.length === 0) {
        throw new Error('No edition list found on the latest issue page.');
    }

    const issueDate = extractIssueDate(firstPage, firstPageUrl);
    const editionResults = await pMap(
        editions,
        async (edition) => {
            const editionHtml = edition.link === firstPageUrl ? firstPageHtml : await cache.tryGet(edition.link, () => fetchPage(edition.link));
            const $ = load(editionHtml);
            const editionTitle = extractEditionTitle($) || edition.title;
            const editionDate = extractIssueDate($, edition.link) ?? issueDate;

            return parseArticleList($, edition.link, editionTitle, editionDate);
        },
        { concurrency: 4 }
    );

    const uniqueItems = dedupeByLink(editionResults.flat());
    const limit = Number.parseInt(ctx.req.query('limit') ?? '', 10);
    const itemsToFetch = Number.isNaN(limit) ? uniqueItems : uniqueItems.slice(0, limit);
    const items = await pMap(
        itemsToFetch,
        (item) =>
            cache.tryGet(item.link, async () => {
                const detailHtml = await fetchPage(item.link);
                const { issueDate: fallbackDate, ...baseItem } = item;

                return {
                    ...baseItem,
                    ...extractDetail(detailHtml, item.link, baseItem.title, baseItem.category, fallbackDate),
                };
            }),
        { concurrency: 4 }
    );

    return {
        title: issueDate ? `检察日报数字报 - ${issueDate}` : '检察日报数字报',
        link: firstPageUrl,
        description: '检察日报数字报最新一期全部版面文章',
        item: items,
    };
}

export const route: Route = {
    path: '/newspaper',
    categories: ['traditional-media'],
    example: '/jcrb/newspaper',
    radar: [
        {
            source: ['newspaper.jcrb.com/'],
            target: '/newspaper',
        },
    ],
    name: '数字报',
    maintainers: ['ZHA30'],
    handler,
    description: '抓取检察日报数字报最新一期全部版面文章。',
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
};
