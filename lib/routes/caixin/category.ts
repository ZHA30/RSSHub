import { load } from 'cheerio';

import InvalidParameterError from '@/errors/types/invalid-parameter';
import type { Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';
import { isValidHost } from '@/utils/valid-host';

import { parseArticle } from './utils';

type CategoryDefinition = readonly [slug: string, name: string];

type ChannelDefinition = {
    name: string;
    host: 'subdomain' | 'www';
    categories: readonly CategoryDefinition[];
};

const channelDefinitions = {
    auto: { name: '汽车', host: 'www', categories: [] },
    china: {
        name: '政经',
        host: 'subdomain',
        categories: [
            ['news', '要闻'],
            ['anticorruption', '反腐纪事'],
            ['law', '法治'],
            ['politics', '时政'],
            ['society', '社会'],
            ['agriculture', '三农'],
            ['medicare', '民生'],
            ['environment', '环境新闻'],
            ['ups_and_downs', '人事观察'],
            ['latest_china', '政经当日快讯'],
        ],
    },
    companies: { name: '公司', host: 'subdomain', categories: [] },
    consumer: { name: '消费', host: 'www', categories: [] },
    culture: {
        name: '文化',
        host: 'subdomain',
        categories: [
            ['zhuanlan', '专栏'],
            ['novel', '文学'],
            ['art', '艺术'],
            ['books', '阅读'],
            ['wh_philosophy', '评论'],
            ['newculture', '资讯'],
            ['chilong', '赤龙'],
            ['dead', '逝者'],
        ],
    },
    economy: {
        name: '经济',
        host: 'subdomain',
        categories: [
            ['policy', '政策信息'],
            ['macro_economy', '宏观数据'],
            ['trade_investment', '贸易投资'],
            ['local_economy', '地方经济'],
            ['global_economy', '国际经济'],
            ['data', '经济数据'],
        ],
    },
    energy: { name: '能源', host: 'www', categories: [] },
    esg: { name: 'ESG', host: 'www', categories: [] },
    finance: {
        name: '金融',
        host: 'subdomain',
        categories: [
            ['regulation', '监管'],
            ['bank', '银行'],
            ['stock', '证券基金'],
            ['insurance_trust', '信托保险'],
            ['investment', '投资'],
            ['innovation', '创新'],
            ['market', '金融市场'],
            ['assets', '欢乐财新闻'],
            ['latest_finance', '金融当日快讯'],
        ],
    },
    health: { name: '健康', host: 'www', categories: [] },
    international: {
        name: '世界',
        host: 'subdomain',
        categories: [
            ['europe_n_north_america', '欧洲北美'],
            ['asia_pacific_region', '亚太地区'],
            ['middle_east_n_north_africa', '中东北非'],
            ['emerging_markets', '新兴市场'],
            ['chinese_diplomacy', '中国外交'],
            ['globusnews', '世界说'],
            ['onchina', '旁观中国'],
        ],
    },
    livelihood: { name: '民生', host: 'www', categories: [] },
    obituary: { name: '讣闻', host: 'www', categories: [] },
    opinion: {
        name: '观点',
        host: 'subdomain',
        categories: [
            ['columns', '财新名家'],
            ['upfront', '火线评论'],
            ['opinion_leader', '意见领袖'],
            ['editorial', '社评'],
            ['wyll', '聚焦'],
            ['opinion_video', '视听'],
            ['think_tank', '智库'],
            ['sxjx', '思想精选'],
        ],
    },
    property: { name: '地产', host: 'www', categories: [] },
    science: {
        name: '环科',
        host: 'subdomain',
        categories: [
            ['environment', '环境'],
            ['scitech', '新科技'],
        ],
    },
    tech: { name: '科技', host: 'www', categories: [] },
} as const satisfies Record<string, ChannelDefinition>;

type Channel = keyof typeof channelDefinitions;

const channelEntries = Object.entries(channelDefinitions) as Array<[Channel, ChannelDefinition]>;
const subdomainChannels = channelEntries.filter(([, value]) => value.host === 'subdomain').map(([key]) => key);
const wwwChannels = channelEntries.filter(([, value]) => value.host === 'www').map(([key]) => key);

export const route: Route = {
    path: '/channel/:channel/:category?',
    categories: ['traditional-media'],
    example: '/caixin/channel/china/news',
    parameters: { channel: '频道名', category: '频道下的子分类名，留空为频道首页' },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: true,
        supportScihub: false,
    },
    name: '新闻分类',
    maintainers: ['idealclover'],
    handler,
    description: buildDescription(),
    radar: [
        {
            source: subdomainChannels.map((channel) => `${channel}.caixin.com/`),
            target: (_, url) => {
                const currentUrl = new URL(url);
                const channel = currentUrl.hostname.split('.')[0];
                const category = currentUrl.pathname.split('/').find(Boolean);

                return getRouteTarget(channel, category);
            },
        },
        {
            source: wwwChannels.map((channel) => `www.caixin.com/${channel}/`),
            target: (_, url) => {
                const [channel, category] = new URL(url).pathname.split('/').filter(Boolean);

                return getRouteTarget(channel, category);
            },
        },
    ],
};

async function handler(ctx) {
    const channel = ctx.req.param('channel');
    const category = ctx.req.param('category');
    const url = getChannelUrl(channel, category);

    if (!url) {
        throw new InvalidParameterError('Invalid channel');
    }

    const response = await got(url);
    const $ = load(response.data);
    const title = $('head title').text();
    const entity = parseChannelEntity($);

    let list = (await getSpecialCategoryList(channel, category)) ?? (entity ? await parseListFromApi(entity.id) : []);

    if (list.length === 0) {
        list = parseListFromHtml(url, $);
    }

    const items = await Promise.all(list.map((item) => cache.tryGet(item.link, () => parseArticle(item))));

    return {
        title,
        link: url,
        description: '财新网 - 提供财经新闻及资讯服务',
        item: items,
    };
}

function getChannelUrl(channel: string, category?: string) {
    if (!isValidChannel(channel)) {
        return;
    }

    const definition = channelDefinitions[channel];
    const categories = getCategoryDefinitions(definition);

    if (normalizeCategory(category) && !categories.some(([slug]) => slug === category)) {
        return;
    }

    const path = category ? `${category}/` : '';

    if (definition.host === 'subdomain') {
        return `https://${channel}.caixin.com/${path}`;
    }

    if (definition.host === 'www') {
        return `https://www.caixin.com/${channel}/${path}`;
    }
}

function buildDescription() {
    const lines = ['路径格式：`/caixin/channel/:channel/:category?`', '', '频道列表：', '', '| channel | 名称 | category 列表 |', '| ------- | ---- | ------------- |'];

    for (const [channel, definition] of channelEntries) {
        lines.push(`| ${channel} | ${definition.name} | ${formatCategories(definition)} |`);
    }

    return lines.join('\n');
}

function getRouteTarget(channel?: string, category?: string) {
    if (!channel || !isValidChannel(channel)) {
        return '/channel/china';
    }

    const normalizedCategory = normalizeCategory(category);

    return normalizedCategory && isValidCategory(channel, normalizedCategory) ? `/channel/${channel}/${normalizedCategory}` : `/channel/${channel}`;
}

function isValidChannel(channel: string): channel is Channel {
    return isValidHost(channel) && Object.hasOwn(channelDefinitions, channel);
}

function isValidCategory(channel: Channel, category: string) {
    return getCategoryDefinitions(channelDefinitions[channel]).some(([slug]) => slug === category);
}

function getCategoryDefinitions(definition: ChannelDefinition): readonly CategoryDefinition[] {
    return definition.categories as readonly CategoryDefinition[];
}

function formatCategories(definition: ChannelDefinition) {
    const categories = getCategoryDefinitions(definition);

    return categories.length > 0 ? categories.map(([slug, name]) => `${slug}（${name}）`).join('<br>') : '留空表示频道首页';
}

function normalizeCategory(category?: string) {
    return category && category !== 'index.html' ? category.replace(/\/index\.html$/, '') : undefined;
}

function parseChannelEntity($: ReturnType<typeof load>) {
    const entityRaw = $('script')
        .toArray()
        .map((script) => $(script).html() ?? '')
        .find((script) => script.includes('var entity'))
        ?.match(/var\s+entity\s*=\s*({.*?})\s*;?/s)?.[1];

    if (!entityRaw) {
        return;
    }

    try {
        return JSON.parse(entityRaw) as { id: number | string };
    } catch {
        return;
    }
}

function getSpecialCategoryList(channel: string, category?: string) {
    if (channel === 'economy' && category === 'data') {
        return parseEconomyDataList();
    }
}

async function parseListFromApi(subject: number | string) {
    try {
        const {
            data: { datas: data },
        } = await got('https://gateway.caixin.com/api/extapi/homeInterface.jsp', {
            searchParams: {
                subject,
                type: 0,
                count: 25,
                picdim: '_266_177',
                start: 0,
            },
        });

        return (
            data?.map((item) => ({
                title: item.desc,
                description: item.summ,
                link: item.link.replace('http://', 'https://'),
                pubDate: timezone(parseDate(item.time), +8),
                category: item.keyword ? item.keyword.split(' ') : undefined,
                author: item.edit?.name,
                audio: item.audioUrl,
                audio_image_url: item.pict?.imgs?.[0]?.url,
            })) ?? []
        );
    } catch {
        return [];
    }
}

async function parseEconomyDataList() {
    try {
        const {
            data: { data },
        } = await got('https://ceic.caixin.com/column/news/list', {
            searchParams: {
                pageNum: 1,
                pageSize: 25,
            },
        });

        return (
            data?.records?.map((item) => ({
                title: item.title,
                description: item.subhead,
                link: item.url.replace('http://', 'https://'),
                pubDate: timezone(parseDate(item.updateTime || item.time), +8),
                author: undefined,
            })) ?? []
        );
    } catch {
        return [];
    }
}

function parseListFromHtml(url: string, $: ReturnType<typeof load>) {
    const handlers = [
        { selector: '#listArticle > .boxa', parser: parseBoxArticle },
        { selector: '#listArticle > dl', parser: parseListDlArticle },
        { selector: '.stitXtuwen_list > dl', parser: parseListDlArticle },
        { selector: '.newlistCon > dl', parser: parseNewListArticle },
        { selector: '.NewsList > a.newsItem', parser: parseNewsItemArticle },
    ];

    for (const { selector, parser } of handlers) {
        const nodes = $(selector).toArray();

        if (nodes.length > 0) {
            return nodes.map((node) => parser(url, $(node))).filter((item) => item?.link);
        }
    }

    throw new Error('Cannot parse channel list from HTML');
}

function parseBoxArticle(url: string, item) {
    const link = item.find('h4 a').first().attr('href') ?? item.find('.pic a').first().attr('href');
    const meta = item.find('span').first().text().trim();

    return {
        title: item.find('h4 a').first().text().trim(),
        description: item.find('p').first().text().trim(),
        link: normalizeLink(url, link),
        pubDate: extractDate(link, meta),
        author: extractAuthor(meta),
    };
}

function parseListDlArticle(url: string, item) {
    const link = item.find('h4 a').first().attr('href') ?? item.find('dt a').first().attr('href');
    const meta = item.find('dd > span').first().text().trim();
    const author = item.find('dt span a').first().text().trim() || undefined;

    return {
        title: item.find('h4 a').first().text().trim() || item.find('dt a').first().text().trim(),
        description: item.find('p').first().text().trim(),
        link: normalizeLink(url, link),
        pubDate: extractDate(link, meta),
        author,
    };
}

function parseNewListArticle(url: string, item) {
    const link = item.find('dt a').first().attr('href');
    const meta = item.find('dd > span').first().text().trim();

    return {
        title: item.find('dt a').first().text().trim(),
        description: item.find('p').first().text().trim(),
        link: normalizeLink(url, link),
        pubDate: extractDate(link, meta),
        author: extractAuthor(meta),
    };
}

function parseNewsItemArticle(url: string, item) {
    const meta = item.find('.newsRightConTime').text().trim();

    return {
        title: item.find('.newsRightConTitle').first().text().trim(),
        description: item.find('.newsRightConText').first().text().trim(),
        link: normalizeLink(url, item.attr('href')),
        pubDate: extractDate(item.attr('href'), meta),
        author: item.find('.newsRightConTime a').first().text().trim() || undefined,
    };
}

function normalizeLink(url: string, link?: string) {
    if (!link) {
        return;
    }

    return new URL(link, url).toString().replace('http://', 'https://');
}

function extractDate(link?: string, text?: string) {
    const linkDate = link?.match(/\/(\d{4}-\d{2}-\d{2})\//)?.[1];

    if (linkDate) {
        return timezone(parseDate(linkDate), +8);
    }

    if (text) {
        const dateText = text.match(/\d{4}年\d{2}月\d{2}日(?:\s+\d{2}:\d{2})?|\d{2}月\d{2}日(?:\s+\d{2}:\d{2})?/)?.[0];

        if (dateText) {
            return timezone(parseDate(dateText), +8);
        }
    }
}

function extractAuthor(text?: string) {
    if (!text) {
        return;
    }

    const author = text
        .replace(/\d{4}年\d{2}月\d{2}日(?:\s+\d{2}:\d{2})?/, '')
        .replace(/\d{2}月\d{2}日(?:\s+\d{2}:\d{2})?/, '')
        .replaceAll(/[｜|]/g, ' ')
        .trim();

    return author || undefined;
}
