import { load } from 'cheerio';
import { renderToString } from 'hono/jsx/dom/server';

import type { Route } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

const rootUrl = 'https://www.shueisha.co.jp';
const comicsUrl = `${rootUrl}/books/comics/index.html`;

const categories = {
    all: {
        name: '全部',
    },
    boy: {
        name: '少年',
        classifications: ['少年'],
    },
    girl: {
        name: '少女・女性',
        classifications: ['少女・女性'],
    },
    young: {
        name: '青年',
        classifications: ['青年'],
    },
    other: {
        name: 'その他',
        classifications: ['その他'],
    },
};

type CategoryKey = keyof typeof categories;

type ShueishaBook = {
    classification_datas: string[];
    ssid: string;
    isbn: string;
    label_name: string;
    item_name: string;
    author_name_datas: string[];
    author_role_datas: string[];
    image_url?: string;
    tameshiyomi_flg: number;
};

type ShueishaReleaseGroup = {
    release_date: string;
    item_datas: ShueishaBook[];
};

type ShueishaData = {
    datas: ShueishaReleaseGroup[];
};

const extractInitialData = (html: string): ShueishaData => {
    const script = load(html)('script:contains("var ssd =")').first().text();
    const matched = script.match(/var ssd = (\{.*?\});\s*var ssdMags =/s);

    if (!matched) {
        throw new Error('Failed to extract comics data from Shueisha page');
    }

    return JSON.parse(matched[1]);
};

const getBookLink = (isbn: string) => `${rootUrl}/books/items/contents.html?isbn=${encodeURIComponent(isbn)}`;

const renderDescription = (item: ShueishaBook) =>
    renderToString(<div>{item.image_url && <img src={item.image_url} alt={item.item_name} />}</div>);

export const route: Route = {
    path: '/comics/:category?',
    categories: ['reading'],
    example: '/shueisha/comics/boy',
    parameters: { category: '分类，all - 全部，boy - 少年，girl - 少女・女性，young - 青年，other - その他，默认为 all' },
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
            source: ['www.shueisha.co.jp/books/comics/index.html', 'www.shueisha.co.jp/books/comics/'],
            target: '/comics',
        },
    ],
    name: 'コミックス',
    maintainers: ['ZHA30'],
    handler,
    url: 'www.shueisha.co.jp/books/comics/index.html',
};

async function handler(ctx) {
    const category = (ctx.req.param('category') || 'all') as CategoryKey;
    const categoryConfig = categories[category];

    if (!categoryConfig) {
        throw new Error(`Invalid category: ${category}`);
    }

    const response = await ofetch(comicsUrl);
    const data = extractInitialData(response);
    const item = data.datas.flatMap((group) =>
        group.item_datas
            .filter((book) => !('classifications' in categoryConfig) || book.classification_datas.some((classification) => categoryConfig.classifications.includes(classification)))
            .map((book) => ({
                title: book.item_name,
                link: getBookLink(book.isbn),
                guid: book.ssid || book.isbn,
                author: book.author_name_datas.join('、'),
                category: [book.label_name, ...book.classification_datas],
                pubDate: timezone(parseDate(group.release_date, 'YYYY-MM-DD'), +9),
                description: renderDescription(book),
            }))
    );

    return {
        title: `集英社 コミックス - ${categoryConfig.name}`,
        link: comicsUrl,
        description: '集英社コミックの新刊発売予定と試し読み',
        item,
    };
}
