import type { Route } from '@/types';

import { getForumPost } from './forum';

export const route: Route = {
    path: '/forum/post/:id',
    categories: ['bbs'],
    example: '/novelia/forum/post/69fa07fe09670419a334e5ff',
    parameters: {
        id: '帖子 ID，可在帖子页 URL 中找到',
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
            source: ['n.novelia.cc/forum/:id'],
            target: '/forum/post/:id',
        },
    ],
    name: '论坛帖子',
    maintainers: ['ZHA30'],
    handler: getForumPost,
    url: 'n.novelia.cc/forum/:id',
};
