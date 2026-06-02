import type { Route } from '@/types';

import { buildChannelFeed } from './utils';

const link = 'http://www.jcrb.com/procuratorate/';

export const route: Route = {
    path: '/procuratorate',
    categories: ['traditional-media'],
    example: '/jcrb/procuratorate',
    radar: [
        {
            source: ['www.jcrb.com/procuratorate/'],
            target: '/procuratorate',
        },
    ],
    name: '检察',
    maintainers: ['ZHA30'],
    handler: () =>
        buildChannelFeed({
            title: '正义网检察',
            link,
        }),
    description: '正义网检察频道首页主新闻列表。',
};
