import type { DataItem, Route } from '@/types';
import { ViewType } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';
import parser from '@/utils/rss-parser';

const pageUrl = 'https://www.donga.com/news/Politics/List';
const feedUrl = 'https://rss.donga.com/politics.xml';

const toArray = <T>(value: T | T[] | undefined): T[] => (Array.isArray(value) ? value : value ? [value] : []);
const isDefined = <T>(value: T | undefined): value is T => value !== undefined;

export const route: Route = {
    path: '/politics',
    categories: ['traditional-media'],
    example: '/donga/politics',
    view: ViewType.Articles,
    radar: [
        {
            source: ['www.donga.com/news/Politics/List'],
            target: '/politics',
        },
    ],
    name: 'Politics',
    maintainers: ['ZHA30'],
    url: 'www.donga.com/news/Politics/List',
    handler,
};

async function handler() {
    const response = await ofetch(feedUrl, {
        responseType: 'text',
    });
    const feed = await parser.parseString(response);

    const items: DataItem[] = (feed.items ?? [])
        .map((item) => {
            if (!item.title || !item.link) {
                return;
            }

            const feedItem: DataItem = {
                title: item.title,
                link: item.link,
                pubDate: item.pubDate ? parseDate(item.pubDate) : undefined,
                description: item.content ?? item.contentSnippet ?? item.summary,
                author: item.creator,
                category: toArray(item.categories),
                guid: item.guid,
            };

            if (item.enclosure?.url || item.enclosure?.type) {
                feedItem.enclosure_url = item.enclosure?.url;
                feedItem.enclosure_type = item.enclosure?.type;
                feedItem.itunes_item_image = item.enclosure?.url;
            }

            return feedItem;
        })
        .filter(isDefined);

    return {
        title: feed.title ?? '동아일보 | 정치 뉴스',
        link: pageUrl,
        feedLink: feedUrl,
        description: feed.description,
        language: feed.language ?? 'ko',
        image: feed.image?.url,
        item: items,
    };
}
