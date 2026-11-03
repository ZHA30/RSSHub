import { load } from 'cheerio';

import InvalidParameterError from '@/errors/types/invalid-parameter';
import type { Data, DataItem, Route } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const baseUrl = 'https://myanimelist.net';

const normalizeText = (text: string) => text.replaceAll(/\s+/g, ' ').trim();

export const route: Route = {
    path: '/reviews/:type',
    name: 'Reviews',
    url: 'myanimelist.net/reviews.php',
    categories: ['anime'],
    maintainers: ['ZHA30'],
    example: '/myanimelist/reviews/manga',
    parameters: {
        type: 'Review type, either `anime` or `manga`',
    },
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
            source: ['myanimelist.net/reviews.php'],
            target: '/reviews/manga',
            title: 'Manga Reviews',
        },
    ],
    description: 'Latest reviews listed on MyAnimeList. Only the first page is parsed; use the common `limit` parameter to control the number of entries.',
    handler,
};

async function handler(ctx): Promise<Data> {
    const type = ctx.req.param('type');
    if (type !== 'anime' && type !== 'manga') {
        throw new InvalidParameterError(`Invalid review type: ${type}. Expected one of: anime, manga.`);
    }

    const link = `${baseUrl}/reviews.php?t=${type}`;
    const response = await ofetch(link);
    const $ = load(response);

    const items = $('.review-element')
        .toArray()
        .map((element): DataItem => {
            const $review = $(element);
            const $reviewer = $review.find('.username a');
            const itemLink = $review.find('a[href*="reviews.php?id="]').attr('href')!;
            const content = $review.find('.text');

            content.find('.thumb-right').remove();
            content.find('.js-visible').remove();
            content.find('.js-hidden').contents().unwrap();

            return {
                title: `${normalizeText($review.find('.titleblock a.title').text())} - ${normalizeText($reviewer.text())}'s Review`,
                link: new URL(itemLink, baseUrl).href,
                author: [
                    {
                        name: normalizeText($reviewer.text()),
                        url: new URL($reviewer.attr('href')!, baseUrl).href,
                    },
                ],
                category: $review
                    .find('.tags .tag:not(.preliminary)')
                    .toArray()
                    .map((tag) => normalizeText($(tag).text())),
                pubDate: parseDate(normalizeText($review.find('.update_at').text()), 'MMM D, YYYY'),
                content: {
                    html: content.html() ?? '',
                },
            };
        });

    return {
        title: normalizeText($('title').text()),
        link,
        description: normalizeText($('meta[name="description"]').attr('content') ?? ''),
        image: $('meta[property="og:image"]').attr('content'),
        language: 'en',
        item: items,
    };
}
