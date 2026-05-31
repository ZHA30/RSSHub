import type { CheerioAPI } from 'cheerio';
import { load } from 'cheerio';
import pMap from 'p-map';

import InvalidParameterError from '@/errors/types/invalid-parameter';
import type { Data, DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

const rootUrl = 'https://bangumi.tv';

const categories = {
    all: {
        name: '全部',
        path: '/blog',
        feedPath: '/feed/blog/all',
    },
    anime: {
        name: '动画',
        path: '/anime/blog',
        feedPath: '/feed/blog/anime',
    },
    book: {
        name: '书籍',
        path: '/book/blog',
        feedPath: '/feed/blog/book',
    },
    music: {
        name: '音乐',
        path: '/music/blog',
        feedPath: '/feed/blog/music',
    },
    game: {
        name: '游戏',
        path: '/game/blog',
        feedPath: '/feed/blog/game',
    },
    real: {
        name: '三次元',
        path: '/real/blog',
        feedPath: '/feed/blog/real',
    },
};

const categoryOptions = Object.entries(categories).map(([value, { name }]) => ({
    value,
    label: name,
}));

export const route: Route = {
    path: '/blog/:category?',
    categories: ['anime'],
    example: '/bangumi.tv/blog/anime',
    parameters: {
        category: {
            description: '日志分类，默认为全部',
            options: categoryOptions,
        },
    },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportRadar: true,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    radar: [
        {
            source: ['bangumi.tv/blog'],
            target: '/blog',
        },
        {
            source: ['bangumi.tv/anime/blog'],
            target: '/blog/anime',
        },
        {
            source: ['bangumi.tv/book/blog'],
            target: '/blog/book',
        },
        {
            source: ['bangumi.tv/music/blog'],
            target: '/blog/music',
        },
        {
            source: ['bangumi.tv/game/blog'],
            target: '/blog/game',
        },
        {
            source: ['bangumi.tv/real/blog'],
            target: '/blog/real',
        },
        {
            source: ['bgm.tv/blog'],
            target: '/blog',
        },
        {
            source: ['bgm.tv/anime/blog'],
            target: '/blog/anime',
        },
        {
            source: ['bgm.tv/book/blog'],
            target: '/blog/book',
        },
        {
            source: ['bgm.tv/music/blog'],
            target: '/blog/music',
        },
        {
            source: ['bgm.tv/game/blog'],
            target: '/blog/game',
        },
        {
            source: ['bgm.tv/real/blog'],
            target: '/blog/real',
        },
    ],
    name: '全站日志',
    maintainers: ['ZHA30'],
    handler,
    url: 'bangumi.tv/blog',
    description: `| 全部 | 动画  | 书籍 | 音乐  | 游戏 | 三次元 |
| ---- | ----- | ---- | ----- | ---- | ------ |
| all  | anime | book | music | game | real   |`,
};

async function handler(ctx): Promise<Data> {
    const category = ctx.req.param('category') ?? 'all';

    if (!Object.hasOwn(categories, category)) {
        throw new InvalidParameterError(`Invalid category: ${category}`);
    }

    const categoryConfig = categories[category];
    const currentUrl = new URL(categoryConfig.path, rootUrl).href;
    const response = await ofetch(currentUrl);
    const $ = load(response);
    const limit = ctx.req.query('limit') ? Number.parseInt(ctx.req.query('limit'), 10) : 20;

    const list: DataItem[] = $('#entry_list div.item')
        .toArray()
        .slice(0, limit)
        .map((element) => parseListItem($, element))
        .filter((item) => item.title && item.link);

    const items = await pMap(
        list,
        (item) =>
            cache.tryGet(`bangumi.tv:blog:${item.link}`, async () => {
                const detailResponse = await ofetch(item.link!);
                const $$ = load(detailResponse);
                const content = $$('#entry_content');

                normalizeLinks($$, content, item.link!);

                const description = content.html()?.trim() ?? item.description;
                const relatedSubjectsHtml = parseRelatedSubjects($$);

                return {
                    ...item,
                    description: [description, relatedSubjectsHtml].filter(Boolean).join('<br><br>'),
                };
            }),
        { concurrency: 3 }
    );

    return {
        title: category === 'all' ? 'Bangumi · 日志' : `Bangumi · ${categoryConfig.name}日志`,
        link: currentUrl,
        feedLink: new URL(categoryConfig.feedPath, rootUrl).href,
        language: 'zh-CN',
        description: category === 'all' ? '大家在 Bangumi 发表的日志' : `大家在 Bangumi 发表的${categoryConfig.name}日志`,
        item: items,
    };
}

function parseListItem($: CheerioAPI, element): DataItem {
    const item = $(element);
    const titleElement = item.find('h2.title a').first();
    const link = new URL(titleElement.attr('href') ?? '', rootUrl).href;
    const timeText = item.find('.time').text().replaceAll(/\s+/g, ' ').trim();
    const dateText = timeText.match(/(\d{4}-\d{1,2}-\d{1,2} \d{1,2}:\d{2})/)?.[1];
    const subjectElement = item.find('.time a[href^="/subject/"]').first();

    return {
        title: titleElement.text().trim(),
        link,
        guid: link,
        author: item.find('.time a[href^="/user/"]').first().text().trim(),
        pubDate: dateText ? timezone(parseDate(dateText, 'YYYY-M-D H:mm'), +8) : undefined,
        description: item.find('.content').html()?.trim(),
        category: subjectElement.length ? [subjectElement.text().trim()] : undefined,
        image: getAbsoluteUrl(item.find('.cover img').first().attr('src')),
    };
}

function normalizeLinks($: CheerioAPI, element, baseUrl: string) {
    element.find('a[href]').each((_, anchor) => {
        const href = $(anchor).attr('href');
        if (href) {
            $(anchor).attr('href', new URL(href, baseUrl).href);
        }
    });

    element.find('img[src]').each((_, image) => {
        const src = $(image).attr('src');
        if (src) {
            $(image).attr('src', getAbsoluteUrl(src, baseUrl));
        }
    });
}

function parseRelatedSubjects($: CheerioAPI) {
    const subjects = $('.entry-related-subjects a[href^="/subject/"]')
        .toArray()
        .map((anchor) => {
            const link = new URL($(anchor).attr('href') ?? '', rootUrl).href;
            const title = $(anchor).text().trim();

            return title ? { link, title } : undefined;
        })
        .filter((subject) => subject !== undefined);

    if (subjects.length === 0) {
        return;
    }

    const section = $('<section></section>');
    section.append('<h2>关联条目</h2>');
    const list = $('<ul></ul>');

    for (const subject of subjects) {
        const anchor = $('<a></a>').attr('href', subject.link).text(subject.title);
        $('<li></li>').append(anchor).appendTo(list);
    }

    section.append(list);

    return section.toString();
}

function getAbsoluteUrl(url: string | undefined, baseUrl = rootUrl) {
    return url ? new URL(url, baseUrl).href : undefined;
}
