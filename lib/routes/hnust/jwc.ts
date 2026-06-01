import type { Cheerio, CheerioAPI } from 'cheerio';
import { load } from 'cheerio';
import type { Element } from 'domhandler';

import type { DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

const rootUrl = 'https://jwc.hnust.edu.cn';

const categories = {
    all: {
        name: '教学运行',
        path: 'gzzd2_20170827120536008171/index.htm',
    },
    jwk: {
        name: '教务科',
        path: 'gzzd2_20170827120536008171/jwk3_20170827120536008171/index.htm',
    },
    jyk: {
        name: '教研科',
        path: 'gzzd2_20170827120536008171/jyk3_20170827120536008171/index.htm',
    },
    jck: {
        name: '教材科',
        path: 'gzzd2_20170827120536008171/jck3_20170827120536008171/index.htm',
    },
    zlk: {
        name: '质量科',
        path: 'gzzd2_20170827120536008171/zlglk3_20170827120536008171/index.htm',
    },
    sjjx: {
        name: '实践教学科',
        path: 'gzzd2_20170827120536008171/sjjxglk3_20170827120536008171/index.htm',
    },
    kszx: {
        name: '考试中心',
        path: 'gzzd2_20170827120536008171/kszx3_20170827120536008171/index.htm',
    },
    xdjy: {
        name: '现代教育技术中心',
        path: 'gzzd2_20170827120536008171/xdjyzx3_20170827120536008171/index.htm',
    },
    pgpj: {
        name: '评估评建',
        path: 'gzzd2_20170827120536008171/pgpj4/index.htm',
    },
};

type CategoryKey = keyof typeof categories;

const isCategoryKey = (category: string): category is CategoryKey => category in categories;

export const route: Route = {
    path: '/jwc/:category?',
    categories: ['university'],
    example: '/hnust/jwc/jwk',
    parameters: { category: '分类，默认为教学运行' },
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
            source: ['jwc.hnust.edu.cn/gzzd2_20170827120536008171/:category/index.htm', 'jwc.hnust.edu.cn/gzzd2_20170827120536008171/index.htm'],
            target: '/jwc/:category',
        },
    ],
    name: '本科生院教学运行',
    maintainers: ['ZHA30'],
    handler,
    url: 'jwc.hnust.edu.cn/gzzd2_20170827120536008171/index.htm',
    description: `| 教学运行 | 教务科 | 教研科 | 教材科 | 质量科 | 实践教学科 | 考试中心 | 现代教育技术中心 | 评估评建 |
| -------- | ------ | ------ | ------ | ------ | ---------- | -------- | ---------------- | -------- |
| all      | jwk    | jyk    | jck    | zlk    | sjjx       | kszx     | xdjy             | pgpj     |`,
};

async function handler(ctx) {
    const categoryParam = ctx.req.param('category') ?? 'all';
    const categoryKey = isCategoryKey(categoryParam) ? categoryParam : 'all';
    const category = categories[categoryKey];
    const currentUrl = new URL(category.path, rootUrl).href;

    const response = await got(currentUrl);
    const $ = load(response.data);
    const items = parseItems($, currentUrl);

    const result = await Promise.all(
        items.map((item) =>
            item.link && isInternalArticle(item.link)
                ? cache.tryGet(`hnust:jwc:detail:${item.link}`, async () => {
                      try {
                          const detail = await parseDetail(item.link!);
                          return {
                              ...item,
                              ...detail,
                              pubDate: detail.pubDate ?? item.pubDate,
                          };
                      } catch {
                          return item;
                      }
                  })
                : item
        )
    );

    return {
        title: `湖南科技大学本科生院 - ${category.name}`,
        link: currentUrl,
        description: `湖南科技大学本科生院 - ${category.name}`,
        item: result,
    };
}

function parseItems($: CheerioAPI, currentUrl: string): DataItem[] {
    const items = parseBlockItems($, currentUrl);

    if (items.length) {
        return items;
    }

    return parseArticleListItems($, currentUrl);
}

function parseBlockItems($: CheerioAPI, currentUrl: string): DataItem[] {
    const items: DataItem[] = [];

    $('.block-list li').each((_, element) => {
        const item = $(element);
        const title = item.find('.gpArticleTitle').first().text().trim();

        if (!title) {
            return;
        }

        const link = new URL(item.find('a').first().attr('href') ?? '', currentUrl).href;
        const date = item.find('.gpArticleDate').first().text().trim();

        items.push({
            title,
            link,
            pubDate: date ? timezone(parseDate(date, 'YYYY-MM-DD'), 8) : undefined,
        });
    });

    return items;
}

function parseArticleListItems($: CheerioAPI, currentUrl: string): DataItem[] {
    const items: DataItem[] = [];

    $('.articleList li').each((_, element) => {
        const item = $(element);
        const anchor = item.find('a').first();
        const title = anchor.attr('title')?.trim() || anchor.text().trim();

        if (!title) {
            return;
        }

        const link = new URL(anchor.attr('href') ?? '', currentUrl).href;
        const date = item.find('span').first().text().trim();

        items.push({
            title,
            link,
            pubDate: date ? timezone(parseDate(date, 'YYYY-MM-DD'), 8) : undefined,
        });
    });

    return items;
}

async function parseDetail(link: string): Promise<Partial<DataItem>> {
    const response = await got(link);
    const $ = load(response.data);
    const article = $('.gp-article1').first();
    const annex = $('.gp-annex3').first();

    article.find('script, style').remove();
    annex.find('script, style').remove();

    normalizeUrls($, article, link);
    normalizeUrls($, annex, link);

    const date = $('.gp-articleAuthor .date')
        .text()
        .replace(/^.*日期：/, '')
        .trim();
    const author = $('.gp-articleAuthor .source')
        .text()
        .replace(/^.*来源：/, '')
        .trim();
    const description = [article.html(), annex.length ? annex.html() : undefined].filter(Boolean).join('');

    return {
        title: $('#shareTitle').text().trim() || undefined,
        description: description || undefined,
        author: author || undefined,
        pubDate: date ? timezone(parseDate(date, 'YYYY-MM-DD'), 8) : undefined,
    };
}

function normalizeUrls($: CheerioAPI, element: Cheerio<Element>, baseUrl: string) {
    element.find('img, video, source').each((_, node) => {
        const item = $(node);
        const src = item.attr('src');
        if (src) {
            item.attr('src', new URL(src, baseUrl).href);
        }
        const poster = item.attr('poster');
        if (poster) {
            item.attr('poster', new URL(poster, baseUrl).href);
        }
    });

    element.find('a[href]').each((_, node) => {
        const item = $(node);
        const href = item.attr('href');
        if (href) {
            item.attr('href', new URL(href, baseUrl).href);
        }
    });
}

function isInternalArticle(link: string): boolean {
    return Boolean(link && link.startsWith(`${rootUrl}/`) && link.endsWith('.htm') && !/\/index\d*\.htm$/.test(link));
}
