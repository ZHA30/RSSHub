import { config } from '@/config';
import ConfigNotFoundError from '@/errors/types/config-not-found';
import InvalidParameterError from '@/errors/types/invalid-parameter';
import type { Data, Route } from '@/types';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import parser from '@/utils/rss-parser';

export const route: Route = {
    path: '/fulltext/:url',
    name: 'Full text',
    categories: ['other'],
    maintainers: ['ZHA30'],
    example: '/rsshub/fulltext/https%3A%2F%2Fwww.theguardian.com%2Fworld%2Frss',
    parameters: { url: 'RSS or Atom feed URL, encoded with encodeURIComponent' },
    features: {
        requireConfig: [{ name: 'ALLOW_USER_SUPPLY_UNSAFE_DOMAIN', description: 'Enable fetching user-supplied feeds and article URLs.' }],
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    description: `Convert an existing RSS or Atom feed into a full-text feed using the built-in article extractor.

Encode the entire source feed URL with \`encodeURIComponent\`, including its query string. For example, \`https://www.theguardian.com/world/rss\` becomes \`https%3A%2F%2Fwww.theguardian.com%2Fworld%2Frss\`.

Article content is cached. If an article cannot be fetched or extracted, its original content is retained. Pages requiring JavaScript, authentication, or a paid subscription may not yield full text. Custom XML extensions are not preserved.

Use the common \`limit\` parameter to limit the number of articles fetched, for example \`?limit=10\`. Full-text extraction is enabled by default; \`?mode=original\` returns the parsed source content without extraction.`,
    handler,
};

async function handler(ctx): Promise<Data> {
    if (!config.feature.allow_user_supply_unsafe_domain) {
        throw new ConfigNotFoundError("This RSS is disabled unless 'ALLOW_USER_SUPPLY_UNSAFE_DOMAIN' is set to 'true'.");
    }

    const url = ctx.req.param('url');
    let feedUrl: URL;
    try {
        feedUrl = new URL(url);
    } catch {
        throw new InvalidParameterError('Provide a valid HTTP or HTTPS feed URL encoded with encodeURIComponent.');
    }
    if (!['http:', 'https:'].includes(feedUrl.protocol)) {
        throw new InvalidParameterError('Only HTTP and HTTPS feed URLs are supported.');
    }

    const response = await got(url);
    const feed = await parser.parseString(response.data);
    const baseUrl = response.url;

    return {
        title: feed.title || '',
        link: feed.link ? new URL(feed.link, baseUrl).href : undefined,
        description: feed.description,
        image: feed.image?.url ? new URL(feed.image.url, baseUrl).href : undefined,
        author: feed.author || feed.creator,
        language: feed.language,
        sortItems: false,
        fulltext: true,
        item: feed.items.map((item) => ({
            title: item.title || '',
            link: item.link ? new URL(item.link, baseUrl).href : undefined,
            guid: item.guid || item.id,
            id: item.guid || item.id,
            author: item.creator || item.author,
            category: item.categories,
            pubDate: item.isoDate || item.pubDate ? parseDate((item.isoDate || item.pubDate)!) : undefined,
            content: { html: item['content:encoded'] || item.content || item.description || item.summary },
            enclosure_url: item.enclosure?.url ? new URL(item.enclosure.url, baseUrl).href : undefined,
            enclosure_type: item.enclosure?.type,
            enclosure_length: item.enclosure?.length,
        })),
    };
}
