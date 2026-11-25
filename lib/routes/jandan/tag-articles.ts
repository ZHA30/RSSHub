import { load } from 'cheerio';
import pMap from 'p-map';

import { config } from '@/config';
import type { DataItem } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/time';

const tagRootUrl = 'https://jandan.net';

const normalizeTagImageUrl = (url?: string) => {
    if (!url) {
        return '';
    }

    const normalized = url.startsWith('//') ? `https:${url}` : url;
    return normalized.replace(/^https?:\/\/(\w+)\.moyu\.im/, 'https://$1.sinaimg.cn');
};

const parseTagArticleList = (html: string, tag: string) => {
    const $ = load(html);
    const items = $('.post-list .post-item')
        .toArray()
        .map((post): DataItem | undefined => {
            const element = $(post);
            const titleElement = element.find('.post-title a').first();
            const link = titleElement.attr('href');
            const title = titleElement.text();

            if (!title || !link) {
                return;
            }

            const image = normalizeTagImageUrl(element.find('.post-thumb img').attr('src'));
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
                category: category.length > 0 ? category : [tag],
            };
        })
        .filter((item): item is DataItem => item !== undefined);

    return {
        title: $('title').text().trim() || '煎蛋',
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

export const handleTag = async (tag: string, limit = 20) => {
    const currentUrl = `${tagRootUrl}/p/tag/${encodeURIComponent(tag)}`;
    const html = await ofetch<string, 'text'>(currentUrl, {
        responseType: 'text',
        headers: { 'User-Agent': config.ua },
    });
    const { title, items } = parseTagArticleList(html, tag);
    const enrichedItems = await pMap(items.slice(0, limit), enrichTagArticle, { concurrency: 3 });

    return {
        title: title === '新鲜事' ? '煎蛋 - 新鲜事' : `煎蛋 - ${title}`,
        link: currentUrl,
        items: enrichedItems,
    };
};
