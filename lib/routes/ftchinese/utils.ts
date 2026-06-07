import type { CheerioAPI } from 'cheerio';
import { load } from 'cheerio';

import cache from '@/utils/cache';
import got from '@/utils/got';
import parser from '@/utils/rss-parser';

export const rootUrl = 'https://www.ftchinese.com';

type ProcessedFeed = {
    content: string | null;
    author: string;
    title: string;
};

const processStoryContent = ($: CheerioAPI, index: number, link: string): ProcessedFeed => {
    const title = $('h1').text();
    const content = $('div.story-container').eq(index);

    content.find('div.story-image > figure').each((_, element) => {
        const imageUrl = element.attribs['data-url'];

        if (imageUrl) {
            $(`<img src="https://thumbor.ftacademy.cn/unsafe/1340x754/${imageUrl}">`).insertAfter(content.find('div.story-lead')[0]);
        }
    });

    content.find('div#subscribe-now-container').each((_, element) => {
        $(`<br/><p>此文章为付费文章，会员<a href="${link}">请访问网站阅读</a>。</p>`).insertAfter(content.find('div.story-body')[0]);
        $(element).remove();
    });

    const author = content
        .find('span.story-author > a')
        .toArray()
        .map((element) => $(element).text())
        .join(' ')
        .trim();

    content
        .find(
            'div.story-theme, h1.story-headline, div.story-byline, div.mpu-container-instory, script, div#story-action-placeholder, div.copyrightstatement-container, div.clearfloat, div.o-ads, h2.list-title, div.allcomments, div.logincomment, div.nologincomment'
        )
        .remove();

    return {
        content: content.html(),
        author,
        title,
    };
};

export const getChannelData = async ({ site = 'www', channel }) => {
    const normalizedChannel = channel?.toLowerCase().split('-').join('/');
    let feed;

    if (normalizedChannel) {
        try {
            feed = await parser.parseURL(`https://${site}.ftchinese.com/rss/${normalizedChannel}`);
        } catch {
            return {
                title: `FT 中文网 ${normalizedChannel} 不存在`,
                description: `FT 中文网 ${normalizedChannel} 不存在`,
            };
        }
    } else {
        feed = await parser.parseURL(`https://${site}.ftchinese.com/rss/feed`);
    }

    const items = await Promise.all(
        feed.items.map((item) => {
            item.link = item.link.replace('http://', 'https://');

            return cache.tryGet(item.link, async () => {
                try {
                    const response = await got.get(`${item.link}?full=y&archive`);
                    const $ = load(response.data);
                    const results: ProcessedFeed[] = [];

                    for (let i = 0; i < $('div.story-container').length; i++) {
                        results.push(processStoryContent($, i, item.link));
                    }

                    if (results.length > 0) {
                        item.title = results[0].title;
                        item.description = results.map((result) => result.content).join('');
                        item.author = results[0].author;
                    }
                } catch {
                    // Keep the official RSS item when the optional full-text page is unavailable.
                }

                return item;
            });
        })
    );

    return {
        title: feed.title,
        link: feed.link,
        description: feed.description,
        item: items,
    };
};
