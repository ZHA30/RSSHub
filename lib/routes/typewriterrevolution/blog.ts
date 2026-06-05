import type { Data, Route } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const baseUrl = 'https://typewriterrevolution.com';
const blogUrl = `${baseUrl}/the-typewriter-revolution-blog/`;
const apiUrl = `${baseUrl}/wp-json/wp/v2/posts?per_page=20&_embed=1`;

export const route: Route = {
    path: '/blog',
    categories: ['blog'],
    example: '/typewriterrevolution/blog',
    parameters: {},
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
            source: ['typewriterrevolution.com/the-typewriter-revolution-blog/'],
            target: '/blog',
        },
    ],
    name: 'Weblog',
    maintainers: ['ZHA30'],
    handler,
    url: 'typewriterrevolution.com/the-typewriter-revolution-blog/',
};

async function handler(): Promise<Data> {
    const posts = await ofetch<WordPressPost[]>(apiUrl);

    return {
        title: 'The Typewriter Revolution - Weblog',
        link: blogUrl,
        description: 'Latest posts from The Typewriter Revolution weblog.',
        language: 'en',
        item: posts.map((post) => {
            const terms = post._embedded?.['wp:term'] ?? [];
            const categories = terms.flat().filter((term) => term.taxonomy === 'category');
            const media = post._embedded?.['wp:featuredmedia']?.[0];

            return {
                title: post.title.rendered,
                link: post.link,
                description: post.excerpt.rendered,
                pubDate: parseDate(post.date),
                updated: parseDate(post.modified),
                author: post._embedded?.author?.[0]?.name,
                category: categories.map((category) => category.name),
                banner: media?.source_url,
            };
        }),
    };
}

interface WordPressPost {
    date: string;
    modified: string;
    link: string;
    title: {
        rendered: string;
    };
    excerpt: {
        rendered: string;
    };
    _embedded?: {
        author?: Array<{
            name: string;
        }>;
        'wp:featuredmedia'?: Array<{
            source_url?: string;
        }>;
        'wp:term'?: Array<
            Array<{
                name: string;
                taxonomy: string;
            }>
        >;
    };
}
