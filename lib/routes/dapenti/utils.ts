import { load } from 'cheerio';
import iconv from 'iconv-lite';
import pMap from 'p-map';
import { z } from 'zod';

import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/time';

export const baseUrl = 'https://www.dapenti.com/blog/';

export const channels = {
    xilei: '铂程斋',
    tugua: '喷嚏图卦',
    agile: '乐活',
    caijing: '财经风云',
    aieverything: 'AI Everything',
    fushihui: '浮世汇',
    shijieguan: '世界观',
    changyuedu: '长阅读',
    dianying: '乐影',
    piaoquan: '铂程的票圈',
    youxuan: '喷嚏优选',
};

const articleSchema = z.object({
    id: z.number(),
    topic: z.string(),
    snippet: z.string(),
    addtime: z.string(),
    subject_name: z.string(),
    source_url: z.string(),
});

const responseSchema = z.object({
    success: z.literal(true),
    hits: z.array(articleSchema),
});

export async function getItems(channel: string, limit: number) {
    const response = await ofetch<z.infer<typeof responseSchema>>(`${baseUrl}member-search/api.asp`, {
        query: { channel, sort: 'newest', cursor: 0, limit: 30 },
        schema: responseSchema,
    });

    return pMap(
        response.hits.slice(0, limit),
        async (article) => {
            const link = new URL(article.source_url, baseUrl).href;
            const detail = await cache.tryGet(`article:${article.id}`, () => getArticle(link));

            return {
                title: article.topic,
                link,
                guid: `dapenti:${article.id}`,
                summary: article.snippet || undefined,
                pubDate: parseDate(article.addtime, 'YYYY-MM-DD HH:mm:ss', 8),
                category: article.subject_name ? [article.subject_name] : undefined,
                ...detail,
            };
        },
        { concurrency: 3 }
    );
}

async function getArticle(link: string) {
    const response = await ofetch(link, { responseType: 'arrayBuffer', publicOnly: true });
    const $ = load(iconv.decode(Buffer.from(response), 'gbk'));
    const content = $('#article-content');

    if (!content.length) {
        throw new Error(`Article content not found: ${link}`);
    }

    content.find('script, style, noscript, .article-ad, .adsbygoogle').remove();

    return {
        description: content.html() || undefined,
        author: $('.article-meta').text().split('发布于', 1)[0].trim() || undefined,
    };
}
