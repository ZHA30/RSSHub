import { load } from 'cheerio';

import type { Route } from '@/types';
import { getPlaywrightPage } from '@/utils/playwright';

export const route: Route = {
    path: '/shelf',
    categories: ['reading'],
    example: '/hackerbooks/shelf',
    url: 'hackerbooks.org',
    name: "Today's shelf",
    maintainers: ['ZHA30'],
    features: { requirePuppeteer: true },
    radar: [{ source: ['hackerbooks.org/'] }],
    handler,
};

async function handler() {
    const link = 'https://hackerbooks.org/';
    const { page, destroy } = await getPlaywrightPage(link, { noGoto: true, closeTimeout: 0 });
    let html: string;
    try {
        await page.route('**/*', (request) => (request.request().resourceType() === 'document' ? request.continue() : request.abort()));
        await page.goto(link, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#grid a.card');
        html = await page.content();
    } finally {
        await destroy();
    }

    const $ = load(html);
    const item = $('#grid a.card')
        .toArray()
        .map((element) => {
            const card = $(element);
            return {
                title: card.find('h2').text(),
                link: new URL(card.attr('href')!, link).href,
                author: card.find('.au').text() || undefined,
                image: card.find('img').attr('src'),
            };
        });

    return {
        title: "HackerBooks - Today's shelf",
        link,
        description: 'A daily reshuffled selection of books mentioned on Hacker News.',
        sortItems: false,
        item,
    };
}
