import { load } from 'cheerio';
import pMap from 'p-map';

import type { Route } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

const rootUrl = 'https://news.zaimanhua.com';

const categories = {
    '': '首页',
    donghuaqingbao: '动画情报',
    manhuaqingbao: '漫画情报',
    qingxiaoshuoqingbao: '轻小说情报',
    manhuazhoubian: '动漫周边',
    shengyouqingbao: '声优情报',
    yinyuezixun: '音乐资讯',
    youxizixun: '游戏资讯',
    meituxinshang: '美图欣赏',
    manzhanqingbao: '漫展情报',
    dazahui: '大杂烩',
};

type Category = keyof typeof categories;

const headers = {
    referer: rootUrl,
};

export const route: Route = {
    path: '/news/:category?',
    name: '新闻',
    url: 'news.zaimanhua.com',
    maintainers: ['ZHA30'],
    example: '/zaimanhua/news/donghuaqingbao',
    parameters: {
        category: {
            description: '分类，默认为首页',
            default: '首页',
            options: Object.entries(categories).map(([value, label]) => ({
                value: value || '',
                label,
            })),
        },
    },
    categories: ['anime'],
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportRadar: true,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
        nsfw: true,
    },
    radar: [
        {
            source: ['news.zaimanhua.com'],
            target: '/news',
        },
        {
            source: ['news.zaimanhua.com/:category'],
            target: '/news/:category',
        },
    ],
    description: '分类参数可选：首页、动画情报、漫画情报、轻小说情报、动漫周边、声优情报、音乐资讯、游戏资讯、美图欣赏、漫展情报、大杂烩。文章正文会抓取源站 “全文浏览” 页面。',
    handler,
};

async function handler(ctx) {
    const categoryParam = ctx.req.param('category') || '';
    const category = (categoryParam in categories ? categoryParam : '') as Category;
    const categoryName = categories[category] || categories[''];
    const link = new URL(category, rootUrl).href;
    const response = await ofetch(link, { headers });
    const $ = load(response);

    const list = $('.briefnews_con_li')
        .toArray()
        .flatMap((element) => {
            const item = $(element);
            const titleElement = item.find('h3 a').first();
            const href = titleElement.attr('href');
            const title = titleElement.attr('title') || titleElement.text();

            if (!href || !title) {
                return [];
            }

            const link = new URL(href, rootUrl).href;
            const info = item.find('.head_con_p_o span');

            return [
                {
                    title,
                    link,
                    author: info
                        .toArray()
                        .map((span) => $(span).text())
                        .find((text) => text.startsWith('发布：'))
                        ?.replace('发布：', ''),
                    pubDate: timezone(parseDate(info.first().text(), 'YYYY-MM-DD HH:mm'), +8),
                    description: item.find('.com_about').html() || undefined,
                    image: item.find('.li_content_img img').attr('src'),
                    category: item
                        .find('.bqwarp, .bq_ico')
                        .toArray()
                        .map((tag) => $(tag).text())
                        .filter(Boolean),
                },
            ];
        });

    const limit = Number.parseInt(ctx.req.query('limit') ?? String(list.length), 10);
    const items = await pMap(
        list.slice(0, limit),
        (item) =>
            cache.tryGet(`zaimanhua:news:${item.link}`, async () => {
                const detail = await fetchDetail(item.link);

                return {
                    ...item,
                    ...detail,
                    category: detail.category.length > 0 ? detail.category : item.category,
                };
            }),
        { concurrency: 3 }
    );

    return {
        title: `再漫画新闻 - ${categoryName}`,
        link,
        item: items,
    };
}

async function fetchDetail(link: string) {
    const fullTextUrl = link.replace(/\.html$/, '_all.html');
    const response = await ofetch(fullTextUrl, { headers });
    const $ = load(response);
    const content = $('.news_content_con');

    content.find('#content_page, .page').remove();

    return {
        description: content.html() || undefined,
        pubDate: timezone(parseDate($('.data_time').text(), 'YYYY-MM-DD HH:mm'), +8),
        category: $('.news_content_foot .bqwarp')
            .toArray()
            .map((tag) => $(tag).text())
            .filter(Boolean),
    };
}
