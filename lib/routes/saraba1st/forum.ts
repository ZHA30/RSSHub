import { load } from 'cheerio';
import pMap from 'p-map';

import { config } from '@/config';
import type { DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

export const route: Route = {
    path: '/forum/:fid/:typeid?',
    categories: ['bbs'],
    example: '/saraba1st/forum/6/290',
    parameters: {
        fid: '论坛版块 id，可从版块网址中的 `fid` 或 `forum-{fid}-1.html` 提取',
        typeid: '可选，版块分类 id，可从分类网址中的 `typeid` 提取',
    },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    radar: [
        {
            source: ['stage1st.com/2b/forum.php?mod=forumdisplay&fid=:fid', 'stage1st.com/2b/forum-:fid-1.html'],
            target: '/forum/:fid',
        },
        {
            source: ['stage1st.com/2b/forum.php?mod=forumdisplay&fid=:fid&filter=author&orderby=dateline&typeid=:typeid', 'stage1st.com/2b/forum.php?mod=forumdisplay&fid=:fid&filter=typeid&typeid=:typeid'],
            target: '/forum/:fid/:typeid',
        },
    ],
    name: '版块主题',
    maintainers: ['ZHA30'],
    handler,
    description: '版块网址如果为 `https://stage1st.com/2b/forum.php?mod=forumdisplay&fid=6&filter=author&orderby=dateline&typeid=290`，那么路由为 `/saraba1st/forum/6/290`。',
};

async function handler(ctx) {
    const fid = ctx.req.param('fid');
    const typeid = ctx.req.param('typeid');
    const host = config.saraba1st.host;
    const cookieString = config.saraba1st.cookie ?? '';

    const params = new URLSearchParams({
        mod: 'forumdisplay',
        fid,
        orderby: 'dateline',
    });

    if (typeid) {
        params.set('filter', 'author');
        params.set('typeid', typeid);
    }

    const link = `${host}/2b/forum.php?${params.toString()}`;
    const response = await got(link, {
        headers: {
            Cookie: cookieString,
        },
    });
    const $ = load(response.data);
    const title = $('head title')
        .text()
        .replace(/ - +Stage1st.+$/, '')
        .trim();

    const limit = ctx.req.query('limit') ? Number.parseInt(ctx.req.query('limit'), 10) : 20;
    const list: DataItem[] = $('#threadlisttableid tbody[id^="normalthread_"]')
        .slice(0, limit)
        .toArray()
        .map((element) => {
            const item = $(element);
            const titleElement = item.find('a.xst').first();
            const category = item.find('th em a').first().text().trim();
            const href = titleElement.attr('href');
            const threadLink = new URL(href ?? '', `${host}/2b/`).href;
            const pubDateText = item.find('td.by').first().find('em span').attr('title') || item.find('td.by').first().find('em span').text();

            return {
                title: `${category ? `[${category}] ` : ''}${titleElement.text().trim()}`,
                link: threadLink,
                author: item.find('td.by').first().find('cite a').text().trim(),
                pubDate: timezone(parseDate(pubDateText), +8),
                category: category ? [category] : undefined,
            };
        });

    const items = await pMap(
        list,
        (item) =>
            cache.tryGet(item.link!, async () => {
                item.description = await fetchContent(item.link!, cookieString);
                return item;
            }),
        { concurrency: 5 }
    );

    return {
        title: `Stage1 论坛 - ${title}`,
        link,
        item: items,
    };
}

async function fetchContent(url: string, cookieString: string) {
    const response = await got(url, {
        headers: {
            Cookie: cookieString,
        },
    });
    const $ = load(response.data);
    const post = $('td[id^="postmessage_"]').first();

    post.find('img').each((_, element) => {
        const image = $(element);
        const file = image.attr('file');
        if (file) {
            image.attr('src', file);
            image.removeAttr('zoomfile');
            image.removeAttr('file');
            image.removeAttr('onmouseover');
            image.removeAttr('onclick');
        }
    });
    post.find('div.aimg_tip').remove();

    return post.html() ?? undefined;
}
