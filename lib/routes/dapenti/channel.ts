import InvalidParameterError from '@/errors/types/invalid-parameter';
import type { Data, Route } from '@/types';
import { getRouteLimit } from '@/utils/route-limit';

import { baseUrl, channels, getItems } from './utils';

export const route: Route = {
    path: '/channel/:channel',
    name: '栏目',
    url: 'www.dapenti.com/blog/index-responsive-new.asp',
    categories: ['new-media'],
    example: '/dapenti/channel/tugua',
    maintainers: ['ZHA30'],
    parameters: {
        channel: {
            description: '栏目名称，使用新版栏目地址中的 channel 值',
            options: Object.entries(channels).map(([value, label]) => ({ value, label })),
        },
    },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportRadar: true,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    radar: Object.entries(channels).map(([channel, title]) => ({
        title,
        source: ['www.dapenti.com', 'www.dapenti.com/blog/index-responsive-new.asp'],
        target: `/channel/${channel}`,
    })),
    description:
        '订阅新版公开栏目的最新文章，默认获取 10 篇，支持通用 limit 参数，最多读取第一页的 30 篇。公开文章返回正文；会员文章仅返回源站公开的内容或访问提示。喷嚏优选按源站规则仅展示最近 7 天的内容。喷嚏意图（yitu）的独立栏目需要登录，不在此公开接口范围内。',
    handler,
};

async function handler(ctx): Promise<Data> {
    const channel = ctx.req.param('channel');
    if (!Object.hasOwn(channels, channel)) {
        throw new InvalidParameterError(`Unsupported channel: ${channel}. Supported channels: ${Object.keys(channels).join(', ')}`);
    }

    return {
        title: `喷嚏网 - ${channels[channel as keyof typeof channels]}`,
        link: `${baseUrl}member-channel.asp?channel=${channel}`,
        language: 'zh-CN',
        item: await getItems(channel, getRouteLimit(ctx, 10)),
        sortItems: false,
        allowEmpty: true,
    };
}
