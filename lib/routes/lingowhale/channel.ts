import type { Cheerio } from 'cheerio';
import { load } from 'cheerio';
import type { Element } from 'domhandler';
import pMap from 'p-map';

import InvalidParameterError from '@/errors/types/invalid-parameter';
import type { Data, DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { getRouteLimit } from '@/utils/route-limit';
import { parseDate } from '@/utils/time';

import { apiUrl, baseUrl, fetchEntries, getHeaders } from './utils';

const feedApiUrl = `${apiUrl}/feed/subscription`;
const detailApiUrl = `${apiUrl}/entry_detail/get`;
const removableMetadataAttrs = ['position_id', 'data-pm-slice', 'data-deeplang-h1', 'data-deeplang-h2', 'data-deeplang-h3', 'data-deeplang-legend', 'data-deeplang-intro'];
const removableCommonAttrs = ['class', 'id', 'leaf', 'contenteditable', 'tabindex', 'subtree'];

type LingowhaleApiResponse<T> = {
    code: number;
    msg: string;
    data: T;
};

type LingowhaleChannel = {
    channel_id: string;
    name: string;
    description?: string;
    surface_url?: string | { url?: string };
};

type LingowhaleInfoSource = {
    info_source_name?: string;
};

type LingowhaleFeedItem = {
    entry_id: string;
    entry_type: number;
    title: string;
    pub_time?: number;
    surface_url?: string | { url?: string };
    description?: string;
    abstract?: string;
    channel?: LingowhaleChannel;
    info_source?: LingowhaleInfoSource;
};

type LingowhaleFeedListData = {
    feed_list: LingowhaleFeedItem[];
    cursor?: string;
    has_more?: boolean;
};

type LingowhaleAuthor = {
    name?: string;
};

type LingowhaleResource = {
    entry_id: string;
    entry_type: number;
    orig_url?: string;
    title?: string;
    pub_time?: number;
    description?: string;
    abstract?: string;
    html?: string;
    surface_url?: string | { url?: string };
    author?: LingowhaleAuthor;
    multimedia?: { surface_img?: string };
};

type LingowhaleEntryDetailData = {
    resource?: LingowhaleResource;
};

type LinkMode = 'original' | 'render';

export const route: Route = {
    path: '/channel/:id/:linkMode?',
    name: '频道',
    url: 'lingowhale.com',
    categories: ['new-media'],
    example: '/lingowhale/channel/67cc08a19a4297b6148b297e',
    parameters: {
        id: '语鲸频道 ID，可从频道网页 URL 中的 channel_id 参数获取。',
        linkMode: {
            description: '网页文章的链接目标，默认保留语鲸阅读页；original 使用原文链接。',
            default: 'render',
            options: [
                { label: '语鲸阅读页', value: 'render' },
                { label: '原文链接', value: 'original' },
            ],
        },
    },
    maintainers: ['ZHA30'],
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    radar: [{ source: ['lingowhale.com/channels'] }],
    description: '通过公开详情接口补全并清理网页文章正文。使用 `/lingowhale/channel/频道ID/original` 将网页文章链接指向原文，未提供原文链接时使用语鲸阅读页。PDF 与 AI 摘要沿用语鲸内容类型对应的处理方式。',
    handler,
};

const getLinkMode = (mode = 'render'): LinkMode => {
    if (mode !== 'render' && mode !== 'original') {
        throw new InvalidParameterError('Unsupported link mode. Use render or original.');
    }
    return mode;
};

const getSurfaceUrl = (surfaceUrl?: string | { url?: string }) => (typeof surfaceUrl === 'string' ? surfaceUrl : surfaceUrl?.url);

const isExternalHtmlArchive = (value?: string) => typeof value === 'string' && /^https?:\/\/\S+\.html\.gz(?:[?#]\S*)?$/i.test(value.trim());

const stripColorStyles = (style?: string) => {
    if (!style) {
        return;
    }

    const kept = style
        .split(';')
        .map((declaration) => declaration.trim())
        .filter(Boolean)
        .filter((declaration) => {
            const [property] = declaration.split(':', 1);
            const key = property?.trim().toLowerCase();

            return key !== 'color' && key !== 'background-color';
        });

    return kept.length > 0 ? kept.join('; ') : undefined;
};

const removeAttrs = ($node: Cheerio<Element>, attrs: string[]) => {
    for (const attr of attrs) {
        $node.removeAttr(attr);
    }
};

const extractDescription = (html?: string, fallback?: string) => {
    if (!html) {
        return fallback;
    }

    const $ = load(html);
    const articleRoot: Cheerio<Element> = $('body').length ? $('body') : $('html');

    articleRoot.find('script, style, noscript, meta, title, link, head').remove();
    articleRoot.find('dplv-pos-group').each((_, element) => {
        $(element).replaceWith($(element).contents());
    });
    articleRoot.find('dplv-pos').each((_, element) => {
        $(element).replaceWith($(element).contents());
    });
    articleRoot.find('*').each((_, element) => {
        const node = $(element);

        removeAttrs(node, removableMetadataAttrs);
        removeAttrs(node, removableCommonAttrs);

        if (element.tagName === 'img') {
            node.removeAttr('referrerpolicy');
        }

        const style = stripColorStyles(node.attr('style'));
        if (style) {
            node.attr('style', style);
        } else {
            node.removeAttr('style');
        }

        const attributes = Object.entries(node.attr() ?? {});
        for (const [name, value] of attributes) {
            if (name.startsWith('on')) {
                node.removeAttr(name);
                continue;
            }

            if ((name === 'href' || name === 'src') && typeof value === 'string' && value.trim().toLowerCase().startsWith('javascript:')) {
                node.removeAttr(name);
            }
        }
    });
    articleRoot.find('div, section, p, span').each((_, element) => {
        const node = $(element);
        const hasMeaningfulText = node.text().replaceAll('\u{A0}', ' ').trim().length > 0;
        if (!hasMeaningfulText && node.find('img, video, audio, iframe').length === 0 && node.children().length === 0) {
            node.remove();
        }
    });

    const bodyHtml = articleRoot.html()?.trim();

    if (!bodyHtml) {
        return fallback;
    }

    return bodyHtml.replaceAll(/\sreferrerpolicy="[^"]*"/g, '');
};

const getDescription = (detail: LingowhaleResource, entry: LingowhaleFeedItem) => {
    const fallback = detail.description || detail.abstract || entry.abstract || entry.description;
    const description = extractDescription(detail.html, fallback);

    if (isExternalHtmlArchive(description)) {
        return isExternalHtmlArchive(fallback) ? undefined : fallback;
    }

    return description;
};

const fetchEntryDetail = async (entryId: string, entryType: number) => {
    const response = await ofetch<LingowhaleApiResponse<LingowhaleEntryDetailData>>(detailApiUrl, {
        method: 'POST',
        body: {
            entry_id: entryId,
            entry_type: entryType,
        },
    });

    if (response.code !== 0 || !response.data?.resource) {
        throw new Error(response.msg || `Lingowhale entry detail request failed for ${entryId}`);
    }

    return response.data.resource;
};

async function handler(ctx): Promise<Data> {
    const channelId = ctx.req.param('id');
    const limit = getRouteLimit(ctx, 20);
    const linkMode = getLinkMode(ctx.req.param('linkMode'));

    const [channel, feedResponse] = await Promise.all([
        cache.tryGet(`lingowhale:channel:${channelId}`, async () => {
            const response = await ofetch<LingowhaleApiResponse<{ subscription_channel: LingowhaleChannel }>>(`${apiUrl}/subscription_channel/get`, {
                method: 'POST',
                body: { channel_id: channelId },
            });
            if (response.code !== 0 || !response.data?.subscription_channel) {
                throw new Error(response.msg || `Lingowhale channel request failed for ${channelId}`);
            }
            return response.data.subscription_channel;
        }),
        ofetch<LingowhaleApiResponse<LingowhaleFeedListData>>(feedApiUrl, {
            method: 'POST',
            body: {
                cursor: '',
                limit,
                channel_ids: [channelId],
            },
            headers: getHeaders(),
        }),
    ]);

    if (feedResponse.code !== 0) {
        throw new Error(feedResponse.msg || `Lingowhale feed request failed for channel ${channelId}`);
    }

    const feedList = feedResponse.data?.feed_list ?? [];

    const items: DataItem[] = await pMap(
        feedList.slice(0, limit),
        async (entry) => {
            if (entry.entry_type !== 7) {
                const [item] = await fetchEntries([entry]);
                return item;
            }
            const detail = await cache.tryGet(`lingowhale:channel-entry:v1:${entry.entry_id}`, () => fetchEntryDetail(entry.entry_id, entry.entry_type));
            const rid = detail.entry_id || entry.entry_id;
            const renderUrl = `${baseUrl}/reader/web/${rid}`;
            const originalUrl = detail.orig_url || renderUrl;
            const pubTime = detail.pub_time ?? entry.pub_time;

            return {
                title: detail.title || entry.title,
                link: linkMode === 'render' ? renderUrl : originalUrl,
                guid: renderUrl,
                pubDate: pubTime ? parseDate(pubTime, 'X') : undefined,
                author: detail.author?.name || entry.info_source?.info_source_name,
                description: getDescription(detail, entry),
                image: detail.multimedia?.surface_img || getSurfaceUrl(detail.surface_url) || getSurfaceUrl(entry.surface_url),
                category: entry.channel ? [`${entry.channel.name} (channel:${entry.channel.channel_id})`] : undefined,
            };
        },
        { concurrency: 3 }
    );

    return {
        title: `${channel.name} - 语鲸`,
        description: channel.description,
        link: `${baseUrl}/channels?channel_id=${channelId}`,
        image: getSurfaceUrl(channel.surface_url),
        language: 'zh-CN',
        item: items,
    };
}
