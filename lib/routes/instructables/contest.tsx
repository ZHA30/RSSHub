import { raw } from 'hono/html';
import { renderToString } from 'hono/jsx/dom/server';
import pMap from 'p-map';

import type { Data, DataItem, Route } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const rootUrl = 'https://www.instructables.com';
const currentContestsApi = `${rootUrl}/json-api/getCurrentContests`;
const closedContestsApi = `${rootUrl}/json-api/getClosedContests`;
const contestDetailApi = `${rootUrl}/json-api/contest`;

const filterCategories = (...categories: Array<string | undefined>) => categories.filter((category): category is string => !!category);
const detailCacheKey = (urlString: string) => `instructables:contest:detail:${urlString}`;

type Contest = {
    title: string;
    urlString: string;
    bannerUrl?: string;
    state?: string;
    deadline?: string;
    startDate?: string;
    prizeCount?: number;
    numEntries?: number;
    onlyUS?: boolean;
    studentOnly?: boolean;
};

type ContestDetail = Contest & {
    bodyFull?: string;
};

export const route: Route = {
    path: '/contest',
    categories: ['design'],
    example: '/instructables/contest',
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
            source: ['instructables.com/contest'],
            target: '/contest',
        },
    ],
    name: 'Contests',
    maintainers: ['ZHA30'],
    handler,
    url: 'instructables.com/contest',
    description: 'Current and recent contests on Instructables',
};

async function handler(): Promise<Data> {
    const [currentResponse, closedResponse] = await Promise.all([
        ofetch<{ contests: Contest[] }>(currentContestsApi),
        ofetch<{ contests: Contest[] }>(closedContestsApi, {
            query: {
                limit: 20,
                offset: 0,
            },
        }),
    ]);

    const contests = [...currentResponse.contests, ...closedResponse.contests];
    const items: DataItem[] = await pMap(
        contests,
        async (contest) => {
            const link = `${rootUrl}/contest/${contest.urlString}/`;
            let detail: ContestDetail | undefined;

            try {
                detail = await cache.tryGet(detailCacheKey(contest.urlString), () =>
                    ofetch<ContestDetail>(contestDetailApi, {
                        query: {
                            path: contest.urlString,
                        },
                    })
                );
            } catch {
                detail = undefined;
            }

            return {
                title: contest.title,
                link,
                description: renderContestDescription(contest, detail),
                pubDate: contest.startDate ? parseDate(contest.startDate) : undefined,
                category: filterCategories(contest.state, contest.onlyUS ? 'US Only' : undefined, contest.studentOnly ? 'Student Only' : undefined),
            };
        },
        { concurrency: 4 }
    );

    return {
        title: 'Instructables Contests',
        link: `${rootUrl}/contest/`,
        description: 'Current and recent contests on Instructables',
        language: 'en',
        item: items,
    };
}

function renderContestDescription(contest: Contest, detail?: ContestDetail) {
    return renderToString(<>{detail?.bodyFull ? <div>{raw(detail.bodyFull)}</div> : undefined}</>);
}
