import { load } from 'cheerio';

import type { DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

const rootUrl = 'https://jy.hnust.edu.cn';
const detailModuleTitles = new Set(['宣讲会信息', '单位简介', '招聘简章', '职位描述', '招聘会信息', '招聘会说明']);

const categories = {
    notice: {
        name: '通知公告',
        panelType: '1727',
        panelContent: '1',
        detailType: 'news',
    },
    news: {
        name: '新闻资讯',
        panelType: '1726',
        panelContent: '1',
        detailType: 'news',
    },
    talent: {
        name: '人才工作站',
        panelType: '20355',
        panelContent: '1',
        detailType: 'news',
    },
    institution: {
        name: '事业单位',
        panelType: '300027',
        panelContent: '2',
        detailType: 'industry',
    },
    civil: {
        name: '公务员',
        panelType: '300026',
        panelContent: '2',
        detailType: 'industry',
    },
    policy: {
        name: '人才政策',
        panelType: '1738',
        panelContent: '1',
        detailType: 'news',
    },
    online: {
        name: '在线招聘',
        panelType: '5',
        panelContent: '',
        detailType: 'online',
    },
    career: {
        name: '校内宣讲会',
        panelType: '1',
        panelContent: '',
        detailType: 'career',
    },
    'career-outside': {
        name: '校外宣讲会',
        panelType: '2',
        panelContent: '',
        detailType: 'career',
    },
    jobfair: {
        name: '双选会',
        panelType: '3',
        panelContent: '',
        detailType: 'jobfair',
    },
    job: {
        name: '正式岗位',
        panelType: '6',
        panelContent: '',
        detailType: 'job',
    },
    intern: {
        name: '实习岗位',
        panelType: '7',
        panelContent: '',
        detailType: 'job',
    },
};

type CategoryKey = keyof typeof categories;
type DetailType = (typeof categories)[CategoryKey]['detailType'];

type EmploymentItem = {
    notice_id?: string;
    recruitment_id?: string;
    career_talk_id?: string;
    fair_id?: string;
    publish_id?: string;
    info_id?: string;
    type?: string;
    title?: string;
    notice_name?: string;
    meet_name?: string;
    job_name?: string;
    company_name?: string | null;
    org_name?: string;
    source_name?: string;
    news_pic?: string;
    logo?: string;
    logo_url?: string;
    cover_pic?: string;
    create_time?: string;
    create_time2?: string;
    publish_time?: string;
    meet_day?: string;
    meet_time?: string;
    a_meet_time?: string;
    address?: string;
    school_name?: string;
    work_city?: string;
    city_name?: string;
    salary?: string;
    degree_require?: string;
    content?: string;
    content_source_url?: string;
    source_url?: string;
};

const isCategoryKey = (category: string): category is CategoryKey => category in categories;

export const route: Route = {
    path: '/jy/:category?',
    categories: ['university'],
    example: '/hnust/jy/notice',
    parameters: { category: '分类，默认为通知公告' },
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
            source: ['jy.hnust.edu.cn/', 'jy.hnust.edu.cn/module/:path'],
            target: '/jy/notice',
        },
    ],
    name: '就业服务网',
    maintainers: ['ZHA30'],
    handler,
    url: 'jy.hnust.edu.cn',
    description: `| 通知公告 | 新闻资讯 | 人才工作站 | 事业单位    | 公务员 | 人才政策 | 在线招聘 | 校内宣讲会 | 校外宣讲会     | 双选会  | 正式岗位 | 实习岗位 |
| -------- | -------- | ---------- | ----------- | ------ | -------- | -------- | ---------- | -------------- | ------- | -------- | -------- |
| notice   | news     | talent     | institution | civil  | policy   | online   | career     | career-outside | jobfair | job      | intern   |`,
};

async function handler(ctx) {
    const categoryParam = ctx.req.param('category') ?? 'notice';
    const categoryKey = isCategoryKey(categoryParam) ? categoryParam : 'notice';
    const category = categories[categoryKey];
    const list = await fetchList(category.panelType, category.panelContent);

    const items = await Promise.all(
        list.map((item) => {
            const baseItem = buildItem(item, category.detailType, category.panelType);

            return cache.tryGet(`hnust:jy:detail:${baseItem.link}`, async () => {
                try {
                    const detail = await parseDetail(baseItem.link!);
                    return {
                        ...baseItem,
                        ...detail,
                        title: baseItem.title,
                        description: detail.description ?? baseItem.description,
                        pubDate: detail.pubDate ?? baseItem.pubDate,
                    };
                } catch {
                    return baseItem;
                }
            });
        })
    );

    return {
        title: `湖南科技大学就业服务网 - ${category.name}`,
        link: categoryLink(categoryKey),
        description: `湖南科技大学就业服务网 - ${category.name}`,
        item: items,
    };
}

async function fetchList(panelType: string, panelContent: string): Promise<EmploymentItem[]> {
    const response = await got(`${rootUrl}/index/loadpanellist`, {
        searchParams: {
            panel_type: panelType,
            count: 20,
            panel_content: panelContent,
            panel_id: '',
        },
        headers: {
            'X-Requested-With': 'XMLHttpRequest',
        },
    });

    if (response.data.code !== 1) {
        throw new Error(`Failed to fetch employment list: ${response.data.msg || 'unknown error'}`);
    }

    return response.data.data;
}

function buildItem(item: EmploymentItem, detailType: DetailType, panelType: string): DataItem {
    const title = item.notice_name || item.title || item.meet_name || [item.company_name, item.job_name].filter(Boolean).join(' - ') || item.job_name || item.company_name || item.org_name || '无标题';
    const link = getItemLink(item, detailType, panelType);
    const date = getItemDate(item);
    const author = item.company_name || item.org_name || item.source_name || undefined;
    const description = buildSummary(item);

    return {
        title,
        link,
        author,
        description,
        pubDate: date,
        image: item.news_pic || item.logo || item.logo_url || item.cover_pic || undefined,
        guid: getGuid(item, link),
    };
}

function getItemLink(item: EmploymentItem, detailType: DetailType, panelType: string): string {
    if (detailType === 'news' && item.notice_id) {
        return `${rootUrl}/detail/news?id=${item.notice_id}&type_id=${item.type || panelType}`;
    }

    if (detailType === 'industry' && item.info_id) {
        return `${rootUrl}/detail/industry?id=${item.info_id}&type_id=${panelType}`;
    }

    if (detailType === 'online' && item.recruitment_id) {
        return `${rootUrl}/detail/online?id=${item.recruitment_id}`;
    }

    if (detailType === 'career' && item.career_talk_id) {
        return `${rootUrl}/detail/career?id=${item.career_talk_id}`;
    }

    if (detailType === 'jobfair' && item.fair_id) {
        return `${rootUrl}/detail/jobfair?id=${item.fair_id}`;
    }

    if (detailType === 'job' && item.publish_id) {
        return `${rootUrl}/detail/job?id=${item.publish_id}`;
    }

    return item.source_url || item.content_source_url || rootUrl;
}

function getGuid(item: EmploymentItem, link: string): string {
    return item.notice_id || item.recruitment_id || item.career_talk_id || item.fair_id || item.publish_id || item.info_id || link;
}

function getItemDate(item: EmploymentItem) {
    if (item.a_meet_time) {
        return timezone(new Date(Number(item.a_meet_time) * 1000), 8);
    }

    const date = item.create_time || item.publish_time || item.meet_day;
    if (!date) {
        return;
    }

    const dateTime = item.create_time2 ? `${date} ${item.create_time2}` : date;
    return timezone(parseDate(dateTime), 8);
}

function buildSummary(item: EmploymentItem): string | undefined {
    const rows = [
        ['单位', item.company_name || item.org_name],
        ['学校', item.school_name],
        ['地点', item.address || item.work_city || item.city_name],
        ['薪资', item.salary],
        ['学历', item.degree_require],
        ['时间', [item.meet_day, item.meet_time].filter(Boolean).join(' ')],
        ['来源', item.source_name],
    ].filter((row): row is [string, string] => Boolean(row[1]));

    const summary = rows.map(([key, value]) => `<p>${key}：${value}</p>`).join('');
    const content = item.content ? `<p>${item.content}</p>` : '';

    if (summary || content) {
        return `${summary}${content}`;
    }

    const sourceUrl = item.source_url || item.content_source_url;
    if (sourceUrl) {
        return `<p><a href="${sourceUrl}">查看原文</a></p>`;
    }

    return;
}

async function parseDetail(link: string): Promise<Partial<DataItem>> {
    const response = await got(link);
    const $ = load(response.data);

    $('script, style, iframe').remove();

    const title = $('h1').first().text().trim() || $('.dh-tit').first().text().trim() || $('.job-title').first().text().trim() || undefined;
    const dateText = $('.dh-info, .info, .time')
        .toArray()
        .map((element) => $(element).text())
        .join(' ');
    const date = dateText.match(/\d{4}年\d{1,2}月\d{1,2}日/)?.[0] || dateText.match(/\d{4}-\d{1,2}-\d{1,2}/)?.[0];

    const description = extractDescription($, link);

    return {
        title,
        description: description || undefined,
        pubDate: date ? timezone(parseDate(date), 8) : undefined,
    };
}

function extractDescription($: ReturnType<typeof load>, baseUrl: string): string {
    const content = $('.details-content').first();
    const attachments = $('.pub-download-list').first();

    if (content.length) {
        const descriptionNode = content.clone();
        cleanElement($, descriptionNode, baseUrl);

        const attachmentNode = attachments.clone();
        cleanElement($, attachmentNode, baseUrl);

        return [descriptionNode.html(), attachmentNode.length ? attachmentNode.html() : undefined].filter(Boolean).join('');
    }

    const modules = $('.detail-module')
        .toArray()
        .map((element) => $(element))
        .filter((element) => {
            const title = element.find('.dm-tit').first().text().trim();
            return detailModuleTitles.has(title) && !element.hasClass('hide') && element.attr('id') !== 'join_company';
        });

    const wrapper = $('<div></div>');
    for (const module of modules) {
        const clonedModule = module.clone();
        clonedModule.find('.dm-tit').each((_, node) => {
            const title = $(node).text().trim();
            $(node).replaceWith(`<h3>${title}</h3>`);
        });
        wrapper.append(clonedModule);
    }

    cleanElement($, wrapper, baseUrl);

    return wrapper.html() || '';
}

function cleanElement($: ReturnType<typeof load>, element: ReturnType<ReturnType<typeof load>>, baseUrl: string) {
    element.find('script, style, iframe, form, input, button, select, textarea, .bshare-custom, .pub-code, .qr, .opera, .has-opera .opera, .pub-btn, .float-bar, .footer-content').remove();
    element.find('a[href^="javascript:"]').remove();
    element.find('span').each((_, node) => {
        $(node).replaceWith($(node).contents());
    });
    element.find('*').each((_, node) => {
        const item = $(node);
        for (const attribute of Object.keys(node.attribs ?? {})) {
            if (attribute === 'href' || attribute === 'src' || attribute === 'poster' || attribute === 'alt' || attribute === 'title') {
                continue;
            }
            item.removeAttr(attribute);
        }
    });

    element.find('p, div, span').each((_, node) => {
        const item = $(node);
        if (!item.text().trim() && !item.find('img, video, audio, a, table').length) {
            item.remove();
        }
    });
    element.find('div').each((_, node) => {
        const item = $(node);
        if (!item.attr('href') && !item.find('table').length && item.children().length === 0) {
            item.replaceWith(item.contents());
        }
    });

    normalizeUrls($, element, baseUrl);
}

function normalizeUrls($: ReturnType<typeof load>, element: ReturnType<ReturnType<typeof load>>, baseUrl: string) {
    element.find('img, video, source').each((_, node) => {
        const item = $(node);
        const src = item.attr('src');
        if (src) {
            item.attr('src', new URL(src, baseUrl).href);
        }
        const poster = item.attr('poster');
        if (poster) {
            item.attr('poster', new URL(poster, baseUrl).href);
        }
    });

    element.find('a[href]').each((_, node) => {
        const item = $(node);
        const href = item.attr('href');
        if (href) {
            item.attr('href', new URL(href, baseUrl).href);
        }
    });
}

function categoryLink(categoryKey: CategoryKey): string {
    if (['notice', 'news', 'talent', 'policy'].includes(categoryKey)) {
        return `${rootUrl}/module/news?type_id=${categories[categoryKey].panelType}`;
    }

    if (categoryKey === 'career') {
        return `${rootUrl}/module/careers?type=inner&menu_id=46030`;
    }

    if (categoryKey === 'career-outside') {
        return `${rootUrl}/module/careers?type=outer&menu_id=46030`;
    }

    return rootUrl;
}
