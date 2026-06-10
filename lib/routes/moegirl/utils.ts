import type { DataItem } from '@/types';

export const rootUrl = 'https://zh.moegirl.org.cn';

export type WireField = {
    no: number;
    wireType: number;
    value: number | string | Buffer;
};

export type Timestamp = {
    seconds?: number;
};

export type PageEntry = {
    entryId?: string;
    entryImgUrl?: string;
    entryTitle?: string;
    entryIntroduction?: string;
    categories: string[];
    entryUrl?: string;
    hotComments: string[];
    likeCount?: number;
    dislikeCount?: number;
    commentCount?: number;
};

export type Post = {
    postId?: string;
    communityId?: string;
    username?: string;
    content?: string;
    likeCount?: number;
    dislikeCount?: number;
    postUpdateTime?: Timestamp;
    postCreateTime?: Timestamp;
    pictureLinks: string[];
    firstLevelReplyCount?: number;
    displayName?: string;
    displayTag?: string;
    communityName?: string;
};

export type Article = {
    post?: Post;
    title?: string;
    subCommunityName?: string;
    totalNumberComments?: number;
};

export function grpcWebHeaders() {
    return {
        accept: 'application/grpc-web-text',
        'content-type': 'application/grpc-web-text',
        'grpc-timeout': '10000m',
        mobiledeviceid: 'WebApp/gRPC-web RSSHub __NOUSERNAME__',
        referer: `${rootUrl}/`,
        sp_thinking_app_name: 'moegirl-web',
        sp_thinking_bundle_id: 'WebApp',
        sp_thinking_system_language: 'zh-CN',
        sp_thinking_zone_offset: '-480',
        'x-grpc-web': '1',
    };
}

export function encodeGrpcWebTextFrame(payload: Buffer): string {
    const header = Buffer.alloc(5);
    header.writeUInt32BE(payload.length, 1);
    return Buffer.concat([header, payload]).toString('base64');
}

export function decodeGrpcWebTextFrame(text: string): Buffer {
    const frames = decodeGrpcWebTextFrames(text);
    if (!frames.length) {
        throw new Error('Invalid gRPC-web response frame');
    }
    return frames[0];
}

export function decodeGrpcWebTextFrames(text: string): Buffer[] {
    const frame = Buffer.from(text.trim(), 'base64');
    const payloads: Buffer[] = [];
    let offset = 0;

    while (offset + 5 <= frame.length) {
        const flags = frame[offset];
        const length = frame.readUInt32BE(offset + 1);
        offset += 5;
        const payload = frame.subarray(offset, offset + length);
        offset += length;

        if ((flags & 0x80) === 0) {
            payloads.push(payload);
        }
    }

    return payloads;
}

export function writeStringField(no: number, value: string): Buffer {
    const bytes = Buffer.from(value);
    return Buffer.concat([writeVarint((no << 3) | 2), writeVarint(bytes.length), bytes]);
}

export function writeInt32Field(no: number, value: number): Buffer {
    return Buffer.concat([writeVarint(no << 3), writeVarint(value)]);
}

export function writePackedInt32Field(no: number, values: number[]): Buffer {
    const bytes = Buffer.concat(values.map((value) => writeVarint(value)));
    return Buffer.concat([writeVarint((no << 3) | 2), writeVarint(bytes.length), bytes]);
}

export function decodeArticleWithUserInfo(buffer: Buffer): Article {
    for (const field of readFields(buffer)) {
        if (field.no === 1 && Buffer.isBuffer(field.value)) {
            return decodeArticle(field.value);
        }
    }
    return {};
}

export function decodeArticle(buffer: Buffer): Article {
    const article: Article = {};
    for (const field of readFields(buffer)) {
        switch (field.no) {
            case 1:
                if (Buffer.isBuffer(field.value)) {
                    article.post = decodePost(field.value);
                }
                break;
            case 2:
                article.title = field.value as string;
                break;
            case 4:
                article.subCommunityName = field.value as string;
                break;
            case 5:
                article.totalNumberComments = field.value as number;
                break;
            default:
                break;
        }
    }
    return article;
}

export function decodePost(buffer: Buffer): Post {
    const post: Post = {
        pictureLinks: [],
    };
    for (const field of readFields(buffer)) {
        switch (field.no) {
            case 1:
                post.postId = field.value as string;
                break;
            case 4:
                post.communityId = field.value as string;
                break;
            case 5:
                post.username = field.value as string;
                break;
            case 7:
                post.content = field.value as string;
                break;
            case 8:
                post.likeCount = field.value as number;
                break;
            case 9:
                post.dislikeCount = field.value as number;
                break;
            case 14:
                if (Buffer.isBuffer(field.value)) {
                    post.postUpdateTime = decodeTimestamp(field.value);
                }
                break;
            case 15:
                if (Buffer.isBuffer(field.value)) {
                    post.postCreateTime = decodeTimestamp(field.value);
                }
                break;
            case 20:
                post.pictureLinks.push(field.value as string);
                break;
            case 22:
                post.firstLevelReplyCount = field.value as number;
                break;
            case 23:
                post.displayName = field.value as string;
                break;
            case 24:
                post.displayTag = field.value as string;
                break;
            case 25:
                post.communityName = field.value as string;
                break;
            default:
                break;
        }
    }
    return post;
}

export function readFields(buffer: Buffer): WireField[] {
    const fields: WireField[] = [];
    let offset = 0;
    while (offset < buffer.length) {
        const tag = readVarint(buffer, offset);
        offset = tag.offset;
        const no = tag.value >> 3;
        const wireType = tag.value & 7;

        if (wireType === 0) {
            const value = readVarint(buffer, offset);
            offset = value.offset;
            fields.push({ no, wireType, value: value.value });
        } else if (wireType === 2) {
            const length = readVarint(buffer, offset);
            offset = length.offset;
            const bytes = buffer.subarray(offset, offset + length.value);
            offset += length.value;
            fields.push({ no, wireType, value: looksLikeUtf8String(bytes) ? bytes.toString('utf8') : bytes });
        } else {
            break;
        }
    }
    return fields;
}

export function timestampToDate(timestamp?: Timestamp): Date | undefined {
    return timestamp?.seconds ? new Date(timestamp.seconds * 1000) : undefined;
}

export function articleToDataItem(article: Article): DataItem | undefined {
    const post = article.post;
    if (!post?.postId) {
        return;
    }

    const title = article.title || deltaToText(post.content) || `帖子 ${post.postId}`;
    const link = `${rootUrl}/Mainpage#/post/${post.communityId || ''}/${post.postId}`;
    const author = post.displayName || post.username;
    const content = deltaToHtml(post.content);
    const images = post.pictureLinks
        .filter((url) => !content.includes(escapeHtml(url)))
        .map((url) => `<p><img src="${escapeHtml(url)}"></p>`)
        .join('');

    return {
        title,
        link,
        guid: `post-${post.postId}`,
        author,
        pubDate: timestampToDate(post.postCreateTime),
        updated: timestampToDate(post.postUpdateTime),
        description: `${content}${images}${statsLine(post.likeCount, post.dislikeCount, post.firstLevelReplyCount)}`,
        category: [article.subCommunityName || post.communityName].filter(Boolean) as string[],
    };
}

export function deltaToText(delta?: string): string {
    if (!delta) {
        return '';
    }
    try {
        const ops = JSON.parse(delta);
        if (Array.isArray(ops)) {
            return ops
                .map((op) => (typeof op.insert === 'string' ? op.insert : ''))
                .join('')
                .trim();
        }
    } catch {
        // Fall through to raw text.
    }
    return delta.trim();
}

export function deltaToHtml(delta?: string): string {
    if (!delta) {
        return '';
    }
    try {
        const ops = JSON.parse(delta);
        if (Array.isArray(ops)) {
            return ops
                .map((op) => {
                    if (typeof op.insert === 'string') {
                        const text = escapeHtml(op.insert).replaceAll('\n', '<br>');
                        return op.attributes?.link ? `<a href="${escapeHtml(op.attributes.link)}">${text}</a>` : text;
                    }
                    if (op.insert?.image) {
                        return `<p><img src="${escapeHtml(op.insert.image)}"></p>`;
                    }
                    return '';
                })
                .join('');
        }
    } catch {
        // Fall through to raw text.
    }
    return escapeHtml(delta).replaceAll('\n', '<br>');
}

export function statsLine(likeCount?: number, dislikeCount?: number, commentCount?: number): string {
    const stats = [likeCount === undefined ? undefined : `赞 ${likeCount}`, dislikeCount === undefined ? undefined : `踩 ${dislikeCount}`, commentCount === undefined ? undefined : `评论 ${commentCount}`].filter(Boolean);
    return stats.length ? `<p>${stats.join(' / ')}</p>` : '';
}

export function escapeHtml(text: string): string {
    return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function decodeTimestamp(buffer: Buffer): Timestamp {
    const timestamp: Timestamp = {};
    for (const field of readFields(buffer)) {
        if (field.no === 1) {
            timestamp.seconds = field.value as number;
        }
    }
    return timestamp;
}

function writeVarint(value: number): Buffer {
    const bytes: number[] = [];
    do {
        let byte = value & 0x7f;
        value >>>= 7;
        if (value) {
            byte |= 0x80;
        }
        bytes.push(byte);
    } while (value);
    return Buffer.from(bytes);
}

function readVarint(buffer: Buffer, offset: number): { value: number; offset: number } {
    let value = 0;
    let shift = 0;
    while (offset < buffer.length) {
        const byte = buffer[offset++];
        value += (byte & 0x7f) * 2 ** shift;
        if (!(byte & 0x80)) {
            return { value, offset };
        }
        shift += 7;
    }
    throw new Error('Invalid protobuf varint');
}

function looksLikeUtf8String(buffer: Buffer): boolean {
    if (!buffer.length) {
        return true;
    }
    const text = buffer.toString('utf8');
    return (
        !text.includes('\uFFFD') &&
        ![...text].some((char) => {
            const codePoint = char.codePointAt(0) ?? 0;
            return codePoint <= 8 || (codePoint >= 14 && codePoint <= 31);
        })
    );
}
