import type { Cheerio } from 'cheerio';
import { load } from 'cheerio';
import type { Element } from 'domhandler';

import type { Data, DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';

const feedApiUrl = 'https://api-public.lingowhale.com/api/lingowhale/v1/feed/subscription';
const detailApiUrl = 'https://api-public.lingowhale.com/api/lingowhale/v1/entry_detail/get';
const webBaseUrl = 'https://lingowhale.com';
const defaultLimit = 10;
const maxLimit = 50;
const entryCacheVersion = 'v2';
const removableMetadataAttrs = ['position_id', 'data-pm-slice', 'data-deeplang-h1', 'data-deeplang-h2', 'data-deeplang-h3', 'data-deeplang-legend', 'data-deeplang-intro'];
const removableCommonAttrs = ['class', 'id', 'leaf', 'contenteditable', 'tabindex', 'subtree'];

type LingowhaleApiResponse<T> = {
    code: number;
    msg: string;
    data: T;
};

type LingowhaleChannel = {
    channel_id: string;
    name?: string;
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
};

type LingowhaleEntryDetailData = {
    resource?: LingowhaleResource;
};

export const route: Route = {
    path: '/channel/:channelId',
    name: '频道全文',
    url: 'lingowhale.com',
    categories: ['reading'],
    example: '/lingowhale/channel/67f72af31f4459172981b3ea',
    parameters: {
        channelId: '语鲸频道 ID，可从语鲸网页请求参数或频道数据中获取。',
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
    description: '通过语鲸公开频道接口抓取频道内容，并用公开详情接口补全文章正文。',
    handler,
};

const clampLimit = (limit?: string) => {
    const parsed = Number.parseInt(limit ?? '', 10);

    if (Number.isNaN(parsed) || parsed <= 0) {
        return defaultLimit;
    }

    return Math.min(parsed, maxLimit);
};

const getFeedHeaders = () => ({
    'content-type': 'application/json',
    imei: 'fingerPrint-web',
});

const getSurfaceUrl = (surfaceUrl?: string | { url?: string }) => (typeof surfaceUrl === 'string' ? surfaceUrl : surfaceUrl?.url);

const stripColorStyles = (style?: string) => {
    if (!style) {
        return;
    }

    const kept = style
        .split(';')
        .map((declaration) => declaration.trim())
        .filter(Boolean)
        .filter((declaration) => {
            const [property] = declaration.split(':');
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

        for (const [name, value] of Object.entries(node.attr() ?? {})) {
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
        const hasMeaningfulText = node.text().replaceAll('\u00A0', ' ').trim().length > 0;
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

const fetchEntryDetail = async (entryId: string, entryType: number) => {
    const response = await ofetch<LingowhaleApiResponse<LingowhaleEntryDetailData>>(detailApiUrl, {
        method: 'POST',
        query: {
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
    const channelId = ctx.req.param('channelId');
    const limit = clampLimit(ctx.req.query('limit'));

    const feedResponse = await ofetch<LingowhaleApiResponse<LingowhaleFeedListData>>(feedApiUrl, {
        method: 'POST',
        body: {
            cursor: '',
            limit,
            channel_ids: [channelId],
        },
        headers: getFeedHeaders(),
    });

    if (feedResponse.code !== 0) {
        throw new Error(feedResponse.msg || `Lingowhale feed request failed for channel ${channelId}`);
    }

    const feedList = feedResponse.data?.feed_list ?? [];
    const firstChannel = feedList[0]?.channel;

    const items: DataItem[] = await Promise.all(
        feedList.slice(0, limit).map((entry) =>
            cache.tryGet(`lingowhale:entry:${entryCacheVersion}:${entry.entry_id}`, async () => {
                const detail = await fetchEntryDetail(entry.entry_id, entry.entry_type);

                return {
                    title: detail.title || entry.title,
                    link: detail.orig_url || webBaseUrl,
                    guid: detail.entry_id || entry.entry_id,
                    pubDate: new Date(((detail.pub_time ?? entry.pub_time) || 0) * 1000),
                    author: detail.author?.name || entry.info_source?.info_source_name,
                    description: extractDescription(detail.html, detail.description || detail.abstract || entry.abstract || entry.description),
                    image: getSurfaceUrl(detail.surface_url) || getSurfaceUrl(entry.surface_url),
                };
            })
        )
    );

    return {
        title: firstChannel?.name || channelId,
        description: firstChannel?.description,
        link: `${webBaseUrl}/channels?channel_id=${channelId}`,
        image: getSurfaceUrl(firstChannel?.surface_url),
        language: 'zh-CN',
        item: items,
    };
}
