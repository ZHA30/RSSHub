import { load } from 'cheerio';
import type { Comment, Element } from 'domhandler';
import { renderToString } from 'hono/jsx/dom/server';

import { config } from '@/config';
import type { Data, Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';

const cleanArticleContent = (html: string, imageAttributes = {}) => {
    const $ = load(html, null, false);

    $('*')
        .contents()
        .filter((_, elem) => elem.type === 'comment')
        .replaceWith((_, elem) => {
            const comment = elem as Comment;
            const attribute = comment.data.trim();
            const imageData = attribute?.startsWith('IMG') ? imageAttributes[attribute] : undefined;

            return renderToString(imageData ? <img src={imageData.imgurl0} style={imageData.style} /> : null);
        });

    $('script, style, noscript').remove();
    $('[powered-by]').remove();
    $('[class]').removeAttr('class');
    $('[style]').removeAttr('style');

    $('*').each((_, element) => {
        const node = $(element);
        const attribs = (element as Element).attribs ?? {};

        for (const name of Object.keys(attribs)) {
            if (name === 'src' || name === 'href' || name === 'alt' || name === 'title' || name === 'controls' || name === 'poster' || name === 'loop' || name === 'muted' || name === 'autoplay') {
                continue;
            }

            node.removeAttr(name);
        }
    });

    $('img').each((_, element) => {
        const img = $(element);
        const src = img.attr('src') || img.attr('data-src');

        if (src) {
            img.attr('src', src);
        }
    });

    $('a').each((_, element) => {
        const link = $(element);
        const href = link.attr('href');

        if (!href || href.startsWith('javascript:')) {
            link.removeAttr('href');
        }
    });

    $('p, section, div, span').each((_, element) => {
        const node = $(element);

        if (!node.text().trim() && node.find('img, video, audio, iframe, figure').length === 0) {
            node.remove();
        }
    });

    return $('.rich_media_content').html() || $.root().html();
};

const extractWindowData = (scriptText: string) => {
    const match = scriptText?.match(/window\.DATA = ({.+});/);

    return match ? JSON.parse(match[1]) : undefined;
};

export const route: Route = {
    path: '/news/author/:mid',
    categories: ['new-media'],
    example: '/tencent/news/author/5933889',
    parameters: { mid: '企鹅号 ID' },
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
            title: '当前作者文章',
            source: ['news.qq.com/omn/author/:mid'],
        },
    ],
    name: '作者',
    maintainers: ['LogicJake', 'miles170'],
    handler,
};

async function handler(ctx): Promise<Data> {
    const mid = ctx.req.param('mid');
    const userType = /^\d+$/.test(mid) ? 'chlid' : 'guestSuid';
    const homePageInfoUrl = `https://i.news.qq.com/i/getUserHomepageInfo?${userType}=${mid}`;
    const userInfo = await cache.tryGet(homePageInfoUrl, async () => (await got(homePageInfoUrl)).data.userinfo);
    const title = userInfo.nick;
    const description = userInfo.user_desc;
    const suid = encodeURIComponent(userInfo.suid);

    const newsListUrl = `https://i.news.qq.com/getSubNewsMixedList?guestSuid=${suid}&tabId=om_index`;
    const news = await cache.tryGet(newsListUrl, async () => (await got(newsListUrl)).data.newslist, config.cache.routeExpire, false);

    const items = await Promise.all(
        news.map((item) => {
            const title = item.title;
            const pubDate = parseDate(item.timestamp, 'X');
            const itemUrl = item.url;
            const author = item.source;
            const abstract = item.abstract;

            if (item.articletype === '4' || item.articletype === '118') {
                // Video
                return {
                    title,
                    description: `<a href=${item.url}><img src="${item.articletype === '4' ? item.miniProShareImage : item.miniVideoPic}" style="width: 100%"></a>`,
                    link: itemUrl,
                    author,
                    pubDate,
                };
            }

            return cache.tryGet(itemUrl, async () => {
                const response = await got(itemUrl);
                const $ = load(response.data);
                const data = extractWindowData($('script:contains("window.DATA")').text());

                return {
                    title,
                    description: data ? cleanArticleContent(data.originContent?.text || '', data.originAttribute) || abstract : abstract,
                    link: itemUrl,
                    author,
                    pubDate,
                };
            });
        })
    );

    return {
        title,
        description,
        link: `https://new.qq.com/omn/author/${mid}`,
        item: items,
        image: userInfo?.shareImg,
    };
}
