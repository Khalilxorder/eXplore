'use strict';

const { runDiscoveryCycle } = require('../../discoveryWorker');
const { ensureWrittenNewsCoverage } = require('./writtenNewsService');
const { refreshPriorityAlertCache } = require('./priorityAlertStore');
const {
  dispatchHostedPush,
  hydrateRecentContentItems,
  isConfigured: isSupabaseRuntimeConfigured,
  mirrorRecentContentItems,
  upsertPriorityAlerts,
  upsertWorkerStatus,
} = require('./supabaseRuntimeStore');

const INTELLIGENCE_WORKER_NAME = 'latest_news_intelligence';

function getAnalysisEvidence(db) {
  try {
    return db.prepare(`
      SELECT
        COUNT(*) AS analyzed_count,
        SUM(CASE WHEN analysis_provider = 'gemini' THEN 1 ELSE 0 END) AS gemini_count,
        SUM(CASE WHEN analysis_provider = 'openai' THEN 1 ELSE 0 END) AS openai_count,
        SUM(CASE WHEN analysis_provider = 'local' OR analysis_provider IS NULL THEN 1 ELSE 0 END) AS fallback_count,
        MAX(analysis_updated_at) AS latest_analysis_at
      FROM content_items
      WHERE analysis_updated_at IS NOT NULL
         OR analysis_provider IS NOT NULL
    `).get();
  } catch (error) {
    return {
      analyzed_count: 0,
      gemini_count: 0,
      openai_count: 0,
      fallback_count: 0,
      latest_analysis_at: null,
    };
  }
}

async function recordRemoteStatus(changes) {
  try {
    return await upsertWorkerStatus(INTELLIGENCE_WORKER_NAME, changes);
  } catch (error) {
    console.warn(`[IntelligenceCycle] Could not persist remote status: ${error.message}`);
    return null;
  }
}

async function runIntelligenceCycle(db, options = {}) {
  const startedAt = new Date().toISOString();
  await recordRemoteStatus({
    loop_mode: options.loopMode || 'scheduled',
    last_status: 'running',
    last_started_at: startedAt,
    heartbeat_at: startedAt,
  });

  try {
    const hydratedContentCount = isSupabaseRuntimeConfigured()
      ? await hydrateRecentContentItems(db, 500)
      : 0;
    const written = await ensureWrittenNewsCoverage(db, { force: options.force !== false });
    const discovery = await runDiscoveryCycle(db, { loopMode: options.loopMode || 'scheduled' });
    const radar = await refreshPriorityAlertCache(db, { limit: Number(options.alertLimit || 40) });
    let mirroredContent = [];
    let mirroredAlerts = [];
    let push = { configured: false, devicesConsidered: 0, sent: 0, skipped: 0, failed: 0 };

    if (isSupabaseRuntimeConfigured()) {
      mirroredContent = await mirrorRecentContentItems(db, 500);
      mirroredAlerts = await upsertPriorityAlerts(radar.alerts || []);
      push = await dispatchHostedPush(radar.alerts || []);
    }

    const summary = {
      startedAt,
      completedAt: new Date().toISOString(),
      persistence: {
        hydratedContent: hydratedContentCount,
        mirroredContent: mirroredContent?.length || 0,
      },
      written: {
        refreshed: Boolean(written?.refreshed),
        articleCount: Number(written?.articleCount || 0),
        reachableFeeds: Number(written?.coverage?.reachable_feed_count || 0),
        failedFeeds: Number(written?.coverage?.failure_count || 0),
      },
      discovery: {
        refreshedScopes: Number(discovery?.refreshedScopes || 0),
        candidateCount: Number(discovery?.candidateCount || 0),
        liveScopes: Number(discovery?.liveScopes || 0),
      },
      analysis: getAnalysisEvidence(db),
      alerts: {
        generated: radar.alerts?.length || 0,
        mirrored: mirroredAlerts?.length || 0,
        source: radar.source || 'unknown',
      },
      push,
    };

    await recordRemoteStatus({
      loop_mode: options.loopMode || 'scheduled',
      last_status: push.failed > 0 ? 'partial' : 'success',
      last_started_at: startedAt,
      last_completed_at: summary.completedAt,
      heartbeat_at: summary.completedAt,
      last_error: push.failed > 0 ? `${push.failed} push delivery attempt(s) failed.` : '',
      last_summary_json: JSON.stringify(summary),
    });
    await Promise.all([
      upsertWorkerStatus('best_feed_discovery', {
        loop_mode: options.loopMode || 'scheduled',
        last_status: discovery.partialScopes > 0 ? 'partial' : 'success',
        last_started_at: startedAt,
        last_completed_at: summary.completedAt,
        heartbeat_at: summary.completedAt,
        last_summary_json: JSON.stringify(summary.discovery),
      }),
      upsertWorkerStatus('priority_alert_dispatch', {
        loop_mode: options.loopMode || 'scheduled',
        last_status: push.failed > 0 ? 'error' : 'success',
        last_started_at: startedAt,
        last_completed_at: summary.completedAt,
        heartbeat_at: summary.completedAt,
        last_error: push.failed > 0 ? `${push.failed} push delivery attempt(s) failed.` : '',
        last_summary_json: JSON.stringify(push),
      }),
    ]);
    return summary;
  } catch (error) {
    const completedAt = new Date().toISOString();
    await recordRemoteStatus({
      loop_mode: options.loopMode || 'scheduled',
      last_status: 'error',
      last_started_at: startedAt,
      last_completed_at: completedAt,
      heartbeat_at: completedAt,
      last_error: error?.message || 'Intelligence cycle failed.',
    });
    throw error;
  }
}

module.exports = {
  INTELLIGENCE_WORKER_NAME,
  runIntelligenceCycle,
};
