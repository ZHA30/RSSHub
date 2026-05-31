import type { Data, Route } from '@/types';
import { ViewType } from '@/types';

import { buildThreadItems, getUserInfo, getUserLink, getUserThreads } from './utils';

export const route: Route = {
    path: '/club/user/:id',
    categories: ['social-media'],
    view: ViewType.SocialMedia,
    example: '/vmall/club/user/1000214037717',
    parameters: {
        id: '用户 id，可在个人主页 URL 中找到，如 `id_1000214037717`',
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
            source: ['cn.club.vmall.com/mhw/consumer/cn/community/mhwnews/bluevstore/id_:id', 'cn.club.vmall.com/mhw/consumer/cn/community/mhwnews/userhome/id_:id'],
            target: '/club/user/:id',
        },
    ],
    name: '个人主页',
    maintainers: ['ZHA30'],
    handler,
};

async function handler(ctx): Promise<Data> {
    const id = ctx.req.param('id');
    const [user, threads] = await Promise.all([getUserInfo(id), getUserThreads(id)]);
    const name = user.nickName ?? user.name ?? id;
    const items = await buildThreadItems(threads);

    return {
        title: `${name} - 我的华为个人主页`,
        description: user.description ?? user.introduce,
        link: getUserLink(id),
        image: user.avatarUrl ?? user.avatar,
        language: 'zh-CN',
        item: items,
    };
}
