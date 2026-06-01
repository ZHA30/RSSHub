import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

export const rootUrl = 'https://n.novelia.cc';

export const defaultNovelProviders = 'kakuyomu,syosetu,novelup,hameln,pixiv,alphapolis';

export interface NovelListItem {
    providerId: string;
    novelId: string;
    titleJp: string;
    titleZh?: string;
    type?: string;
    attentions?: string[];
    keywords?: string[];
    total?: number;
    jp?: number;
    baidu?: number;
    youdao?: number;
    gpt?: number;
    sakura?: number;
    updateAt?: number;
}

export interface NovelListResponse {
    items: NovelListItem[];
    pageNumber?: number;
}

export interface NovelDetailResponse {
    titleJp: string;
    titleZh?: string;
    authors?: string[];
    type?: string;
    attentions?: string[];
    keywords?: string[];
    points?: number;
    totalCharacters?: number;
    introductionJp?: string;
    introductionZh?: string;
    visited?: number;
    syncAt?: number;
    jp?: number;
    baidu?: number;
    youdao?: number;
    gpt?: number;
    sakura?: number;
}

export interface ArticleListItem {
    id: string;
    title: string;
    category?: string;
    locked?: boolean;
    pinned?: boolean;
    hidden?: boolean;
    numViews?: number;
    numComments?: number;
    user?: {
        username?: string;
    };
    createAt?: number;
    updateAt?: number;
}

export interface ArticleListResponse {
    items: ArticleListItem[];
    pageNumber?: number;
}

export interface ArticleDetailResponse extends ArticleListItem {
    content?: string;
}

export const unixDate = (timestamp?: number) => (timestamp ? parseDate(timestamp * 1000) : undefined);

export const displayTitle = (titleJp?: string, titleZh?: string) => (titleZh && titleZh !== titleJp ? `${titleZh} / ${titleJp}` : (titleZh ?? titleJp ?? ''));

const tenThousand = 10000;
const oneHour = 3600;
const oneDay = 86400;
const oneMonth = 2_592_000;
const oneYear = 31_536_000;

export const formatNumber = (value: number) => (value >= tenThousand ? `${(value / tenThousand).toFixed(1).replace(/\.0$/, '')}万` : String(value));

export const relativeDate = (timestamp?: number) => {
    if (!timestamp) {
        return;
    }

    const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
    if (seconds < 60) {
        return '刚刚';
    }
    if (seconds < oneHour) {
        return `${Math.floor(seconds / 60)} 分钟前`;
    }
    if (seconds < oneDay) {
        return `${Math.floor(seconds / oneHour)} 小时前`;
    }
    if (seconds < oneMonth) {
        return `${Math.floor(seconds / oneDay)} 天前`;
    }
    if (seconds < oneYear) {
        return `${Math.floor(seconds / oneMonth)} 个月前`;
    }
    return `${Math.floor(seconds / oneYear)} 年前`;
};

const htmlEscape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

export const markdownToHtml = (content = '') =>
    htmlEscape(content)
        .replaceAll(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replaceAll(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
        .replaceAll('\n', '<br>');

export async function fetchApi<T>(path: string): Promise<T> {
    return await ofetch<T>(`${rootUrl}${path}`, {
        headers: {
            accept: 'application/json',
        },
    });
}
