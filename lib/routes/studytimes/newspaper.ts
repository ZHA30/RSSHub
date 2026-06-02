import { load } from 'cheerio';
import pMap from 'p-map';

import { config } from '@/config';
import type { Data, Route } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

const rootUrl = 'https://paper.studytimes.cn';
const rootPageUrl = `${rootUrl}/cntheory/`;

type Edition = {
    title: string;
    link: string;
};

type Article = {
    title: string;
    link: string;
    category: string[];
    issueDateText: string;
};

const editionConcurrency = 2;

const fetchPage = (url: string) =>
    ofetch<string, 'text'>(url, {
        responseType: 'text',
        headers: {
            'User-Agent': config.trueUA,
        },
    });

const extractIssuePath = (html: string) => {
    const issuePath = html.match(/window\.location\.href\s*=\s*["']([^"']+)["']/i)?.[1]?.trim();

    if (!issuePath) {
        throw new Error('无法从学习时报数字报首页识别最新刊期，请稍后重试。');
    }

    return issuePath;
};

const extractIssueDateText = (issuePath: string) => {
    const match = issuePath.match(/(\d{4}-\d{2})\/(\d{2})\/node_1\.html$/);

    if (!match) {
        throw new Error('无法从学习时报数字报最新刊期链接识别日期，请稍后重试。');
    }

    return `${match[1]}-${match[2]}`;
};

const parseEditionList = ($: ReturnType<typeof load>, baseUrl: string): Edition[] => {
    const seenLinks = new Set<string>();

    return $('.layout-catalogue-item > a[href*="node_"]')
        .toArray()
        .map((element) => {
            const item = $(element);
            const href = item.attr('href');
            const title = item.text().replaceAll(/\s+/g, ' ').trim();

            if (!href || !title) {
                return null;
            }

            const link = new URL(href, baseUrl).href;

            if (seenLinks.has(link)) {
                return null;
            }

            seenLinks.add(link);

            return {
                title,
                link,
            };
        })
        .filter((item): item is Edition => item !== null);
};

const parseArticleList = ($: ReturnType<typeof load>, baseUrl: string, category: string[], issueDateText: string): Article[] => {
    const seenLinks = new Set<string>();

    return $('.news-list a[href*="content_"], area.paperarea[href*="content_"]')
        .toArray()
        .map((element) => {
            const item = $(element);
            const href = item.attr('href');
            const title = item.attr('title')?.trim() || item.text().replaceAll(/\s+/g, ' ').trim();

            if (!href || !title) {
                return null;
            }

            const link = new URL(href, baseUrl).href;

            if (seenLinks.has(link)) {
                return null;
            }

            seenLinks.add(link);

            return {
                title,
                link,
                category,
                issueDateText,
            };
        })
        .filter((item): item is Article => item !== null);
};

const formatItemTitle = (title: string, category?: string[]) => {
    const categoryLabel = category?.[0]?.replaceAll(/\s+/g, ' ').trim();

    if (!categoryLabel || title.startsWith(`【${categoryLabel}】`)) {
        return title;
    }

    return `【${categoryLabel}】${title}`;
};

async function handler(): Promise<Data> {
    const rootHtml = await fetchPage(rootPageUrl);
    const issuePath = extractIssuePath(rootHtml);
    const issueDateText = extractIssueDateText(issuePath);
    const issueUrl = new URL(issuePath, rootPageUrl).href;
    const issueHtml = await fetchPage(issueUrl);
    const issuePage = load(issueHtml);
    const issueDateDisplay = issuePage('#cur_dates').first().text().replaceAll(/\s+/g, '').trim() || issueDateText;
    const editions = parseEditionList(issuePage, issueUrl);

    if (!editions.length) {
        throw new Error(`未找到 ${issueDateDisplay} 刊的版面列表，请稍后重试。`);
    }

    const editionResults = await pMap(
        editions,
        async (edition) => {
            const editionHtml = edition.link === issueUrl ? issueHtml : await cache.tryGet(edition.link, () => fetchPage(edition.link));
            const $ = load(editionHtml);

            return parseArticleList($, edition.link, [edition.title], issueDateText);
        },
        { concurrency: editionConcurrency }
    );

    const seenLinks = new Set<string>();
    const uniqueArticles = editionResults.flat().filter((item) => {
        if (seenLinks.has(item.link)) {
            return false;
        }

        seenLinks.add(item.link);
        return true;
    });

    const items = uniqueArticles.map((article) => ({
        title: formatItemTitle(article.title, article.category),
        link: article.link,
        pubDate: timezone(parseDate(article.issueDateText, 'YYYY-MM-DD'), +8),
        category: article.category,
    }));

    return {
        title: `学习时报数字报 - ${issueDateDisplay}`,
        link: issueUrl,
        description: '学习时报数字报最新一期全部版面文章',
        language: 'zh-CN',
        item: items,
    };
}

export const route: Route = {
    path: '/newspaper',
    categories: ['traditional-media'],
    example: '/studytimes/newspaper',
    radar: [
        {
            source: ['paper.studytimes.cn/cntheory/'],
            target: '/newspaper',
        },
    ],
    name: '数字报',
    maintainers: ['ZHA30'],
    handler,
    url: 'paper.studytimes.cn',
    description: '抓取学习时报数字报最新一期全部版面文章。',
};
