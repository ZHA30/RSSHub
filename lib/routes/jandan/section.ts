import type { DataItem, Route } from '@/types';

import { handleCommentSection, handleForum, handleTopSection, isCommentSection } from './utils';

export const route: Route = {
    path: '/:category/:type?',
    example: '/jandan/top',
    name: '栏目',
    maintainers: ['nczitzk', 'pseudoyu', 'ZHA30'],
    parameters: {
        category: {
            description: '栏目',
            options: [
                {
                    label: '热榜',
                    value: 'top',
                },
                {
                    label: '问答',
                    value: 'qa',
                },
                {
                    label: '树洞',
                    value: 'treehole',
                },
                {
                    label: '女装',
                    value: 'beauty',
                },
                {
                    label: '随手拍',
                    value: 'ooxx',
                },
                {
                    label: '无聊图',
                    value: 'pic',
                },
                {
                    label: '鱼塘',
                    value: 'forum',
                },
                {
                    label: '大吐槽',
                    value: 'tucao',
                },
            ],
        },
        type: {
            description: '热榜类型，仅当 category 选择 `top` 时有效',
            default: '4hr',
            options: [
                {
                    label: '4小时热门',
                    value: '4hr',
                },
                {
                    label: '3天内无聊图',
                    value: 'pic3days',
                },
                {
                    label: '7天内无聊图',
                    value: 'pic7days',
                },
            ],
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
            source: ['jandan.net/:category'],
            target: '/jandan/:category',
        },
        {
            source: ['jandan.net/new/forum'],
            target: '/jandan/forum',
        },
    ],
    handler,
};

async function handler(ctx): Promise<{
    title: string;
    link: string;
    item: DataItem[];
}> {
    const category = (ctx.req.param('category') ?? 'top').replace(/#.*$/, '');
    const type = ctx.req.param('type');

    let result: { title: string; link: string; items: DataItem[] };

    if (category === 'top') {
        result = await handleTopSection(type);
    } else if (category === 'forum' || category === 'bbs') {
        result = await handleForum();
    } else if (isCommentSection(category)) {
        result = await handleCommentSection(category);
    } else {
        throw new Error(`Unsupported jandan category: ${category}`);
    }

    return {
        title: result.title,
        link: result.link,
        item: result.items,
    };
}
