import InvalidParameterError from '@/errors/types/invalid-parameter';
import type { Route } from '@/types';
import got from '@/utils/got';

import utils from './utils';

export const route: Route = {
    path: '/product/:keyword',
    categories: ['social-media'],
    example: '/coolapk/product/华为MatePadMini',
    parameters: { keyword: '产品名，路由会搜索并使用最佳匹配的产品结果' },
    features: {
        requireConfig: [
            {
                name: 'ALLOW_USER_HOTLINK_TEMPLATE',
                optional: true,
                description: '设置为`true`并添加`image_hotlink_template`参数来代理图片',
            },
        ],
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: '产品',
    maintainers: ['ZHA30'],
    handler,
};

async function handler(ctx) {
    const keyword = ctx.req.param('keyword');
    const product = await getProductByKeyword(keyword);

    return await getProductFeed(product.id, product.title, product.url);
}

async function getProductByKeyword(keyword) {
    const searchUrl = new URL('/v6/search', utils.base_url);
    searchUrl.searchParams.append('page', '1');
    searchUrl.searchParams.append('type', 'app');
    searchUrl.searchParams.append('searchValue', keyword);

    const response = await got(searchUrl, {
        headers: utils.getHeaders(),
    });
    const products = response.data.data?.find((item) => item.url === 'tab://product')?.entities?.filter((item) => item.entityType === 'product');
    const exactMatch = products?.find((item) => normalizeTitle(item.title) === normalizeTitle(keyword));
    const product = exactMatch || products?.[0];
    if (!product?.id) {
        throw new InvalidParameterError('没有搜索到这个产品。');
    }

    return product;
}

function normalizeTitle(title) {
    return title.replaceAll(/\s+/g, '').toLowerCase();
}

async function getProductFeed(id, fallbackTitle, fallbackUrl) {
    const fullUrl = new URL('/v6/page/dataList', utils.base_url);
    fullUrl.searchParams.append('url', '/page?url=/product/feedList');
    fullUrl.searchParams.append('id', id);
    fullUrl.searchParams.append('type', 'feed');
    fullUrl.searchParams.append('page', '1');
    fullUrl.searchParams.append('listType', 'dateline_desc');

    const response = await got(fullUrl, {
        headers: utils.getHeaders(),
    });
    const data = response.data.data;
    if (!data) {
        throw new InvalidParameterError('这个产品还没有动态内容。');
    }

    let targetTitle = fallbackTitle;
    let targetUrl = fallbackUrl;
    let out = await Promise.all(
        data.map((item) => {
            if (item.targetRow) {
                targetTitle ||= item.targetRow.title;
                targetUrl ||= item.targetRow.url;
            }

            return utils.parseDynamic(item);
        })
    );

    out = out.filter(Boolean);
    if (out.length === 0) {
        throw new InvalidParameterError('这个产品还没有图文或动态。');
    }

    return {
        title: `酷安产品-${targetTitle || id}`,
        link: `https://www.coolapk.com${targetUrl || `/product/${id}`}`,
        description: `酷安产品-${targetTitle || id}`,
        item: out,
    };
}
