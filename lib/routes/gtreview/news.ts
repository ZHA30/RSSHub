import { load } from 'cheerio';

import InvalidParameterError from '@/errors/types/invalid-parameter';
import type { Data, DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const rootUrl = 'https://www.gtreview.com';

const categories = {
    africa: 'Africa',
    americas: 'Americas',
    asia: 'Asia',
    'digital-trade': 'Digital Trade',
    europe: 'Europe',
    global: 'Global',
    mena: 'Mena',
    'on-the-move': 'On the Move',
    sustainability: 'Sustainability',
    'trade-leaders-interviews': 'GTR Trade Leaders',
} as const;

type CategoryKey = keyof typeof categories;

const isCategory = (value: string): value is CategoryKey => Object.hasOwn(categories, value);

const routePrefixFor = (category: CategoryKey) => `${rootUrl}/news/${category}/`;

const routeUrlFor = (category: CategoryKey) => routePrefixFor(category);

export const route: Route = {
    path: '/news/:category',
    categories: ['traditional-media'],
    example: '/gtreview/news/asia',
    parameters: {
        category: {
            description: 'News category slug',
            options: Object.entries(categories).map(([value, label]) => ({ value, label })),
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
            source: ['www.gtreview.com/news/:category/'],
            target: '/news/:category',
        },
    ],
    name: 'News by category',
    maintainers: ['ZHA30'],
    handler,
    description: `News category pages on Global Trade Review.

Supported categories:

| Slug | Category |
| ---- | -------- |
${Object.entries(categories)
    .map(([value, label]) => `| ${value} | ${label} |`)
    .join('\n')}`,
    url: 'gtreview.com/news',
};

async function handler(ctx): Promise<Data> {
    const category = ctx.req.param('category').toLowerCase();
    if (!isCategory(category)) {
        throw new InvalidParameterError(`Invalid category: ${category}. Valid categories are: ${Object.keys(categories).join(', ')}`);
    }

    const currentUrl = routeUrlFor(category);
    const html = await ofetch(currentUrl);
    const $ = load(html);
    const prefix = routePrefixFor(category);
    const container = $('main .wp-block-ps-post-category .ps-posts-by-category--article-wrap').first();

    const entries = container
        .find('article')
        .toArray()
        .map((element) => {
            const article = $(element);
            const titleElement = article.find('h3').first();
            const linkElement = article.find('a[href]').filter((_, a) => {
                const href = $(a).attr('href');
                return !!href?.startsWith(prefix);
            });
            const href = linkElement.first().attr('href');

            if (!href) {
                return;
            }

            const timeText = article.find('time').first().text().trim();
            const image = article.find('img').first().attr('src');

            return {
                title: titleElement.text().trim(),
                link: href,
                pubDate: timeText ? parseDate(timeText) : undefined,
                image: image ? new URL(image, currentUrl).href : undefined,
            };
        })
        .filter((item): item is NonNullable<typeof item> => !!item);

    const items = await Promise.all(
        entries.map((item) =>
            cache.tryGet(`gtreview:detail:${item.link}`, async (): Promise<DataItem> => {
                const detailHtml = await ofetch(item.link);
                const $ = load(detailHtml);

                const descriptionContainer = $('div.entry-content.post_content').first().clone();
                descriptionContainer.find('.pigeon-context-promotion').remove();
                const description = descriptionContainer.html() ?? '';

                const preciseTime = $('meta[property="article:published_time"]').attr('content') ?? $('div.gtr_post__info time').first().text().trim() ?? undefined;

                const author = $('meta[name="author"]').attr('content') ?? $('div.gtr_post__info a[rel="author"]').first().text().trim() ?? undefined;

                const categoryList = $('div.gtrps-tags-cloud a')
                    .toArray()
                    .map((tag) => $(tag).text().trim())
                    .filter(Boolean);

                const leadImage = $('meta[property="og:image"]').attr('content') ?? $('figure.featured_img img').first().attr('src') ?? item.image;

                const imageHtml = leadImage ? `<p><img src="${new URL(leadImage, item.link).href}"></p>` : '';

                return {
                    title: item.title,
                    link: item.link,
                    pubDate: preciseTime ? parseDate(preciseTime) : item.pubDate,
                    author,
                    category: categoryList.length > 0 ? categoryList : [categories[category]],
                    description: `${imageHtml}${description}`,
                };
            })
        )
    );

    return {
        title: `Global Trade Review - ${categories[category]} News`,
        link: currentUrl,
        description: `${categories[category]} news from Global Trade Review`,
        language: 'en',
        item: items,
    };
}
