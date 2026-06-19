import type { Route } from '@/types';
import { parseDate } from '@/utils/parse-date';
import playwright from '@/utils/playwright';
import timezone from '@/utils/timezone';

const rootUrl = 'https://www.cwl.gov.cn';
const currentUrl = `${rootUrl}/ygkj/wqkjgg/ssq/`;
const apiUrl = `${rootUrl}/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice`;

type DrawNotice = {
    name: string;
    code: string;
    detailsLink: string;
    videoLink: string;
    date: string;
    week: string;
    red: string;
    blue: string;
    sales: string;
    poolmoney: string;
    content: string;
};

type DrawNoticeResponse = {
    state?: number;
    message?: string;
    result?: DrawNotice[];
};

const formatNumber = (value: string) => {
    const number = Number(value);
    return Number.isNaN(number) ? value : number.toLocaleString('zh-CN');
};

const buildDescription = (item: DrawNotice) =>
    [
        `<p>开奖日期：${item.date}</p>`,
        `<p>开奖号码：红球 ${item.red}；蓝球 ${item.blue}</p>`,
        `<p>销量：${formatNumber(item.sales)} 元；奖池：${formatNumber(item.poolmoney)} 元</p>`,
        item.content ? `<p>中奖情况：${item.content}</p>` : '',
    ].join('');

const getDrawNotices = async () => {
    const context = await playwright();
    const page = await context.newPage();
    await page.route('**/*', (route) => {
        const resourceType = route.request().resourceType();
        ['document', 'script', 'xhr', 'fetch'].includes(resourceType) ? route.continue() : route.abort();
    });

    try {
        await page.goto(currentUrl, {
            waitUntil: 'domcontentloaded',
        });

        const data = await page.evaluate(async (url) => {
            const searchParams = new URLSearchParams({
                dayEnd: '',
                dayStart: '',
                issueCount: '30',
                issueEnd: '',
                issueStart: '',
                name: 'ssq',
                pageNo: '1',
                pageSize: '30',
                systemType: 'PC',
                week: '',
            });

            const response = await fetch(`${url}?${searchParams.toString()}`, {
                headers: {
                    accept: 'application/json, text/javascript, */*; q=0.01',
                },
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch draw notices: ${response.status}`);
            }

            return response.json();
        }, apiUrl);

        return data as DrawNoticeResponse;
    } finally {
        await context.close();
    }
};

const handler: Route['handler'] = async () => {
    const data = await getDrawNotices();
    const list = data.result ?? [];

    return {
        title: '中国福彩网 - 双色球往期开奖公告',
        link: currentUrl,
        description: '中国福彩网双色球往期开奖公告',
        item: list.map((item) => {
            const link = new URL(item.detailsLink, rootUrl).href;

            return {
                title: `中国福利彩票“双色球”第${item.code}期开奖公告`,
                link,
                guid: link,
                pubDate: timezone(parseDate(item.date.replace(/\(.+?\)/, '')), +8),
                description: buildDescription(item),
                category: [item.name, `第${item.code}期`, ...item.red.split(',').map((number) => `红球 ${number}`), `蓝球 ${item.blue}`],
            };
        }),
    };
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
