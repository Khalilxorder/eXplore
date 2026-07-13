'use strict';

function getRequestPath(url = '/') {
  return String(url || '/').split('?', 1)[0] || '/';
}

function isProtectedRequest(url, protectedPrefixes = [], publicExactRoutes = new Set()) {
  const requestPath = getRequestPath(url);
  return protectedPrefixes.some((prefix) => requestPath.startsWith(prefix))
    && !publicExactRoutes.has(requestPath);
}

module.exports = {
  getRequestPath,
  isProtectedRequest,
};
