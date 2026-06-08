import type { DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

type XinshengSession = {
    session: string;
};

type HuaweierArticle = {
    postId: string;
    title: string;
    maskName?: string;
    ctime?: string;
    byliner?: string;
    summary?: string;
    subtitle?: string;
    imageUrl?: string;
};

type PostField = {
    fieldType: string;
    fieldValue: string | null;
};

type PostDetailResponse = {
    title: string;
    uuid: string;
    creationDate?: number;
    sectionName?: string;
    categoryName?: string;
    author?: {
        maskName?: string;
    };
    categories?: Array<{
        categoryName?: string;
        name?: string;
    }>;
    tagInfoList?: Array<{
        tagName?: string;
        name?: string;
    }>;
    images?: Array<{
        url: string;
    }>;
    fields?: PostField[];
};

type HuaweierListResponse = {
    list?: HuaweierArticle[];
    topList?: HuaweierArticle[];
};

type FeedSeedItem = {
    id: string;
    title: string;
    link: string;
    author?: string;
    description?: string;
    image?: string;
    category: string[];
    pubDate?: string;
};

const rootUrl = 'https://xinsheng.huawei.com';
const plusUrl = `${rootUrl}/next/plus/`;
const channelUrl = `${plusUrl}#/newpaper/channel?pageType=1`;
const sessionCacheKey = 'xinsheng:guest-session';
const sessionTTL = 10 * 60;
const pageSize = 50;

export const route: Route = {
    path: '/huaweier',
    categories: ['social-media'],
    example: '/xinsheng/huaweier',
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
            source: ['xinsheng.huawei.com/next/plus/#/newpaper/channel?pageType=1'],
            target: '/huaweier',
        },
    ],
    name: '华为人',
    maintainers: ['ZHA30'],
    handler,
    url: 'xinsheng.huawei.com',
};

const requestHeaders = (session?: string, referer = plusUrl) => ({
    accept: 'application/json, text/plain, */*',
    referer,
    ...(session ? { cookie: `SESSION=${session}` } : {}),
});

const isNonEmptyString = (value: string | null | undefined): value is string => typeof value === 'string' && value.length > 0;

const getSession = () =>
    cache.tryGet(
        sessionCacheKey,
        async (): Promise<XinshengSession> => {
            const response = await ofetch.raw<{ status: string; data: { token: string } }>(`${rootUrl}/xsperson/v1/csrf-token`, {
                method: 'POST',
                body: {},
                headers: requestHeaders(),
            });
            const session = response.headers
                .getSetCookie()
                .map((cookie) => cookie.split(';')[0]?.trim())
                .find((cookie) => cookie?.startsWith('SESSION='))
                ?.slice('SESSION='.length);

            if (!session) {
                throw new Error('Failed to get Xinsheng guest session');
            }

            return { session };
        },
        sessionTTL
    );

const requestWithGuestSession = async <T>(url: string, referer?: string, query?: Record<string, number | string>) => {
    const { session } = await getSession();

    return ofetch<T>(url, {
        headers: requestHeaders(session, referer),
        query,
    });
};

const getContentField = (fields?: PostField[]) => fields?.find((field) => field.fieldType === 'CONTENT')?.fieldValue;

const normalizeLink = (postId: string) => `${rootUrl}/next/#/detail?uuid=${postId}`;

const toSeedItem = (item: HuaweierArticle): FeedSeedItem => ({
    id: item.postId,
    title: item.title,
    link: normalizeLink(item.postId),
    author: item.byliner,
    description: item.summary || item.subtitle,
    image: isNonEmptyString(item.imageUrl) ? item.imageUrl : undefined,
    category: ['华为人', item.maskName].filter((entry) => isNonEmptyString(entry)),
    pubDate: item.ctime,
});

const dedupeItems = (items: FeedSeedItem[]) => {
    const merged = new Map<string, FeedSeedItem>();

    for (const item of items) {
        const existing = merged.get(item.id);

        if (!existing) {
            merged.set(item.id, item);
            continue;
        }

        existing.author ??= item.author;
        existing.description ??= item.description;
        existing.image ??= item.image;
        existing.pubDate ??= item.pubDate;
        existing.category = [...new Set([...existing.category, ...item.category])];
    }

    return [...merged.values()];
};

const seedToDataItem = (item: FeedSeedItem): DataItem => ({
    title: item.title,
    link: item.link,
    author: item.author,
    description: item.description,
    image: item.image,
    ...(item.pubDate ? { pubDate: parseDate(item.pubDate) } : {}),
    category: item.category,
    id: item.id,
});

const enrichItem = async (item: FeedSeedItem): Promise<DataItem> => {
    try {
        return await cache.tryGet(`xinsheng:detail:${item.id}`, async () => {
            const detail = await requestWithGuestSession<{ status: string; message: string; data: PostDetailResponse }>(`${rootUrl}/xsapi/user/posts/${item.id}`, `${rootUrl}/next/detail/`);
            const data = detail.data;
            const description = getContentField(data.fields);
            const category = [
                ...item.category,
                data.sectionName,
                data.categoryName,
                ...(data.categories ?? []).map((entry) => entry.categoryName ?? entry.name).filter((name) => isNonEmptyString(name)),
                ...(data.tagInfoList ?? []).map((entry) => entry.tagName ?? entry.name).filter((name) => isNonEmptyString(name)),
            ].filter((entry) => isNonEmptyString(entry));
            const result: DataItem = {
                title: data.title || item.title,
                link: item.link,
                author: item.author ?? data.author?.maskName,
                description: description ?? item.description,
                image: item.image ?? data.images?.[0]?.url,
                category: [...new Set(category)],
                id: data.uuid || item.id,
            };

            if (data.creationDate) {
                result.pubDate = parseDate(data.creationDate);
            } else if (item.pubDate) {
                result.pubDate = parseDate(item.pubDate);
            }

            return result;
        });
    } catch {
        return seedToDataItem(item);
    }
};

async function handler() {
    const response = await requestWithGuestSession<{ status: string; message: string; data: HuaweierListResponse }>(`${rootUrl}/xsapi/user/v1/paper/huaweier/article/list`, channelUrl, {
        curPage: 1,
        pageSize,
    });

    const listItems = response.data.list ?? [];
    const topItems = response.data.topList ?? [];
    const items = await Promise.all(dedupeItems([...topItems, ...listItems].map((item) => toSeedItem(item))).map((item) => enrichItem(item)));

    return {
        title: '华为人 - 心声社区',
        link: channelUrl,
        description: '华为心声社区华为人频道最新文章',
        language: 'zh-CN' as const,
        item: items,
    };
}
