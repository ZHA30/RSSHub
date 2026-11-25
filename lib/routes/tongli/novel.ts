import type { Route } from '@/types';
import { getRouteLimit } from '@/utils/route-limit';

import { getBooks } from './utils';

export const route: Route = {
    path: '/novel/books',
    categories: ['reading'],
    example: '/tongli/novel/books',
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
            source: ['www.tongli.com.tw/NovelDetail.aspx'],
            target: '/novel/books',
        },
    ],
    name: '小說新書上架',
    maintainers: ['ZHA30'],
    handler,
};

async function handler(ctx) {
    return await getBooks('NovelDetail.aspx', '小說新書上架', getRouteLimit(ctx));
}
