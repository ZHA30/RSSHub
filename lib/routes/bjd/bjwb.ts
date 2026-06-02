import type { Route } from '@/types';

import { createNewspaperRoute } from './utils';

export const route: Route = createNewspaperRoute({
    paperId: 'bjwb',
    paperName: '北京晚报',
});
