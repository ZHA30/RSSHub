import { load } from 'cheerio';

import type { DataItem } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

const baseUrl = 'https://www.tongli.com.tw/';

export { baseUrl };

export async function enrichBookDetail(item: DataItem, prefixDescription?: string, includePubDate = true) {
    const detail = await cache.tryGet(`tongli:books:detail:${item.link}`, async () => {
        const { data: response } = await got(item.link!);
        const $ = load(response);

        const description = $('#ContentPlaceHolder1_Description').html();
        const pubDateText = $('#ContentPlaceHolder1_UplineDate').text().trim();

        return {
            description,
            pubDate: pubDateText ? timezone(parseDate(pubDateText, 'YYYY/M/D'), +8) : undefined,
        };
    });

    return {
        ...item,
        description: [prefixDescription, item.description, detail.description ? `<p>${detail.description}</p>` : undefined].filter(Boolean).join(''),
        pubDate: includePubDate ? detail.pubDate : undefined,
    };
}

export async function getBooks(path: string, title: string) {
    const currentUrl = new URL(path, baseUrl);

    if (!currentUrl.searchParams.has('Page') && !currentUrl.searchParams.has('page')) {
        currentUrl.searchParams.set('page', '1');
    }
    if (!currentUrl.searchParams.has('S') && !currentUrl.searchParams.has('s')) {
        currentUrl.searchParams.set('s', '1');
    }

    const { data: response } = await got(currentUrl.href);
    const $ = load(response);

    const list = $('.package_list .b_package')
        .toArray()
        .flatMap((item) => {
            const $item = $(item);
            const $link = $item.find('.pk_img a').first();
            const href = $link.attr('href');
            const itemTitle = $item.find('.pk_txt em').text().trim();
            const author = $item.find('.pk_txt span').eq(0).text().trim();
            const volume = $item.find('.pk_txt span').eq(1).text().trim();
            const image = $item.find('.pk_img img').attr('src');

            if (!href || !itemTitle) {
                return [];
            }

            const link = new URL(href, baseUrl).href;
            const description = image ? `<p><img src="${new URL(image, baseUrl).href}"></p>` : undefined;

            return {
                title: [itemTitle, volume].filter(Boolean).join(' '),
                author,
                description,
                link,
                guid: link,
            };
        }) as DataItem[];

    const items = await Promise.all(list.map((item) => enrichBookDetail(item)));

    return {
        title: `東立出版社 - ${title}`,
        link: currentUrl.href,
        item: items,
    };
}
