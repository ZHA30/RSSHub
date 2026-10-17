import { load } from 'cheerio';
import pMap from 'p-map';
import sanitizeHtml from 'sanitize-html';

import { config } from '@/config';
import type { DataItem } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const parseSourceDate = (value?: string) => {
    if (typeof value !== 'string' || !value || !Number.isFinite(parseDate(value.slice(0, 19), value.length === 10 ? 'YYYY-MM-DD' : 'YYYY-MM-DDTHH:mm:ss', true).getTime())) {
        return;
    }
    const date = parseDate(value);
    return Number.isFinite(date.getTime()) ? date : undefined;
};

/**
 * Extract page ID from script tags and title
 */
const extractPageMeta = (url: string) =>
    cache.tryGet(`jandan:pageMeta:${url}`, async () => {
        const response = await ofetch(url);

        const $ = load(response);

        return {
            pageId:
                $('script:contains("PAGE")')
                    .text()
                    .match(/PAGE\s*=\s*\{\s*id\s*:\s*(\d+)\s*\}/)?.[1] ?? '',
            title: $('title').text().trim(),
        };
    });

/**
 * Handle the top section (热榜)
 */
export const handleTopSection = async (rootUrl: string, type: string): Promise<{ title: string; items: DataItem[] }> => {
    const apiUrl = `${rootUrl}/api/top/${type}`;
    const response = await ofetch(apiUrl);

    let title = '热榜';
    switch (type) {
        case 'pic3days':
            title += ' - 3天内无聊图';
            break;
        case 'pic7days':
            title += ' - 7天内无聊图';
            break;
        default:
            title += ' - 4小时热门';
            break;
    }

    if (response.code !== 0) {
        throw new Error(`未能获取热榜数据: ${title}`);
    }

    const items = response.data.map((item): DataItem => {
        const content = item.content.replaceAll(/img src="(.*?)"/g, (match, src) => match.replace(src, () => src.replace(/^https?:\/\/(\w+)\.moyu\.im/, 'https://$1.sinaimg.cn')));

        return {
            author: item.author,
            title: `${item.author}: ${sanitizeHtml(content, { allowedTags: [], allowedAttributes: {} })}`,
            description: content,
            pubDate: parseSourceDate(item.date_gmt),
            link: `${rootUrl}/t/${item.id}`,
        };
    });

    return { title, items };
};

/**
 * Handle the forum/bbs section (鱼塘)
 */
export const handleForumSection = async (rootUrl: string): Promise<{ title: string; items: DataItem[]; link: string }> => {
    const title = '煎蛋 - 鱼塘';
    const currentUrl = `${rootUrl}/new/forum`;

    const forumId = 112928;
    const apiUrl = `${rootUrl}/api/forum/posts/${forumId}?page=1`;
    const forumData = await ofetch(apiUrl);

    if (forumData.code !== 0) {
        throw new Error('未能获取鱼塘数据');
    }

    const items = forumData.data.list.map((post): DataItem => ({
        author: post.author_name,
        title: post.title,
        pubDate: parseSourceDate(post.create_time),
        updated: parseSourceDate(post.update_time),
        link: `${rootUrl}/new/forum/topic/${post.post_id}`,
        category: post.reply_count > 0 ? [`${post.reply_count}条回复`] : undefined,
    }));

    return { title, items, link: currentUrl };
};

/**
 * Handle other sections (问答, 树洞, 随手拍, 女装, 无聊图)
 */
export const handleCommentSection = async (rootUrl: string, category: string): Promise<{ title: string; items: DataItem[] }> => {
    const currentUrl = `${rootUrl}/${category}`;

    const { pageId, title: pageTitle } = await extractPageMeta(currentUrl);
    const title = pageTitle || `煎蛋 - ${category}`;

    if (!pageId) {
        throw new Error('无法从页面中获取到帖子ID，可能网站结构已变更');
    }

    const apiUrl = `${rootUrl}/api/comment/post/${pageId}?order=desc&page=0`;
    const commentsData = await ofetch(apiUrl);

    if (commentsData.code !== 0) {
        throw new Error('没有获取到内容，可能需要更新解析规则');
    }

    const items = commentsData.data.list.map((comment): DataItem => {
        const content = comment.content.replaceAll(/img src="(.*?)"/g, (match, src) => match.replace(src, () => src.replace(/^https?:\/\/(\w+)\.moyu\.im/, 'https://$1.sinaimg.cn')));

        return {
            author: comment.author,
            title: `${comment.author}: ${sanitizeHtml(content, { allowedTags: [], allowedAttributes: {} })}`,
            description: content,
            pubDate: parseSourceDate(comment.date_gmt),
            link: `${rootUrl}/t/${comment.id}`,
        };
    });

    return { title, items };
};

const tagRootUrl = 'https://jandan.net';

const normalizeTagImageUrl = (url?: string) => {
    if (!url) {
        return '';
    }

    const normalized = url.startsWith('//') ? `https:${url}` : url;
    return normalized.replace(/^https?:\/\/(\w+)\.moyu\.im/, 'https://$1.sinaimg.cn');
};

const parseTagArticleList = (html: string) => {
    const $ = load(html);
    const items = $('.post-list .post-item')
        .toArray()
        .map((post): DataItem | undefined => {
            const element = $(post);
            const titleElement = element.find('.post-title a').first();
            const link = titleElement.attr('href');
            const title = titleElement.text().trim();

            if (!title || !link) {
                return;
            }

            const image = normalizeTagImageUrl(element.find('.thumb img').attr('src'));
            const summary = element.find('.post-excerpt').text().trim();
            const category = element
                .find('.post-tag a')
                .toArray()
                .map((tag) => $(tag).text().trim())
                .filter(Boolean);

            return {
                title,
                link: new URL(link, tagRootUrl).href,
                description: [image ? `<img src="${image}">` : '', summary].filter(Boolean).join('<br>'),
                category,
            };
        })
        .filter((item): item is DataItem => item !== undefined);

    return {
        title: $('h1.header-h1').first().text().trim() || $('title').text().trim() || '煎蛋',
        items,
    };
};

const enrichTagArticle = (item: DataItem) =>
    cache.tryGet(`jandan:article:${item.link}`, async () => {
        const articleUrl = item.link || tagRootUrl;
        const html = await ofetch<string, 'text'>(articleUrl, {
            responseType: 'text',
            headers: { 'User-Agent': config.ua, Referer: tagRootUrl },
        });
        const $ = load(html);
        $('.post-content script, .post-content style').remove();

        const pubDateText = $('.post-meta')
            .first()
            .text()
            .match(/发布于\s*([\d.]+\s*,\s*[\d:]+)/)?.[1];
        const author = $('.post-author').first().text().trim();
        const content = $('.post-content').html() || item.description || '';
        const normalizedContent = content.replaceAll(/(<img\b[^>]+?\bsrc=["'])([^"']+)(["'][^>]*>)/g, (_, prefix, src, suffix) => `${prefix}${normalizeTagImageUrl(src)}${suffix}`);

        return {
            ...item,
            description: normalizedContent,
            author,
            pubDate: pubDateText ? parseDate(pubDateText.replaceAll('.', '-').replaceAll(',', '')) : undefined,
        } satisfies DataItem;
    });

export const handleTag = async (tag: string) => {
    const currentUrl = `${tagRootUrl}/p/tag/${encodeURIComponent(tag)}`;
    const html = await ofetch<string, 'text'>(currentUrl, {
        responseType: 'text',
        headers: { 'User-Agent': config.ua },
    });
    const { title, items } = parseTagArticleList(html);
    const enrichedItems = await pMap(items, enrichTagArticle, { concurrency: 3 });

    return {
        title: title === '新鲜事' ? '煎蛋 - 新鲜事' : `煎蛋 - ${title}`,
        link: currentUrl,
        items: enrichedItems,
    };
};
