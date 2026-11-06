import { escapeText } from 'entities';

import type { Route } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

export const route: Route = {
    path: '/recent',
    categories: ['multimedia'],
    example: '/hackertube/recent',
    url: 'hackertube.org/browse?sort=recent',
    name: 'Recently recommended',
    maintainers: ['ZHA30'],
    handler,
};

type Video = {
    vid: string;
    title: string;
    channel: string;
    published?: string;
    summary?: string;
    thumbnail?: string;
    tags: string[];
};

async function handler() {
    const link = 'https://hackertube.org/browse?sort=recent';
    const videos = await ofetch<Video[]>('https://hackertube.org/api/list', {
        query: { sort: 'recent', n: 36 },
    });

    return {
        title: 'HackerTube - Recently recommended',
        link,
        sortItems: false,
        item: videos.map((video) => ({
            title: video.title,
            link: `https://hackertube.org/watch/${video.vid}`,
            author: video.channel,
            pubDate: video.published ? parseDate(video.published) : undefined,
            description: video.summary ? escapeText(video.summary) : undefined,
            image: video.thumbnail,
            category: video.tags,
        })),
    };
}
