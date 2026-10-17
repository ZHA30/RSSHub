import { load } from 'cheerio';
import pMap from 'p-map';

import { config } from '@/config';
import type { Route } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

const rootUrl = 'https://epaper.bjnews.com.cn';

type EpaperCalendar = Record<string, Record<string, string[]>>;

type EpaperArticle = {
    articleAuthor?: string;
    articleContent?: string;
    articleHref?: string;
    articleIssueDate?: string;
    mainTitle?: string;
};

type EpaperLayout = {
    issueDate: string;
    onePageArticleList?: EpaperArticle[];
    pageHref: string;
    pageName?: string;
    pageNo: string;
};

type EpaperListItem = {
    author?: string;
    category?: string[];
    issueDate?: string;
    link: string;
    title: string;
    fallbackContent?: string;
};

export const route: Route = {
    path: '/epaper',
    categories: ['traditional-media'],
    example: '/bjnews/epaper',
    features: {},
    radar: [
        {
            source: ['epaper.bjnews.com.cn/'],
            target: '/epaper',
        },
    ],
    name: '电子报',
    maintainers: ['ZHA30'],
    handler,
    url: 'epaper.bjnews.com.cn',
};

function normalizeIssueDate(date: string) {
    return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

function buildCategory(pageNo?: string, pageName?: string) {
    if (!pageNo) {
        return;
    }

    const trimmedName = pageName?.trim();
    return [trimmedName ? `第${pageNo}版：${trimmedName}` : `第${pageNo}版`];
}

function formatItemTitle(title: string, category?: string[]) {
    const categoryLabel = category?.[0]?.trim();

    if (!categoryLabel || title.startsWith(`【${categoryLabel}】`)) {
        return title;
    }

    return `【${categoryLabel}】${title}`;
}

function fetchArticleDetail(item: EpaperListItem) {
    return cache.tryGet(item.link, async () => {
        const response = await ofetch<string, 'text'>(item.link, {
            responseType: 'text',
            headers: {
                'User-Agent': config.trueUA,
            },
        });
        const $ = load(response);
        const content = $('.article-detail .content').first();
        const description = content.length ? content.html() : item.fallbackContent;

        return {
            title: formatItemTitle(item.title, item.category),
            link: item.link,
            ...(description ? { description } : {}),
            ...(item.issueDate ? { pubDate: timezone(parseDate(item.issueDate, 'YYYY-MM-DD'), +8) } : {}),
            ...(item.author ? { author: item.author } : {}),
            ...(item.category ? { category: item.category } : {}),
        };
    });
}

async function getLatestIssueDate() {
    const cached = await cache.tryGet('bjnews:epaper:latest-date', async () => {
        const calendar = await ofetch<EpaperCalendar>(`${rootUrl}/period/yearMonthDay.json`, {
            headers: {
                'User-Agent': config.trueUA,
            },
        });

        let latest = '';

        for (const year of Object.values(calendar)) {
            for (const month of Object.values(year)) {
                for (const date of month) {
                    if (date > latest) {
                        latest = date;
                    }
                }
            }
        }

        if (!latest) {
            throw new Error('无法从年历数据中获取最新刊期，请稍后重试。');
        }

        return latest;
    });

    const latestText = typeof cached === 'string' ? cached : typeof cached === 'number' ? String(cached) : '';

    if (!/^\d{8}$/.test(latestText)) {
        throw new Error('无法从年历数据中获取最新刊期，请稍后重试。');
    }

    return latestText;
}

async function handler() {
    const issueDate = await getLatestIssueDate();
    const issueYear = issueDate.slice(0, 4);
    const issueDateText = normalizeIssueDate(issueDate);
    const dataUrl = `${rootUrl}/html/${issueYear}/${issueDate}/data.json`;

    let layouts: EpaperLayout[];

    try {
        layouts = await cache.tryGet(`bjnews:epaper:data:${issueDate}`, () =>
            ofetch<EpaperLayout[]>(dataUrl, {
                headers: {
                    'User-Agent': config.trueUA,
                },
            })
        );
    } catch {
        throw new Error(`无法获取最新刊期（${issueDateText}）的版面数据，请稍后重试。`);
    }

    if (!layouts.length) {
        throw new Error(`未找到最新刊期（${issueDateText}）的版面数据，请稍后重试。`);
    }

    const items = layouts.flatMap((layout) => {
        const category = buildCategory(layout.pageNo, layout.pageName);
        const layoutDir = `${issueDate}_${layout.pageNo}`;
        const layoutBaseUrl = `${rootUrl}/html/${issueYear}/${issueDate}/${layoutDir}/`;

        return (layout.onePageArticleList ?? [])
            .filter((article) => article.articleHref && article.mainTitle)
            .map((article) => {
                const link = new URL(article.articleHref!, layoutBaseUrl).href;
                const author = article.articleAuthor?.trim() || undefined;
                const articleIssueDate = article.articleIssueDate?.trim() || undefined;

                return {
                    title: article.mainTitle!,
                    link,
                    issueDate: articleIssueDate,
                    author,
                    category,
                    fallbackContent: article.articleContent,
                };
            });
    });

    const detailItems = await pMap(items, (item) => fetchArticleDetail(item), { concurrency: 4 });

    const firstLayout = layouts[0];
    const firstLayoutDir = `${issueDate}_${firstLayout.pageNo}`;
    const firstPageUrl = new URL(firstLayout.pageHref, `${rootUrl}/html/${issueYear}/${issueDate}/${firstLayoutDir}/`).href;

    return {
        title: `新京报 - 电子报 - ${issueDateText}`,
        link: firstPageUrl,
        item: detailItems,
    };
}
