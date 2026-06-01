import { load } from 'cheerio';

import type { DataItem } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

export const rootUrl = 'https://jandan.net';

const requestHeaders = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
};

const apiHeaders = {
    ...requestHeaders,
    Accept: 'application/json, text/plain, */*',
};

const commentSections = {
    qa: {
        title: '问答',
        id: '88399',
        path: '/qa',
        source: 'comment',
    },
    treehole: {
        title: '树洞',
        id: '102312',
        path: '/treehole',
        source: 'top-post',
    },
    beauty: {
        title: '女装',
        id: '108629',
        path: '/beauty',
        source: 'top-post',
    },
    ooxx: {
        title: '随手拍',
        id: '21183',
        path: '/ooxx',
        source: 'top-post',
    },
    pic: {
        title: '无聊图',
        id: '26402',
        path: '/pic',
        source: 'top-post',
    },
    tucao: {
        title: '大吐槽',
        id: '21221',
        path: '/tucao',
        source: 'tucao',
    },
} as const;

const topTypes = {
    '4hr': '4小时热门',
    pic3days: '3天内无聊图',
    pic7days: '7天内无聊图',
} as const;

type CommentSection = keyof typeof commentSections;
type TopType = keyof typeof topTypes;

const normalizeImageUrl = (url?: string) => {
    if (!url) {
        return '';
    }

    const normalized = url.startsWith('//') ? `https:${url}` : url;
    return normalized.replace(/^https?:\/\/(\w+)\.moyu\.im/, 'https://$1.sinaimg.cn');
};

const normalizeHtml = (html = '') => html.replaceAll(/(<img\b[^>]*?\bsrc=["'])([^"']+)(["'][^>]*>)/g, (_, prefix, src, suffix) => `${prefix}${normalizeImageUrl(src)}${suffix}`);

const textFromHtml = (html = '') => load(html).text().trim().replaceAll(/\s+/g, ' ');

const get = <T>(url: string, referer = rootUrl) =>
    ofetch<T>(url, {
        headers: {
            ...requestHeaders,
            Referer: referer,
        },
    });

const getApi = <T>(url: string, referer = rootUrl) =>
    ofetch<T>(url, {
        headers: {
            ...apiHeaders,
            Referer: referer,
        },
    });

interface CommentApiResponse {
    code: number;
    msg: string;
    data?: {
        list?: Array<{
            id: number;
            author?: string;
            content?: string;
            date_gmt?: string;
            date?: string;
            post_title?: string;
        }>;
    };
}

interface TopApiResponse {
    code: number;
    msg: string;
    data?: Array<{
        id: number;
        author?: string;
        content?: string;
        date_gmt?: string;
        date?: string;
        post_title?: string;
        hot_comments?: Array<{
            comment_author?: string;
            comment_content?: string;
            comment_date?: string;
            vote_positive?: number;
            vote_negative?: number;
            post_title?: string;
        }>;
    }>;
}

interface ForumApiResponse {
    code: number;
    msg: string;
    data?: {
        list?: Array<{
            post_id: number;
            title?: string;
            author_name?: string;
            create_time?: string;
            update_time?: string;
            reply_count?: number;
        }>;
    };
}

const parseArticleList = (html: string) => {
    const $ = load(html);
    const items = $('.post-list .post-item')
        .toArray()
        .map((item) => {
            const element = $(item);
            const titleElement = element.find('.post-title a').first();
            const link = titleElement.attr('href');
            const title = titleElement.text().trim();

            if (!title || !link) {
                return;
            }

            const image = normalizeImageUrl(element.find('.thumb img').attr('src'));
            const summary = element.find('.post-excerpt').text().trim();
            const category = element
                .find('.post-tag a')
                .toArray()
                .map((tag) => $(tag).text().trim())
                .filter(Boolean);

            return {
                title,
                link,
                description: [image ? `<img src="${image}">` : '', summary].filter(Boolean).join('<br>'),
                category,
            } satisfies DataItem;
        })
        .filter(Boolean);

    const title = $('h1.header-h1').first().text().trim() || $('title').text().trim() || '煎蛋';

    return {
        title,
        items,
    };
};

const enrichArticle = (item: DataItem) =>
    cache.tryGet(`jandan:article:${item.link}`, async () => {
        const html = await get<string>(item.link || rootUrl);
        const $ = load(html);
        $('.post-content script, .post-content style').remove();

        const pubDateText = $('.post-meta')
            .first()
            .text()
            .match(/发布于\s*([\d.]+\s*,\s*[\d:]+)/)?.[1];
        const author = $('.post-author').first().text().trim();
        const content = normalizeHtml($('.post-content').html() || item.description || '');

        return {
            ...item,
            description: content,
            author,
            pubDate: pubDateText ? parseDate(pubDateText.replaceAll('.', '-').replaceAll(',', '')) : undefined,
        } satisfies DataItem;
    });

export const handleArticleList = async (path = '/') => {
    const currentUrl = `${rootUrl}${path}`;
    const html = await get<string>(currentUrl);
    const { title, items } = parseArticleList(html);
    const enrichedItems = await Promise.all(items.map((item) => enrichArticle(item)));

    return {
        title: title === '新鲜事' ? '煎蛋 - 新鲜事' : `煎蛋 - ${title}`,
        link: currentUrl,
        items: enrichedItems,
    };
};

export const handleTag = (tag: string) => handleArticleList(`/p/tag/${encodeURIComponent(tag)}`);

export const isCommentSection = (category: string): category is CommentSection => category in commentSections;

export const handleCommentSection = async (category: CommentSection) => {
    const section = commentSections[category];
    const currentUrl = `${rootUrl}${section.path}`;
    let response: CommentApiResponse;

    if (section.source === 'comment') {
        response = await getApi<CommentApiResponse>(`${rootUrl}/api/comment/post/${section.id}?order=desc&page=1`, currentUrl);
    } else if (section.source === 'tucao') {
        const data = await getApi<TopApiResponse>(`${rootUrl}/api/top/tucao`, currentUrl);
        response = {
            code: data.code,
            msg: data.msg,
            data: {
                list: data.data,
            },
        };
    } else {
        const data = await getApi<TopApiResponse>(`${rootUrl}/api/top/post/${section.id}`, currentUrl);
        response = {
            code: data.code,
            msg: data.msg,
            data: {
                list: data.data,
            },
        };
    }

    if (response.code !== 0 || !Array.isArray(response.data?.list)) {
        throw new Error(`Failed to fetch ${section.title}: ${response.msg}`);
    }

    const items = response.data.list.map((comment) => {
        const content = normalizeHtml(comment.content || '');
        const hotComments = 'hot_comments' in comment && Array.isArray(comment.hot_comments) ? comment.hot_comments : [];
        const hotCommentsHtml = hotComments
            .map((hotComment) => {
                const vote = typeof hotComment.vote_positive === 'number' ? ` (${hotComment.vote_positive} OO${hotComment.vote_negative ? ` / ${hotComment.vote_negative} XX` : ''})` : '';
                return `<blockquote>${hotComment.comment_author || '匿名'}${vote}: ${normalizeHtml(hotComment.comment_content || '')}</blockquote>`;
            })
            .join('');
        const titleText = textFromHtml(content);

        return {
            author: comment.author,
            title: `${comment.author || '匿名'}${titleText ? `: ${titleText}` : ''}`,
            description: [content, hotCommentsHtml].filter(Boolean).join('<hr>'),
            pubDate: parseDate(comment.date_gmt || comment.date),
            link: `${rootUrl}/t/${comment.id}`,
            category: comment.post_title ? [comment.post_title] : [section.title],
        } satisfies DataItem;
    });

    return {
        title: `煎蛋 - ${section.title}`,
        link: currentUrl,
        items,
    };
};

export const normalizeTopType = (type?: string): TopType => (type && type in topTypes ? (type as TopType) : '4hr');

export const handleTopSection = async (type?: string) => {
    const topType = normalizeTopType(type);
    const title = `热榜 - ${topTypes[topType]}`;
    const response = await getApi<TopApiResponse>(`${rootUrl}/api/top/${topType}`, `${rootUrl}/top`);

    if (response.code !== 0 || !Array.isArray(response.data)) {
        throw new Error(`Failed to fetch ${title}: ${response.msg}`);
    }

    const items = response.data.map((item) => {
        const content = normalizeHtml(item.content || '');
        const titleText = textFromHtml(content);

        return {
            author: item.author,
            title: `${item.author || '匿名'}${titleText ? `: ${titleText}` : ''}`,
            description: content,
            pubDate: parseDate(item.date_gmt || item.date),
            link: `${rootUrl}/t/${item.id}`,
            category: item.post_title ? [item.post_title] : undefined,
        } satisfies DataItem;
    });

    return {
        title,
        link: `${rootUrl}/top`,
        items,
    };
};

export const handleForum = async () => {
    const forumId = '112928';
    const currentUrl = `${rootUrl}/new/forum`;
    const response = await getApi<ForumApiResponse>(`${rootUrl}/api/forum/posts/${forumId}?page=1`, currentUrl);

    if (response.code !== 0 || !Array.isArray(response.data?.list)) {
        throw new Error(`Failed to fetch 鱼塘: ${response.msg}`);
    }

    const items = response.data.list.map((post) => ({
        author: post.author_name,
        title: post.title || `${post.author_name || '匿名'}发表了新主题`,
        description: post.reply_count ? `${post.reply_count} 条回复` : '',
        pubDate: parseDate(post.update_time || post.create_time),
        link: `${rootUrl}/new/forum/topic/${post.post_id}`,
        category: post.reply_count ? [`${post.reply_count} 条回复`] : undefined,
    })) satisfies DataItem[];

    return {
        title: '煎蛋 - 鱼塘',
        link: currentUrl,
        items,
    };
};
