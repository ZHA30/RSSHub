import type { Route } from '@/types';

import { getFeed } from './utils';

const categories = {
    latest: {
        name: '최신기사',
        url: 'https://www.yna.co.kr/news',
        channel: 'news',
    },
    politics: {
        name: '정치',
        url: 'https://www.yna.co.kr/politics/index',
        channel: 'politics',
    },
    'north-korea': {
        name: '북한',
        url: 'https://www.yna.co.kr/nk/index',
        channel: 'northkorea',
    },
    economy: {
        name: '경제',
        url: 'https://www.yna.co.kr/economy/index',
        channel: 'economy',
    },
    markets: {
        name: '마켓+',
        url: 'https://www.yna.co.kr/market-plus/index',
        channel: 'market',
    },
    business: {
        name: '산업',
        url: 'https://www.yna.co.kr/industry/index',
        channel: 'industry',
    },
    society: {
        name: '사회',
        url: 'https://www.yna.co.kr/society/index',
        channel: 'society',
    },
    nationwide: {
        name: '전국',
        url: 'https://www.yna.co.kr/local/index',
        channel: 'local',
    },
    world: {
        name: '세계',
        url: 'https://www.yna.co.kr/international/index',
        channel: 'international',
    },
    arts: {
        name: '문화',
        url: 'https://www.yna.co.kr/culture/index',
        channel: 'culture',
    },
    wellness: {
        name: '건강',
        url: 'https://www.yna.co.kr/health/index',
        channel: 'health',
    },
    entertainment: {
        name: '연예',
        url: 'https://www.yna.co.kr/entertainment/index',
        channel: 'entertainment',
    },
    sports: {
        name: '스포츠',
        url: 'https://www.yna.co.kr/sports/index',
        channel: 'sports',
    },
    opinion: {
        name: '오피니언',
        url: 'https://www.yna.co.kr/opinion/index',
        channel: 'opinion',
    },
    people: {
        name: '사람들',
        url: 'https://www.yna.co.kr/people/index',
        channel: 'people',
    },
};

export const route: Route = {
    path: ['/', '/latest', '/:category'],
    categories: ['traditional-media'],
    example: '/yna/world',
    parameters: {
        category: 'Category, see table below. `latest` by default',
    },
    features: {
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
        requireConfig: false,
    },
    radar: [
        {
            source: ['www.yna.co.kr/news'],
            target: '/',
        },
        {
            source: ['www.yna.co.kr/news'],
            target: '/latest',
        },
        {
            source: ['www.yna.co.kr/politics/index'],
            target: '/politics',
        },
        {
            source: ['www.yna.co.kr/nk/index'],
            target: '/north-korea',
        },
        {
            source: ['www.yna.co.kr/economy/index'],
            target: '/economy',
        },
        {
            source: ['www.yna.co.kr/market-plus/index'],
            target: '/markets',
        },
        {
            source: ['www.yna.co.kr/industry/index'],
            target: '/business',
        },
        {
            source: ['www.yna.co.kr/society/index'],
            target: '/society',
        },
        {
            source: ['www.yna.co.kr/local/index'],
            target: '/nationwide',
        },
        {
            source: ['www.yna.co.kr/international/index'],
            target: '/world',
        },
        {
            source: ['www.yna.co.kr/culture/index'],
            target: '/arts',
        },
        {
            source: ['www.yna.co.kr/health/index'],
            target: '/wellness',
        },
        {
            source: ['www.yna.co.kr/entertainment/index'],
            target: '/entertainment',
        },
        {
            source: ['www.yna.co.kr/sports/index'],
            target: '/sports',
        },
        {
            source: ['www.yna.co.kr/opinion/index'],
            target: '/opinion',
        },
        {
            source: ['www.yna.co.kr/people/index'],
            target: '/people',
        },
    ],
    name: '뉴스',
    maintainers: ['quiniapiezoelectricity', 'ZHA30'],
    handler,
    url: 'www.yna.co.kr/news',
    description: `| 最新   | 政治     | 朝鲜        | 经济    | 市场    | 产业     | 社会    | 全国       | 世界  | 文化 | 健康     | 娱乐          | 体育   | 观点    | 人物   |
| ------ | -------- | ----------- | ------- | ------- | -------- | ------- | ---------- | ----- | ---- | -------- | ------------- | ------ | ------- | ------ |
| latest | politics | north-korea | economy | markets | business | society | nationwide | world | arts | wellness | entertainment | sports | opinion | people |`,
};

export function handler(ctx) {
    const category = ctx.req.param('category') ?? 'latest';
    const target = categories[category] ?? categories.latest;
    return getFeed(target.channel, target.url);
}
