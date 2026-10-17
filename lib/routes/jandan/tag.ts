import type { DataItem, Route } from '@/types';

import { handleTag } from './utils';

export const route: Route = {
    path: '/tag/:tag',
    example: '/jandan/tag/tech',
    name: '标签',
    maintainers: ['ZHA30'],
    parameters: {
        tag: {
            description: '标签名',
        },
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
            source: ['jandan.net/p/tag/:tag'],
            target: '/jandan/tag/:tag',
        },
    ],
    handler,
};

async function handler(ctx): Promise<{
    title: string;
    link: string;
    item: DataItem[];
}> {
    const result = await handleTag(ctx.req.param('tag'));

    return {
        title: result.title,
        link: result.link,
        item: result.items,
    };
}
