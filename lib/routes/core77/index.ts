import { load } from 'cheerio';

import type { Data, DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';

const siteUrl = 'https://www.core77.com';
const homeUrl = `${siteUrl}/`;

export const route: Route = {
    path: '/',
    categories: ['design'],
    example: '/core77',
    parameters: {},
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: 'Latest',
    maintainers: ['ZHA30'],
    handler,
    radar: [
        {
            source: ['core77.com/'],
            target: '/',
        },
    ],
    description: 'Latest articles from Core77.',
};

async function handler(): Promise<Data> {
    const response = await ofetch(homeUrl);
    const $ = load(response);

    const list = $('section.post_list_prime li.blog.article_unit')
        .toArray()
        .flatMap((item) => {
            const $item = $(item);
            const titleLink = $item.find('h1 a[href*="/posts/"]').first();
            const rawLink = titleLink.attr('href');
            const link = normalizeUrl(rawLink);
            const title = titleLink.text().trim();

            return link && title
                ? [
                      {
                          title,
                          link,
                      },
                  ]
                : [];
        });

    const items = await Promise.all(list.map((item) => cache.tryGet(`core77:detail:${item.link}`, () => getItem(item))));

    return {
        title: $('title').text().trim() || 'Core77',
        link: homeUrl,
        description: $('meta[name="description"]').attr('content') || 'Core77 industrial design magazine and resource.',
        language: 'en',
        image: $('meta[property="og:image"]').attr('content') || undefined,
        item: items,
    };
}

async function getItem(item: { title: string; link: string }): Promise<DataItem> {
    const response = await ofetch(item.link);
    const $ = load(response);

    const detailData = extractPostJson(response);
    const description = cleanDescription(detailData?.body_text || $('#post').html() || '');
    const author = getAuthor(detailData, $);
    const category = detailData?.channels?.map((channel) => channel?.name).filter((name): name is string => Boolean(name) && name !== 'Home Page');
    const image = detailData?.lead_image_large_url || $('meta[property="og:image"]').attr('content') || undefined;

    return {
        title: detailData?.title?.trim() || item.title,
        link: item.link,
        description,
        author,
        category,
        image,
    };
}

function normalizeUrl(link: string | undefined): string | undefined {
    if (!link) {
        return undefined;
    }

    const url = new URL(link, siteUrl);
    url.search = '';
    url.hash = '';
    return url.href;
}

function extractPostJson(html: string):
    | {
          body_text?: string;
          title?: string;
          published_into_channel_on?: string;
          lead_image_large_url?: string;
          channels?: Array<{ name?: string }>;
          user_profile?: { first_name?: string; last_name?: string; handle?: string };
      }
    | undefined {
    const $ = load(html);
    const scriptText = $('script')
        .toArray()
        .map((script) => $(script).text())
        .find((text) => text.includes('var this_post_json = '));

    if (!scriptText) {
        return undefined;
    }

    const start = scriptText.indexOf('var this_post_json = ') + 'var this_post_json = '.length;
    const end = scriptText.indexOf('var this_post = new Post_Public', start);

    if (start < 'var this_post_json = '.length || end === -1) {
        return undefined;
    }

    return JSON.parse(scriptText.slice(start, end).trim().replace(/;$/, ''));
}

function getAuthor(
    detailData:
        | {
              user_profile?: { first_name?: string; last_name?: string; handle?: string };
          }
        | undefined,
    $: ReturnType<typeof load>
) {
    const profile = detailData?.user_profile;
    const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim();
    if (name) {
        return name;
    }

    return $('#post_header .author_info a[href*="codex.core77.com/users/"]').first().text().trim() || profile?.handle;
}

function cleanDescription(description: string) {
    const $ = load(description);
    $('.ad_wrap, .at_end, .caption.public_hide').remove();
    $('p')
        .filter((_, element) => $(element).text().trim() === '' && $(element).find('img,video,iframe').length === 0)
        .remove();
    return $.html();
}
