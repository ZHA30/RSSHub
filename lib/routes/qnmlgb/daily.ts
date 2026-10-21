import type { Route } from '@/types';

import { getItems } from './utils';

export const route: Route = {
    path: '/daily',
    name: '早报',
    url: 'qnmlgb.tech/daily',
    categories: ['new-media'],
    example: '/qnmlgb/daily',
    maintainers: ['ZHA30'],
    radar: [
        {
            source: ['qnmlgb.tech/daily'],
            target: '/daily',
        },
    ],
    handler: async () => ({
        title: '瓦斯阅读 - 早报',
        link: 'https://qnmlgb.tech/daily',
        description: '瓦斯阅读早报',
        language: 'zh-CN',
        item: await getItems('/daily'),
    }),
};
