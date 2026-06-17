import { load } from 'cheerio';

import type { Data, DataItem } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import parser from '@/utils/rss-parser';

export async function getFeed(category: string, pageUrl: string): Promise<Data> {
    const url = `https://www.yna.co.kr/rss/${category}.xml`;

    const feed = await parser.parseURL(url);
    const items = await Promise.all(
        (feed.items ?? [])
            .filter((item) => item.link && item.title)
            .map((item) =>
                cache.tryGet(item.link as string, async () => {
                    const pubDate = item.pubDate ? parseDate(item.pubDate) : undefined;
                    const response = await got(item.link as string);
                    const $ = load(response.data);
                    const article = $('article.story-news');
                    article.find('.related-group').remove();
                    article.find('.writer-zone01').remove();

                    const feedItem: DataItem = {
                        title: item.title as string,
                        link: item.link as string,
                        pubDate,
                        author:
                            item.creator ??
                            $('.tit-name')
                                .toArray()
                                .map((c) => $(c).text())
                                .join(', '),
                        description: article.html() ?? item.content ?? item.contentSnippet ?? item.summary,
                        category: item.categories,
                        guid: item.guid,
                    };

                    if (item.enclosure?.url || item.enclosure?.type) {
                        feedItem.enclosure_url = item.enclosure?.url;
                        feedItem.enclosure_type = item.enclosure?.type;
                    }

                    return feedItem;
                })
            )
    );

    return {
        title: feed.title ?? 'Yonhap News Agency',
        link: pageUrl || feed.link,
        description: feed.description,
        language: feed.language ?? 'ko',
        item: items,
    };
}
