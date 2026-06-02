import { load } from 'cheerio';

import type { DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

const rootUrl = 'https://www.chinacourt.cn';
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

type ChinacourtListItem = {
    title: string;
    link: string;
    pubDate?: Date;
    category?: string[];
};

const options = {
    MzAwNDAwAiPCAAA: '刑事案件',
    MzAwNDAwMgCRhAEA: '民事案件',
    MzAwNDAwNQCRhAEA: '民事研究',
    MzAwNDAwNTAwMiACAAA: '刑事研究',
    MzAwNDAoNzAwNiACAAA: '理论',
} as const;

const getAbsoluteUrl = (path: string) => new URL(path, rootUrl).href;

const commonHeaders = (referer = rootUrl, cookie?: string) => ({
    Referer: referer,
    'User-Agent': userAgent,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    ...(cookie ? { Cookie: cookie } : {}),
});

const fetchPage = (url: string, referer = rootUrl, cookie?: string) =>
    ofetch(url, {
        ignoreResponseError: true,
        headers: commonHeaders(referer, cookie),
    });

const getWafCookie = async (url: string, referer = rootUrl) => {
    const response = await ofetch.raw(url, {
        method: 'HEAD',
        ignoreResponseError: true,
        headers: commonHeaders(referer),
    });

    return response.headers
        .getSetCookie()
        .map((cookie) => cookie.split(';')[0])
        .join('; ');
};

const getPageTitle = ($: ReturnType<typeof load>, id: string) =>
    $('div.title h2').first().text().trim() ||
    $('title')
        .text()
        .replace(/-中国法院网$/, '')
        .trim() ||
    options[id] ||
    id;

const assertAccessiblePage = (html: string) => {
    if (/<title>\s*(?:455|449)\s*<\/title>/i.test(html) || html.includes('您的访问被阻断') || html.includes('https_waf_cookie')) {
        throw new Error('中国法院网返回反爬阻断页，请稍后重试。');
    }
};

const getList = ($: ReturnType<typeof load>, pageTitle: string): ChinacourtListItem[] =>
    $('#articleList ul li')
        .toArray()
        .flatMap((element) => {
            const item = $(element);
            const anchor = item.find('a').first();
            const href = anchor.attr('href');

            if (!href) {
                return [];
            }

            return {
                title: anchor.attr('title') || anchor.text().trim(),
                link: getAbsoluteUrl(href),
                pubDate: item.find('span.right').text().trim() ? timezone(parseDate(item.find('span.right').text().trim(), 'YYYY-MM-DD'), +8) : undefined,
                category: pageTitle ? [pageTitle] : undefined,
            };
        });

const fetchDetail = async (item: ChinacourtListItem, currentUrl: string, wafCookie: string): Promise<DataItem> => {
    try {
        return await cache.tryGet(item.link, async () => {
            const detailResponse = await fetchPage(item.link, currentUrl, wafCookie);
            const $ = load(detailResponse);

            const title = $('div.detail_bigtitle').first().text().trim() || $('div.content_title h2').first().text().trim() || $('h2').first().text().trim() || item.title;
            const description = $('div.detail_txt').html() || $('div#article_content').html() || $('div.content').find('div.TRS_Editor').html() || $('div.TRS_Editor').html() || $('div#article_content_new').html() || undefined;
            const metaKeywords = $('meta[name="keywords"]').attr('content');
            const keywords = metaKeywords
                ?.split(/[，,]/)
                .map((keyword) => keyword.trim())
                .filter(Boolean);
            const sourceText = $('div.detail_thr span.source').first().text().replaceAll(/\s+/g, ' ').trim();
            const authorText = $('div.content_title div.xx_text').text().replaceAll(/\s+/g, ' ').trim() || $('span#source_baidu').text().replaceAll(/\s+/g, ' ').trim() || sourceText;
            const author = authorText.match(/作者[:：]\s*(.+)$/)?.[1] || authorText.match(/来源[:：]\s*(.+)$/)?.[1];
            const pubDateText = $('div.detail_thr span.time').first().text().trim();
            const pubDateMatch = pubDateText || detailResponse.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/)?.[1];

            return {
                ...item,
                title,
                author,
                category: keywords?.length ? keywords : item.category,
                pubDate: pubDateMatch ? timezone(parseDate(pubDateMatch, 'YYYY-MM-DD HH:mm:ss'), +8) : item.pubDate,
                description,
            };
        });
    } catch {
        return item;
    }
};

export const route: Route = {
    path: '/article/:id',
    categories: ['government'],
    example: '/chinacourt/article/MzAwNDAwAiPCAAA',
    parameters: {
        id: {
            description: '栏目 ID，可在栏目页 URL 中找到',
            options: Object.entries(options).map(([value, label]) => ({ value, label })),
        },
    },
    radar: [
        {
            source: ['www.chinacourt.cn/article/index/id/:id.shtml'],
            target: '/article/:id',
        },
    ],
    name: '栏目',
    maintainers: ['ZHA30'],
    handler,
    url: 'www.chinacourt.cn',
    description: `| 栏目 ID             | 栏目名   |
| ------------------- | -------- |
| MzAwNDAwAiPCAAA     | 刑事案件 |
| MzAwNDAwMgCRhAEA    | 民事案件 |
| MzAwNDAwNQCRhAEA    | 民事研究 |
| MzAwNDAwNTAwMiACAAA | 刑事研究 |
| MzAwNDAoNzAwNiACAAA | 理论     |`,
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: true,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
};

async function handler(ctx) {
    const id = ctx.req.param('id');
    const currentUrl = `${rootUrl}/article/index/id/${id}.shtml`;
    let wafCookie = '';
    let response = await fetchPage(currentUrl);
    assertAccessiblePage(response);
    let $ = load(response);
    let pageTitle = getPageTitle($, id);
    let list: ChinacourtListItem[] = getList($, pageTitle);

    if (list.length === 0) {
        wafCookie = await getWafCookie(currentUrl);
        if (wafCookie) {
            response = await fetchPage(currentUrl, rootUrl, wafCookie);
            assertAccessiblePage(response);
            $ = load(response);
            pageTitle = getPageTitle($, id);
            list = getList($, pageTitle);
        }
    }

    const items: DataItem[] = await Promise.all(list.map((item) => fetchDetail(item, currentUrl, wafCookie)));

    return {
        title: `${pageTitle} - 中国法院网`,
        link: currentUrl,
        item: items,
    };
}
