import { load } from 'cheerio';
import { renderToString } from 'hono/jsx/dom/server';

import type { DataItem, Route } from '@/types';
import { ViewType } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const baseUrl = 'https://news.web.nhk';
const routeUrl = `${baseUrl}/newsweb/pl/news-nwa-latest-nationwide`;
const detailApiBaseUrl = 'https://api.web.nhk/r8/t/newsarticle/na';
const cookieCacheKey = 'nhk:news-web:cookie';
const cookieCacheMaxAge = 50 * 60;

type NewsArticleDetail = {
    title?: string;
    abstract?: string;
    description?: string;
    genre?: string | string[];
    image?: {
        medium?: {
            url?: string;
        };
        icon?: {
            url?: string;
        };
    };
    detailedArticleBody?: {
        markedLead?: string;
        markedBody?: string;
    };
};

type DetailContent = {
    description?: string;
    image?: string;
    category?: string[];
};

type ListItem = DataItem & {
    id?: string;
};

export const route: Route = {
    path: '/news_web/latest',
    categories: ['traditional-media'],
    view: ViewType.Articles,
    example: '/nhk/news_web/latest',
    parameters: {},
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
            source: ['news.web.nhk/newsweb/pl/news-nwa-latest-nationwide'],
            target: '/news_web/latest',
        },
    ],
    name: 'ニュース - 新着ニュース一覧',
    maintainers: ['ZHA30'],
    handler,
    url: 'news.web.nhk/newsweb/pl/news-nwa-latest-nationwide',
};

async function handler() {
    const response = await ofetch<string>(routeUrl);
    const $ = load(response);
    const seen = new Set<string>();
    const pageTitle = $('h1').first().text().trim() || '新着ニュース一覧';

    const listItems = $('main a[href*="/newsweb/na/"]')
        .toArray()
        .map((element) => {
            const item = $(element);
            const href = item.attr('href');
            const title = item.find('p').first().text().trim();
            const datetime = item.find('time[datetime]').first().attr('datetime');

            if (!href || !title) {
                return null;
            }

            const link = new URL(href, baseUrl).href;

            if (seen.has(link)) {
                return null;
            }
            seen.add(link);

            const image = item.find('img').first().attr('src');
            const id = new URL(link).pathname.split('/').at(-1);
            const listItem: ListItem = {
                title,
                link,
                guid: link,
            };

            if (id) {
                listItem.id = id;
            }

            if (datetime) {
                listItem.pubDate = parseDate(datetime);
            }

            if (image) {
                listItem.description = renderToString(<img src={image} />);
                listItem.image = image;
            }

            return listItem;
        })
        .filter((item): item is ListItem => item !== null);

    let authCookie: string | undefined;
    try {
        authCookie = await getAccountlessCookie();
    } catch {
        // The list page remains usable when accountless article access is unavailable.
    }

    const items = await Promise.all(
        listItems.map(async ({ id, ...item }) => {
            if (!authCookie || !id || !item.link) {
                return item;
            }
            const itemLink = item.link;

            let detail: DetailContent | undefined;
            try {
                detail = await cache.tryGet(`nhk:news-web:detail:${id}`, () => fetchDetailContent(id, itemLink, authCookie));
            } catch {
                // Keep the feed available with list metadata if a single detail request fails.
            }

            const completedItem: DataItem = {
                ...item,
            };

            if (detail?.description) {
                completedItem.description = detail.description;
            }
            if (detail?.image) {
                completedItem.image = detail.image;
            }
            if (detail?.category) {
                completedItem.category = detail.category;
            }

            return completedItem;
        })
    );

    return {
        title: `${pageTitle} | NHKニュース`,
        link: routeUrl,
        item: items,
    };
}

async function getAccountlessCookie() {
    return await cache.tryGet(
        cookieCacheKey,
        async () => {
            const buildAuthorizeResponse = await ofetch.raw('https://news.web.nhk/tix/build_authorize', {
                query: {
                    idp: 'a-alaz',
                    profileType: 'abroad',
                    redirect_uri: routeUrl,
                    entity: 'none',
                    area: '130',
                    pref: '13',
                    jisx0402: '13101',
                    postal: '1000001',
                },
                redirect: 'manual',
            });
            const buildAuthorizeCookie = getCookies(buildAuthorizeResponse.headers);
            const authorizeLocation = buildAuthorizeResponse.headers.get('location');

            if (!authorizeLocation) {
                throw new Error('NHK accountless authorize location not found');
            }

            const authorizeResponse = await ofetch.raw(authorizeLocation, {
                redirect: 'manual',
            });
            const idpLocation = authorizeResponse.headers.get('location');

            if (!idpLocation) {
                throw new Error('NHK accountless idp location not found');
            }

            const idpResponse = await ofetch.raw(idpLocation, {
                headers: {
                    cookie: buildAuthorizeCookie,
                },
                redirect: 'manual',
            });
            const idpCookie = getCookies(idpResponse.headers);

            return [buildAuthorizeCookie, idpCookie].filter(Boolean).join('; ');
        },
        cookieCacheMaxAge
    );
}

async function fetchDetailContent(id: string, link: string, authCookie: string): Promise<DetailContent> {
    const detail = await ofetch<NewsArticleDetail>(`${detailApiBaseUrl}/${id}.json`, {
        headers: {
            cookie: authCookie,
            referer: link,
            origin: baseUrl,
        },
    });

    const body = [detail.detailedArticleBody?.markedLead, detail.detailedArticleBody?.markedBody].filter(Boolean).join('\n\n') || detail.abstract || detail.description;
    const image = detail.image?.medium?.url ?? detail.image?.icon?.url;
    const description = renderDescription(image, body);
    const category = normalizeCategory(detail.genre);
    const content: DetailContent = {};

    if (description) {
        content.description = description;
    }
    if (image) {
        content.image = image;
    }
    if (category) {
        content.category = category;
    }

    return content;
}

function renderDescription(image?: string, body?: string) {
    if (!image && !body) {
        return;
    }

    const paragraphs = body
        ?.split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean);

    return renderToString(
        <>
            {image && <img src={image} />}
            {paragraphs?.map((paragraph) => (
                <p>{paragraph}</p>
            ))}
        </>
    );
}

function normalizeCategory(category?: string | string[]) {
    if (!category) {
        return;
    }

    const categories = Array.isArray(category) ? category : [category];
    const filteredCategories = categories.map((item) => item.trim()).filter(Boolean);

    if (filteredCategories.length === 0) {
        return;
    }

    return filteredCategories;
}

function getCookies(headers: Headers) {
    return headers
        .getSetCookie()
        .map((cookie) => cookie.split(';')[0])
        .join('; ');
}
