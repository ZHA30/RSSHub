import { load } from 'cheerio';

import type { Route } from '@/types';

import { fetchWithCookie } from './utils';
import utils from './utils';

export const route: Route = {
    path: '/list/:id',
    categories: ['new-media'],
    example: '/thepaper/list/25457',
    parameters: { id: '栏目 id，可在栏目页 URL 中找到' },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: '栏目',
    maintainers: ['nczitzk', 'bigfei'],
    handler,
    description: `| 栏目 ID | 栏目名     | 所属频道 |
| ------- | ---------- | -------- |
| 26912   | 上直播     | 视频     |
| 26913   | 锋线视频   | 视频     |
| 26965   | 温度计     | 视频     |
| 26908   | 一级视场   | 视频     |
| 27260   | World 湃   | 视频     |
| 26907   | 湃客科技   | 视频     |
| 33168   | 纪录湃     | 视频     |
| 119740  | 奇客解     | 视频     |
| 26911   | 暖闻湃     | 视频     |
| 26918   | @所有人    | 视频     |
| 26906   | 大都会     | 视频     |
| 26909   | 追光灯     | 视频     |
| 26910   | 运动装     | 视频     |
| 89035   | 影子调查   | 视频     |
| 92278   | 关键帧     | 视频     |
| 142516  | 时政湃     | 视频     |
| 25462   | 中国政库   | 时事     |
| 25488   | 中南海     | 时事     |
| 25489   | 舆论场     | 时事     |
| 25490   | 打虎记     | 时事     |
| 25423   | 人事风向   | 时事     |
| 25426   | 法治中国   | 时事     |
| 25424   | 一号专案   | 时事     |
| 25463   | 港台来信   | 时事     |
| 25491   | 长三角政商 | 时事     |
| 25428   | 直击现场   | 时事     |
| 68750   | 公益湃     | 时事     |
| 25464   | 澎湃质量观 | 时事     |
| 25425   | 绿政公署   | 时事     |
| 137534  | 国防聚焦   | 时事     |
| 25427   | 澎湃人物   | 时事     |
| 25422   | 浦江头条   | 时事     |
| 127425  | 上海大调研 | 时事     |
| 25487   | 教育家     | 时事     |
| 25635   | 美数课     | 时事     |
| 138033  | 对齐 Lab   | 时事     |
| 25600   | 快看       | 时事     |
| 25429   | 全球速报   | 国际     |
| 122903  | 澎湃世界观 | 国际     |
| 122904  | 澎湃明查   | 国际     |
| 25430   | 澎湃防务   | 国际     |
| 25481   | 外交学人   | 国际     |
| 25678   | 唐人街     | 国际     |
| 122905  | 大国外交   | 国际     |
| 27260   | World 湃   | 国际     |
| 25434   | 10% 公司   | 财经     |
| 25436   | 能见度     | 财经     |
| 25433   | 地产界     | 财经     |
| 25438   | 财经上下游 | 财经     |
| 124129  | 区域经纬   | 财经     |
| 25435   | 金改实验室 | 财经     |
| 25437   | 牛市点线面 | 财经     |
| 119963  | IPO 最前线 | 财经     |
| 25485   | 澎湃商学院 | 财经     |
| 25432   | 自贸区连线 | 财经     |
| 145902  | 新引擎     | 财经     |
| 37978   | 进博会在线 | 财经     |
| 27234   | 科学湃     | 科技     |
| 119445  | 生命科学   | 科技     |
| 119447  | 未来 2%    | 科技     |
| 119448  | 科创 101   | 科技     |
| 119449  | 科学城邦   | 科技     |
| 36079   | 湃客       | 澎湃号   |
| 27392   | 政务       | 澎湃号   |
| 77286   | 媒体       | 澎湃号   |
| 25445   | 澎湃研究所 | 智库     |
| 25446   | 全球智库   | 智库     |
| 26915   | 城市漫步   | 智库     |
| 25456   | 市政厅     | 智库     |
| 104191  | 世界会客厅 | 智库     |
| 25444   | 社论       | 思想     |
| 27224   | 澎湃评论   | 思想     |
| 26525   | 思想湃     | 思想     |
| 26878   | 上海书评   | 思想     |
| 25483   | 思想市场   | 思想     |
| 25457   | 私家历史   | 思想     |
| 25574   | 翻书党     | 思想     |
| 25455   | 艺术评论   | 思想     |
| 26937   | 古代艺术   | 思想     |
| 25450   | 文化课     | 思想     |
| 25482   | 逝者       | 思想     |
| 25536   | 理论・学术 | 思想     |
| 103076  | 一问三知   | 思想     |
| 25448   | 有戏       | 生活     |
| 26609   | 文艺范     | 生活     |
| 135619  | 上海文艺   | 生活     |
| 26909   | 追光灯     | 生活     |
| 26015   | 私・奔     | 生活     |
| 25599   | 运动家     | 生活     |
| 97313   | 海平面     | 生活     |
| 80623   | 非常品     | 生活     |
| 26862   | 城势       | 生活     |
| 25769   | 生活方式   | 生活     |
| 26202   | 亲子学堂   | 生活     |
| 26404   | 赢家       | 生活     |
| 26490   | 汽车圈     | 生活     |
| 115327  | IP SH      | 生活     |
| 117340  | 酒业       | 生活     |`,
};

async function handler(ctx) {
    const id = ctx.req.param('id');
    const listUrl = `https://m.thepaper.cn/list/${id}`;
    const listUrlResp = await fetchWithCookie(listUrl);
    const $ = load(listUrlResp);
    const nextData = $('#__NEXT_DATA__').text();
    const listUrlData = JSON.parse(nextData);

    const resp = await fetchWithCookie('https://api.thepaper.cn/contentapi/nodeCont/getByNodeIdPortal', {
        method: 'POST',
        body: {
            nodeId: id,
        },
    });
    const pagePropsData = resp.data;
    const list = pagePropsData.list;

    const items = await Promise.all(list.map((item) => utils.ProcessItem(item, ctx)));
    return {
        title: `澎湃新闻栏目 - ${utils.ListIdToName(id, listUrlData)}`,
        link: listUrl,
        item: items,
        itunes_author: '澎湃新闻',
        image: pagePropsData.nodeInfo?.pic ?? utils.ExtractLogo(listUrlResp),
    };
}
