import { raw } from 'hono/html';
import { renderToString } from 'hono/jsx/dom/server';

import type { Route } from '@/types';
import got from '@/utils/got';

export const route: Route = {
    path: ['/tieba/forum/good/:kw/:cid?/:sortBy?', '/tieba/forum/:kw/:sortBy?'],
    categories: ['bbs'],
    example: '/baidu/tieba/forum/good/女图',
    parameters: { kw: '吧名', cid: '精品分类，默认为 `0`（全部分类），如果不传 `cid` 则获取全部分类', sortBy: '排序方式：`created`, `replied`。默认为 `created`' },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: '精品帖子',
    maintainers: ['u3u'],
    handler,
};

const pageNumbers = ['0', '2'];

async function handler(ctx) {
    // sortBy: created, replied
    const { kw, cid = '0', sortBy = 'created' } = ctx.req.param();
    const isGood = ctx.req.path.includes('good');

    const searchParams: Record<string, string> = {
        kw,
        rn: '20',
        sort_type: sortBy === 'created' ? '1' : '0',
    };
    if (isGood) {
        searchParams.tab_id = cid === '0' ? '301' : cid;
    }

    const responses = await Promise.all(
        pageNumbers.map((pn) =>
            got('https://tieba.baidu.com/mg/f/getFrsData', {
                headers: {
                    Referer: 'https://tieba.baidu.com/',
                },
                searchParams: {
                    ...searchParams,
                    pn,
                },
            })
        )
    );

    const failedResponse = responses.find(({ data }) => data.errno !== 0);
    if (failedResponse) {
        const { data } = failedResponse;
        throw new Error(`Failed to fetch Tieba forum data: ${data.errmsg || data.error || data.errno}`);
    }

    const data = responses[0].data;
    const threads = responses.flatMap(({ data }) => data.data?.thread_list || []);
    const seen = new Set();
    const list = threads
        .filter((item) => !item.is_top)
        .filter((item) => {
            const id = item.tid || item.id;
            if (seen.has(id)) {
                return false;
            }
            seen.add(id);
            return true;
        })
        .map((element) => {
            const item = element;
            const author = item.author?.name_show || item.author?.show_nickname || item.author?.name;
            const timestamp = sortBy === 'created' ? item.create_time : item.last_time_int;
            const details = item.rich_abstract?.map((content) => (content.type === 2 && content.src ? `<img src="${content.src}">` : content.text)).join('') || item.abstract?.map((content) => content.text).join('');
            const medias = item.media?.map((media) => `<img src="${media.water_pic || media.big_pic || media.small_pic}">`).join('');

            return {
                title: item.title,
                description: renderToString(
                    <>
                        <p>{raw(details || '')}</p>
                        <p>{raw(medias || '')}</p>
                    </>
                ),
                author,
                pubDate: timestamp ? new Date(timestamp * 1000) : undefined,
                link: `https://tieba.baidu.com/p/${item.tid || item.id}`,
            };
        });

    return {
        title: `${data.data?.forum?.name || kw}吧`,
        description: data.data?.forum ? `${data.data.forum.name}吧，主题数 ${data.data.forum.thread_num}，帖子数 ${data.data.forum.post_num}` : undefined,
        link: `https://tieba.baidu.com/f?kw=${encodeURIComponent(kw)}`,
        item: list,
    };
}
