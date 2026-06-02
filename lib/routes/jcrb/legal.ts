import type { Route } from '@/types';

import { buildChannelFeed } from './utils';

const link = 'http://www.jcrb.com/legal/';

export const route: Route = {
    path: '/legal',
    categories: ['traditional-media'],
    example: '/jcrb/legal',
    radar: [
        {
            source: ['www.jcrb.com/legal/'],
            target: '/legal',
        },
    ],
    name: '法治',
    maintainers: ['ZHA30'],
    handler: () =>
        buildChannelFeed({
            title: '正义网法治',
            link,
        }),
    description: '正义网法治频道首页主新闻列表。',
};
