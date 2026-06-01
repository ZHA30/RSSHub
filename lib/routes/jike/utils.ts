import { load } from 'cheerio';

import { config } from '@/config';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';

const videoAPI = 'https://api.ruguoapp.com/1.0/mediaMeta/play?type=ORIGINAL_POST';
const refreshTokenAPI = 'https://api.ruguoapp.com/app_auth_tokens.refresh';
const topicDetailAPI = 'https://api.ruguoapp.com/1.0/topics/getDetail';
const topicFeedAPI = 'https://api.ruguoapp.com/1.0/topics/tabs/square/feed';
const defaultTopicLimit = 30;
const maxTopicLimit = 100;

const pickImageUrl = (image?: { picUrl?: string; middlePicUrl?: string; thumbnailUrl?: string; pictureUrl?: string }) => image?.picUrl || image?.middlePicUrl || image?.thumbnailUrl || image?.pictureUrl;

const normalizePictureUrl = (url?: string, format?: string) => {
    if (!url) {
        return;
    }

    if (format === 'gif') {
        return url.split('?imageMogr2/')[0];
    }

    return /\.[\da-z]+?\?imageMogr2/i.test(url) ? url.split('?imageMogr2/')[0] : url.replace(/thumbnail\/.+/, '');
};

type TopicData = {
    topic: any;
    posts: any[];
    result?: any;
};

type TopicDataOrEmpty = TopicData | { title: string };

const isNonEmptyString = (value?: string) => typeof value === 'string' && value.trim().length > 0;

const pickFirstString = (...values: Array<string | undefined>) => values.find((value) => isNonEmptyString(value));

const pickTopicImage = (...topics: Array<{ squarePicture?: { picUrl?: string; middlePicUrl?: string; thumbnailUrl?: string; pictureUrl?: string } } | undefined>) => {
    for (const topic of topics) {
        const image = pickImageUrl(topic?.squarePicture);
        if (image) {
            return image;
        }
    }
};

const getTopicFallbackFromPosts = (posts: any[] = [], topicId?: string) => {
    for (const item of posts) {
        for (const candidate of [item?.topic, item?.target?.topic]) {
            if (!candidate) {
                continue;
            }

            if (!topicId || candidate.id === topicId || candidate.topic?.id === topicId) {
                return candidate;
            }
        }
    }
};

const normalizeTopicMetadata = (topic?: any, posts: any[] = []) => {
    const fallbackTopic = getTopicFallbackFromPosts(posts, topic?.id);
    const normalizedTopic = topic?.topic;
    const normalizedFallbackTopic = fallbackTopic?.topic;

    return {
        displayName:
            pickFirstString(
                topic?.content,
                topic?.title,
                topic?.name,
                normalizedTopic?.content,
                normalizedTopic?.title,
                normalizedTopic?.name,
                fallbackTopic?.content,
                fallbackTopic?.title,
                fallbackTopic?.name,
                normalizedFallbackTopic?.content,
                normalizedFallbackTopic?.title,
                normalizedFallbackTopic?.name,
                topic?.id,
                fallbackTopic?.id
            ) || '未知圈子',
        description: pickFirstString(
            topic?.briefIntro,
            topic?.description,
            normalizedTopic?.briefIntro,
            normalizedTopic?.description,
            fallbackTopic?.briefIntro,
            fallbackTopic?.description,
            normalizedFallbackTopic?.briefIntro,
            normalizedFallbackTopic?.description
        ),
        image: pickTopicImage(topic, normalizedTopic, fallbackTopic, normalizedFallbackTopic),
    };
};

const getTopicDisplayName = (topic?: { content?: string; title?: string; name?: string; id?: string }, posts: any[] = []) => normalizeTopicMetadata(topic, posts).displayName;

const dedupeTopicPosts = (posts) => {
    const seen = new Set<string>();

    return posts.filter((item) => {
        const key = item.id || item.url || item.linkInfo?.linkUrl || item.linkInfo?.originalLinkUrl;

        if (!key || seen.has(key)) {
            return false;
        }

        seen.add(key);
        return true;
    });
};

const getDefaultTopicLimit = () => {
    const value = defaultTopicLimit;
    const limit = Number.parseInt(String(value ?? ''), 10);
    if (Number.isNaN(limit) || limit <= 0) {
        return defaultTopicLimit;
    }
    return Math.min(limit, maxTopicLimit);
};

const enrichTopicPosts = (posts) =>
    Promise.all(
        posts.map(async (item) => {
            if (!item.video) {
                return item;
            }

            const videoUrl = `${videoAPI}&id=${item.id}`;
            const videoRes = await got(videoUrl);
            item.video = videoRes.data;

            return item;
        })
    );

const getJikeAccessToken = () => {
    if (!config.jike?.refreshToken) {
        return;
    }

    const cacheKey = `jike:access-token:${config.jike.refreshToken}`;
    return cache.tryGet(
        cacheKey,
        async () => {
            const { data } = await got.post(refreshTokenAPI, {
                headers: {
                    'x-jike-refresh-token': config.jike.refreshToken,
                },
            });
            return data['x-jike-access-token'];
        },
        60 * 60,
        false
    );
};

const fetchTopicFromPage = async (url, limit: number): Promise<TopicData> => {
    const resp = await got(url);
    const $ = load(resp.data);
    const raw = $('[type = "application/json"]').html();
    const data = JSON.parse(raw ?? '{}').props.pageProps;
    data.posts = await enrichTopicPosts(dedupeTopicPosts(data.posts).slice(0, limit));
    return data;
};

const fetchTopicWithAuth = async (id: string, limit: number): Promise<TopicData | undefined> => {
    const accessToken = await getJikeAccessToken();
    if (!accessToken) {
        return;
    }

    const headers = {
        'x-jike-access-token': accessToken,
    };

    const topic = await cache.tryGet(
        `jike:topic-detail:${id}`,
        async () => {
            const { data } = await got(topicDetailAPI, {
                headers,
                searchParams: {
                    id,
                },
            });
            return data;
        },
        config.cache.routeExpire,
        false
    );

    const posts: any[] = [];
    let loadMoreKey;
    let lastSerializedLoadMoreKey;

    while (dedupeTopicPosts(posts).length < limit) {
        const previousUniqueCount = dedupeTopicPosts(posts).length;
        // Pagination depends on the previous page's loadMoreKey, so requests must stay sequential.
        // oxlint-disable-next-line no-await-in-loop
        const { data } = await got.post(topicFeedAPI, {
            headers,
            json: {
                topicId: id,
                limit: 25,
                ...(loadMoreKey ? { loadMoreKey } : {}),
            },
        });

        if (!Array.isArray(data.data) || data.data.length === 0) {
            break;
        }

        posts.push(...data.data);

        const nextSerializedLoadMoreKey = data.loadMoreKey ? JSON.stringify(data.loadMoreKey) : undefined;
        const uniqueCount = dedupeTopicPosts(posts).length;

        if (!data.loadMoreKey) {
            break;
        }

        if (uniqueCount === previousUniqueCount || nextSerializedLoadMoreKey === lastSerializedLoadMoreKey) {
            break;
        }

        lastSerializedLoadMoreKey = nextSerializedLoadMoreKey;
        loadMoreKey = data.loadMoreKey;
    }

    return {
        topic,
        posts: await enrichTopicPosts(dedupeTopicPosts(posts).slice(0, limit)),
    };
};

const topicDataHanding = (data, showUid = false) =>
    data.posts
        .map((item) => {
            let audioName, videoName, linkName;

            let content = item.content || item.title || item.linkInfo?.title || '';
            let link = item.url;
            switch (item.type) {
                case 'ORIGINAL_POST':
                    content = item.content || content;
                    link = `https://m.okjike.com/originalPosts/${item.id}`;
                    break;
                default:
                    link = link || (item.id ? `https://m.okjike.com/originalPosts/${item.id}` : undefined);
            }

            let description = '';
            const author = item.user?.screenName ?? '';

            if (item.user && showUid) {
                description += `<span>用户昵称：${author} <br> Username：${item.user.username}</span><br>`;
            }

            if (item.linkInfo) {
                const linkUrl = item.linkInfo.originalLinkUrl || item.linkInfo.linkUrl;

                if (new URL(linkUrl).host === 'mp.weixin.qq.com') {
                    link = linkUrl;
                }

                const audioObject = item.linkInfo.audio || item.audio;
                if (audioObject) {
                    const audioImage = pickImageUrl(audioObject.image);
                    const audioLink = linkUrl;
                    const audioTitle = audioObject.title;
                    const audioAuthor = audioObject.author;
                    audioName = `${audioTitle} - ${audioAuthor}`;
                    description += `
            ${audioImage ? `<img src="${audioImage}">` : ''}
            <a href="${audioLink}">${audioName}</a>
        `;
                }

                const videoObject = item.linkInfo.video || item.video;
                if (videoObject) {
                    const videoImage = pickImageUrl(videoObject.image);
                    const videoLink = linkUrl;
                    const videoDuration = Math.floor(videoObject.duration / 60000);
                    videoName = item.linkInfo.title;
                    description += `
            ${videoImage ? `<img src="${videoImage}">` : ''}
            <a href="${videoLink}">${videoName || '观看视频'} - 约${videoDuration}分钟</a>
        `;
                }

                if (!audioObject && !videoObject && linkUrl) {
                    linkName = item.linkInfo.title;
                    const linkTitle = linkName || '访问原文';
                    const linkImage = item.linkInfo.pictureUrl;
                    const imageTag = `<img src="${linkImage}">`;
                    description += `
            ${linkImage ? imageTag : ''}
            <a href="${linkUrl}">${linkTitle}</a>
        `;
                }
            }

            if (content) {
                description += description ? `<br>${content}` : content;
            }

            if (item.pictures) {
                for (const pic of item.pictures) {
                    const imgUrl = normalizePictureUrl(pic.picUrl, pic.format);

                    if (imgUrl) {
                        description += `<br><img src="${imgUrl}">`;
                    }
                }
            }

            if (item.video) {
                description += `<br><video src="${item.video.url}" controls></video>`;
            }

            const title = audioName || videoName || content || linkName;

            if (!title && !description && !link) {
                return;
            }

            return {
                title: title || '无题',
                description: description.trim().replaceAll('\n', '<br>'),
                pubDate: parseDate(item.createdAt),
                author,
                link: link || data.result.link,
            };
        })
        .filter(Boolean);

const constructTopicEntry = async (ctx, url): Promise<TopicDataOrEmpty> => {
    const id = ctx.req.param('id');
    const itemLimit = getDefaultTopicLimit();
    const useAuth = Boolean(config.jike?.refreshToken);
    const cacheKey = useAuth ? `jike:topic:${id}:${itemLimit}` : `${url}:${itemLimit}`;

    const data = await cache.tryGet(
        cacheKey,
        async () => {
            if (useAuth) {
                try {
                    const authData = await fetchTopicWithAuth(id, itemLimit);
                    if (authData) {
                        return authData;
                    }
                } catch {
                    // Fall back to page scraping when auth pagination is temporarily blocked.
                }
            }

            return fetchTopicFromPage(url, itemLimit);
        },
        config.cache.routeExpire,
        false
    );

    if (!data?.posts?.length) {
        return {
            title: '主题 ID 不存在，或该主题暂无内容',
        };
    }

    const topic = data.topic;
    const topicMetadata = normalizeTopicMetadata(topic, data.posts);
    const topicDisplayName = topicMetadata.displayName;

    data.result = {
        title: `${topicDisplayName} - 即刻圈子`,
        link: url,
        description: topicMetadata.description,
        image: topicMetadata.image,
    };

    return data;
};

export { constructTopicEntry, getTopicDisplayName, topicDataHanding };
