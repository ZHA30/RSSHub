import { load } from 'cheerio';
import { raw } from 'hono/html';
import { renderToString } from 'hono/jsx/dom/server';
import pMap from 'p-map';
import sanitizeHtml from 'sanitize-html';

import type { Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

import { fetchPhoto, fetchVideo, fixDesc } from './utils';

type CategorySlug =
    | 'wpk-general-secretary-kim-jong-un'
    | 'revolutionary-anecdote'
    | 'always-in-memory-of-people'
    | 'latest-news'
    | 'top-news'
    | 'documents'
    | 'news-commentary'
    | 'home-news'
    | 'world'
    | 'external'
    | 'society-life'
    | 'celebrations-for-new-year';

type ListItem = {
    title: string;
    link: string;
    pubDate?: Date;
    description?: string;
};

const defaultCategory: CategorySlug = 'latest-news';

const categories: Record<CategorySlug, { id: string; title: string }> = {
    'wpk-general-secretary-kim-jong-un': {
        id: '54c0ca4ca013a92cc9cf95bd4004c61a',
        title: 'WPK General Secretary Kim Jong Un',
    },
    'revolutionary-anecdote': {
        id: 'f7e5e24e7923d024ac914e4d78ccbb35',
        title: 'Revolutionary Anecdote',
    },
    'always-in-memory-of-people': {
        id: '82c82d91066ac44e4579b200154399f0',
        title: 'Always in Memory of People',
    },
    'latest-news': {
        id: '1ee9bdb7186944f765208f34ecfb5407',
        title: 'Latest News',
    },
    'top-news': {
        id: '5394b80bdae203fadef02522cfb578c0',
        title: 'Top News',
    },
    documents: {
        id: 'a8754921399857ebdbb97a98a1e741f5',
        title: 'Documents',
    },
    'news-commentary': {
        id: '12c03a49f7dbe829bceea8ac77088c21',
        title: 'News Commentary',
    },
    'home-news': {
        id: 'b2b3bcc1b0a4406ab0c36e45d5db58db',
        title: 'Home News',
    },
    world: {
        id: '593143484cf15d48ce85c26139582395',
        title: 'World',
    },
    external: {
        id: '0f98b4623a3ef82aeea78df45c423fd0',
        title: 'External',
    },
    'society-life': {
        id: '93102e5a735d03979bc58a3a7aefb75a',
        title: 'Society-Life',
    },
    'celebrations-for-new-year': {
        id: 'c04c7cce165c70654e319c06e5f3e7b5',
        title: 'Celebrations for New Year',
    },
};

const resolveCategory = (category?: string): CategorySlug => (category && category in categories ? (category as CategorySlug) : defaultCategory);

export const route: Route = {
    path: '/:lang/:category?',
    categories: ['traditional-media'],
    example: '/kcna/en/top-news',
    parameters: {
        lang: 'Language, refer to the table below',
        category: {
            description: 'Category slug, refer to the table below',
            options: Object.entries(categories).map(([value, { title }]) => ({
                value,
                label: title,
            })),
            default: defaultCategory,
        },
    },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: true,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    radar: [
        {
            source: ['www.kcna.kp/:lang', 'www.kcna.kp/:lang/category/articles.kcmsf'],
            target: '/:lang',
        },
        {
            source: ['www.kcna.kp/:lang/category/articles/q/:id.kcmsf'],
            target: (params, url) => {
                const id = new URL(url).pathname.match(/\/q\/([^.]+)\.kcmsf$/)?.[1];
                const category = Object.entries(categories).find(([, value]) => value.id === id)?.[0];
                return `/${params.lang}${category && category !== defaultCategory ? `/${category}` : ''}`;
            },
        },
    ],
    name: 'News',
    maintainers: ['Rongronggg9'],
    handler,
    description: `| Language | 조선어 | English | 中国语 | Русский | Español | 日本語 |
| -------- | ------ | ------- | ------ | ------- | ------- | ------ |
| \`:lang\`  | \`kp\`   | \`en\`    | \`cn\`   | \`ru\`    | \`es\`    | \`jp\`   |

| Category                          | \`:category\`                         |
| --------------------------------- | ----------------------------------- |
| WPK General Secretary Kim Jong Un | \`wpk-general-secretary-kim-jong-un\` |
| Revolutionary Anecdote            | \`revolutionary-anecdote\`            |
| Always in Memory of People        | \`always-in-memory-of-people\`        |
| Latest News (default)             | \`latest-news\`                       |
| Top News                          | \`top-news\`                          |
| Home News                         | \`home-news\`                         |
| Documents                         | \`documents\`                         |
| World                             | \`world\`                             |
| Society-Life                      | \`society-life\`                      |
| External                          | \`external\`                          |
| Celebrations for New Year         | \`celebrations-for-new-year\`         |
| News Commentary                   | \`news-commentary\`                   |`,
};

async function handler(ctx) {
    const { lang, category } = ctx.req.param();
    const categorySlug = resolveCategory(category);
    const categoryId = categories[categorySlug].id;

    const rootUrl = 'http://www.kcna.kp';
    const pageUrl = categorySlug === defaultCategory ? `${rootUrl}/${lang}/category/articles.kcmsf` : `${rootUrl}/${lang}/category/articles/q/${categoryId}.kcmsf`;

    const response = await got(pageUrl);
    const $ = load(response.data);

    // fix <nobr><span class="fSpecCs">???</span></nobr>
    const title = sanitizeHtml($('head > title').text(), { allowedTags: [], allowedAttributes: {} });

    const list = $('.article-link li a')
        .toArray()
        .map((element): ListItem => {
            const item = $(element);
            const dateElem = item.find('.publish-time');
            const dateString = dateElem.text().match(/\d+\.\d+\.\d+/);
            dateElem.remove();
            return {
                title: item.text(),
                link: rootUrl + item.attr('href'),
                pubDate: dateString ? timezone(parseDate(dateString[0]), +9) : undefined,
            };
        });

    // avoid being IP-banned
    // if being banned, 103.35.255.254 (the last hop before www.kcna.kp - 175.45.176.71) will drop the packet
    // verify that with `mtr www.kcna.kp -Tz`
    const items = await pMap(
        list,
        (item: ListItem) =>
            cache.tryGet(item.link, async () => {
                const response = await got(item.link);
                const $ = load(response.data);
                item.title = $('.article-main-title').text() || item.title;

                const dateElem = $('.publish-time');
                const dateString = dateElem.text().match(/\d+\.\d+\.\d+/);
                dateElem.remove();
                item.pubDate = dateString ? timezone(parseDate(dateString[0]), +9) : item.pubDate;

                const description = fixDesc($, $('.article-content-body .content-wrapper'));

                // add picture and video
                const media = $('.media-icon a')
                    .toArray()
                    .map((elem) => rootUrl + elem.attribs.href);
                let photo, video;
                await Promise.all(
                    media.map(async (medium) => {
                        if (medium.includes('/photo/')) {
                            photo = await fetchPhoto(ctx, medium);
                        } else if (medium.includes('/video/')) {
                            video = await fetchVideo(ctx, medium);
                        }
                    })
                );

                item.description = renderToString(
                    <>
                        {description ? raw(description) : null}
                        {photo ? (
                            <>
                                <br />
                                {raw(photo)}
                            </>
                        ) : null}
                        {video ? (
                            <>
                                <br />
                                {raw(video)}
                            </>
                        ) : null}
                    </>
                );

                return item;
            }),
        { concurrency: 3 }
    );

    return {
        title,
        link: pageUrl,
        item: items,
    };
}
