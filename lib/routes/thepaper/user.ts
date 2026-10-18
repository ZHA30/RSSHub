import { load } from 'cheerio';
import pMap from 'p-map';

import type { DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';

import { parseSourceDate, replaceVideos } from './utils';

export const route: Route = {
    path: '/user/:pphId',
    categories: ['new-media'],
    example: '/thepaper/user/4221423',
    parameters: { pphId: '澎湃号 id，可在澎湃号页 URL 中找到' },
    name: '澎湃号',
    maintainers: ['TonyRL'],
    handler,
};

interface AuthorInfo {
    userId: number;
    sname: string;
    pic: string;
    isAuth: string;
    userType: string;
    perDesc: string;
    mobile: null;
    isOrder: string;
    sex: string;
    area: string;
    attentionNum: string;
    fansNum: string;
    praiseNum: null;
    pph: boolean;
    normalUser: boolean;
    mobForwardType: number;
    authInfo: string;
    mail: string;
    pphImpactNum: string;
    wonderfulCommentCount: string;
    location: string;
    lastLoginDate: null;
}

interface PPHContentResponse {
    code: number;
    data: Data;
    desc: string;
    time: number;
}

interface Data {
    hasNext: boolean;
    startTime: number;
    list: ListItem[];
    nodeInfo: null;
    tagInfo: null;
    moreNodeInfo: null;
    pageNum: null;
    pageSize: null;
    pages: null;
    total: null;
    prevPageNum: null;
    nextPageNum: null;
    excludeContIds: null;
    contCont: null;
    filterIds: null;
    updateCount: null;
}

interface ListItem {
    contId: string;
    isOutForword: string;
    isOutForward: string;
    forwardType: string;
    mobForwardType: number;
    interactionNum: string;
    praiseTimes: string;
    pic: string;
    imgCardMode: number;
    smallPic: string;
    sharePic: string;
    pubTime: string;
    pubTimeNew: string;
    name: string;
    closePraise: string;
    authorInfo: AuthorInfo;
    nodeId: number;
    contType: number;
    pubTimeLong: number;
    specialNodeId: number;
    cardMode: string;
    dataObjId: number;
    closeFrontComment: boolean;
    isSupInteraction: boolean;
    hideVideoFlag: boolean;
    praiseStyle: number;
    isSustainedFly: number;
    softLocType: number;
    closeComment: boolean;
    voiceInfo: VoiceInfo;
    softAdTypeStr: string;
}

interface VoiceInfo {
    imgSrc: string;
    isHaveVoice: string;
}

async function handler(ctx) {
    const { pphId } = ctx.req.param();

    const userInfo = await cache.tryGet<AuthorInfo>(`thepaper:user:${pphId}`, async () => {
        const response = await ofetch(`https://api.thepaper.cn/userservice/user/homePage/${pphId}`, {
            headers: {
                'Client-Type': '2',
                Origin: 'https://m.thepaper.cn',
                Referer: 'https://m.thepaper.cn/',
            },
        });
        return response.userInfo;
    });

    const response = await ofetch<PPHContentResponse>('https://api.thepaper.cn/contentapi/cont/pph/user', {
        method: 'POST',
        body: {
            pageSize: 10,
            pageNum: 1,
            contType: 0,
            excludeContIds: [],
            pphId,
            startTime: 0,
        },
    });

    const list = response.data.list.map((item): DataItem & { contId: string } => ({
        title: item.name,
        link: `https://www.thepaper.cn/newsDetail_forward_${item.contId}`,
        pubDate: parseSourceDate(item.pubTimeLong),
        author: item.authorInfo.sname,
        contId: item.contId,
        image: item.pic,
    }));

    const items = await pMap(
        list,
        async (item) => ({
            ...item,
            ...(await cache.tryGet(item.link!, async () => {
                const response = await ofetch(`https://m.thepaper.cn/newsDetail_forward_${item.contId}`);
                const $ = load(response);
                const nextData = JSON.parse($('#__NEXT_DATA__').text());

                const contentDetail = nextData.props.pageProps.detailData.contentDetail;
                return {
                    description: replaceVideos(contentDetail.content),
                    updated: parseSourceDate(contentDetail.updateTime),
                };
            })),
        }),
        { concurrency: 3 }
    );

    return {
        title: userInfo.sname,
        description: userInfo.perDesc,
        link: `https://www.thepaper.cn/user_${pphId}`,
        item: items,
        itunes_author: userInfo.sname,
        image: userInfo.pic,
    };
}
