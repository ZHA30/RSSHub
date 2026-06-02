import type { DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';

type FreeClassInfo = {
    current_article_count?: number;
    enid: string;
    highlight?: string;
    intro?: string;
    lecturer_name?: string;
    name: string;
    product_id: number;
    product_type: number;
    share_url?: string;
    share_summary?: string;
    share_title?: string;
    update_time?: number;
};

type FreeArticle = {
    id: number;
    order_num?: number;
    publish_time?: number;
    share_content?: string;
    title: string;
};

type DetailState = {
    articleContent?: {
        content?: string;
    };
    page?: {
        article_info?: {
            audio?: {
                duration?: number;
                mp3_play_url?: string;
                title?: string;
            };
            publish_time?: number;
            share_content?: string;
            title?: string;
        };
        class_info?: {
            name?: string;
        };
    };
};

const extractState = <T>(html: string) => {
    const json = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{.*\});<\/script>/s)?.[1];

    if (!json) {
        throw new Error('页面初始化数据缺失');
    }

    return JSON.parse(json) as T;
};

const handleParagraph = (data) => {
    let html = '<p>';
    if (data.contents && Array.isArray(data.contents)) {
        html += data.contents.map((item) => extractArticleContent(item)).join('');
    }
    html += '</p>';
    return html;
};

const handleText = (data) => {
    let content = data.text?.content || '';
    if (data.text?.bold || data.text?.highlight) {
        content = `<strong>${content}</strong>`;
    }
    return content;
};

const handleImage = (data) => (data.image?.src ? `<img src="${data.image.src}" alt="${data.image.alt || ''}">` : '');

const handleAudio = (data) => {
    const src = data.url || data.src || data.playUrl || data.play_url || data.audio?.src;
    const title = data.title || data.audio?.title || '音频';
    const desc = data.desc || data.audio?.desc;

    if (!src) {
        return desc ? `<p>${desc}</p>` : '';
    }

    return `<p><audio controls src="${src}"></audio></p>${title ? `<p>${title}</p>` : ''}${desc ? `<p>${desc}</p>` : ''}`;
};

const handleHr = () => '<hr>';

function extractArticleContent(data) {
    if (!data || typeof data !== 'object') {
        return '';
    }

    switch (data.type) {
        case 'paragraph':
            return handleParagraph(data);
        case 'text':
            return handleText(data);
        case 'image':
            return handleImage(data);
        case 'audio':
            return handleAudio(data);
        case 'hr':
            return handleHr();
        default:
            return '';
    }
}

const getHeaders = (enid: string) => ({
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json;charset=UTF-8',
    Referer: `https://m.igetget.com/share/course/free/detail?id=${enid}`,
    Origin: 'https://m.igetget.com',
});

const getRootUrl = (enid: string) => `https://m.igetget.com/share/course/free/detail?id=${enid}`;

const getArticleLink = (id: number) => `https://m.igetget.com/share/course/article/article_id/${id}`;

const renderCourseDescription = (state: { page?: { class_info?: FreeClassInfo } }) => {
    const classInfo = state.page?.class_info;

    if (!classInfo) {
        return;
    }

    const parts = [classInfo.highlight, classInfo.intro].filter(Boolean);
    return parts.length > 0 ? `<p>${parts.join('</p><p>')}</p>` : undefined;
};

const fetchListPage = async (enid: string, classInfo: FreeClassInfo, maxId = 0, maxOrderNum = 0, count = 20) => {
    const response = await got.post('https://m.igetget.com/share/api/course/free/pageTurning', {
        json: {
            chapter_id: 0,
            count,
            max_id: maxId,
            max_order_num: maxOrderNum,
            pid: classInfo.product_id,
            ptype: classInfo.product_type,
            reverse: true,
            since_id: 0,
            since_order_num: 0,
        },
        headers: getHeaders(enid),
    });

    return JSON.parse(response.body) as { article_list?: FreeArticle[] };
};

const fetchList = async (enid: string, classInfo: FreeClassInfo, limit: number) => {
    const articleList: FreeArticle[] = [];
    let maxId = 0;
    let maxOrderNum = 0;

    while (articleList.length < limit) {
        const remaining = limit - articleList.length;
        // Pagination depends on the previous page's tail cursor.
        // eslint-disable-next-line no-await-in-loop
        const data = await fetchListPage(enid, classInfo, maxId, maxOrderNum, Math.min(remaining, 20));
        const pageItems = data.article_list ?? [];

        if (pageItems.length === 0) {
            break;
        }

        articleList.push(...pageItems);

        const lastItem = pageItems.at(-1);
        maxId = lastItem?.id ?? 0;
        maxOrderNum = lastItem?.order_num ?? 0;

        if (!lastItem || pageItems.length < Math.min(remaining, 20)) {
            break;
        }
    }

    if (articleList.length === 0) {
        throw new Error('限免专栏文章列表为空');
    }

    return articleList;
};

const buildItem = (article: FreeArticle, enid: string) => {
    const link = getArticleLink(article.id);

    return cache.tryGet(link, async () => {
        const detailResponse = await got.get(link, {
            headers: getHeaders(enid),
        });

        const state = extractState<DetailState>(detailResponse.body);
        const articleInfo = state.page?.article_info;
        const content = state.articleContent?.content;

        let description = '';
        if (content) {
            description = JSON.parse(content)
                .map((item) => extractArticleContent(item))
                .join('');
        }

        const audio = articleInfo?.audio;
        if (audio?.mp3_play_url && !description.includes('<audio')) {
            description = `${description}<p><audio controls src="${audio.mp3_play_url}"></audio></p>`;
        }

        return {
            title: articleInfo?.title || article.title,
            link,
            description: description || articleInfo?.share_content || article.share_content || undefined,
            pubDate: parseDate((articleInfo?.publish_time || article.publish_time || 0) * 1000),
            enclosure_url: audio?.mp3_play_url,
            enclosure_type: audio?.mp3_play_url ? 'audio/mp4' : undefined,
            enclosure_title: audio?.title || articleInfo?.title || article.title,
            itunes_duration: audio?.duration,
        } satisfies DataItem;
    });
};

export const route: Route = {
    path: '/free/:enid',
    categories: ['new-media'],
    example: '/dedao/free/nb9L2q1e3OxKBPNsdoJrgN8P0Rwo6B',
    parameters: {
        enid: '限免专栏详情页 URL 中 `id=` 后的字符串，例如 `nb9L2q1e3OxKBPNsdoJrgN8P0Rwo6B` 或 `b0rNAzaYOj7VyPMs09K8P54m6wlk12`',
    },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: true,
        supportScihub: false,
    },
    radar: [
        {
            source: ['m.igetget.com/share/course/free/detail?id=:enid'],
            target: '/free/:enid',
        },
    ],
    name: '限免专栏',
    maintainers: ['ZHA30'],
    handler,
    url: 'm.igetget.com/share/course/free/detail',
};

async function handler(ctx) {
    const enid = ctx.req.param('enid');
    const rootUrl = getRootUrl(enid);
    const response = await got.get(rootUrl, {
        headers: getHeaders(enid),
    });
    const state = extractState<{ page?: { class_info?: FreeClassInfo } }>(response.body);
    const classInfo = state.page?.class_info;

    if (!classInfo?.product_id || !classInfo.product_type || !classInfo.name) {
        throw new Error('限免专栏信息缺失');
    }

    const articles = await fetchList(enid, classInfo, 30);
    const items = await Promise.all(articles.map((article) => buildItem(article, enid)));

    return {
        title: `得到限免专栏 - ${classInfo.name}`,
        link: classInfo.share_url || rootUrl,
        description: renderCourseDescription(state),
        item: items,
    };
}
