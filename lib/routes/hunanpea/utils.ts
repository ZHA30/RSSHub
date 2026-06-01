import { load } from 'cheerio';

import type { DataItem } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

export const rootUrl = 'http://rst.hunan.gov.cn';

export const categories = {
    c103129: {
        name: '考试计划',
        path: '/rst/hnrsksw/c103127/c103129/rskswlist.html',
    },
    c103096: {
        name: '考试通知',
        path: '/rst/hnrsksw/c103127/c103096/rskswlist.html',
    },
};

export type CategoryId = keyof typeof categories;

export const isCategoryId = (id: string): id is CategoryId => id in categories;

export async function parseList(categoryId: CategoryId): Promise<{
    title: string;
    link: string;
    description: string;
    item: DataItem[];
}> {
    const category = categories[categoryId];
    const link = new URL(category.path, rootUrl).href;
    const { data: response } = await got(link);
    const $ = load(response);

    const title = $('meta[name="ColumnName"]').attr('content')?.trim() || category.name;
    const items = $('.list-text li')
        .toArray()
        .flatMap((element) => {
            const item = $(element);
            const anchor = item.find('a').first();
            const href = anchor.attr('href');
            const title = anchor.attr('title')?.trim() || anchor.find('span').text().trim();

            if (!href || !title) {
                return [];
            }

            const date = anchor.find('small').text().trim();

            return [
                {
                    title,
                    link: new URL(href, link).href,
                    pubDate: date ? timezone(parseDate(date, 'YYYY-MM-DD'), 8) : undefined,
                },
            ];
        });

    return {
        title: `湖南人事考试网 - 考务工作 - ${title}`,
        link,
        description: `湖南人事考试网 - 考务工作 - ${title}`,
        item: await Promise.all(
            items.map((item) =>
                item.link.startsWith(rootUrl)
                    ? cache.tryGet(`hunanpea:detail:${item.link}`, async () => {
                          const detail = await parseDetail(item.link);

                          return {
                              ...item,
                              ...detail,
                              pubDate: item.pubDate ?? detail.pubDate,
                          };
                      })
                    : item
            )
        ),
    };
}

async function parseDetail(link: string): Promise<Partial<DataItem>> {
    const { data: response } = await got(link);
    const $ = load(response);

    const content = $('#j-show-body').first();
    content.find('script').remove();

    content.find('a').each((_, element) => {
        const href = $(element).attr('href');
        if (href) {
            $(element).attr('href', new URL(href, link).href);
        }
    });

    content.find('img').each((_, element) => {
        const src = $(element).attr('src');
        if (src) {
            $(element).attr('src', new URL(src, link).href);
        }
    });

    const attachments = $('.xgld_nr').first();
    attachments.find('a').each((_, element) => {
        const href = $(element).attr('href');
        if (href) {
            $(element).attr('href', new URL(href, link).href);
        }
    });

    const description = [content.html(), attachments.html()].filter(Boolean).join('');
    const date =
        $('meta[name="PubDate"]').attr('content') ||
        $('.main_conftitp')
            .text()
            .match(/\d{4}-\d{2}-\d{2}/)?.[0];

    return {
        description: description || undefined,
        pubDate: date ? timezone(parseDate(date), 8) : undefined,
    };
}
