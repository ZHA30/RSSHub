import type { CheerioAPI } from 'cheerio';
import { load } from 'cheerio';
import type { Context } from 'hono';

import { config } from '@/config';
import type { Data, DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';

const rootUrl = 'https://www.spp.gov.cn';
const channelMap = {
    llyj: '理论研究',
    zdgz: '重点推荐',
    gjybs: '最高检新闻',
    dfjcdt: '地方动态',
    tt: '头条',
    wsfbt: '网上发布厅',
} as const;

type Channel = keyof typeof channelMap;
type ListItem = DataItem & { link: string };
type RawListItem = {
    title: string;
    link?: string;
    pubDate?: DataItem['pubDate'];
};

const channels = new Set<Channel>(Object.keys(channelMap) as Channel[]);

const fetchPage = async (url: string, referer = rootUrl) => {
    const requestOptions = {
        headers: {
            Referer: referer,
            'User-Agent': config.trueUA,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9',
        },
    };

    try {
        return (await got(url, requestOptions)).data;
    } catch (error) {
        if (error instanceof Error && error.message.includes('<no response>')) {
            return (
                await got(url, {
                    ...requestOptions,
                    headers: {
                        ...requestOptions.headers,
                        'x-prefer-proxy': '1',
                    },
                })
            ).data;
        }

        throw error;
    }
};

const normalizeDate = (value?: string) => {
    if (!value) {
        return;
    }

    return value
        .replaceAll('年', '-')
        .replaceAll('月', '-')
        .replaceAll('日', '')
        .replace(/^发布时间：/, '')
        .replace(/^(\d{4}-\d{2}-\d{2})-(\d{2}:\d{2}:\d{2})$/, '$1 $2')
        .trim();
};

const cleanContent = ($: CheerioAPI, selector: string) => {
    const container = $(selector).first();

    if (!container.length) {
        return;
    }

    container.find('script, style, base').remove();
    container.find('*').removeAttr('style').removeAttr('class').removeAttr('id').removeAttr('target');
    container.find('a').each((_, element) => {
        const item = $(element);
        const href = item.attr('href');

        if (!href) {
            item.replaceWith(item.html() || item.text());
            return;
        }

        item.attr('href', new URL(href, rootUrl).href);
    });
    container.find('img').each((_, element) => {
        const item = $(element);
        const src = item.attr('src');

        if (src) {
            item.attr('src', new URL(src, rootUrl).href);
        }
    });

    return container.html() || undefined;
};

const getDescription = ($: CheerioAPI) => cleanContent($, '#fontzoom') || cleanContent($, 'div.TRS_Editor');

const getContentText = ($: CheerioAPI) => $('#fontzoom').text() || $('div.wsfbh_detail_con').first().text() || $('div.TRS_Editor').first().text() || '';

const getDetailTitle = ($: CheerioAPI) => $('title').text().split('_中华人民共和国最高人民检察院')[0].trim();

export const handler = async (ctx: Context): Promise<Data> => {
    const category = (ctx.req.param('category') || 'gjybs') as Channel;

    if (!channels.has(category)) {
        throw new Error(`不支持的栏目：${category}。可用栏目为 ${Object.keys(channelMap).join('、')}。`);
    }

    const limit = Number.parseInt(ctx.req.query('limit') ?? '20', 10);
    const targetUrl = `${rootUrl}/spp/${category}/index.shtml`;
    const response = await fetchPage(targetUrl);
    const $ = load(response);
    const channelName = channelMap[category];

    let items = $('div.commonList_con ul.li_line li')
        .slice(0, limit)
        .toArray()
        .map((element): RawListItem => {
            const item = $(element);
            const a = item.find('a').first();
            const href = a.attr('href');
            const pubDate = normalizeDate(item.find('span').text());

            return {
                title: a.text().trim(),
                link: href ? new URL(href, targetUrl).href : undefined,
                pubDate: pubDate ? parseDate(pubDate) : undefined,
            };
        })
        .filter((item): item is ListItem => Boolean(item.link));

    items = await Promise.all(
        items.map((item) =>
            cache.tryGet(item.link, async () => {
                const detailResponse = await fetchPage(item.link, targetUrl);
                const $$ = load(detailResponse);
                const description = getDescription($$);
                const pubDate = normalizeDate($$('meta[name="firstpublishedtime"]').attr('content') || $$('div.time').first().text());
                const author = $$('meta[name="author"]').attr('content')?.trim();
                const detailTitle = getDetailTitle($$);

                return {
                    ...item,
                    title: detailTitle || item.title,
                    description,
                    pubDate: pubDate ? parseDate(pubDate) : item.pubDate,
                    author,
                    category: [$$('meta[name="lanmu"]').attr('content') || channelName],
                    content: description
                        ? {
                              html: description,
                              text: getContentText($$),
                          }
                        : undefined,
                };
            })
        )
    );

    return {
        title: `${channelName} - 中华人民共和国最高人民检察院`,
        description: channelName,
        link: targetUrl,
        item: items,
        language: 'zh-CN',
        image: new URL('/spp/xhtml/images/public/logo.png', rootUrl).href,
    };
};

export const route: Route = {
    path: '/:category?',
    name: '栏目',
    url: 'www.spp.gov.cn',
    maintainers: ['zha'],
    handler,
    example: '/spp/gjybs',
    parameters: {
        category: {
            description: '栏目，默认为 `gjybs`',
            options: [
                {
                    label: '最高检新闻',
                    value: 'gjybs',
                },
                {
                    label: '头条',
                    value: 'tt',
                },
                {
                    label: '重点推荐',
                    value: 'zdgz',
                },
                {
                    label: '网上发布厅',
                    value: 'wsfbt',
                },
                {
                    label: '地方动态',
                    value: 'dfjcdt',
                },
                {
                    label: '理论研究',
                    value: 'llyj',
                },
            ],
        },
    },
    description:
        '| 栏目 | 路由 |\n' +
        '| --- | --- |\n' +
        '| [理论研究](https://www.spp.gov.cn/spp/llyj/index.shtml) | [/spp/llyj](https://rsshub.app/spp/llyj) |\n' +
        '| [重点推荐](https://www.spp.gov.cn/spp/zdgz/index.shtml) | [/spp/zdgz](https://rsshub.app/spp/zdgz) |\n' +
        '| [最高检新闻](https://www.spp.gov.cn/spp/gjybs/index.shtml) | [/spp/gjybs](https://rsshub.app/spp/gjybs) |\n' +
        '| [地方动态](https://www.spp.gov.cn/spp/dfjcdt/index.shtml) | [/spp/dfjcdt](https://rsshub.app/spp/dfjcdt) |\n' +
        '| [头条](https://www.spp.gov.cn/spp/tt/index.shtml) | [/spp/tt](https://rsshub.app/spp/tt) |\n' +
        '| [网上发布厅](https://www.spp.gov.cn/spp/wsfbt/index.shtml) | [/spp/wsfbt](https://rsshub.app/spp/wsfbt) |',
    categories: ['government'],
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
            title: '理论研究',
            source: ['www.spp.gov.cn/spp/llyj/index.shtml'],
            target: '/llyj',
        },
        {
            title: '重点推荐',
            source: ['www.spp.gov.cn/spp/zdgz/index.shtml'],
            target: '/zdgz',
        },
        {
            title: '最高检新闻',
            source: ['www.spp.gov.cn/spp/gjybs/index.shtml'],
            target: '/gjybs',
        },
        {
            title: '地方动态',
            source: ['www.spp.gov.cn/spp/dfjcdt/index.shtml'],
            target: '/dfjcdt',
        },
        {
            title: '头条',
            source: ['www.spp.gov.cn/spp/tt/index.shtml'],
            target: '/tt',
        },
        {
            title: '网上发布厅',
            source: ['www.spp.gov.cn/spp/wsfbt/index.shtml'],
            target: '/wsfbt',
        },
    ],
};
