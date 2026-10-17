import type { Route } from '@/types';

import { isCategoryId, parseList } from './utils';

export const route: Route = {
    path: '/kw/:id',
    categories: ['study'],
    example: '/hunanpea/kw/c103096',
    parameters: { id: '栏目 id，见下表，默认为 c103096' },
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
            source: ['rst.hunan.gov.cn/rst/hnrsksw/c103127/:id/rskswlist.html'],
            target: '/kw/:id',
        },
    ],
    name: '考务工作',
    maintainers: ['ZHA30'],
    handler,
    url: 'rst.hunan.gov.cn/rst/hnrsksw/c103127',
    description: `| 考试计划 | 考试通知 |
| -------- | -------- |
| c103129  | c103096  |`,
};

async function handler(ctx) {
    const id = ctx.req.param('id') ?? 'c103096';
    const categoryId = isCategoryId(id) ? id : 'c103096';

    return await parseList(categoryId);
}
