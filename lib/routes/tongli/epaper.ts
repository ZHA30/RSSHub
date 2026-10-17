import { load } from 'cheerio';

import type { DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

export const route: Route = {
    path: '/epaper',
    categories: ['reading'],
    example: '/tongli/epaper',
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
            source: ['tongli.com.tw/EpaperList.aspx'],
            target: '/epaper',
        },
    ],
    name: '電子報',
    maintainers: ['ZHA30'],
    handler,
};

async function handler() {
    const baseUrl = 'https://www.tongli.com.tw/';
    const currentUrl = new URL('EpaperList.aspx', baseUrl).href;
    const { data: response } = await got(currentUrl);
    const $ = load(response);

    const list = $('#ContentPlaceHolder1_GridView1 a')
        .toArray()
        .flatMap((item) => {
            const $item = $(item);
            const href = $item.attr('href');
            const title = $item.text().trim();

            if (!href || !title) {
                return [];
            }

            const link = new URL(href, baseUrl).href;

            return {
                title,
                link,
                guid: link,
            };
        }) as DataItem[];

    const items = await Promise.all(
        list.map((item) =>
            cache.tryGet(`tongli:epaper:${item.link}`, async () => {
                const { data: response } = await got(item.link!);
                const $ = load(response);
                const dateText = $('#ContentPlaceHolder1_Label1').text().replace('發報日期：', '').trim();
                const content = $('#ContentPlaceHolder1_Panel1').first();

                content.find('script, style, noscript').remove();
                content
                    .find('*')
                    .contents()
                    .each((_, element) => {
                        if (element.type === 'comment') {
                            $(element).remove();
                        }
                    });
                content.find('a[href^="#"]').removeAttr('href');
                content.find('*').each((_, element) => {
                    const $element = $(element);
                    const style = $element.attr('style');

                    if (style) {
                        const cleanedStyle = style
                            .split(';')
                            .map((declaration) => declaration.trim())
                            .filter((declaration) => declaration && !/^(?:background(?:-color|-image)?|color|font-(?:family|size)|box-shadow)\s*:/i.test(declaration))
                            .join('; ');

                        if (cleanedStyle) {
                            $element.attr('style', cleanedStyle);
                        } else {
                            $element.removeAttr('style');
                        }
                    }

                    $element.removeAttr('color').removeAttr('bgcolor').removeAttr('face').removeAttr('size');
                });

                return {
                    ...item,
                    description: content.html() ?? undefined,
                    pubDate: dateText ? timezone(parseDate(dateText, 'YYYY/MM/DD'), +8) : undefined,
                };
            })
        )
    );

    return {
        title: '東立出版社 - 電子報',
        link: currentUrl,
        item: items,
    };
}
