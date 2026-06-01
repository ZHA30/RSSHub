import type { Route } from '@/types';

import { getBooks } from './utils';

const categories = {
    books: {
        name: '新書上架',
        path: 'webpagebooks.aspx',
    },
    bl: {
        name: '紫界專區',
        path: 'ThemeBLBooks.aspx',
    },
    beautiful: {
        name: '唯美專區',
        path: 'ThemeBeautiful.aspx',
    },
    gl: {
        name: '百合姬專區',
        path: 'ThemeGL.aspx',
    },
};

export const route: Route = {
    path: '/comic/:category?',
    categories: ['reading'],
    example: '/tongli/comic/books',
    parameters: { category: '分類，`books` 新書上架、`bl` 紫界專區、`beautiful` 唯美專區、`gl` 百合姬專區，默認為 `books`' },
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
            source: ['tongli.com.tw/webpagebooks.aspx'],
            target: '/comic/books',
        },
        {
            source: ['tongli.com.tw/ThemeBL.aspx', 'tongli.com.tw/ThemeBLBooks.aspx'],
            target: '/comic/bl',
        },
        {
            source: ['tongli.com.tw/ThemeBeautiful.aspx'],
            target: '/comic/beautiful',
        },
        {
            source: ['tongli.com.tw/ThemeGL.aspx'],
            target: '/comic/gl',
        },
    ],
    name: '漫畫',
    maintainers: ['ZHA30'],
    handler,
};

async function handler(ctx) {
    const { category = 'books' } = ctx.req.param();
    const config = categories[category] ?? categories.books;

    return await getBooks(config.path, `漫畫 - ${config.name}`);
}
