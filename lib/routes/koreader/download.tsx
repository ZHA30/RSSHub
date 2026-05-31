import { load } from 'cheerio';

import type { DataItem, Route } from '@/types';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

const rootUrl = 'https://build.koreader.rocks';
const categoryMap = {
    all: 'All',
    stable: 'Stable',
    nightly: 'Nightly',
};

type Category = keyof typeof categoryMap;
type SourceCategory = Exclude<Category, 'all'>;

type DownloadItem = DataItem & {
    pubDate?: Date;
};

export const route: Route = {
    path: '/download/:category?',
    categories: ['program-update'],
    example: '/koreader/download/all',
    parameters: { category: 'Category, all, stable or nightly, nightly by default' },
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
            source: ['build.koreader.rocks/download/:category/'],
            target: '/download/:category',
        },
    ],
    name: 'Build Downloads',
    maintainers: ['ZHA30'],
    handler,
    url: 'build.koreader.rocks/download',
};

async function handler(ctx) {
    const category = getCategory(ctx.req.param('category'));
    const categories: SourceCategory[] = category === 'all' ? ['nightly', 'stable'] : [category];
    const items = (await Promise.all(categories.map((category) => fetchItems(category, categories.length > 1)))).flat().toSorted((a, b) => (b.pubDate?.getTime() ?? 0) - (a.pubDate?.getTime() ?? 0));

    return {
        title: `KOReader ${categoryMap[category]} Builds`,
        link: category === 'all' ? `${rootUrl}/download/` : getCategoryUrl(category),
        item: items,
    };
}

async function fetchItems(category: SourceCategory, showCategory: boolean): Promise<DownloadItem[]> {
    const currentUrl = getCategoryUrl(category);
    const response = await got(currentUrl);
    const $ = load(response.data);

    return $('#list tbody tr')
        .toArray()
        .map((item) => {
            const row = $(item);
            const linkElement = row.find('td.link a');
            const title = linkElement.attr('title') || linkElement.text().trim().replace(/\/$/, '');
            const href = linkElement.attr('href');
            const date = row.find('td.date').text().trim();
            const link = href ? new URL(href, currentUrl).href : undefined;
            const pubDate = date && date !== '-' ? timezone(parseDate(date, 'YYYY-MMM-DD HH:mm', 'en'), 0) : undefined;

            if (!title || !link || title === 'Parent directory') {
                return;
            }

            return {
                title: showCategory ? `[${categoryMap[category]}] ${title}` : title,
                link,
                guid: link,
                pubDate,
                content: {
                    html: '<span></span>',
                    text: '',
                },
            };
        })
        .filter((item): item is DownloadItem => !!item);
}

function getCategory(category?: string): Category {
    return category && category in categoryMap ? (category as Category) : 'nightly';
}

function getCategoryUrl(category: SourceCategory) {
    return `${rootUrl}/download/${category}/?C=M&O=D`;
}
