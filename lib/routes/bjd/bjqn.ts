import type { Route } from '@/types';

import { createNewspaperRoute } from './utils';

export const route: Route = createNewspaperRoute({
    paperId: 'bjqn',
    paperName: '北京青年报',
    host: 'bqbdzb.bjd.com.cn',
});
