import MarkdownIt from 'markdown-it';

import { config } from '@/config';
import ConfigNotFoundError from '@/errors/types/config-not-found';
import type { Route } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const apiUrl = 'https://api.github.com';
const md = MarkdownIt({
    html: true,
    linkify: true,
});

export const route: Route = {
    path: '/notifications',
    categories: ['programming'],
    example: '/github/notifications',
    features: {
        requireConfig: [
            {
                name: 'GITHUB_ACCESS_TOKEN',
                description: 'GitHub personal access token with notifications access',
            },
        ],
    },
    radar: [
        {
            source: ['github.com/notifications'],
        },
    ],
    name: 'Notifications',
    maintainers: ['zhzy0077'],
    handler,
    url: 'github.com/notifications',
};

async function handler(ctx) {
    if (!config.github || !config.github.access_token) {
        throw new ConfigNotFoundError('GitHub notification RSS is disabled due to the lack of <a href="https://docs.rsshub.app/deploy/config#route-specific-configurations">relevant config</a>');
    }
    const headers = getHeaders();
    const limit = ctx.req.query('limit') ? Math.min(Number.parseInt(ctx.req.query('limit')), 50) : 20;

    const response = await ofetch.raw(`${apiUrl}/notifications`, {
        headers,
        query: {
            per_page: limit,
        },
    });
    const notifications = response._data;

    const items = await Promise.all(notifications.map((item) => buildNotificationItem(item, headers)));

    ctx.set('json', {
        title: 'Github Notifications',
        item: items,
        rateLimit: {
            limit: Number.parseInt(getHeader(response.headers, 'x-ratelimit-limit')),
            remaining: Number.parseInt(getHeader(response.headers, 'x-ratelimit-remaining')),
            reset: parseDate(Number.parseInt(getHeader(response.headers, 'x-ratelimit-reset')) * 1000),
            resoure: response.headers.get('x-ratelimit-resource'),
            used: Number.parseInt(getHeader(response.headers, 'x-ratelimit-used')),
        },
    });

    return {
        title: 'Github Notifications',
        link: 'https://github.com/notifications',
        item: items,
        allowEmpty: true,
    };
}

function getHeaders() {
    return {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${config.github.access_token}`,
        'X-GitHub-Api-Version': '2022-11-28',
    };
}

function getHeader(headers, name) {
    return headers.get(name) ?? '';
}

async function buildNotificationItem(notification, headers) {
    const threadUrl = notification.url ?? `${apiUrl}/notifications/threads/${notification.id}`;
    const thread = await cache.tryGet(threadUrl, async () => await ofetch(threadUrl, { headers }));
    const subject = thread.subject ?? notification.subject ?? {};
    const repository = thread.repository ?? notification.repository ?? {};
    const detail = subject.url ? await fetchGitHubResource(subject.url, headers) : null;
    const latestComment = subject.latest_comment_url ? await fetchGitHubResource(subject.latest_comment_url, headers) : null;

    const repoFullName = repository.full_name ?? extractRepoFullName(subject.url);
    const type = normalizeSubjectType(subject.type, detail);
    const link = resolveOriginUrl(subject, detail, repository);
    const title = formatTitle(repoFullName, type, detail?.number, subject.title ?? detail?.title ?? 'Untitled');

    return {
        title,
        ...(latestComment?.body ? { description: md.render(latestComment.body) } : {}),
        pubDate: parseDate(thread.updated_at ?? notification.updated_at),
        guid: thread.id ?? notification.id,
        author: latestComment?.user?.login,
        link,
    };
}

async function fetchGitHubResource(url, headers) {
    try {
        return await cache.tryGet(url, async () => await ofetch(url, { headers }));
    } catch {
        return null;
    }
}

function resolveOriginUrl(subject, detail, repository) {
    if (detail?.html_url) {
        return detail.html_url;
    }

    let originUrl = subject.url ? subject.url.replace('https://api.github.com/repos/', 'https://github.com/') : (repository.html_url ?? 'https://github.com/notifications');
    originUrl = originUrl.replace('/pulls/', '/pull/');

    if (originUrl.includes('/releases/')) {
        originUrl = originUrl.replace(/\/releases\/\d+$/, '/releases');
    }

    return originUrl;
}

function normalizeSubjectType(type, detail) {
    return (type ?? (detail?.pull_request ? 'PullRequest' : 'Unknown')).toLowerCase();
}

function formatTitle(repoFullName, type, number, subjectTitle) {
    const repo = repoFullName ?? 'github';
    const typeLabel = type ?? 'notification';
    const numberLabel = number ? ` #${number}` : '';
    return `[${repo}|${typeLabel}]${numberLabel} ${subjectTitle}`;
}

function extractRepoFullName(url) {
    const match = url?.match(/repos\/([^/]+\/[^/]+)/);
    return match?.[1];
}
