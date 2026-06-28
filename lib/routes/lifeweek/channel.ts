import type { Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';

import { getRssItem } from './utils';

const rootApiUrl = 'https://www.lifeweek.com.cn/api/userWebFollow/getFollowTagContentList?type=3&sort=2&tagId';
const rootUrl = 'https://www.lifeweek.com.cn/column';
const articleRootUrl = 'https://www.lifeweek.com.cn/article';

export const route: Route = {
    path: '/channel/:id',
    categories: ['traditional-media'],
    example: '/lifeweek/channel/1',
    parameters: {
        id: '频道 ID，可从频道页 URL 中获取',
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
            source: ['lifeweek.com.cn/column/:id'],
            target: '/channel/:id',
        },
    ],
    name: '频道',
    maintainers: ['ZHA30'],
    handler,
    url: 'lifeweek.com.cn/column',
    description: '三联生活网频道文章列表。',
};

async function handler(ctx) {
    const channel = ctx.req.param('id');
    const url = `${rootApiUrl}=${channel}`;
    const { data } = await got(url);
    const result = data.model.articleResponseList;
    const items = await Promise.all(
        result.map((item) => {
            const articleLink = `${articleRootUrl}/${item.id}`;
            return cache.tryGet(articleLink, () => getRssItem(item, articleLink));
        })
    );

    return {
        title: data.model.tagName,
        link: `${rootUrl}/${channel}`,
        item: items,
    };
}
