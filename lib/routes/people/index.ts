import { load } from 'cheerio';
import iconv from 'iconv-lite';

import InvalidParameterError from '@/errors/types/invalid-parameter';
import type { DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';
import { isValidHost } from '@/utils/valid-host';

type ListItem = DataItem & {
    title: string;
    link: string;
};

export const route: Route = {
    path: '/:site?/:category{.+}?',
    name: '首页头条',
    maintainers: ['nczitzk', 'pseudoyu'],
    example: '/people',
    parameters: {
        site: '人民网子域名，默认为 `www`',
        category: '栏目路径，即源站 URL 中 `/GB/` 后的部分，默认为 `59476`',
    },
    handler,
};

async function handler(ctx) {
    const { site = 'www' } = ctx.req.param();
    let { category = site === 'www' ? '59476' : '' } = ctx.req.param();
    category = site === 'cpc' && category === '24h' ? '87228' : category;

    const limit = ctx.req.query('limit') ? Number.parseInt(ctx.req.query('limit'), 10) : 30;

    if (!isValidHost(site)) {
        throw new InvalidParameterError('Invalid site');
    }
    const rootUrl = `http://${site}.people.com.cn`;
    const currentUrl = new URL(`GB/${category}`, rootUrl).href;

    const response = await ofetch(currentUrl, {
        responseType: 'arrayBuffer',
    });

    // try to parse charset from meta tag
    let decodedResponse = iconv.decode(Buffer.from(response), 'utf-8');
    const parsedCharset = decodedResponse.match(/<meta.*?charset=["']?([^"'>]+)["']?/i);
    const encoding = parsedCharset ? parsedCharset[1].toLowerCase() : 'utf-8';
    decodedResponse = encoding === 'utf-8' ? decodedResponse : iconv.decode(Buffer.from(response), encoding);
    const $ = load(decodedResponse);

    $('em').remove();
    $('.bshare-more, .page_n, .page').remove();

    $('a img, h3 img').each((_, e) => {
        $(e).parent().remove();
    });

    let items: ListItem[] = $('.p6, div.p2j_list, div.headingNews, div.ej_list_box, .leftItem')
        .find('a')
        .slice(0, limit)
        .toArray()
        .map((element) => {
            const item = $(element);

            const link = item.attr('href')?.trim() ?? '';

            return {
                title: item.text(),
                link: link.indexOf('http') === 0 ? link : new URL(link.replace(/^\.\./, ''), rootUrl).href,
            };
        });

    items = await Promise.all(
        items.map((item) =>
            cache.tryGet(item.link, async () => {
                try {
                    const detailResponse = await ofetch(item.link, {
                        responseType: 'arrayBuffer',
                    });

                    const data = iconv.decode(Buffer.from(detailResponse), encoding);
                    const content = load(data);

                    content('.paper_num, #rwb_tjyd, .voice-wrap, .voice-container, .voice-img-wrap, .rm_relevant, .rm_download, .bza, .edit, .rmw-page-view, .rm_dingy, .rm_qxdingy, .rm_yshouc, .rm_shouc, .rm_type').remove();
                    content('#rwb_zw, #rm_txt_zw')
                        .find('*')
                        .each((_, element) => {
                            const node = content(element);
                            const attribs = element.attribs ? Object.keys(element.attribs) : [];

                            if (attribs.length > 0) {
                                node.removeAttr(attribs.filter((attr) => ['style', 'class', 'id', 'target', 'align', 'width', 'height'].includes(attr) || attr.startsWith('data-') || attr.startsWith('on')).join(' '));
                            }
                        });

                    for (const element of content('#rwb_zw, #rm_txt_zw').find('*').toArray().toReversed()) {
                        const node = content(element);

                        if (!node.text().trim() && node.children().length === 0 && !node.is('img, video, audio, source, iframe, embed, object, br')) {
                            node.remove();
                        }
                    }

                    item.description = content('#rwb_zw, #rm_txt_zw').first().html() ?? undefined;
                    item.pubDate = timezone(parseDate(data.match(/(\d{4}年\d{2}月\d{2}日\d{2}:\d{2})/)?.[1] || '', 'YYYY年MM月DD日 HH:mm'), +8);
                } catch (error) {
                    item.description = String(error);
                }

                return item;
            })
        )
    );

    return {
        title: $('title').text(),
        link: currentUrl,
        item: items,
    };
}
