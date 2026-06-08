import { load } from 'cheerio';
import type { Context } from 'hono';

import type { Data, DataItem, Route } from '@/types';
import { ViewType } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

import { renderDescription } from './templates/description';

type ScientificAmericanAuthor = {
    name?: string;
    url?: string;
    picture_file?: string;
};

type ScientificAmericanContentBlock = {
    tag?: string;
    content?: string;
};

type ScientificAmericanItem = {
    id?: number | string;
    title?: string;
    display_title?: string;
    url?: string;
    summary?: string;
    image_url?: string;
    image_alt_text?: string;
    image_width?: number;
    image_height?: number;
    date_published?: string;
    published_at_date_time?: string;
    release_date?: string;
    updated_at_date_time?: string;
    category?: string;
    subtype?: string;
    column?: string;
    digital_column?: string;
    display_category?: string;
    primary_category?: string;
    subcategory?: string;
    podcast_series_name?: string;
    authors?: ScientificAmericanAuthor[];
    content?: ScientificAmericanContentBlock[];
};

type ScientificAmericanPageData = {
    initialData?: {
        article?: ScientificAmericanItem;
        meta?: {
            tags?: {
                description?: string;
            };
        };
        props?: {
            results?: ScientificAmericanItem[];
        };
    };
};

const baseUrl = 'https://www.scientificamerican.com';
const listUrl = `${baseUrl}/latest/`;
const officialFeedUrl = `${baseUrl}/platform/syndication/rss/`;

const decodeText = (value?: string) => (value ? load(value).text().trim() : undefined);

const getTitle = (item: ScientificAmericanItem) => decodeText(item.display_title ?? item.title) ?? '';

const getAuthors = (authors?: ScientificAmericanAuthor[]): DataItem['author'] =>
    authors
        ?.filter((author) => author.name)
        .map((author) => ({
            name: author.name!,
            url: author.url ? new URL(author.url, baseUrl).href : undefined,
        }));

const getCategories = (item: ScientificAmericanItem) => [
    ...new Set([item.display_category, item.primary_category, item.category, item.subcategory, item.subtype, item.column, item.digital_column, item.podcast_series_name].filter((value): value is string => value !== undefined)),
];

const getPageData = (response: string): ScientificAmericanPageData => {
    const data = response.match(/window\.__DATA__=JSON\.parse\(`(.*?)`\)<\/script>/s)?.[1];

    if (!data) {
        throw new Error('Unable to find Scientific American page data');
    }

    return JSON.parse(data.replaceAll(String.raw`\\`, '\\')) as ScientificAmericanPageData;
};

const getDescription = (item: ScientificAmericanItem, fallbackTitle?: string) =>
    renderDescription({
        images: item.image_url
            ? [
                  {
                      src: item.image_url,
                      alt: item.image_alt_text || fallbackTitle,
                      width: item.image_width,
                      height: item.image_height,
                  },
              ]
            : undefined,
        intro: item.summary,
        content: item.content?.filter((block): block is ScientificAmericanContentBlock & { tag: string; content: string } => Boolean(block.tag && block.content)),
    });

const getPubDate = (item: ScientificAmericanItem) => item.published_at_date_time ?? item.date_published ?? item.release_date;

const getUpdated = (item: ScientificAmericanItem) => item.updated_at_date_time ?? item.release_date ?? getPubDate(item);

const toItem = (item: ScientificAmericanItem): DataItem => {
    const title = getTitle(item);
    const description = getDescription(item, title);
    const link = item.url ? new URL(item.url, baseUrl).href : undefined;
    const guid = item.id ? `scientificamerican-latest-${item.id}` : link;

    return {
        title,
        link,
        description,
        pubDate: getPubDate(item) ? parseDate(getPubDate(item)!) : undefined,
        updated: getUpdated(item) ? parseDate(getUpdated(item)!) : undefined,
        category: getCategories(item),
        author: getAuthors(item.authors),
        guid,
        id: guid,
        content: {
            html: description,
            text: decodeText(item.summary) ?? title,
        },
        image: item.image_url,
        banner: item.image_url,
        language: 'en',
    };
};

export const handler = async (_: Context): Promise<Data> => {
    const response = await ofetch(listUrl);
    const pageData = getPageData(response);
    const results = pageData.initialData?.props?.results ?? [];

    const items = await Promise.all(
        results.map(async (result) => {
            const item = toItem(result);

            if (!item.link) {
                return item;
            }

            try {
                return await cache.tryGet(`scientificamerican:detail:${item.link}`, async (): Promise<DataItem> => {
                    const detailResponse = await ofetch(item.link!);
                    const detailData = getPageData(detailResponse);
                    const article = detailData.initialData?.article;

                    if (!article) {
                        return item;
                    }

                    const title = getTitle(article) || item.title;
                    const description = getDescription(article, title);
                    const guid = article.id ? `scientificamerican-latest-${article.id}` : item.guid;

                    return {
                        ...item,
                        title,
                        description,
                        pubDate: getPubDate(article) ? parseDate(getPubDate(article)!) : item.pubDate,
                        updated: getUpdated(article) ? parseDate(getUpdated(article)!) : item.updated,
                        category: getCategories(article),
                        author: getAuthors(article.authors) ?? item.author,
                        guid,
                        id: guid,
                        content: {
                            html: description,
                            text: decodeText(article.summary) ?? item.content?.text ?? title,
                        },
                        image: article.image_url ?? item.image,
                        banner: article.image_url ?? item.banner,
                        language: 'en',
                    };
                });
            } catch {
                return item;
            }
        })
    );

    return {
        title: 'Scientific American - Latest Stories',
        description: pageData.initialData?.meta?.tags?.description,
        link: listUrl,
        item: items,
        language: 'en',
        author: 'Scientific American',
        feedLink: officialFeedUrl,
        id: listUrl,
    };
};

export const route: Route = {
    path: '/latest',
    name: 'Latest Stories',
    url: 'www.scientificamerican.com/latest/',
    maintainers: ['ZHA30'],
    handler,
    example: '/scientificamerican/latest',
    categories: ['new-media'],
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportRadar: true,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    radar: [
        {
            source: ['www.scientificamerican.com/latest/'],
            target: '/latest',
        },
    ],
    view: ViewType.Articles,
};
