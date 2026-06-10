import type { DataItem, Route } from '@/types';
import got from '@/utils/got';

import { type Article, articleToDataItem, decodeArticleWithUserInfo, decodeGrpcWebTextFrame, encodeGrpcWebTextFrame, escapeHtml, grpcWebHeaders, type PageEntry, readFields, rootUrl, statsLine } from './utils';

export const route: Route = {
    path: '/flow',
    categories: ['anime'],
    radar: [
        {
            source: ['zh.moegirl.org.cn/Mainpage#/flow', 'zh.moegirl.org.cn/'],
            target: '/flow',
        },
    ],
    name: '无限·瀑布流',
    example: '/moegirl/flow',
    maintainers: ['ZHA30'],
    handler,
    url: 'zh.moegirl.org.cn/Mainpage#/flow',
};

const apiUrl = 'https://api.moegirl.org.cn/moegirl.moepad.MoepadService/GetMixedFeedData';
const pageSize = 10;

type MixedContentItem =
    | {
          type: 'pageEntry';
          pageEntry: PageEntry;
      }
    | {
          type: 'articleWithUserInfo';
          article: Article;
      };

async function handler() {
    const response = await got.post(apiUrl, {
        headers: grpcWebHeaders(),
        body: encodeGrpcWebTextFrame(encodeMixedFeedRequest(0)),
        responseType: 'text',
    });

    const items = decodeMixedFeedResponse(decodeGrpcWebTextFrame(response.data.toString()))
        .map((item) => toDataItem(item))
        .filter((item): item is DataItem => item !== undefined);

    return {
        title: '萌娘百科 - 无限·瀑布流',
        link: `${rootUrl}/Mainpage#/flow`,
        language: 'zh-CN' as const,
        item: items,
    };
}

function toDataItem(item: MixedContentItem): DataItem | undefined {
    if (item.type === 'pageEntry') {
        const page = item.pageEntry;
        if (!page.entryTitle) {
            return;
        }

        const link = page.entryUrl || `${rootUrl}/index.php?title=${encodeURIComponent(page.entryTitle)}`;
        const comments = page.hotComments.length ? `<blockquote>${page.hotComments.map(escapeHtml).join('<br>')}</blockquote>` : '';
        const image = page.entryImgUrl ? `<p><img src="${escapeHtml(page.entryImgUrl)}"></p>` : '';

        return {
            title: page.entryTitle,
            link,
            guid: `page-${page.entryId || page.entryTitle}`,
            description: `${page.entryIntroduction ? `<p>${escapeHtml(page.entryIntroduction)}</p>` : ''}${comments}${image}${statsLine(page.likeCount, page.dislikeCount, page.commentCount)}`,
            category: page.categories,
        };
    }

    return articleToDataItem(item.article);
}

function encodeMixedFeedRequest(pageStart: number): Buffer {
    return Buffer.from([0x08, pageStart, 0x12, 0x00, 0x1a, 0x00, 0x20, pageSize]);
}

function decodeMixedFeedResponse(buffer: Buffer): MixedContentItem[] {
    const fields = readFields(buffer);
    return fields
        .filter((field) => field.no === 1 && Buffer.isBuffer(field.value))
        .map((field) => decodeMixedContentItem(field.value as Buffer))
        .filter((item): item is MixedContentItem => item !== undefined);
}

function decodeMixedContentItem(buffer: Buffer): MixedContentItem | undefined {
    for (const field of readFields(buffer)) {
        if (!Buffer.isBuffer(field.value)) {
            continue;
        }
        if (field.no === 1) {
            return { type: 'pageEntry', pageEntry: decodePageEntry(field.value) };
        }
        if (field.no === 2) {
            return { type: 'articleWithUserInfo', article: decodeArticleWithUserInfo(field.value) };
        }
    }
}

function decodePageEntry(buffer: Buffer): PageEntry {
    const entry: PageEntry = {
        categories: [],
        hotComments: [],
    };

    for (const field of readFields(buffer)) {
        switch (field.no) {
            case 1:
                entry.entryId = String(field.value);
                break;
            case 2:
                entry.entryImgUrl = field.value as string;
                break;
            case 3:
                entry.entryTitle = field.value as string;
                break;
            case 4:
                entry.entryIntroduction = field.value as string;
                break;
            case 5:
                entry.categories.push(field.value as string);
                break;
            case 6:
                entry.entryUrl = field.value as string;
                break;
            case 9:
                entry.hotComments.push(field.value as string);
                break;
            case 10:
                entry.likeCount = field.value as number;
                break;
            case 11:
                entry.dislikeCount = field.value as number;
                break;
            case 12:
                entry.commentCount = field.value as number;
                break;
            default:
                break;
        }
    }

    return entry;
}
