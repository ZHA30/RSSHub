import type { DataItem } from '@/types';
import cache from '@/utils/cache';

import { type ArticleDetailResponse, type ArticleListResponse, fetchApi, md, rootUrl, unixDate } from './utils';

const categoryMap = {
    general: {
        value: 'General',
        title: '小说交流',
    },
    guide: {
        value: 'Guide',
        title: '使用指南',
    },
};

export async function getForumList(ctx) {
    const categoryKey = ctx.req.param('category') ?? 'general';
    const category = categoryMap[categoryKey] ?? categoryMap.general;
    const limit = Number.parseInt(ctx.req.query('limit') ?? '20', 10);

    const params = new URLSearchParams({
        page: '0',
        pageSize: String(limit),
        category: category.value,
    });
    const response = await fetchApi<ArticleListResponse>(`/api/article?${params.toString()}`);

    const items: DataItem[] = await Promise.all(
        response.items.map((item) =>
            cache.tryGet(`novelia:forum:${item.id}`, async () => {
                const detail = await fetchApi<ArticleDetailResponse>(`/api/article/${item.id}`);
                return {
                    title: item.title,
                    link: `${rootUrl}/forum/${item.id}`,
                    guid: `novelia:forum:${item.id}`,
                    author: item.user?.username,
                    pubDate: unixDate(item.createAt),
                    updated: unixDate(item.updateAt),
                    category: item.category ? [item.category] : undefined,
                    description: md.render(detail.content ?? ''),
                };
            })
        )
    );

    return {
        title: `轻小说机翻机器人论坛 - ${category.title}`,
        link: `${rootUrl}/forum`,
        item: items,
    };
}

export async function getForumPost(ctx) {
    const id = ctx.req.param('id');
    const link = `${rootUrl}/forum/${id}`;
    const response = await fetchApi<ArticleDetailResponse>(`/api/article/${id}`);

    return {
        title: `轻小说机翻机器人论坛 - ${response.title}`,
        link,
        item: [
            {
                title: response.title,
                link,
                guid: `novelia:forum:${id}`,
                author: response.user?.username,
                pubDate: unixDate(response.createAt),
                updated: unixDate(response.updateAt),
                category: response.category ? [response.category] : undefined,
                description: md.render(response.content ?? ''),
            },
        ],
    };
}
