import { renderToString } from 'hono/jsx/dom/server';

const extractDoc = (data) =>
    data
        .map((item) => {
            const type = item.type;
            if (type === 'video') {
                return renderVideo(item.data);
            }
            if (type === 'text') {
                return item.data.replaceAll(/data-lazyload=(.+?) src=(.+?) style=".+?"/g, 'src=$1');
            }
            return '';
        })
        .join('<br>');

const renderVideo = (videoInfo) =>
    renderToString(
        videoInfo.mobileUrl ? (
            <video controls poster={videoInfo.bigPosterUrl} preload="metadata">
                <source src={videoInfo.mobileUrl} type="video/mp4" />
            </video>
        ) : null
    );

const extractJsonObject = (text: string, marker: string) => {
    const markerIndex = text.indexOf(marker);
    if (markerIndex === -1) {
        return;
    }

    const start = text.indexOf('{', markerIndex);
    if (start === -1) {
        return;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
        const char = text[i];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        switch (char) {
            case '"':
                inString = true;
                break;
            case '{':
                depth++;
                break;
            case '}':
                depth--;
                if (depth === 0) {
                    return text.slice(start, i + 1);
                }
                break;
            default:
                break;
        }
    }
};

export const extractIfengData = (html: string) => {
    const source = extractJsonObject(html, 'var allData = ');
    return source ? JSON.parse(source) : undefined;
};

export type IfengNewsstreamItem = {
    url: string;
    title: string;
    id?: string;
    base62Id?: string;
    newsTime?: string;
    thumbnail?: string;
    thumbnails?: {
        image?: Array<{ url: string; width?: number; height?: number }>;
    };
};

export const extractNewsstream = (html: string): IfengNewsstreamItem[] => {
    const data = extractIfengData(html);
    if (!Array.isArray(data?.newsstream)) {
        throw new Error('newsstream not found');
    }
    return data.newsstream as IfengNewsstreamItem[];
};

export { extractDoc, renderVideo };
