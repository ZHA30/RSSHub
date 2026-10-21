import { load } from 'cheerio';

import type { DataItem } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDateInTimezone } from '@/utils/parse-date-in-timezone';

const baseUrl = 'https://qnmlgb.tech';

function getPublicationDate(dateText: string, id: string): Date | undefined {
    const date = dateText.match(/^(\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{2})/);
    const objectId = id.match(/[a-f\d]{24}/i)?.[0];
    if (!date || !objectId) {
        return;
    }

    // MongoDB ObjectId records the collection time, which supplies the year
    // omitted from the site's displayed publication time.
    const collected = new Date(Number.parseInt(objectId.slice(0, 8), 16) * 1000);
    if (Number.isNaN(collected.getTime())) {
        return;
    }
    const collectedMonth = collected.getUTCMonth() + 1;
    const publishedMonth = Number(date[1]);
    const year = collected.getUTCFullYear() + (collectedMonth === 1 && publishedMonth === 12 ? -1 : collectedMonth === 12 && publishedMonth === 1 ? 1 : 0);
    return parseDateInTimezone(`${year}-${date[1].padStart(2, '0')}-${date[2].padStart(2, '0')} ${date[3].padStart(2, '0')}:${date[4]}`, 8);
}

export async function getItems(path: string): Promise<DataItem[]> {
    const html = await ofetch<string, 'text'>(`${baseUrl}${path}`, { responseType: 'text' });
    const $ = load(html);
    const entries = $('.ae-hub > .ae');
    if (!entries.length) {
        throw new Error('瓦斯阅读页面未找到文章，请检查页面结构是否变更');
    }

    const items = entries.toArray().flatMap((entry) => {
        const element = $(entry);
        const anchor = element.find('a[href]').first();
        const href = anchor.attr('href');
        const title = anchor.find('.tp').text();
        if (!href || !title) {
            return [];
        }

        const meta = anchor.find('.ae-container-2 > div').last().text();
        const author = meta.replace(/^\d{1,2}\.\d{1,2}\s+\d{1,2}:\d{2}\s*/, '');
        return {
            title,
            link: new URL(href, baseUrl).href,
            pubDate: getPublicationDate(meta, element.attr('data-id') || ''),
            ...(author && { author }),
        };
    });

    if (!items.length) {
        throw new Error('瓦斯阅读页面未解析到有效文章，请检查页面结构是否变更');
    }
    return items;
}
