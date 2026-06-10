import type { Context } from 'hono';

import type { Route } from '@/types';
import got from '@/utils/got';

import { articleToDataItem, decodeArticleWithUserInfo, decodeGrpcWebTextFrames, encodeGrpcWebTextFrame, grpcWebHeaders, rootUrl, writeInt32Field, writePackedInt32Field, writeStringField } from './utils';

export const route: Route = {
    path: '/post/:category?',
    categories: ['anime'],
    radar: [
        {
            source: ['zh.moegirl.org.cn/Mainpage#/post', 'zh.moegirl.org.cn/'],
            target: '/post',
        },
    ],
    name: '帖子·文章',
    example: '/moegirl/post/acgn',
    parameters: {
        category: {
            description: '分区，默认为 ACGN 杂谈；可使用下表 slug、中文名或源站 cid',
            default: 'acgn',
            options: [
                { value: 'acgn', label: 'ACGN杂谈' },
                { value: 'official', label: '官方发布' },
                { value: 'guide', label: '游戏攻略' },
                { value: 'fanwork', label: '同人创作' },
                { value: 'industry', label: '业界观察' },
                { value: 'culture', label: '文化研究' },
                { value: 'tech', label: '技术宅' },
                { value: 'cosplay', label: 'Cosplay' },
                { value: 'feedback', label: '意见反馈' },
            ],
        },
    },
    maintainers: ['ZHA30'],
    handler,
    url: 'zh.moegirl.org.cn/Mainpage#/post',
    description: `| slug     | 分区      | cid |
| -------- | --------- | --- |
| acgn     | ACGN 杂谈 | 18  |
| official | 官方发布  | 24  |
| guide    | 游戏攻略  | 20  |
| fanwork  | 同人创作  | 26  |
| industry | 业界观察  | 21  |
| culture  | 文化研究  | 22  |
| tech     | 技术宅    | 25  |
| cosplay  | Cosplay   | 27  |
| feedback | 意见反馈  | 23  |`,
};

const apiUrl = 'https://api.moegirl.org.cn/moegirl.moepad.MoepadCommunityService/GetArticleListWithUserInfo';
const listSize = 10;
const passedCensorStatus = 1;
const regularPostType = 0;

const categories = [
    { slug: 'acgn', label: 'ACGN杂谈', cid: '18' },
    { slug: 'official', label: '官方发布', cid: '24' },
    { slug: 'guide', label: '游戏攻略', cid: '20' },
    { slug: 'fanwork', label: '同人创作', cid: '26' },
    { slug: 'industry', label: '业界观察', cid: '21' },
    { slug: 'culture', label: '文化研究', cid: '22' },
    { slug: 'tech', label: '技术宅', cid: '25' },
    { slug: 'cosplay', label: 'Cosplay', cid: '27' },
    { slug: 'feedback', label: '意见反馈', cid: '23' },
];

async function handler(ctx: Context) {
    const category = resolveCategory(ctx.req.param('category'));

    const response = await got.post(apiUrl, {
        headers: grpcWebHeaders(),
        body: encodeGrpcWebTextFrame(encodeArticleListRequest(category.cid, 0, listSize + 1)),
        responseType: 'text',
    });

    const items = decodeGrpcWebTextFrames(response.data.toString())
        .slice(0, listSize)
        .map((frame) => articleToDataItem(decodeArticleWithUserInfo(frame)))
        .filter((item) => item !== undefined);

    return {
        title: `萌娘百科 - 帖子·文章 - ${category.label}`,
        link: `${rootUrl}/Mainpage#/post?community_id=${category.cid}`,
        language: 'zh-CN' as const,
        item: items,
    };
}

function resolveCategory(value = 'acgn') {
    const decoded = decodeURIComponent(value).toLowerCase();
    return categories.find((category) => [category.slug, category.label.toLowerCase(), category.cid].includes(decoded)) ?? categories[0];
}

function encodeArticleListRequest(communityId: string, offset: number, size: number): Buffer {
    return Buffer.concat([
        writeStringField(1, communityId),
        offset ? writeInt32Field(2, offset) : Buffer.alloc(0),
        writeInt32Field(3, size),
        writePackedInt32Field(4, [passedCensorStatus]),
        regularPostType ? writeInt32Field(5, regularPostType) : Buffer.alloc(0),
    ]);
}
