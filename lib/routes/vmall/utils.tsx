import { renderToString } from 'hono/jsx/dom/server';
import type { FetchOptions } from 'ofetch';
import pMap from 'p-map';
import sanitizeHtml from 'sanitize-html';

import type { DataItem } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const apiRoot = 'https://sgw-cn.c.huawei.com';
const webRoot = 'https://cn.club.vmall.com';
const defaultAppId = 'EDCF82D77A5AB59706CD5F2163F67427';
const listAppId = '9CE75DB648ADD4E0C1556B805C80D2CA';

const commonHeaders = {
    Referer: `${webRoot}/`,
    site: 'zh_CN',
    'X-Requested-With': 'XMLHttpRequest',
    'request-source': 'H5',
};

interface ApiResponse<T> {
    errcode?: string;
    errmsg?: string;
    resultCode?: number | string;
    message?: string;
    data?: T;
}

export interface CircleInfo {
    id: number | string;
    name: string;
    introduction?: string;
    logo?: string;
    members?: number;
    articles?: number;
}

export interface UserInfo {
    id?: number | string;
    idStr?: string;
    userId?: number | string;
    userIdStr?: string;
    nickName?: string;
    name?: string;
    avatarUrl?: string;
    avatar?: string;
    description?: string;
    introduce?: string;
    fansCount?: number;
    followCount?: number;
}

interface ThreadListResponse {
    threadBeanList?: Thread[];
    threads?: Thread[];
    threadCount?: number;
}

interface H5BuilderPage {
    meta?: {
        elements?: H5BuilderElement[];
    };
}

interface H5BuilderElement {
    type?: string;
    props?: Record<string, unknown>;
    elements?: H5BuilderElement[];
}

export interface Thread {
    threadId?: number | string;
    threadIdStr?: string;
    id?: number | string;
    title?: string;
    subject?: string;
    description?: string;
    content?: string;
    dateline?: number | string;
    publishTime?: number | string;
    editTime?: number | string;
    threadType?: number | string;
    authorId?: number | string;
    authorIdStr?: string;
    authorInfo?: AuthorInfo;
    imgInfoList?: ImageInfo[];
    imgInfos?: ImageInfo[];
    circleInfo?: {
        circleId?: number | string;
        id?: number | string;
        name?: string;
    };
    labelInfo?: {
        labelName?: string;
        name?: string;
    };
    hashTagInfo?: {
        topicName?: string;
        topicId?: number | string;
    };
    articleCoverUrl?: string;
    coverPath?: string;
    video?: {
        videoImg?: string;
        videoUrl?: string;
    };
    source?: number | string;
}

interface AuthorInfo {
    id?: number | string;
    idStr?: string;
    userId?: number | string;
    userIdStr?: string;
    name?: string;
    nickName?: string;
    avatarUrl?: string;
    avatar?: string;
    certificationType?: string;
}

interface ImageInfo {
    imgId?: number | string;
    path?: string;
    thumbPath?: string;
    mediumPath?: string;
    normalPath?: string;
    smallPath?: string;
    url?: string;
    imgUrl?: string;
}

export const getCircleLink = (id: string) => `${webRoot}/mhw/consumer/cn/community/mhwnews/allcircle/id_${id}`;

export const getUserLink = (id: string) => `${webRoot}/mhw/consumer/cn/community/mhwnews/bluevstore/id_${id}`;

const getThreadId = (thread: Thread) => String(thread.threadIdStr ?? thread.threadId ?? thread.id ?? '');

export const getThreadLink = (thread: Thread) => {
    const id = getThreadId(thread);
    const type = Number(thread.threadType);

    if (type === 1) {
        return `${webRoot}/mhw/consumer/cn/community/mhwnews/article/id_${id}`;
    }
    if (type === 2) {
        return `${webRoot}/mhw/consumer/cn/community/mhwnews/video/id_${id}`;
    }
    if (type === 3) {
        return `${webRoot}/mhw/consumer/cn/community/mhwnews/news/id_${id}`;
    }
    if (type === 4) {
        return `${webRoot}/mhw/consumer/cn/community/mhwnews/question/id_${id}`;
    }

    return `${webRoot}/mhw/consumer/cn/community/mhwnews/thread/id_${id}`;
};

const getCsrfToken = () =>
    cache.tryGet(
        'myhuawei:csrf-token',
        async () => {
            const response = await ofetch<ApiResponse<string>>(`${apiRoot}/forward/myhuawei/uum/csrfToken/1`, {
                query: {
                    _: Date.now(),
                },
                headers: {
                    ...commonHeaders,
                    'SGW-APP-ID': listAppId,
                },
            });

            if (!response.data) {
                throw new Error('Failed to get My Huawei CSRF token');
            }

            return response.data;
        },
        30 * 60
    ) as Promise<string>;

async function request<T>(path: string, body: object, appId = defaultAppId, options?: FetchOptions<'json'>) {
    const token = await getCsrfToken();

    const response = await ofetch<ApiResponse<T>>(`${apiRoot}${path}`, {
        method: 'POST',
        body,
        ...options,
        headers: {
            ...commonHeaders,
            'SGW-APP-ID': appId,
            tCsrfToken: token ?? '',
            ...options?.headers,
        },
    });

    const code = response.errcode ?? response.resultCode;
    if (code !== undefined && String(code) !== '0') {
        throw new Error(response.errmsg ?? response.message ?? `My Huawei API error: ${code}`);
    }

    return response.data as T;
}

export const getCircleInfo = (id: string) => request<CircleInfo>(`/forward/club/circle_h5/circleInfo/1?id=${id}`, {});

export const getCircleThreads = async (id: string) => {
    const data = await request<ThreadListResponse>('/forward/club/content_h5/allPost/3', {
        circleId: id,
        circleTag: '',
        pageIndex: 1,
        pageSize: 20,
        startTime: '',
        cursor: '',
        lastThreadId: '',
    });

    return data.threadBeanList ?? [];
};

export const getUserInfo = (id: string) => request<UserInfo>('/forward/myhuawei/bffuserservice_h5/gethome_new/2', { userId: id });

export const getUserThreads = async (id: string) => {
    const data = await request<ThreadListResponse>(
        '/forward/club/content_h5/newsListByUserId/1',
        {
            site: 'zh_CN',
            userId: id,
            pageSize: 20,
            curPage: 1,
        },
        listAppId
    );

    return data.threads ?? [];
};

const getThreadDetail = (thread: Thread) =>
    cache.tryGet(`myhuawei:thread:${getThreadId(thread)}`, () =>
        request<Thread>(
            '/forward/club/content_h5/queryThreadDetail/1',
            {
                threadId: getThreadId(thread),
                pageIndex: 1,
                pageSize: 20,
                orderBy: 1,
            },
            '5881CD5912A8D0AA39AEC96F2EC2388A'
        )
    ) as Promise<Thread>;

export const buildThreadItems = (threads: Thread[]) =>
    pMap(
        threads,
        async (thread) => {
            try {
                const detail = await getThreadDetail(thread);
                return buildThreadItem(await enrichThreadContent({ ...thread, ...detail }));
            } catch {
                return buildThreadItem(await enrichThreadContent(thread));
            }
        },
        { concurrency: 3 }
    );

const cleanText = (value?: string) =>
    sanitizeHtml(value ?? '', {
        allowedTags: [],
        allowedAttributes: {},
    }).trim();

const normalizeHtml = (value?: string) =>
    sanitizeHtml(value ?? '', {
        allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img'],
        allowedAttributes: {
            ...sanitizeHtml.defaults.allowedAttributes,
            img: ['src', 'alt'],
        },
    });

const getImageUrl = (image: ImageInfo) => image.mediumPath ?? image.normalPath ?? image.thumbPath ?? image.smallPath ?? image.path ?? image.imgUrl ?? image.url;

const getImages = (thread: Thread) => (thread.imgInfoList ?? thread.imgInfos ?? []).map((image) => getImageUrl(image)).filter(Boolean) as string[];

const getAuthor = (thread: Thread) => {
    const author = thread.authorInfo;
    return author?.nickName ?? author?.name;
};

const getAuthorUrl = (thread: Thread) => {
    const author = thread.authorInfo;
    const id = author?.userIdStr ?? author?.idStr ?? author?.userId ?? author?.id ?? thread.authorIdStr ?? thread.authorId;
    return id ? getUserLink(String(id)) : undefined;
};

const getAuthorAvatar = (thread: Thread) => thread.authorInfo?.avatarUrl ?? thread.authorInfo?.avatar;

const getTitle = (thread: Thread) => cleanText(thread.title ?? thread.subject ?? thread.description ?? thread.content) || '无标题';

const replaceImagePlaceholders = (thread: Thread, content: string) => {
    let replaced = content;

    for (const image of thread.imgInfoList ?? thread.imgInfos ?? []) {
        const imageId = image.imgId;
        const imageUrl = getImageUrl(image);
        if (imageId && imageUrl) {
            replaced = replaced.replaceAll(new RegExp(`<img\\s+id=["']${imageId}["']\\s*/?>`, 'g'), `<img src="${imageUrl}" />`);
        }
    }

    return replaced;
};

const h5BuilderUrlPattern = /^https:\/\/assets-res-cn\.c\.huawei\.com\/file-html-app\/[\w-]+\/index\.html(?:[?#].*)?$/i;

const getSingleUrl = (value?: string) => {
    const text = cleanText(value);

    return /^https?:\/\/\S+$/.test(text) ? text : undefined;
};

const getH5BuilderUrl = (thread: Thread) => {
    const url = getSingleUrl(thread.content) ?? getSingleUrl(thread.description);

    return url && h5BuilderUrlPattern.test(url) ? url : undefined;
};

const extractJsonObject = (source: string, start: number) => {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < source.length; index++) {
        const character = source[index];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (character === '\\') {
                escaped = true;
            } else if (character === '"') {
                inString = false;
            }
            continue;
        }

        switch (character) {
            case '"': {
                inString = true;

                break;
            }
            case '{': {
                depth++;

                break;
            }
            case '}': {
                depth--;
                if (depth === 0) {
                    return source.slice(start, index + 1);
                }

                break;
            }
            default:
            // Do nothing
        }
    }
};

const parseH5BuilderPage = (script: string) => {
    const marker = 'return {"pageName"';
    const markerIndex = script.indexOf(marker);
    if (markerIndex === -1) {
        return;
    }

    const start = script.indexOf('{', markerIndex);
    if (start === -1) {
        return;
    }

    const json = extractJsonObject(script, start);
    return json ? (JSON.parse(json) as H5BuilderPage) : undefined;
};

const isHttpUrl = (value: unknown): value is string => typeof value === 'string' && /^https?:\/\//i.test(value);

const getStringProp = (props: Record<string, unknown>, keys: string[]) => {
    for (const key of keys) {
        const value = props[key];
        if (typeof value === 'string' && value.trim()) {
            return value;
        }
    }
};

const getNestedStringProp = (value: unknown, path: string[]): string | undefined => {
    let current = value;

    for (const key of path) {
        if (!current || typeof current !== 'object') {
            return;
        }
        current = (current as Record<string, unknown>)[key];
    }

    return typeof current === 'string' && current.trim() ? current : undefined;
};

const getH5BuilderImage = (element: H5BuilderElement) => {
    const props = element.props ?? {};

    return getNestedStringProp(props.dataSrc, ['hotArea', 'imageProps', 'src']) ?? getNestedStringProp(props.dataSrc, ['src']) ?? getStringProp(props, ['src', 'imgUrl', 'imageUrl', 'url', 'backgroundImage']);
};

const getH5BuilderText = (element: H5BuilderElement) => {
    const props = element.props ?? {};

    return getStringProp(props, ['content', 'html', 'richText', 'text', 'value', 'title']);
};

const renderH5BuilderElements = (elements: H5BuilderElement[] = []) =>
    elements
        .flatMap((element) => {
            const output: string[] = [];
            const image = getH5BuilderImage(element);
            const text = getH5BuilderText(element);

            if (isHttpUrl(image)) {
                output.push(`<p><img src="${image}" /></p>`);
            }

            if (text) {
                output.push(normalizeHtml(text));
            }

            output.push(renderH5BuilderElements(element.elements));

            return output;
        })
        .filter(Boolean)
        .join('');

const fetchH5BuilderContent = (url: string) =>
    cache.tryGet(
        `myhuawei:h5-builder:${url}`,
        async () => {
            const script = await ofetch(new URL('basicPage1.js', url).href, {
                responseType: 'text',
                headers: {
                    Referer: url,
                },
            });
            const page = parseH5BuilderPage(script);
            const content = renderH5BuilderElements(page?.meta?.elements);

            if (!content) {
                throw new Error('Failed to extract My Huawei H5 builder content');
            }

            return renderToString(
                <>
                    <div dangerouslySetInnerHTML={{ __html: content }} />
                    <p>
                        <a href={url}>原文链接</a>
                    </p>
                </>
            );
        },
        24 * 60 * 60
    ) as Promise<string>;

const enrichThreadContent = async (thread: Thread) => {
    const url = getH5BuilderUrl(thread);
    if (!url) {
        return thread;
    }

    try {
        return {
            ...thread,
            content: await fetchH5BuilderContent(url),
        };
    } catch {
        return thread;
    }
};

const getDescription = (thread: Thread) => normalizeHtml(replaceImagePlaceholders(thread, thread.content ?? thread.description ?? thread.subject ?? thread.title ?? ''));

const getCategories = (thread: Thread) => [thread.circleInfo?.name, thread.labelInfo?.labelName ?? thread.labelInfo?.name, thread.hashTagInfo?.topicName].filter(Boolean) as string[];

const getImage = (thread: Thread) => thread.articleCoverUrl ?? thread.coverPath ?? thread.video?.videoImg ?? getImages(thread)[0];

export const buildThreadItem = (thread: Thread): DataItem => ({
    title: getTitle(thread),
    link: getThreadLink(thread),
    guid: getThreadId(thread),
    pubDate: parseDate(Number(thread.dateline ?? thread.publishTime ?? thread.editTime)),
    updated: thread.editTime ? parseDate(Number(thread.editTime)) : undefined,
    author: getAuthor(thread)
        ? [
              {
                  name: getAuthor(thread)!,
                  url: getAuthorUrl(thread),
                  avatar: getAuthorAvatar(thread),
              },
          ]
        : undefined,
    category: getCategories(thread),
    image: getImage(thread),
    description: renderDescription(thread),
});

const renderDescription = (thread: Thread) => {
    const content = getDescription(thread);
    const images = /<img\b/i.test(content) ? [] : getImages(thread);

    return renderToString(<ThreadDescription content={content} images={images} videoUrl={thread.video?.videoUrl} />);
};

const ThreadDescription = ({ content, images, videoUrl }: { content: string; images: string[]; videoUrl?: string }) => (
    <>
        {content ? <div dangerouslySetInnerHTML={{ __html: content.replaceAll('\n', '<br>') }} /> : null}
        {images.map((image) => (
            <img src={image} />
        ))}
        {videoUrl ? (
            <p>
                <a href={videoUrl}>视频链接</a>
            </p>
        ) : null}
    </>
);
