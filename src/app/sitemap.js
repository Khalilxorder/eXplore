import { getSiteUrlForPath } from './lib/siteUrl';

export const dynamic = 'force-static';

const routes = [
  {
    path: '/',
    changeFrequency: 'weekly',
    priority: 1,
  },
  {
    path: '/privacy/',
    changeFrequency: 'monthly',
    priority: 0.4,
  },
  {
    path: '/terms/',
    changeFrequency: 'monthly',
    priority: 0.3,
  },
  {
    path: '/contact/',
    changeFrequency: 'monthly',
    priority: 0.3,
  },
  {
    path: '/account-deletion/',
    changeFrequency: 'monthly',
    priority: 0.3,
  },
];

export default function sitemap() {
  const lastModified = new Date();

  return routes.map((route) => ({
    url: getSiteUrlForPath(route.path),
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
