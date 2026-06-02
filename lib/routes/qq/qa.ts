import { load } from 'cheerio';

import type { Data, DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

interface QaRankResponse {
    data?: {
        article_info?: {
            articles?: QaRankItem[];
            id_hash?: string;
            page?: number;
            is_end?: boolean;
        };
    };
}

interface QaRankItem {
    id: string;
    title: string;
    sub_item?: QaArticle[];
}

interface QaArticle {
    id: string;
    title: string;
    short_title?: string;
    publish_time?: string;
    update_time?: string;
    desc?: string;
    link_info?: {
        url?: string;
        share_url?: string;
        short_url?: string;
    };
    user_info?: {
        nick?: string;
    };
    interation_info?: {
        read_num?: number;
    };
    pic_info?: {
        share_img?: string;
        big_img?: string[];
    };
    label_info?: Array<{
        word?: string;
    }>;
    qa_info?: {
        customized_labels?: string[];
    };
}

interface QaPageData {
    desc?: string;
    articleId?: string;
}

interface QaAnswerListResponse {
    data?: {
        answer_list?: QaAnswer[];
    };
}

interface QaAnswer {
    id: string;
    card?: {
        chlname?: string;
    };
    attribute?: Record<
        string,
        {
            imgurl0?: string;
            style?: string;
            desc?: string;
        }
    >;
    content?: {
        text?: string;
    };
}

export const route: Route = {
    path: '/qa',
    categories: ['new-media'],
    example: '/qq/qa',
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
            source: ['view.inews.qq.com/ch/qa', 'news.qq.com/ch/qa'],
            target: '/qa',
        },
    ],
    name: '热问',
    maintainers: ['ZHA30'],
    handler,
};

async function handler(): Promise<Data> {
    const articles = await fetchRankArticles(50);

    const item = await Promise.all(articles.map((article) => buildItem(article)));

    return {
        title: '腾讯新闻热问',
        link: 'https://news.qq.com/ch/qa',
        item,
    };
}

async function fetchRankArticles(limit: number): Promise<QaArticle[]> {
    const articles: QaArticle[] = [];
    let page = 1;
    let idHash = '';
    let isEnd = false;

    while (articles.length < limit && !isEnd) {
        // Pagination depends on the previous page's id_hash, so requests must stay sequential.
        // oxlint-disable-next-line no-await-in-loop
        const response = await fetchRankPage(page, idHash);

        if (response.articles.length === 0) {
            break;
        }

        articles.push(...response.articles);

        if (response.isEnd || !response.idHash) {
            break;
        }

        idHash = response.idHash;
        isEnd = response.isEnd;
        page += 1;
    }

    return articles.slice(0, limit);
}

async function fetchRankPage(page: number, idHash: string): Promise<{ articles: QaArticle[]; idHash?: string; isEnd: boolean }> {
    const response = await ofetch<QaRankResponse>('https://i.news.qq.com/web_feed/getHotQaChannelRankList', {
        query: {
            rank_id: 'thing_hot_rank_qa_channel_realtime',
            page,
            size: 15,
            id_hash: idHash,
        },
    });

    const articleInfo = response.data?.article_info;

    return {
        articles: (articleInfo?.articles ?? []).flatMap((entry) => entry.sub_item ?? []),
        idHash: articleInfo?.id_hash,
        isEnd: articleInfo?.is_end ?? true,
    };
}

async function buildItem(article: QaArticle): Promise<DataItem> {
    const link = article.link_info?.url ?? article.link_info?.share_url ?? article.link_info?.short_url ?? `https://view.inews.qq.com/a/${article.id}`;
    const description = await cache.tryGet(link, async () => {
        const page = await ofetch<string>(link);
        const data = extractPageData(page);
        const answers = data?.articleId ? await fetchAnswers(data.articleId) : [];

        if (answers.length > 0) {
            return answers.join('<hr>');
        }

        const text = data?.desc || article.desc;
        const image = article.pic_info?.share_img ?? article.pic_info?.big_img?.[0];

        return [text ? `<p>${text}</p>` : '', image ? `<img src="${image}">` : ''].filter(Boolean).join('');
    });

    const category = [...(article.qa_info?.customized_labels ?? []), ...(article.label_info?.map((label) => label.word).filter((word): word is string => word !== undefined) ?? [])].filter(
        (word): word is string => word !== undefined
    );
    const pubDate = article.update_time || article.publish_time;

    return {
        title: article.short_title || article.title,
        description,
        link,
        author: article.user_info?.nick,
        pubDate: pubDate ? parseDate(pubDate) : undefined,
        category: category.length > 0 ? category : undefined,
    };
}

async function fetchAnswers(articleId: string): Promise<string[]> {
    const response = await ofetch<QaAnswerListResponse>('https://i.news.qq.com/web_backend/getAnswerList', {
        query: {
            id: articleId,
            limit: 5,
        },
    });

    return (response.data?.answer_list ?? [])
        .filter((answer) => answer.id !== articleId)
        .map((answer) => renderAnswer(answer))
        .filter((answer): answer is string => answer !== undefined);
}

function renderAnswer(answer: QaAnswer): string | undefined {
    const content = answer.content?.text;

    if (!content) {
        return undefined;
    }

    const $ = load(content);

    $('div[data-widget="image"]').each((_, element) => {
        const imageNode = $(element)
            .contents()
            .toArray()
            .find((node) => node.type === 'comment');
        const imageKey = imageNode && 'data' in imageNode ? imageNode.data.trim() : undefined;
        const image = imageKey ? answer.attribute?.[imageKey] : undefined;

        if (!image?.imgurl0) {
            return;
        }

        $(element).replaceWith(`<figure><img src="${image.imgurl0}"${image.style ? ` style="${image.style}"` : ''}>${image.desc ? `<figcaption>${image.desc}</figcaption>` : ''}</figure>`);
    });

    $('style').remove();
    $('[powered-by]').remove();
    $('p').each((_, element) => {
        if (!$(element).text().trim() && $(element).find('img, video, figure').length === 0) {
            $(element).remove();
        }
    });
    $('span').each((_, element) => {
        if (!$(element).text().trim() && $(element).children().length === 0) {
            $(element).remove();
        }
    });

    const html = $('.rich_media_content').html() || $.root().html();

    if (!html) {
        return undefined;
    }

    const author = answer.card?.chlname || '匿名答主';

    return `<section><h4 style="margin: 0 0 12px; font-size: 18px; line-height: 1.5;">${author}</h4>${html}</section>`;
}

function extractPageData(html: string): QaPageData | undefined {
    const matched = html.match(/window\.DATA\s*=\s*({.+?});\s*<\/script>/s);

    if (!matched) {
        return undefined;
    }

    return JSON.parse(matched[1]) as QaPageData;
}
