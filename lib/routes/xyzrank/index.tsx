import { load } from 'cheerio';
import { renderToString } from 'hono/jsx/dom/server';
import pMap from 'p-map';

import InvalidParameterError from '@/errors/types/invalid-parameter';
import type { Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';

const rootUrl = 'https://xyzrank.com';

const categories = {
    '': {
        apiPath: '/api/episodes',
        title: '热门节目',
        type: 'episodes',
    },
    'hot-podcasts': {
        apiPath: '/api/podcasts',
        title: '热门播客',
        type: 'podcasts',
    },
    'hot-episodes-new': {
        apiPath: '/api/new-episodes',
        title: '新锐节目',
        type: 'episodes',
    },
    'new-podcasts': {
        apiPath: '/api/new-podcasts',
        title: '新锐播客',
        type: 'podcasts',
    },
};

interface XyzrankItem {
    rank?: number;
    title?: string;
    name?: string;
    primaryGenreName?: string;
    authorsText?: string;
    link?: string;
    links?: Array<{
        url?: string;
    }>;
    trackCount?: number;
    postTime?: string;
    lastReleaseDate?: string;
    logoURL?: string;
    duration?: number;
    podcastName?: string;
    playCount?: number;
    commentCount?: number;
    openRate?: number;
    avgUpdateFreq?: number;
    lastReleaseDateDayCount?: number;
    avgDuration?: number;
    avgPlayCount?: number;
    avgCommentCount?: number;
    avgInteractIndicator?: number;
    avgOpenRate?: number;
}

interface XyzrankResponse {
    items: XyzrankItem[];
}

const getAudioType = (audioUrl: string) => {
    const extension = new URL(audioUrl).pathname.split('.').pop();

    return extension ? `audio/${extension === 'm4a' ? 'mp4' : extension}` : undefined;
};

const getEpisodeAudio = async (link?: string) => {
    if (!link || !link.startsWith('https://www.xiaoyuzhoufm.com/episode/')) {
        return;
    }

    return await cache.tryGet<Record<string, string | undefined>>(`xyzrank:episode-audio:${link}`, async () => {
        const response = await got(link);
        const $ = load(response.data);
        const audioUrl = $('meta[property="og:audio"]').attr('content');

        return audioUrl
            ? {
                  enclosure_url: audioUrl,
                  enclosure_type: getAudioType(audioUrl),
              }
            : {};
    });
};

const formatNumber = (value: number | undefined, formatter: (value: number) => string) => (typeof value === 'number' ? formatter(value) : undefined);

export const route: Route = {
    path: '/:category?',
    example: '/xyzrank/hot-podcasts',
    radar: [
        {
            source: ['xyzrank.com/'],
            target: '',
        },
    ],
    parameters: {
        category: '榜单分类，可选 `hot-podcasts`、`hot-episodes-new`、`new-podcasts`，默认为热门节目',
    },
    features: {
        supportPodcast: true,
    },
    name: '榜单',
    maintainers: ['ZHA30'],
    handler,
    url: 'xyzrank.com/',
};

async function handler(ctx) {
    const category = ctx.req.param('category') ?? '';
    const currentUrl = `${rootUrl}/#/${category}`;
    const categoryInfo = categories[category];

    if (!categoryInfo) {
        throw new InvalidParameterError(`Invalid category: ${category}`);
    }

    const limit = Number.parseInt(ctx.req.query('limit') ?? '250', 10) || 250;

    const response = await got({
        method: 'get',
        url: rootUrl,
    });

    const $ = load(response.data);

    const dataResponse = await got({
        method: 'get',
        url: new URL(categoryInfo.apiPath, rootUrl).href,
        searchParams: {
            offset: 0,
            limit,
        },
    });

    const type = categoryInfo.type;

    const items = await pMap(
        (dataResponse.data as XyzrankResponse).items,
        async (item, index) => {
            const rank = item.rank ?? index + 1;
            const link = item.link ?? item.links?.[0]?.url;
            const audio = type === 'episodes' ? await getEpisodeAudio(link) : undefined;

            return {
                title: `#${rank} ${item.title ?? item.name}`,
                category: item.primaryGenreName ? [item.primaryGenreName] : undefined,
                author: item.authorsText,
                link: link ? `${link}${item.trackCount ? `#${item.trackCount}` : ''}` : undefined,
                pubDate: item.postTime || item.lastReleaseDate ? parseDate(item.postTime ?? item.lastReleaseDate!) : undefined,
                enclosure_url: audio?.enclosure_url,
                enclosure_type: audio?.enclosure_type,
                itunes_duration: type === 'episodes' && typeof item.duration === 'number' ? item.duration * 60 : undefined,
                itunes_item_image: item.logoURL,
                description: renderToString(
                    <>
                        {item.logoURL ? <img src={item.logoURL} /> : undefined}
                        <table>
                            {Object.entries(
                                type === 'podcasts'
                                    ? {
                                          '#': rank,
                                          播客电台: item.name,
                                          主持: item.authorsText,
                                          分类: item.primaryGenreName,
                                          更新频率: formatNumber(item.avgUpdateFreq, (value) => `${(value / 24).toFixed(1)}天`),
                                          最近更新: formatNumber(item.lastReleaseDateDayCount, (value) => `${value.toFixed(1)}天前`),
                                          总集数: item.trackCount,
                                          平均时长: `${item.avgDuration}′`,
                                          平均播放量: item.avgPlayCount,
                                          平均评论量: item.avgCommentCount,
                                          千播互动量: formatNumber(item.avgInteractIndicator, (value) => (value * 1000).toFixed(0)),
                                          平均打开率: formatNumber(item.avgOpenRate, (value) => `${(value * 100).toFixed(1)}%`),
                                          小宇宙: item.links?.[0]?.url,
                                          'Apple Podcasts': item.links?.[1]?.url,
                                          官方网站: item.links?.[2]?.url,
                                          'RSS 订阅': item.links?.[3]?.url,
                                      }
                                    : {
                                          '#': rank,
                                          节目标题: item.title,
                                          播客电台: item.podcastName,
                                          播放量: item.playCount,
                                          评论量: item.commentCount,
                                          互动率: typeof item.commentCount === 'number' && typeof item.playCount === 'number' && item.playCount > 0 ? `${((item.commentCount / item.playCount) * 100).toFixed(1)}%` : undefined,
                                          打开率: formatNumber(item.openRate, (value) => `${(value * 100).toFixed(1)}%`),
                                          时长: `${item.duration}′`,
                                          发布时间: item.postTime,
                                          分类: item.primaryGenreName,
                                          链接: item.link,
                                      }
                            ).map(([label, value]) =>
                                value ? (
                                    <tr>
                                        <td>
                                            <b>{label}</b>
                                        </td>
                                        <td>{value}</td>
                                    </tr>
                                ) : undefined
                            )}
                        </table>
                    </>
                ),
            };
        },
        { concurrency: 5 }
    );

    return {
        title: `${$('title').text()} - ${categoryInfo.title}`,
        link: currentUrl,
        item: items,
        description: $('meta[property="og:description"]').attr('content'),
    };
}
