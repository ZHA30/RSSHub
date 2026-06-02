import type { Cheerio } from 'cheerio';
import { load } from 'cheerio';
import type { Element } from 'domhandler';
import type { Context } from 'hono';
import pMap from 'p-map';

import { config } from '@/config';
import type { Route } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

type ListItem = {
    title?: string;
    link: string;
    pubDate?: string;
    category: string[];
};

type DetailItem = {
    title: string;
    link: string;
    description?: string;
    pubDate?: Date;
    author?: string;
    category: string[];
};

const nonContentParagraphPatterns = [/^【?上一篇】?/, /^【?下一篇】?/, /^[（(]转载请注明来源/, /^责任编辑[:：]/];

const fetchPage = (url: string) =>
    ofetch<string, 'text'>(url, {
        responseType: 'text',
        headers: {
            'User-Agent': config.trueUA,
        },
    });

const normalizeText = (text?: string) => text?.replaceAll(/\s+/g, ' ').trim() ?? '';

const getListUrl = (subdomain: string, nodeId: string) => `https://${subdomain}.gmw.cn/node_${nodeId}.htm`;

const normalizeFeedTitle = (rawTitle?: string) => {
    const parts = (rawTitle ?? '')
        .split('_')
        .map((part) => normalizeText(part))
        .filter(Boolean);

    if (parts.at(-1) === '光明网') {
        parts.pop();
    }

    return parts.join(' - ');
};

const parseKeywords = (rawKeywords?: string) => [
    ...new Set(
        (rawKeywords ?? '')
            .split(/[，,、]/)
            .map((keyword) => normalizeText(keyword))
            .filter(Boolean)
    ),
];

const resolveRelativeUrl = (url: string, baseUrl: string) => {
    if (url.startsWith('data:') || url.startsWith('mailto:') || url.startsWith('javascript:') || url.startsWith('#')) {
        return url;
    }

    return new URL(url, baseUrl).href;
};

const resolveRelativeLinks = ($: ReturnType<typeof load>, content: Cheerio<Element>, baseUrl: string) => {
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

const extractPropertyField = (html: string, field: string) => {
    const matched = html.match(new RegExp(`<${field}>\\s*([\\s\\S]*?)\\s*<\\/${field}>`, 'i'));

    return normalizeText(matched?.[1]);
};

const dedupeItems = (items: ListItem[]) => {
    const seenLinks = new Set<string>();

    return items.filter((item) => {
        if (seenLinks.has(item.link)) {
            return false;
        }

        seenLinks.add(item.link);
        return true;
    });
};

const parseStandardList = ($: ReturnType<typeof load>, currentUrl: string, category: string[]) =>
    $('ul.channel-newsGroup li')
        .toArray()
        .map((element) => {
            const item = $(element);
            const linkElement = item.find('.channel-newsTitle > a[href*="content_"], a[href*="content_"]').first();
            const href = linkElement.attr('href');
            const title = normalizeText(linkElement.text());
            const pubDate = normalizeText(item.find('.channel-newsTime').first().text());

            if (!href) {
                return null;
            }

            return {
                ...(title ? { title } : {}),
                link: new URL(href, currentUrl).href,
                ...(pubDate ? { pubDate } : {}),
                category,
            };
        })
        .filter((item): item is ListItem => item !== null);

const parseCommentaryList = ($: ReturnType<typeof load>, currentUrl: string, category: string[]) => {
    const leadBlock = $('.content_left .select').first();
    const leadHref = leadBlock.children('a[href*="content_"]').first().attr('href');
    const leadTitle = normalizeText(leadBlock.find('a[href*="content_"]').first().text());
    const leadPubDate = normalizeText(leadBlock.find('.reading_right').first().text()).replace(/^发布时间[:：]\s*/, '');
    const buildItem = (href: string, title: string, pubDate?: string): ListItem => ({
        title,
        link: new URL(href, currentUrl).href,
        ...(pubDate ? { pubDate } : {}),
        category,
    });
    const parseExtendedItems = (container: Cheerio<Element>, pubDate?: string) =>
        container
            .find('.extend_box1 span, .extend_box2 span')
            .toArray()
            .flatMap<ListItem>((element) => {
                const linkElement = $(element)
                    .find('a[href*="content_"]')
                    .toArray()
                    .map((link) => $(link))
                    .findLast((link) => normalizeText(link.text()) && link.attr('href')?.includes('content_'));
                const href = linkElement?.attr('href');
                const title = normalizeText(linkElement?.text());

                if (!href || !title) {
                    return [];
                }

                return [buildItem(href, title, pubDate)];
            });
    const leadItems = leadHref ? [...(leadTitle ? [buildItem(leadHref, leadTitle, leadPubDate)] : []), ...parseExtendedItems(leadBlock, leadPubDate)] : [];

    const listItems = $('.content_left_main li')
        .toArray()
        .map((element) => {
            const item = $(element);
            const linkElement = item.find('.main_title > a[href*="content_"]').first();
            const href = linkElement.attr('href');
            const title = normalizeText(linkElement.text());
            const pubDate = normalizeText(item.find('.reading_right').first().text()).replace(/^发布时间[:：]\s*/, '');

            if (!href) {
                return null;
            }

            return {
                item: title ? buildItem(href, title, pubDate) : null,
                extendedItems: parseExtendedItems(item, pubDate),
            };
        })
        .flatMap<ListItem>((group) => {
            if (group === null) {
                return [];
            }

            return [...(group.item ? [group.item] : []), ...group.extendedItems];
        });

    return [...leadItems, ...listItems];
};

const parseGuanchaCommentatorList = ($: ReturnType<typeof load>, currentUrl: string, category: string[]) =>
    dedupeItems(
        $('.content_left > .select, .content_left_main > li')
            .toArray()
            .flatMap<ListItem>((element, index) => {
                const container = $(element);
                const coverLink = index === 0 ? container.children('a[href*="content_"]').first().attr('href') : undefined;
                const coverItems = coverLink
                    ? [
                          {
                              title: new URL(coverLink, currentUrl).href,
                              link: new URL(coverLink, currentUrl).href,
                              category,
                          },
                      ]
                    : [];

                const textItems = container
                    .find('a[href*="content_"]')
                    .toArray()
                    .flatMap<ListItem>((link) => {
                        const item = $(link);
                        const href = item.attr('href');
                        const title = normalizeText(item.text());

                        if (!href || !title || item.find('a[href*="content_"]').length > 0) {
                            return [];
                        }

                        return [
                            {
                                title,
                                link: new URL(href, currentUrl).href,
                                category,
                            },
                        ];
                    });

                return [...coverItems, ...textItems];
            })
    );

const parseListPage = (html: string, currentUrl: string, subdomain: string, nodeId: string) => {
    const $ = load(html);
    const rawTitle = normalizeText($('title').first().text());
    const feedTitle = normalizeFeedTitle(rawTitle);
    const fallbackCategory = [feedTitle.split(' - ')[0] || feedTitle || '光明网'];
    const items = shouldKeepPageOrderAndFetchAll(subdomain, nodeId)
        ? parseGuanchaCommentatorList($, currentUrl, fallbackCategory)
        : $('.content_left_main .main_title > a[href*="content_"]').length > 0 || $('.content_left .select > a[href*="content_"]').length > 0
          ? parseCommentaryList($, currentUrl, fallbackCategory)
          : parseStandardList($, currentUrl, fallbackCategory);

    return {
        feedTitle,
        items: dedupeItems(items),
    };
};

const extractAuthor = ($: ReturnType<typeof load>, content: Cheerio<Element>) => {
    const paragraphs = content.find('p').slice(0, 3).toArray();

    for (const element of paragraphs) {
        const paragraph = $(element);
        const paragraphText = normalizeText(paragraph.text());

        if (paragraphText.startsWith('光明网评论员：') || paragraphText.startsWith('光明网评论员:')) {
            return '光明网评论员';
        }

        const reporterMatch = paragraphText.match(/^(?:光明网|光明日报|本报|新华社)?记者[：:\s]+(.+)$/);
        if (reporterMatch?.[1]) {
            paragraph.remove();
            return reporterMatch[1];
        }

        const authorMatch = paragraphText.match(/^作者(?:简介)?[:：]\s*(.+)$/);
        if (authorMatch?.[1]) {
            paragraph.remove();
            return authorMatch[1];
        }
    }
};

const trimTrailingNonContent = ($: ReturnType<typeof load>, content: Cheerio<Element>) => {
    content.find('script, style, .m-zbTool, #articleLiability, .liability, .u-moreText, .u-QRcode, .text-right').remove();
    content.find('[style]').removeAttr('style');

    content.find('p').each((_, element) => {
        const paragraph = $(element);
        const paragraphText = normalizeText(paragraph.text());
        const hasMedia = paragraph.find('img, video, audio, iframe, embed').length > 0;

        if (nonContentParagraphPatterns.some((pattern) => pattern.test(paragraphText)) || (!paragraphText && !hasMedia)) {
            paragraph.remove();
            return;
        }

        if (paragraph.find('a[href*="node_"] img').length > 0) {
            paragraph.remove();
        }
    });

    const children = content.children().toArray().toReversed();

    for (const element of children) {
        const child = $(element);
        const childText = normalizeText(child.text());
        const hasNodeImageLink = child.find('a[href*="node_"] img').length > 0;

        if (nonContentParagraphPatterns.some((pattern) => pattern.test(childText)) || (!childText && hasNodeImageLink)) {
            child.remove();
            continue;
        }

        break;
    }
};

const parsePubDate = (dateText?: string) => {
    const normalizedDateText = normalizeText(dateText).replace(/\.0$/, '');

    if (!normalizedDateText) {
        return;
    }

    return timezone(parseDate(normalizedDateText), +8);
};

const shouldKeepPageOrderAndFetchAll = (subdomain: string, nodeId: string) => subdomain === 'guancha' && nodeId === '11273';

const extractDetail = (html: string, link: string, fallbackItem: ListItem, omitPubDate = false): DetailItem => {
    const $ = load(html);
    const content = $('#ContentPh, .u-mainText, .bd').first();
    const propertyTitle = extractPropertyField(html, 'title');
    const title = normalizeText($('.u-title, #articleID').first().text()) || propertyTitle || fallbackItem.title;
    const propertyAuthor = extractPropertyField(html, 'author');
    const extractedAuthor = extractAuthor($, content);
    const pubDateText = extractPropertyField(html, 'date') || normalizeText($('#articlePubTime, .m-con-time, .date').first().text()) || fallbackItem.pubDate;
    const category = parseKeywords(extractPropertyField(html, 'keyword') || $('meta[name="keywords"]').attr('content'));

    trimTrailingNonContent($, content);
    resolveRelativeLinks($, content, link);

    const description =
        content
            .html()
            ?.replaceAll(/<!--[\s\S]*?-->/g, '')
            .trim() || undefined;

    return {
        title: title || fallbackItem.title || link,
        link,
        ...(description ? { description } : {}),
        ...(!omitPubDate && pubDateText ? { pubDate: parsePubDate(pubDateText) } : {}),
        ...(extractedAuthor || propertyAuthor ? { author: extractedAuthor || propertyAuthor } : {}),
        category: category.length > 0 ? category : fallbackItem.category,
    };
};

async function handler(ctx: Context) {
    const { subdomain, nodeId } = ctx.req.param();

    if (!/^[a-z0-9-]+$/i.test(subdomain)) {
        throw new Error(`子站名格式不合法，收到 ${subdomain}。`);
    }

    if (!/^\d+$/.test(nodeId)) {
        throw new Error(`节点 ID 必须是数字，收到 ${nodeId}。`);
    }

    const listUrl = getListUrl(subdomain, nodeId);
    const listHtml = await fetchPage(listUrl);
    const keepPageOrderAndFetchAll = shouldKeepPageOrderAndFetchAll(subdomain, nodeId);
    const { feedTitle, items } = parseListPage(listHtml, listUrl, subdomain, nodeId);

    if (items.length === 0) {
        throw new Error(`未在 ${listUrl} 找到文章列表，可能是节点不存在、页面结构已变更，或该栏目不提供标准文章列表。`);
    }

    const limit = Number.parseInt(ctx.req.query('limit') ?? '', 10);
    const itemsToFetch = keepPageOrderAndFetchAll || Number.isNaN(limit) ? items : items.slice(0, limit);
    const feedItems = (
        await pMap(
            itemsToFetch,
            async (item) => {
                try {
                    return await cache.tryGet(item.link, async () => {
                        const detailHtml = await fetchPage(item.link);

                        return extractDetail(detailHtml, item.link, item, keepPageOrderAndFetchAll);
                    });
                } catch {
                    return null;
                }
            },
            { concurrency: 4 }
        )
    ).filter((item): item is DetailItem => item !== null);

    if (feedItems.length === 0) {
        throw new Error(`未能从 ${listUrl} 的列表项抓取到有效详情，可能是详情链接已失效或页面结构已变更。`);
    }

    return {
        title: feedTitle || `光明网 ${subdomain} node ${nodeId}`,
        link: listUrl,
        description: `${feedTitle || '光明网栏目'}最新文章`,
        language: 'zh-CN' as const,
        item: feedItems,
    };
}

export const route: Route = {
    path: '/:subdomain/:nodeId',
    categories: ['traditional-media'],
    example: '/gmw/legal/9668',
    parameters: {
        subdomain: '子站名，例如 `legal`、`news`、`politics`、`theory`、`guancha`，可从网站地图 `https://www.gmw.cn/map.htm` 的栏目链接中获取',
        nodeId: '栏目节点 ID，可从 `node_*.htm` URL 中获取',
    },
    radar: [
        {
            source: ['legal.gmw.cn/node_:nodeId.htm'],
            target: '/legal/:nodeId',
        },
        {
            source: ['news.gmw.cn/node_:nodeId.htm'],
            target: '/news/:nodeId',
        },
        {
            source: ['politics.gmw.cn/node_:nodeId.htm'],
            target: '/politics/:nodeId',
        },
        {
            source: ['theory.gmw.cn/node_:nodeId.htm'],
            target: '/theory/:nodeId',
        },
        {
            source: ['guancha.gmw.cn/node_:nodeId.htm'],
            target: '/guancha/:nodeId',
        },
    ],
    name: '栏目',
    maintainers: ['ZHA30'],
    handler,
    url: 'gmw.cn',
    description: '抓取光明网网站地图中暴露的各频道 `node_*.htm` 栏目页文章，兼容常规正文页与时评专栏正文页。',
};
