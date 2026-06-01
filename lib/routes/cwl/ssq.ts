import { type CheerioAPI, load } from 'cheerio';

import type { DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import { parseDate } from '@/utils/parse-date';
import type { Browser } from '@/utils/playwright';
import playwright from '@/utils/playwright';
import timezone from '@/utils/timezone';

const rootUrl = 'https://www.cwl.gov.cn';
const currentUrl = `${rootUrl}/ygkj/wqkjgg/ssq/`;
const apiUrl = `${rootUrl}/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice`;

type DrawNotice = {
    name: string;
    code: string;
    detailsLink: string;
    date: string;
    red: string;
    blue: string;
};

type DrawNoticeResponse = {
    result?: DrawNotice[];
};

const resolveContentAssetUrls = ($: CheerioAPI, baseUrl: string) => {
    $('[src]').each((_, element) => {
        const src = $(element).attr('src');
        if (src) {
            $(element).attr('src', new URL(src, baseUrl).href);
        }
    });

    $('[href]').each((_, element) => {
        const href = $(element).attr('href');
        if (href && !href.startsWith('javascript:')) {
            $(element).attr('href', new URL(href, baseUrl).href);
        }
    });
};

const appendStyle = (currentStyle: string | undefined, style: string) => [currentStyle, style].filter(Boolean).join(';');

const inlineContentStyles = ($: CheerioAPI, content: ReturnType<CheerioAPI>) => {
    content.attr('style', appendStyle(content.attr('style'), 'font-family: "Microsoft YaHei", Arial, sans-serif; font-size: 18px; font-weight: 700; line-height: 1.8; max-width: 860px; color: inherit;'));
    content.find('.lotteryDate, .saleAmount').attr('style', 'margin: 0 0 18px;');
    content.find('.qiu').attr('style', 'display: block; margin: 28px 0 34px; white-space: nowrap;');
    content.find('.qiu > .divStyle').attr('style', 'margin-right: 12px; font-size: 20px; font-weight: 700; white-space: nowrap;');
    content.find('.lotteryNumContainer img').remove();
    content.find('.lotteryNumContainer').each((index, element) => {
        const color = index < 6 ? '#d91f2f' : '#1f70d1';
        const container = $(element);
        container.attr('style', 'display: inline-block; margin: 0 5px 0 0; vertical-align: middle;');
        container.find('.lotteryNum').attr('style', `display: inline-block; min-width: 32px; height: 32px; line-height: 32px; text-align: center; color: ${color}; font-size: 24px; font-weight: 700;`);
    });
    content.find('.winningCase').attr('style', 'margin: 0 0 24px; text-align: center; font-size: 24px; font-weight: 700;');
    content.find('table').attr('style', 'width: 100%; border-collapse: collapse; margin: 0 0 32px; text-align: center; font-size: 20px; font-weight: 700; background: transparent;');
    content.find('th, td').attr('style', 'border: 1px solid currentColor; padding: 18px 12px; text-align: center;');
    content.find('.awardDetailed').attr('style', 'font-size: 18px; font-weight: 700; line-height: 1.8;');
    content.find('.awardDetailed > div').attr('style', 'margin: 0 0 14px;');
    content.find('.awardDetailed .divTitle').attr('style', 'display: inline;');
    content.find('.awardDetailed .winningProvinces').attr('style', 'display: inline;');
};

const createPage = async (browser: Browser) => {
    const page = await browser.newPage();
    await page.route('**/*', (route) => {
        const resourceType = route.request().resourceType();
        ['document', 'script', 'xhr', 'fetch'].includes(resourceType) ? route.continue() : route.abort();
    });
    return page;
};

const handler: Route['handler'] = async () => {
    const browser = await playwright();
    try {
        const page = await createPage(browser);
        await page.goto(currentUrl, {
            waitUntil: 'domcontentloaded',
        });

        const searchParams = new URLSearchParams({
            name: 'ssq',
            issueCount: '20',
            pageNo: '1',
            pageSize: '20',
            systemType: 'PC',
        });
        const listUrl = `${apiUrl}?${searchParams}`;
        const responsePromise = page.waitForResponse((response) => response.url().startsWith(apiUrl));
        const dataPromise = page.evaluate(async (url) => {
            const response = await fetch(url, {
                headers: {
                    accept: 'application/json, text/javascript, */*; q=0.01',
                },
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch ${url}: ${response.status}`);
            }

            return response.json();
        }, listUrl);
        await responsePromise;
        const data = (await dataPromise) as DrawNoticeResponse;
        await page.close();

        const list = data.result ?? [];
        const items = await Promise.all(
            list.map((item) => {
                const link = new URL(item.detailsLink, rootUrl).href;
                const pubDate = timezone(parseDate(item.date.replace(/\(.+?\)/, '')), +8);

                return cache.tryGet(`cwl:detail:ssq:${item.code}`, async (): Promise<DataItem> => {
                    const detailPageInstance = await createPage(browser);
                    try {
                        await detailPageInstance.goto(link, {
                            waitUntil: 'domcontentloaded',
                        });
                        await detailPageInstance.waitForSelector('.content-text');
                        const detailPage = await detailPageInstance.content();
                        const $ = load(detailPage);
                        const content = $('.content-text').first();
                        resolveContentAssetUrls($, link);
                        inlineContentStyles($, content);

                        const title = $('.titleContent .title').first().text().trim() || `中国福利彩票“双色球”第${item.code}期开奖公告`;
                        const description = content.html() ?? '';

                        return {
                            title,
                            link,
                            guid: link,
                            pubDate,
                            description,
                            category: [item.name, `第${item.code}期`, ...item.red.split(',').map((number) => `红球 ${number}`), `蓝球 ${item.blue}`],
                        };
                    } finally {
                        await detailPageInstance.close();
                    }
                });
            })
        );

        return {
            title: '中国福彩网 - 双色球往期开奖公告',
            link: currentUrl,
            description: '中国福彩网双色球往期开奖公告',
            item: items,
        };
    } finally {
        await browser.close();
    }
};

export const route: Route = {
    path: '/ssq',
    name: '双色球往期开奖公告',
    url: 'www.cwl.gov.cn/ygkj/wqkjgg/ssq/',
    maintainers: ['ZHA30'],
    handler,
    example: '/cwl/ssq',
    parameters: {},
    categories: ['government'],
    features: {
        requireConfig: false,
        requirePuppeteer: true,
        antiCrawler: true,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
        supportRadar: true,
    },
    radar: [
        {
            source: ['www.cwl.gov.cn/ygkj/wqkjgg/ssq/'],
            target: '/ssq',
        },
    ],
};
