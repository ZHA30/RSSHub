import type { Route } from '@/types';

import { getItems } from './utils';

export const route: Route = {
    path: '/',
    name: '每日推荐',
    url: 'qnmlgb.tech',
    categories: ['new-media'],
    example: '/qnmlgb',
    maintainers: ['ZHA30'],
    radar: [
        {
            source: ['qnmlgb.tech/'],
            target: '/',
        },
    ],
    handler: async () => ({
        title: '瓦斯阅读 - 每日推荐',
        link: 'https://qnmlgb.tech/',
        description: '聚合优质的商业科技资讯',
        language: 'zh-CN',
        item: await getItems('/'),
    }),
};
