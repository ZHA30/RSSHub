import type { Route } from '@/types';

import { getForumList } from './forum';

export const route: Route = {
    path: '/forum/:category?',
    categories: ['bbs'],
    example: '/novelia/forum/general',
    parameters: {
        category: '版块，可选 general、guide，默认为 general',
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
            source: ['n.novelia.cc/forum'],
            target: '/forum',
        },
    ],
    name: '论坛版块',
    maintainers: ['ZHA30'],
    handler: getForumList,
    url: 'n.novelia.cc/forum',
    description: '反馈与建议版块当前源站 API 返回 500，暂未纳入。',
};
