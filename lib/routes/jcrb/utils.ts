import { load } from 'cheerio';
import iconv from 'iconv-lite';

import { config } from '@/config';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

type ChannelConfig = {
    title: string;
    link: string;
};

type ListItem = {
    title: string;
    link: string;
    category?: string[];
    pubDate?: string;
};

const requestPage = async (url: string) => {
    const { data } = await got({
        method: 'get',
        url,
        responseType: 'buffer',
        headers: {
            'User-Agent': config.trueUA,
        },
    });

    return iconv.decode(data, 'gb2312');
};

const parsePubDate = (pubDateText?: string) => {
    if (!pubDateText) {
        return;
    }

    const format = pubDateText.includes(':') ? 'YYYY-MM-DD HH:mm:ss' : pubDateText.length === 8 ? 'YY-MM-DD' : 'YYYY-MM-DD';

    return timezone(parseDate(pubDateText, format), +8);
};

const parseList = (html: string, baseUrl: string) => {
    const $ = load(html);

    return $('.columnpd .navTabspd li, .maintxt .pdlist > li')
        .toArray()
        .map<ListItem | null>((element) => {
            const item = $(element);
            const titleElement = item.find('h2 a').first();
            const categoryElement = item.find('span a').first();
            const href = titleElement.attr('href');
            const title = titleElement.text().trim();
            const categoryText = categoryElement.text().trim();
            const metaText = item.find('span').text();
            const pubDate = metaText.match(/\d{2}-\d{2}-\d{2}/)?.[0];

            if (!href || !title) {
                return null;
            }

            return {
                title,
                link: new URL(href, baseUrl).href,
                category: categoryText ? [categoryText] : undefined,
                pubDate,
            };
        })
        .filter((item): item is ListItem => item !== null)
        .filter((item, index, items) => items.findIndex((entry) => entry.link === item.link) === index);
};

export const buildChannelFeed = async (channel: ChannelConfig) => {
    const html = await requestPage(channel.link);
    const list = parseList(html, channel.link);

    return {
        title: channel.title,
        link: channel.link,
        item: list.map((item) => ({
            ...item,
            pubDate: parsePubDate(item.pubDate),
        })),
    };
};
