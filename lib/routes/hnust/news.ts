import { load } from 'cheerio';

import type { DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

const rootUrl = 'https://news.hnust.edu.cn';

const categories = {
    home: {
        name: '首页',
        path: 'index.htm',
    },
    kdyw: {
        name: '综合新闻',
        path: 'kdyw/index.htm',
    },
    mtkd: {
        name: '媒体报道',
        path: 'mtkd/index.htm',
    },
    jxky: {
        name: '教学科研',
        path: 'jxky/index.htm',
    },
    xyxw: {
        name: '校园新闻',
        path: 'xyxw/index.htm',
    },
    rmxy: {
        name: '融媒校园',
        path: 'rmxy/index.htm',
    },
    xbhc: {
        name: '校报画册',
        path: 'xbhc/dzxb/index.htm',
    },
    dzxb: {
        name: '电子校报',
        path: 'xbhc/dzxb/index.htm',
    },
    dzhc: {
        name: '电子画册',
        path: 'xbhc/dzhc/index.htm',
    },
    kdst: {
        name: '科大视听',
        path: 'kdst/kdyx/index.htm',
    },
    kdyx: {
        name: '科大影像',
        path: 'kdst/kdyx/index.htm',
    },
    ztxw: {
        name: '专题新闻',
        path: 'ztxw/index.htm',
    },
};

type CategoryKey = keyof typeof categories;

const isCategoryKey = (category: string): category is CategoryKey => category in categories;

export const route: Route = {
    path: '/news/:category?',
    categories: ['university'],
    example: '/hnust/news/kdyw',
    parameters: { category: '分类，默认为综合新闻' },
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
            source: ['news.hnust.edu.cn/:category/index.htm', 'news.hnust.edu.cn/'],
            target: '/news/:category',
        },
    ],
    name: '新闻网',
    maintainers: ['ZHA30'],
    handler,
    url: 'news.hnust.edu.cn',
    description: `| 首页 | 综合新闻 | 媒体报道 | 教学科研 | 校园新闻 | 融媒校园 | 校报画册 | 电子校报 | 电子画册 | 科大视听 | 科大影像 | 专题新闻 |
| ---- | -------- | -------- | -------- | -------- | -------- | -------- | -------- | -------- | -------- | -------- | -------- |
| home | kdyw     | mtkd     | jxky     | xyxw     | rmxy     | xbhc     | dzxb     | dzhc     | kdst     | kdyx     | ztxw     |`,
};

async function handler(ctx) {
    const categoryParam = ctx.req.param('category') ?? 'kdyw';
    const categoryKey = isCategoryKey(categoryParam) ? categoryParam : 'kdyw';
    const category = categories[categoryKey];
    const currentUrl = new URL(category.path, rootUrl).href;

    const response = await got(currentUrl);
    const $ = load(response.data);

    const items = categoryKey === 'home' ? parseHomeItems($) : parseItems($, currentUrl);

    const result = await Promise.all(
        items.map((item) => {
            const link = item.link;

            return link && isInternalArticle(link)
                ? cache.tryGet(`hnust:detail:${link}`, async () => {
                      try {
                          const detail = await parseDetail(link);
                          return {
                              ...item,
                              ...detail,
                              pubDate: detail.pubDate ?? item.pubDate,
                          };
                      } catch {
                          return item;
                      }
                  })
                : item;
        })
    );

    return {
        title: `湖南科技大学新闻网 - ${category.name}`,
        link: currentUrl,
        description: `湖南科技大学新闻网 - ${category.name}`,
        item: result,
    };
}

function parseItems($: ReturnType<typeof load>, currentUrl: string): DataItem[] {
    if ($('.date-list li').length) {
        return parseListItems($, currentUrl);
    }

    if ($('.zt-list li').length) {
        return parseMediaItems($, currentUrl);
    }

    if ($('.TopicNews').length) {
        return parseTopicItems($, currentUrl);
    }

    throw new Error('No news items found');
}

function parseListItems($: ReturnType<typeof load>, currentUrl: string): DataItem[] {
    const items: DataItem[] = [];

    $('.date-list li').each((_, element) => {
        const item = $(element);
        const title = item.find('a').attr('title')?.trim() || item.find('.title').text().trim();

        if (!title) {
            return;
        }

        const link = new URL(item.find('a').attr('href') ?? '', currentUrl).href;
        const date = item.find('.rightDate').text().trim();

        items.push({
            title,
            link,
            pubDate: date ? timezone(parseDate(date, 'YYYY-MM-DD'), 8) : undefined,
        });
    });

    return items;
}

function parseMediaItems($: ReturnType<typeof load>, currentUrl: string): DataItem[] {
    const items: DataItem[] = [];

    $('.zt-list li').each((_, element) => {
        const item = $(element);
        const titleElement = item.find('.info a.title').first();
        const title = titleElement.attr('title')?.trim() || titleElement.text().trim();

        if (!title) {
            return;
        }

        const link = new URL(titleElement.attr('href') ?? '', currentUrl).href;
        const date = item.find('.rightDate').text().trim();
        const image = item.find('img').first().attr('src');

        items.push({
            title,
            link,
            image: image ? new URL(image, currentUrl).href : undefined,
            pubDate: date ? timezone(parseDate(date, 'YYYY-MM-DD'), 8) : undefined,
        });
    });

    return items;
}

function parseTopicItems($: ReturnType<typeof load>, currentUrl: string): DataItem[] {
    const items: DataItem[] = [];

    $('.TopicNews').each((_, element) => {
        const item = $(element);
        const topic = item.find('.TopicFirst a').first();
        const title = topic.find('strong').text().replace('>', '').trim();

        if (!title) {
            return;
        }

        const link = new URL(topic.attr('href') ?? '', currentUrl).href;
        const image = topic.find('img').first().attr('src');

        item.find('a').each((_, anchor) => {
            const href = $(anchor).attr('href');
            if (href) {
                $(anchor).attr('href', new URL(href, currentUrl).href);
            }
        });
        item.find('img').each((_, img) => {
            const src = $(img).attr('src');
            if (src) {
                $(img).attr('src', new URL(src, currentUrl).href);
            }
        });

        items.push({
            title,
            link,
            image: image ? new URL(image, currentUrl).href : undefined,
            description: item.html() ?? undefined,
        });
    });

    return items;
}

function parseHomeItems($: ReturnType<typeof load>): DataItem[] {
    const seen = new Set<string>();
    const items: DataItem[] = [];

    $('a[href]').each((_, element) => {
        const item = $(element);
        const href = item.attr('href') ?? '';
        const link = new URL(href, rootUrl).href;

        if (seen.has(link) || !isNewsLikeLink(link)) {
            return;
        }
        seen.add(link);

        const title = item.attr('title')?.trim() || item.find('.tit, .text, p').first().text().trim() || item.text().trim();
        const date = item.find('.time, .year, .mtdate').first().text().trim();

        if (!title) {
            return;
        }

        items.push({
            title,
            link,
            pubDate: date ? timezone(parseDate(date, 'YYYY-MM-DD'), 8) : undefined,
        });
    });

    return items.slice(0, 30);
}

async function parseDetail(link: string): Promise<Partial<DataItem>> {
    const response = await got(link);
    const $ = load(response.data);
    const article = $('.article.cont');

    article.find('script, style').remove();

    const date = $('.cont-tit span')
        .toArray()
        .map((element) => $(element).text().trim())
        .find((text) => text.includes('日期：'))
        ?.replace(/^.*日期：/, '')
        .trim();
    const author = $('.cont-tit span')
        .toArray()
        .map((element) => $(element).text().trim())
        .find((text) => text.includes('来源：'))
        ?.replace(/^.*来源：/, '')
        .trim();

    article.find('img, video, source').each((_, element) => {
        const node = $(element);
        const src = node.attr('src');
        if (src) {
            node.attr('src', new URL(src, link).href);
        }
        const poster = node.attr('poster');
        if (poster) {
            node.attr('poster', new URL(poster, link).href);
        }
    });

    const video = article.find('video').first();
    const enclosureUrl = video.attr('src') || video.find('source').first().attr('src');

    return {
        title: $('.cont-art-bt h3').text().trim() || undefined,
        description: article.html() ?? undefined,
        author,
        pubDate: date ? timezone(parseDate(date, 'YYYY-MM-DD'), 8) : undefined,
        enclosure_url: enclosureUrl ? new URL(enclosureUrl, link).href : undefined,
        enclosure_type: enclosureUrl ? 'video/mp4' : undefined,
    };
}

function isInternalArticle(link: string): boolean {
    return Boolean(link && link.startsWith(`${rootUrl}/`) && link.endsWith('.htm') && !/\/index\d*\.htm$/.test(link));
}

function isNewsLikeLink(link: string): boolean {
    return (
        isInternalArticle(link) ||
        link.startsWith('https://mp.weixin.qq.com/') ||
        link.startsWith(`${rootUrl}/xb/`) ||
        link.startsWith('http://news.hnust.edu.cn/xb/') ||
        link.startsWith('https://m.chenshipin.com/') ||
        link.startsWith('http://www.mgtv.com/')
    );
}
