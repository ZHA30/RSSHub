import { load } from 'cheerio';

import type { DataItem, Route } from '@/types';
import { getPlaywrightPage } from '@/utils/playwright';

type ShelfItem = DataItem & { link: string };

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
    } catch (error) {
        await destroy();
        throw error;
    }

    const $ = load(html);
    const cards: ShelfItem[] = $('#grid a.card')
        .toArray()
        .flatMap((element) => {
            const card = $(element);
            const href = card.attr('href');
            const title = card.find('h2').text().trim();

            if (!href || !title) {
                return [];
            }

            return [{
                title,
                link: new URL(href, link).href,
                author: card.find('.au').text().trim() || undefined,
                image: card.find('img').attr('src') ? new URL(card.find('img').attr('src')!, link).href : undefined,
            }];
        });

    try {
        const item: DataItem[] = [];
        for (const card of cards) {
            try {
                const detail = await getDetail(page, card.link);
                item.push({ ...card, ...detail });
            } catch {
                item.push(card);
            }
        }

        return {
            title: "HackerBooks - Today's shelf",
            link,
            description: 'A daily reshuffled selection of books mentioned on Hacker News.',
            sortItems: false,
            item,
        };
    } finally {
        await destroy();
    }
}

async function getDetail(page, url: string): Promise<Partial<DataItem>> {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const $ = load(await page.content());
    const content = $('article, main, .content, .book-content, [class*="description"]').first().clone();

    if (!content.length) {
        return {};
    }

    content.find('script, style, nav, header, footer, form').remove();
    content.find('img').each((_, element) => {
        const image = $(element);
        const src = image.attr('src') || image.attr('data-src');
        if (src) {
            image.attr('src', new URL(src, url).href);
            image.removeAttr('data-src');
        }
    });
    content.find('a').each((_, element) => {
        const anchor = $(element);
        const href = anchor.attr('href');
        if (href) {
            anchor.attr('href', new URL(href, url).href);
        }
    });

    const html = content.html()?.trim();
    return html
        ? {
              description: html,
              content: { html, text: content.text().replaceAll(/\s+/g, ' ').trim() },
          }
        : {};
}
