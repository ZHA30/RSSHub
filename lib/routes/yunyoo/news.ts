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

const baseUrl = 'https://yunyoo.cc';
const defaultLimit = 20;
const detailConcurrency = 5;

// Category slugs used by the public route, mapped to the site's `cate` ids.
const categories = {
    security: { id: 9, title: '安全通知' },
    business: { id: 6, title: '业务调整' },
    maintenance: { id: 5, title: '维护通知' },
    event: { id: 4, title: '活动新闻' },
} as const;

type CategorySlug = keyof typeof categories;

type NewsCard = {
    id: string;
    link: string;
    title: string;
    summary: string;
    category: string;
    pubDate?: Date;
};

const getCategorySlug = (ctx): CategorySlug | undefined => {
    const slug = ctx.req.param('category');

    if (slug && !Object.hasOwn(categories, slug)) {
        throw new InvalidParameterError(`Invalid news category: ${slug}. Allowed values: ${Object.keys(categories).join(', ')}`);
    }

    return slug as CategorySlug | undefined;
};

const parseCards = (html: string): NewsCard[] => {
    const $ = load(html);
    const cards: NewsCard[] = [];

    for (const element of $('#news-list .news-card').toArray()) {
        const card = $(element);
        const href = card.attr('href');
        const id = href?.match(/id=(\d+)/)?.[1];

        if (!href || !id) {
            continue;
        }

        const datetime = card.find('time').attr('datetime');

        cards.push({
            id,
            link: new URL(href, baseUrl).href,
            title: card.find('.card-title').text().trim(),
            summary: card.find('.news-card-desc').text().trim(),
            category: card.find('.badge').first().text().trim(),
            pubDate: datetime ? timezone(parseDate(datetime, 'YYYY-MM-DD'), 8) : undefined,
        });
    }

    return cards;
};

const fetchArticle = async (card: NewsCard): Promise<string | undefined> =>
    await cache.tryGet(`yunyoo:news:article:${card.id}`, async () => {
        const html = await ofetch(card.link);
        const $ = load(html);
        const content = $('#article-content');

        if (!content.length) {
            throw new Error(`Yunyoo news article body was not found for ${card.link}`);
        }

        content.find('script, style').remove();
        // Rewrite in-body relative links so the rendered feed keeps working outside the site.
        content.find('[href]').each((_, element) => {
            const node = $(element);
            const href = node.attr('href');
            if (href) {
                node.attr('href', new URL(href, baseUrl).href);
            }
        });

        return content.html()?.trim();
    });

async function handler(ctx): Promise<Data> {
    const slug = getCategorySlug(ctx);
    const listingUrl = slug ? `${baseUrl}/news?cate=${categories[slug].id}` : `${baseUrl}/news`;
    const cards = parseCards(await ofetch(listingUrl));

    if (!cards.length) {
        throw new Error(`No news found at ${listingUrl}`);
    }

    // Fetch article bodies only for the items the feed will serve.
    // `getRouteLimit` keeps the default candidate pool when common filters are present.
    const selected = cards.slice(0, getRouteLimit(ctx, defaultLimit));

    const items = await pMap(
        selected,
        async (card) => {
            // A missing article body should degrade to the list summary instead of failing the feed.
            let content: string | undefined;
            try {
                content = await fetchArticle(card);
            } catch (error) {
                logger.error(`Failed to load Yunyoo news ${card.id}: ${error}`);
            }

            return {
                title: card.title,
                link: card.link,
                description: content || `<p>${card.summary}</p>`,
                category: card.category ? [card.category] : undefined,
                pubDate: card.pubDate,
            };
        },
        { concurrency: detailConcurrency }
    );

    const title = slug ? `云悠新闻中心 - ${categories[slug].title}` : '云悠新闻中心';

    return {
        title,
        link: listingUrl,
        description: `${title}，云悠 YUNYOO 的最新动态、产品更新、维护与安全通知。`,
        language: 'zh-CN',
        item: items,
    };
}

export const route: Route = {
    path: '/news/:category?',
    categories: ['new-media'],
    example: '/yunyoo/news',
    parameters: {
        category: {
            description: 'News category, all news by default',
            options: [
                { value: 'security', label: 'Security notices' },
                { value: 'business', label: 'Business adjustments' },
                { value: 'maintenance', label: 'Maintenance notices' },
                { value: 'event', label: 'Promotions and events' },
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
            source: ['yunyoo.cc/news'],
            target: '/news',
        },
    ],
    name: 'News',
    maintainers: ['ZHA30'],
    handler,
    description:
        'News centre of Yunyoo, covering product updates, maintenance, security notices and promotions. Twenty items from the first page are returned by default; use the common `limit` parameter to receive fewer or more. RSSHub Radar only matches URL paths, so every `/news` page points to the unfiltered feed; subscribe to a category path explicitly.',
    zh: {
        path: '/news/:category?',
        name: '新闻中心',
        maintainers: ['ZHA30'],
        handler,
        example: '/yunyoo/news',
        parameters: {
            category: {
                description: '新闻分类，默认为全部新闻',
                options: [
                    { value: 'security', label: '安全通知' },
                    { value: 'business', label: '业务调整' },
                    { value: 'maintenance', label: '维护通知' },
                    { value: 'event', label: '活动新闻' },
                ],
            },
        },
        description:
            '云悠 YUNYOO 新闻中心，包含产品更新、维护、安全通知与活动促销。默认返回列表首页的 20 条，可用通用 `limit` 参数调整条数。受 Radar 只按 URL 路径匹配的限制，分类页也会命中同一条规则并指向全部新闻，如需订阅分类请手动使用分类路径。',
    },
};
