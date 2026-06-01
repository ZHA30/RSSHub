import { load } from 'cheerio';

import type { DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

const rootUrl = 'https://rwxy.hnust.edu.cn';

const categories = {
    rwxw: {
        name: '学院新闻',
        path: 'lmes/rwxw/index.htm',
    },
    xytg: {
        name: '通知公告',
        path: 'lmes/xytg/index.htm',
    },
    xyfc: {
        name: '学院风采',
        path: 'lmes/xyfc/index.htm',
    },
};

type CategoryKey = keyof typeof categories;

const isCategoryKey = (category: string): category is CategoryKey => category in categories;

export const route: Route = {
    path: '/rwxy/:category?',
    categories: ['university'],
    example: '/hnust/rwxy/rwxw',
    parameters: { category: '分类，默认为学院新闻' },
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
            source: ['rwxy.hnust.edu.cn/lmes/:category/index.htm'],
            target: '/rwxy/:category',
        },
    ],
    name: '人文学院',
    maintainers: ['ZHA30'],
    handler,
    url: 'rwxy.hnust.edu.cn',
    description: `| 学院新闻 | 通知公告 | 学院风采 |
| -------- | -------- | -------- |
| rwxw     | xytg     | xyfc     |`,
};

async function handler(ctx) {
    const categoryParam = ctx.req.param('category') ?? 'rwxw';
    const categoryKey = isCategoryKey(categoryParam) ? categoryParam : 'rwxw';
    const category = categories[categoryKey];
    const currentUrl = new URL(category.path, rootUrl).href;

    const response = await got(currentUrl);
    const $ = load(response.data);
    const items = parseItems($, currentUrl);

    const result = await Promise.all(
        items.map((item) =>
            item.link && isInternalArticle(item.link)
                ? cache.tryGet(`hnust:rwxy:detail:${item.link}`, async () => {
                      try {
                          const detail = await parseDetail(item.link!);
                          return {
                              ...item,
                              ...detail,
                              pubDate: detail.pubDate ?? item.pubDate,
                              image: detail.image ?? item.image,
                          };
                      } catch {
                          return item;
                      }
                  })
                : item
        )
    );

    return {
        title: `湖南科技大学人文学院 - ${category.name}`,
        link: currentUrl,
        description: `湖南科技大学人文学院 - ${category.name}`,
        item: result,
    };
}

function parseItems($: ReturnType<typeof load>, currentUrl: string): DataItem[] {
    if ($('.list01 li').length) {
        return parseListItems($, currentUrl);
    }

    if ($('.pic_list li').length) {
        return parsePictureItems($, currentUrl);
    }

    throw new Error('No humanities college items found');
}

function parseListItems($: ReturnType<typeof load>, currentUrl: string): DataItem[] {
    const items: DataItem[] = [];

    $('.list01 li').each((_, element) => {
        const item = $(element);
        const titleElement = item.find('a').first();
        const title = titleElement.text().trim();

        if (!title) {
            return;
        }

        const link = new URL(titleElement.attr('href') ?? '', currentUrl).href;
        const date = item.find('.rightDate').text().trim();

        items.push({
            title,
            link,
            pubDate: date ? timezone(parseDate(date, 'YYYY-MM-DD'), 8) : undefined,
        });
    });

    return items;
}

function parsePictureItems($: ReturnType<typeof load>, currentUrl: string): DataItem[] {
    const items: DataItem[] = [];

    $('.pic_list li').each((_, element) => {
        const item = $(element);
        const titleElement = item.find('.list_title a').first();
        const title = titleElement.attr('title')?.trim() || titleElement.text().trim();

        if (!title) {
            return;
        }

        const link = new URL(titleElement.attr('href') ?? '', currentUrl).href;
        const image = item.find('img').first().attr('src')?.trim();

        items.push({
            title,
            link,
            image: image ? new URL(image, currentUrl).href : undefined,
        });
    });

    return items;
}

async function parseDetail(link: string): Promise<Partial<DataItem>> {
    const response = await got(link);
    const $ = load(response.data);
    const article = $('.article.art').first();

    article.find('script, style, noscript').remove();
    article.find('*').each((_, element) => {
        const node = $(element);

        node.removeAttr('style').removeAttr('class').removeAttr('width').removeAttr('height').removeAttr('border').removeAttr('vspace').removeAttr('hspace');
        for (const attribute of Object.keys(element.attribs ?? {})) {
            if (attribute.startsWith('on')) {
                node.removeAttr(attribute);
            }
        }
    });
    article.find('img, video, source').each((_, element) => {
        const node = $(element);
        const src = node.attr('src') || node.attr('data-src') || node.attr('data-original');
        if (src) {
            node.attr('src', new URL(src, link).href);
        }
        const poster = node.attr('poster');
        if (poster) {
            node.attr('poster', new URL(poster, link).href);
        }
    });
    article.find('a[href]').each((_, element) => {
        const node = $(element);
        const href = node.attr('href');
        if (href) {
            node.attr('href', new URL(href, link).href);
        }
    });

    const date = $('.articleAuthor span')
        .toArray()
        .map((element) => $(element).text().trim())
        .find((text) => text.startsWith('时间：'))
        ?.replace(/^时间：/, '')
        .trim();
    const image = article.find('img').first().attr('src');
    const video = article.find('video').first();
    const enclosureUrl = video.attr('src') || video.find('source').first().attr('src');

    return {
        title: $('.articleTitle.article02 h2').text().trim() || undefined,
        description: article.html() ?? undefined,
        pubDate: date ? timezone(parseDate(date), 8) : undefined,
        image: image || undefined,
        enclosure_url: enclosureUrl ? new URL(enclosureUrl, link).href : undefined,
        enclosure_type: enclosureUrl ? 'video/mp4' : undefined,
    };
}

function isInternalArticle(link: string): boolean {
    return link.startsWith(`${rootUrl}/`) && link.endsWith('.htm') && !/\/index\d*\.htm$/.test(link);
}
