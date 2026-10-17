import { decodeHTML } from 'entities';
import { renderToString } from 'hono/jsx/dom/server';

import type { Route } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const rootUrl = 'https://www.shogakukan.co.jp';

type ShogakukanPage = {
    props: {
        page_title: string;
        meta_description?: string;
        books: {
            data: Array<{
                document: {
                    content: ShogakukanBook;
                };
            }>;
        };
    };
};

type ShogakukanBook = {
    id: string;
    slug: string;
    url: string;
    image_url?: string;
    title: string;
    body?: string;
    author?: string;
    publish_date?: string;
    publish_date_tz?: string;
    isbn_cd?: string;
    series_name?: string;
    body_hyouji?: {
        text?: string;
    };
    header_hyouji?: {
        text?: string;
    };
    price_hyouji?: {
        price_title_now?: string;
        teika_now?: number;
    };
    sho_source?: {
        series_name?: string;
    };
    purchases?: Array<{
        purchase: string;
    }>;
};

const getComicsUrl = (type: string) => `${rootUrl}/comics/type/${encodeURIComponent(type)}`;

const extractPageData = (html: string): ShogakukanPage => {
    const matched = html.match(/<div id="app" data-page="([^"]+)"/);

    if (!matched) {
        throw new Error('Failed to extract Shogakukan page data');
    }

    return JSON.parse(decodeHTML(matched[1]));
};

const resolveUrl = (url: string) => new URL(url, rootUrl).href;

const renderDescription = (book: ShogakukanBook) => {
    const description = decodeHTML(book.body_hyouji?.text || book.body || '');
    const price = book.price_hyouji?.teika_now ? `${book.price_hyouji.price_title_now || '定価'} ${book.price_hyouji.teika_now}円` : undefined;
    const categories = getCategories(book);

    return renderToString(
        <div>
            {book.image_url && <img src={resolveUrl(book.image_url)} alt={book.title} />}
            {book.header_hyouji?.text && <p>{book.header_hyouji.text}</p>}
            {description && <p dangerouslySetInnerHTML={{ __html: description }} />}
            <table>
                <tbody>
                    {book.series_name && (
                        <tr>
                            <td>シリーズ</td>
                            <td>{book.series_name}</td>
                        </tr>
                    )}
                    {book.sho_source?.series_name && (
                        <tr>
                            <td>掲載誌・レーベル</td>
                            <td>{book.sho_source.series_name}</td>
                        </tr>
                    )}
                    {book.isbn_cd && (
                        <tr>
                            <td>ISBN</td>
                            <td>{book.isbn_cd}</td>
                        </tr>
                    )}
                    {price && (
                        <tr>
                            <td>価格</td>
                            <td>{price}</td>
                        </tr>
                    )}
                    {categories.length > 0 && (
                        <tr>
                            <td>分類</td>
                            <td>{categories.join('、')}</td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
};

const getCategories = (book: ShogakukanBook): string[] => {
    const categories: string[] = [];

    if (book.series_name) {
        categories.push(book.series_name);
    }

    if (book.sho_source?.series_name) {
        categories.push(book.sho_source.series_name);
    }

    if (book.purchases) {
        categories.push(...book.purchases.map((item) => item.purchase));
    }

    return categories;
};

export const route: Route = {
    path: '/comics/:type?',
    categories: ['reading'],
    example: '/shogakukan/comics/all',
    parameters: { type: '種類，源站 `comics/type/:type` 的分類，默認為 `all`' },
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
            source: ['www.shogakukan.co.jp/comics/type/all'],
            target: '/comics/all',
        },
    ],
    name: 'コミックス・ラノベ 新刊一覧',
    maintainers: ['ZHA30'],
    handler,
    url: 'www.shogakukan.co.jp/comics/type/all',
};

async function handler(ctx) {
    const { type = 'all' } = ctx.req.param();
    const currentUrl = getComicsUrl(type);
    const response = await ofetch<string>(currentUrl);
    const data = extractPageData(response);

    return {
        title: data.props.page_title,
        link: currentUrl,
        description: data.props.meta_description,
        item: data.props.books.data.map(({ document }) => {
            const book = document.content;
            const publishedAt = book.publish_date_tz || book.publish_date;

            return {
                title: book.title,
                link: resolveUrl(book.url),
                guid: book.id || book.slug,
                author: book.author,
                category: getCategories(book),
                pubDate: publishedAt ? parseDate(publishedAt) : undefined,
                description: renderDescription(book),
            };
        }),
    };
}
