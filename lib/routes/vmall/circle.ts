import type { Data, Route } from '@/types';
import { ViewType } from '@/types';

import { buildThreadItems, getCircleInfo, getCircleLink, getCircleThreads } from './utils';

export const route: Route = {
    path: '/club/circle/:id',
    categories: ['social-media'],
    view: ViewType.SocialMedia,
    example: '/vmall/club/circle/10000001',
    parameters: {
        id: '圈子 id，可在圈子页 URL 中找到，如 `id_10000001`',
    },
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
            source: ['cn.club.vmall.com/mhw/consumer/cn/community/mhwnews/allcircle/id_:id'],
            target: '/club/circle/:id',
        },
    ],
    name: '圈子',
    maintainers: ['ZHA30'],
    handler,
};

async function handler(ctx): Promise<Data> {
    const id = ctx.req.param('id');
    const [circle, threads] = await Promise.all([getCircleInfo(id), getCircleThreads(id)]);
    const items = await buildThreadItems(threads);

    return {
        title: `${circle.name} - 我的华为圈子`,
        description: circle.introduction,
        link: getCircleLink(id),
        image: circle.logo,
        language: 'zh-CN',
        item: items,
    };
}
