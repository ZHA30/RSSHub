import { load } from 'cheerio';
import type { Element } from 'domhandler';
import sanitizeHtml from 'sanitize-html';

import type { DataItem } from '@/types';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

const articleApiRootUrl = 'https://www.lifeweek.com.cn/api/article';

export type LifeweekListItem = {
    id: number | string;
    title?: string;
    pubTime?: string;
    tag?: string;
    daodu?: string;
    summary?: string;
    pic?: string;
    articleTags?: Array<{
        name?: string;
    }>;
    teacherList?: Array<{
        name?: string;
    }>;
};

const cleanDescription = (html: string) => {
    const $ = load(html);

    const junkTextMarkers = ['三联生活小物分享群', '加群方式：', '招聘｜撰稿人', '大家都在看', '点赞”“在看”', '版权归「三联生活周刊」所有'];

    $('container').each((_, element) => {
        $(element).replaceWith($(element).html() ?? '');
    });

    $('#js_content').each((_, element) => {
        $(element).replaceWith($(element).html() ?? '');
    });

    $('center.center_webview_text').each((_, element) => {
        $(element).replaceWith(`<p>${$(element).text()}</p>`);
    });

    $('mp-common-profile, mp-style-type, svg').remove();
    $(String.raw`o\:p`).remove();
    $('[data-tools], [powered-by], [label*="135editor"], [label*="Powered by 135editor"], [data-miniprogram-type], [data-pluginname="mpprofile"]').remove();

    $('section, p, div').each((_, element) => {
        const text = $(element).text().replaceAll(/\s+/g, ' ').trim();
        if (junkTextMarkers.some((marker) => text.includes(marker))) {
            $(element).remove();
        }
    });

    $('span, font').each((_, element) => {
        $(element).replaceWith($(element).html() ?? '');
    });

    $('p, section, div').each((_, element) => {
        const node = $(element);
        if (!node.text().replaceAll(/\s+/g, '').length && !node.find('img, br').length) {
            node.remove();
        }
    });

    $('[style]').removeAttr('style');
    $('[class]').removeAttr('class');
    $('[id]').removeAttr('id');
    $('*').each((_, element) => {
        const attribs = (element as Element).attribs ?? {};
        for (const name of Object.keys(attribs)) {
            if (name.startsWith('data-') || name.startsWith('mpa-') || name === 'nodeleaf' || name === 'leaf' || name === 'textstyle' || name === 'powered-by' || name === 'label') {
                $(element).removeAttr(name);
            }
        }
    });

    $('img').each((_, element) => {
        const img = $(element);
        const src = img.attr('src') || img.attr('data-src') || img.attr('data-croporisrc');
        img.attr('src', src ?? '');
        for (const name of Object.keys(element.attribs ?? {})) {
            if (name !== 'src' && name !== 'alt') {
                img.removeAttr(name);
            }
        }
    });

    $('a').each((_, element) => {
        const link = $(element);
        for (const name of Object.keys(element.attribs ?? {})) {
            if (name !== 'href') {
                link.removeAttr(name);
            }
        }
    });

    $('section, div').each((_, element) => {
        $(element).replaceWith($(element).html() ?? '');
    });

    $('html, head, body').each((_, element) => {
        $(element).replaceWith($(element).html() ?? '');
    });

    $('span, section').each((_, element) => {
        const node = $(element);
        if (Object.keys((element as Element).attribs ?? {}).length === 0) {
            node.replaceWith(node.html() ?? '');
        }
    });

    $('p, h1, h2, h3, h4, h5, h6').each((_, element) => {
        const node = $(element);
        node.html(node.html()?.replaceAll(/^(<br\s*\/?>(\s|&nbsp;)*)+|((\s|&nbsp;)*<br\s*\/?>)+$/g, '') ?? '');
    });

    $('p, h1, h2, h3, h4, h5, h6').each((_, element) => {
        const node = $(element);
        if (!node.text().replaceAll(/\s+/g, '').length && !node.find('img, br').length) {
            node.remove();
        }
    });

    $('strong, em, a, img, br, p, h1, h2, h3, h4, h5, h6, blockquote, ul, ol, li').each((_, element) => {
        let parent = $(element).parent();
        while (parent.length && ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(parent[0].tagName)) {
            parent.replaceWith(parent.html() ?? '');
            parent = $(element).parent();
        }
    });

    return sanitizeHtml($.root().html() ?? html, {
        allowedTags: ['p', 'br', 'img', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'strong', 'em'],
        allowedAttributes: {
            a: ['href'],
            img: ['src', 'alt'],
        },
        allowedSchemes: ['http', 'https', 'mailto'],
    });
};

async function getRssItem(item: LifeweekListItem, articleLink: string): Promise<DataItem> {
    const articleApiLink = `${articleApiRootUrl}/${item.id}`;
    const { data } = await got(articleApiLink);
    const detail = data.model;
    const time = item.pubTime ? timezone(parseDate(item.pubTime), +8) : undefined;
    const category = [...new Set([...(item.articleTags?.map((tag) => tag.name).filter((name): name is string => !!name) ?? []), ...(item.tag?.split('、').filter(Boolean) ?? [])])];
    const author = [
        ...new Set([detail.aritcleAuthors, ...(detail.teacherList?.map((teacher) => teacher.name).filter(Boolean) ?? []), ...(item.teacherList?.map((teacher) => teacher.name).filter(Boolean) ?? [])].filter(Boolean)),
    ].join(', ');
    const description = cleanDescription(detail.content || item.daodu || item.summary || '');
    const image = detail.pic || detail.shareData?.image || item.pic;

    return {
        title: detail.title || item.title,
        description,
        link: articleLink,
        pubDate: time,
        author,
        category,
        image,
        banner: image,
        guid: `lifeweek:${item.id}`,
        id: `lifeweek:${item.id}`,
        content: {
            html: description,
            text: detail.daodu || item.daodu || item.summary,
        },
    };
}

export default getRssItem;
