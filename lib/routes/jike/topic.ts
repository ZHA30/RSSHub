import { load } from 'cheerio';
import dayjs from 'dayjs';

import type { Route } from '@/types';
import { ViewType } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';

import { constructTopicEntry, getTopicDisplayName, topicDataHanding } from './utils';

const urlRegex = /(https?:\/\/[^\s"'<>]+)/g;

export const route: Route = {
    path: '/topic/:id/:showUid?',
    categories: ['social-media'],
    view: ViewType.SocialMedia,
    example: '/jike/topic/556688fae4b00c57d9dd46ee',
    parameters: {
        id: '圈子 id, 可在即刻 web 端圈子页或 APP 分享出来的圈子页 URL 中找到',
        showUid: {
            description: '是否在内容中显示用户信息，设置为 1 则开启',
            options: [{ value: '1', label: '显示' }],
        },
    },
    features: {
        requireConfig: [
            {
                name: 'JIKE_REFRESHTOKEN',
                optional: true,
                description: '即刻 refresh token。配置后可通过鉴权接口分页抓取更多圈子内容；未配置时回退到公开页面数据。',
            },
        ],
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    radar: [
        {
            source: ['web.okjike.com/topic/:id'],
            target: '/topic/:id',
        },
        {
            source: ['m.okjike.com/topics/:id'],
            target: '/topic/:id',
        },
    ],
    name: '圈子',
    maintainers: ['DIYgod', 'prnake'],
    handler,
};

async function handler(ctx) {
    const id = ctx.req.param('id');
    const showUid = ctx.req.param('showUid') === '1';
    const topicUrl = `https://m.okjike.com/topics/${id}`;

    const data = await constructTopicEntry(ctx, topicUrl);

    if ('posts' in data) {
        const topicDisplayName = getTopicDisplayName(data.topic, data.posts);
        const result = data.result;
        result.item = topicDataHanding(data, showUid);
        if (id === '553870e8e4b0cafb0a1bef68' || id === '55963702e4b0d84d2c30ce6f') {
            result.item = await Promise.all(
                result.item.map(async (one) => {
                    const item = { ...one };
                    const regResult = /https:\/\/www\.okjike\.com\/medium\/[\dA-Za-z]*/.exec(item.description);
                    if (regResult) {
                        const newsUrl = regResult[0];
                        item.description = await cache.tryGet(newsUrl, async () => {
                            const { data } = await got(newsUrl);
                            const $ = load(data);
                            const upper = $('ul.main > li.item');
                            const links = upper.find('a').map((_, ele) => $(ele).attr('href'));
                            const texts = upper.find('span.text').map((_, ele) => $(ele).text());
                            let description = '';
                            for (let i = 0; i < links.length; i++) {
                                description += `${i + 1}、<a href="${links[i]}">${texts[i]}</a><br>`;
                            }
                            description = description.replace(/<br>$/, '');
                            return description;
                        });
                    }
                    item.description = item.description.replaceAll(urlRegex, (url) => `<a href="${url}">${url}</a>`);
                    item.title = `${topicDisplayName} ${dayjs(one.pubDate).format('MM月DD日')}`;
                    return item;
                })
            );
        }
        return result;
    }
}
