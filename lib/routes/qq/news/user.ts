import { load } from 'cheerio';
import type { Comment } from 'domhandler';

import { config } from '@/config';
import type { DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';

type UserInfo = {
    nick: string;
    user_desc?: string;
    suid: string;
    shareImg?: string;
};

type NewsItem = {
    title?: string;
    longtitle?: string;
    url: string;
    timestamp: number;
    abstract?: string;
    source?: string;
    articletype?: string;
    miniProShareImage?: string;
    miniVideoPic?: string;
};

const buildSummary = (item: NewsItem) => {
    const image = item.articletype === '4' ? item.miniProShareImage : item.articletype === '118' ? item.miniVideoPic : item.miniProShareImage;

    return `${item.abstract ? `<p>${item.abstract}</p>` : ''}${image ? `<img src="${image}" />` : ''}` || undefined;
};

const getDetail = async (item: NewsItem) => {
    if (item.articletype === '4' || item.articletype === '118') {
        return `<a href="${item.url}"><img src="${item.articletype === '4' ? item.miniProShareImage : item.miniVideoPic}" style="width: 100%"></a>`;
    }

    const response = await got(item.url);
    const $ = load(response.data);
    const script = $('script:contains("window.DATA")')
        .text()
        .match(/window\.DATA = ({.+});/);

    if (!script) {
        return buildSummary(item);
    }

    const data = JSON.parse(script[1]);
    const $data = load(data.originContent?.text || '', null, false);

    $data('*')
        .contents()
        .filter((_, elem) => elem.type === 'comment')
        .replaceWith((_, elem) => {
            const comment = elem as Comment;
            const attribute = comment.data.trim();
            const imageData = attribute?.startsWith('IMG') ? data.originAttribute?.[attribute] : undefined;

            return imageData ? `<img src="${imageData.imgurl0}" style="${imageData.style ?? ''}" />` : '';
        });

    return $data.html() || buildSummary(item);
};

export const route: Route = {
    path: '/news/:uid/:detail?',
    categories: ['social-media'],
    example: '/qq/news/5254802',
    parameters: {
        uid: '用户 ID，支持作者页 URL 中的数字 ID 或旧 guestSuid',
        detail: '是否抓取全文，该值只要不为空就抓取全文返回，否则只返回摘要',
    },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: true,
        supportScihub: false,
    },
    radar: [
        {
            source: ['news.qq.com/omn/author/:uid'],
            target: '/news/:uid',
        },
    ],
    name: '用户主页列表',
    maintainers: ['hualiong', 'ZHA30'],
    handler,
};

async function handler(ctx) {
    const { uid, detail } = ctx.req.param();
    const userType = /^\d+$/.test(uid) ? 'chlid' : 'guestSuid';
    const homePageInfoUrl = `https://i.news.qq.com/i/getUserHomepageInfo?${userType}=${uid}`;
    const userInfo = await cache.tryGet<UserInfo>(homePageInfoUrl, async () => (await got(homePageInfoUrl)).data.userinfo);
    const suid = encodeURIComponent(userInfo.suid);
    const newsListUrl = `https://i.news.qq.com/getSubNewsMixedList?guestSuid=${suid}&tabId=om_index`;
    const news = await cache.tryGet<NewsItem[]>(newsListUrl, async () => (await got(newsListUrl)).data.newslist ?? [], config.cache.routeExpire, false);

    const items: DataItem[] = await Promise.all(
        news.map((item) =>
            cache.tryGet(item.url + (detail ? ':detail' : ':summary'), async () => ({
                title: item.longtitle || item.title || item.abstract || item.url,
                description: detail ? await getDetail(item) : buildSummary(item),
                guid: item.url,
                link: item.url,
                author: item.source || userInfo.nick,
                pubDate: parseDate(item.timestamp, 'X'),
            }))
        )
    );

    return {
        title: `${userInfo.nick}的主页 - 腾讯网`,
        description: userInfo.user_desc,
        link: `https://news.qq.com/omn/author/${uid}`,
        item: items,
        image: userInfo.shareImg,
    };
}
