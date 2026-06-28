import type { Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';

import { getRssItem } from './utils';

const rootApiUrl = 'https://www.lifeweek.com.cn/api/userWebFollow/getFollowTagContentList?type=4&sort=2&tagId';
const rootUrl = 'https://www.lifeweek.com.cn/articleList';
const articleRootUrl = 'https://www.lifeweek.com.cn/article';

export const route: Route = {
    path: '/tag/:id',
    categories: ['traditional-media'],
    example: '/lifeweek/tag/32523',
    parameters: {
        id: '标签 ID，可从标签页 URL 中获取',
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
            source: ['lifeweek.com.cn/articleList/:id'],
            target: '/tag/:id',
        },
    ],
    name: '标签',
    maintainers: ['ZHA30'],
    handler,
    url: 'lifeweek.com.cn/articleList',
    description: '三联生活网标签文章列表。',
};

async function handler(ctx) {
    const tag = ctx.req.param('id');
    const url = `${rootApiUrl}=${tag}`;
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
        link: `${rootUrl}/${tag}`,
        item: items,
    };
}
