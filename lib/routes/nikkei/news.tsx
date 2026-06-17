import { load } from 'cheerio';
import { raw } from 'hono/html';
import { renderToString } from 'hono/jsx/dom/server';

import type { Data, Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';

type NikkeiNewsItem = {
    title: string;
    link: string;
    image?: string;
    category: string[];
    paywall: boolean;
    pubDate?: string;
    description?: string;
};

export const route: Route = {
    path: ['/news', '/news/:category/:article_type?'],
    categories: ['traditional-media'],
    example: '/nikkei/news',
    parameters: { category: 'Category, see table below', article_type: 'Only includes free articles, set `free` to enable, disabled by default' },
    radar: [
        {
            source: ['www.nikkei.com/news/category'],
            target: '/news',
        },
        {
            source: ['www.nikkei.com/:category/archive', 'www.nikkei.com/:category'],
            target: '/news/:category',
        },
    ],
    name: 'News',
    maintainers: ['Arracc', 'ladeng07', 'ZHA30'],
    handler,
    description: `| 総合 | オピニオン | 経済    | 政治     | 金融      | マーケット | ビジネス | マネーのまなび | テック     | 国際          | スポーツ | 社会・調査 | 地域  | 文化    | ライフスタイル |
| ---- | ---------- | ------- | -------- | --------- | ---------- | -------- | -------------- | ---------- | ------------- | -------- | ---------- | ----- | ------- | -------------- |
| news | opinion    | economy | politics | financial | business   | 不支持   | 不支持         | technology | international | sports   | society    | local | culture | lifestyle      |`,
};

async function handler(ctx): Promise<Data> {
    const baseUrl = 'https://www.nikkei.com';
    const { category = 'news', article_type = 'paid' } = ctx.req.param();
    const url = category === 'news' ? `${baseUrl}/news/category/` : `${baseUrl}/${category}/archive/`;

    const response = await got(url);
    const $ = load(response.data);

    const categoryName =
        $('h1')
            .first()
            .text()
            .trim()
            .replaceAll(/^「|」$/g, '') || (category === 'news' ? '速報' : category);

    const list: NikkeiNewsItem[] = $('main article')
        .toArray()
        .map((item) => extractItem($, item, baseUrl))
        .filter((item): item is NikkeiNewsItem => !!item && !!item.link && !!item.title);

    const items = await Promise.all(
        list.map((item) =>
            cache.tryGet(item.link, async () => {
                const { data: detailResponse } = await got(item.link);
                const $ = load(detailResponse);

                $('.notFloated_n1oadkwi, script, style, noscript').remove();

                const publishedTime = $('meta[property="article:published_time"]').attr('content');
                const articleBody = $('section[data-track-article-content]').first().html() ?? $('main article section').first().html() ?? $('main').find('article').first().html() ?? $('main').find('section').first().html() ?? '';

                const description = renderToString(
                    <>
                        {item.paywall && item.image ? (
                            <>
                                {raw(item.image)}
                                <br />
                            </>
                        ) : null}
                        {articleBody ? raw(articleBody) : $('meta[name="description"]').attr('content')}
                    </>
                );

                return {
                    ...item,
                    pubDate: publishedTime ? parseDate(publishedTime) : undefined,
                    description,
                };
            })
        )
    );

    const feedItems = (article_type === 'free' ? items.filter((item) => !item.paywall) : items).map(({ paywall: _paywall, ...item }) => item);

    return {
        title: '日本経済新聞 - ' + categoryName,
        description: $('meta[name="description"]').attr('content'),
        link: url,
        image: $('meta[property="og:image"]').attr('content'),
        language: 'ja',
        item: feedItems,
    };
}

function extractItem($, element, baseUrl): NikkeiNewsItem | null {
    const article = $(element);
    const articleLink = article.find('h1 a[href^="/article/"], h2 a[href^="/article/"], h3 a[href^="/article/"], a[href^="/article/"]').first();
    const href = articleLink.attr('href');

    if (!href) {
        return null;
    }

    const title = articleLink.text().trim() || article.find('h1, h2, h3').first().text().trim() || article.find('a[href^="/article/"]').first().text().trim();

    const image = article.find('img[src*="article-image-ix"], img[src*="imgix-proxy"], img[src^="https://article-image-ix.nikkei.com"]').first().removeAttr('style').removeAttr('width').removeAttr('height');

    const categories = article
        .find('a')
        .toArray()
        .map((item) => $(item))
        .filter((item) => {
            const href = item.attr('href');
            return href && href !== articleLink.attr('href') && !href.startsWith('/article/');
        })
        .map((item) => item.text().trim())
        .filter(Boolean);

    return {
        title,
        link: new URL(href, baseUrl).href,
        image: image.length ? $.html(image) : undefined,
        category: [...new Set(categories)],
        paywall: article.text().includes('会員限定記事') || article.find('img[alt*="会員限定"], img[src*="locked_square"], img[src*="lock"]').length > 0,
    };
}
