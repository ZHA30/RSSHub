import type { Route } from '@/types';

import { buildChannelFeed } from './utils';

const link = 'http://www.jcrb.com/opinion/';

export const route: Route = {
    path: '/opinion',
    categories: ['traditional-media'],
    example: '/jcrb/opinion',
    radar: [
        {
            source: ['www.jcrb.com/opinion/'],
            target: '/opinion',
        },
    ],
    name: '评论',
    maintainers: ['ZHA30'],
    handler: () =>
        buildChannelFeed({
            title: '正义网评论',
            link,
        }),
    description: '正义网评论频道首页主新闻列表。',
};
