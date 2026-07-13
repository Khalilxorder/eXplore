/**
 * Math engine for determining the baseline anomaly score of a piece of content.
 * Prefer follower reach when it exists, and fall back to an engagement baseline
 * for scraper outputs that do not expose creator follower counts.
 */

const FOLLOWER_MULTIPLIER_THRESHOLD = 50;
const ENGAGEMENT_PROXY_THRESHOLD = 8;

function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

function calculateDavidVsGoliathRatio(views, baseline) {
    if (baseline === 0) return views;
    return views / baseline;
}

function estimateEngagementBaseline(video) {
    const likes = toNumber(video.diggCount || video.likesCount || video.stats?.diggCount);
    const shares = toNumber(video.shareCount || video.sharesCount || video.stats?.shareCount);
    const comments = toNumber(video.commentCount || video.commentsCount || video.stats?.commentCount);

    return Math.max(
        likes * 8,
        shares * 20,
        comments * 100,
        1
    );
}

/**
 * Filters a raw list of Apify TikTok/Instagram items.
 * Removes standard viral content, keeping only reach outliers.
 */
function filterAnomalies(videos) {
    const anomalousVideos = [];

    for (const vid of videos) {
        const views = toNumber(vid.playCount || vid.videoMeta?.playCount || vid.viewsCount || vid.viewCount);
        const followers = toNumber(vid.authorMeta?.fans || vid.author?.followerCount || vid.authorStats?.followerCount);
        const baselineType = followers > 0 ? 'followers' : 'engagement_proxy';
        const baselineValue = followers > 0 ? followers : estimateEngagementBaseline(vid);
        const threshold = baselineType === 'followers'
            ? FOLLOWER_MULTIPLIER_THRESHOLD
            : ENGAGEMENT_PROXY_THRESHOLD;
        const ratio = calculateDavidVsGoliathRatio(views, baselineValue);

        if (ratio >= threshold) {
            anomalousVideos.push({
                ...vid,
                baselineType,
                baselineValue,
                engagementRatio: ratio,
                baseAnomalyScore: Math.min(10, (ratio / threshold) * 5),
            });
        }
    }

    return anomalousVideos.sort((a, b) => b.engagementRatio - a.engagementRatio);
}

module.exports = {
    calculateDavidVsGoliathRatio,
    filterAnomalies,
};
