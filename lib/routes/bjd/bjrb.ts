import type { Route } from '@/types';

import { createNewspaperRoute } from './utils';

export const route: Route = createNewspaperRoute({
    paperId: 'bjrb',
    paperName: '北京日报',
});
