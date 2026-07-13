'use client';

import { useEffect, useState } from 'react';
import { fetchTemplate, importHierarchyFootprint } from '../lib/api';
import MiddleEastSuccessGraph from './MiddleEastSuccessGraph';
import { HeartIcon } from './Icons';
import YoutubeLane from './YoutubeLane';
import {
  USER_FIGURES_STORAGE_KEY,
  VIDEO_LIBRARY_TOPIC_OPTIONS,
  buildWatchHistoryRecommendationBrief,
  buildCuratedVideoLibrary,
  buildUserFigureCollections,
  buildVideoLibraryGapReport,
  buildVideoLibrarySearchProfiles,
  getVideoLibraryCategoryLabel,
  getVideoLibraryCreatorLabel,
  getVideoLibraryResourceTypeLabel,
  getVideoLibraryTopicLabel,
  getYouTubeVideoId,
  normalizeUserFigure,
  parseYouTubeFootprintPreview,
  normalizeVideoLibraryPreferences,
  scoreVideoLibraryVideo,
  toVideoLibraryItem,
} from '../data/videoLibrary';

function loadUserFiguresFromStorage() {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(USER_FIGURES_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistUserFiguresToStorage(list) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(USER_FIGURES_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Ignore storage write failures (private mode / quota).
  }
}

const DEFAULT_VIDEO_LIBRARY_STATE = {
  videoLibrary: normalizeVideoLibraryPreferences(),
  priorityTopics: [],
};

function normalizeVideoLibraryState(template = {}) {
  const workspace = template?.workspace && typeof template.workspace === 'object'
    ? template.workspace
    : {};
  const workspaceMemory = workspace?.workspaceMemory && typeof workspace.workspaceMemory === 'object'
    ? workspace.workspaceMemory
    : {};

  const rules = Array.isArray(template?.rules) ? template.rules : [];
  const priorityTopics = rules
    .filter((r) => r.type === 'priority' || r.type === 'topic')
    .map((r) => String(r.value || r.title || '').toLowerCase())
    .filter(Boolean);

  return {
    videoLibrary: normalizeVideoLibraryPreferences(workspaceMemory.videoLibrary),
    priorityTopics,
  };
}

export default function VideoLibraryScreen({ onNavigate }) {
  const [templateState, setTemplateState] = useState(DEFAULT_VIDEO_LIBRARY_STATE);
  const [activeCreator, setActiveCreator] = useState('');
  const [activeYear, setActiveYear] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [userFigures, setUserFigures] = useState([]);
  const [showAddFigure, setShowAddFigure] = useState(false);
  const [figureName, setFigureName] = useState('');
  const [figureTopic, setFigureTopic] = useState('');
  const [figureRole, setFigureRole] = useState('');
  const [figureEssay, setFigureEssay] = useState('');
  const [figureLinks, setFigureLinks] = useState('');
  const [figureSources, setFigureSources] = useState('');
  const [figureError, setFigureError] = useState('');
  const [historyRaw, setHistoryRaw] = useState('');
  const [historyMessage, setHistoryMessage] = useState('');
  const [historyImporting, setHistoryImporting] = useState(false);
  const [likedVideoUrls, setLikedVideoUrls] = useState(() => {
    if (typeof window === 'undefined') {
      return [];
    }
    try {
      const parsed = JSON.parse(window.localStorage.getItem('explore_liked_videos') || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const toggleLikeVideo = (url) => {
    setLikedVideoUrls((current) => {
      const next = current.includes(url) ? current.filter((u) => u !== url) : [...current, url];
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('explore_liked_videos', JSON.stringify(next));
      }
      return next;
    });
  };

  useEffect(() => {
    setUserFigures(loadUserFiguresFromStorage());
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const template = await fetchTemplate();
        if (cancelled) {
          return;
        }

        if (template) {
          setTemplateState(normalizeVideoLibraryState(template));
          setMessage('');
        } else {
          setTemplateState(DEFAULT_VIDEO_LIBRARY_STATE);
          setMessage('Using the built-in video library because the saved template is not reachable right now.');
        }
      } catch {
        if (!cancelled) {
          setTemplateState(DEFAULT_VIDEO_LIBRARY_STATE);
          setMessage('Using the built-in video library because the saved template is not reachable right now.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const curatedVideoCollections = buildCuratedVideoLibrary(templateState.videoLibrary);
  const videoSearchProfiles = buildVideoLibrarySearchProfiles(templateState.videoLibrary);
  const userFigureCollections = buildUserFigureCollections(userFigures, templateState.videoLibrary);
  const figureCollections = [
    ...curatedVideoCollections.filter((creator) => creator.tier === 'figure'),
    ...userFigureCollections,
  ];
  const lowerOrderCollections = curatedVideoCollections.filter((creator) => creator.tier !== 'figure');
  const allVideoCollections = [...curatedVideoCollections, ...userFigureCollections];
  const figureTopicKeys = [...new Set(figureCollections.map((creator) => creator.topic || 'other'))];
  const topicLabelByKey = {};
  figureCollections.forEach((creator) => {
    if (creator.topicLabel && !topicLabelByKey[creator.topic]) {
      topicLabelByKey[creator.topic] = creator.topicLabel;
    }
  });
  const resolveTopicLabel = (topicKey) => topicLabelByKey[topicKey] || getVideoLibraryTopicLabel(topicKey);
  const getCategoryLabel = (categoryKey) => {
    switch (categoryKey) {
      case 'watch_history': return 'Watch History';
      case 'liked_videos': return 'Liked Videos';
      case 'channels': return 'Channels';
      case 'transcripts': return 'Transcripts';
      case 'interests': return 'Your Interests';
      default: return getVideoLibraryCategoryLabel(categoryKey);
    }
  };
  const selectedVideoCollection = allVideoCollections.find((creator) => creator.key === activeCreator) || allVideoCollections[0] || null;

  // Plan Part 11: multi-lane video sections from existing scores (no parallel ranker).
  const intelligenceVideoLanes = (() => {
    const scored = [];
    for (const creator of allVideoCollections) {
      const years = Array.isArray(creator.years) ? creator.years : [];
      for (const year of years) {
        for (const video of year.videos || []) {
          const judgment = scoreVideoLibraryVideo(video, creator);
          const reasonText = judgment.reason || '';
          scored.push({
            ...video,
            creatorKey: creator.key,
            creatorName: creator.name || creator.label || creator.key,
            topic: creator.topic,
            year: year.year || year.label,
            score: Number(judgment.score) || 0,
            reasons: reasonText ? reasonText.split(' + ').filter(Boolean) : [],
            trusted: Boolean(creator.trusted || creator.tier === 'figure'),
            rare: /rare|archive|lecture|canonical|primary interview/i.test(`${video.title || ''} ${reasonText}`),
            goalLinked: Boolean(
              (templateState.priorityTopics || []).some((topic) =>
                String(video.title || '').toLowerCase().includes(String(topic).toLowerCase())
                || String(creator.topic || '').toLowerCase().includes(String(topic).toLowerCase())
              )
            ),
            ageYears: year.year ? Math.max(0, new Date().getFullYear() - Number(year.year)) : null,
          });
        }
      }
    }
    scored.sort((a, b) => b.score - a.score);
    const take = (predicate, limit = 6) => scored.filter(predicate).slice(0, limit);
    return [
      { id: 'most-important', title: 'Most important now', items: take(() => true, 6) },
      { id: 'trusted', title: 'New from trusted channels', items: take((item) => item.trusted, 6) },
      { id: 'old-valuable', title: 'Old but exceptionally valuable', items: take((item) => item.ageYears != null && item.ageYears >= 3 && item.score >= 55, 6) },
      { id: 'rare', title: 'Rare and hard to discover', items: take((item) => item.rare, 6) },
      { id: 'goals', title: 'Connected to current goals', items: take((item) => item.goalLinked, 6) },
      { id: 'saved', title: 'Saved / liked for later', items: take((item) => likedVideoUrls.includes(item.url), 6) },
    ].filter((lane) => lane.items.length > 0);
  })();
  const selectedGapReport = buildVideoLibraryGapReport(selectedVideoCollection || {});
  const selectedResources = Array.isArray(selectedVideoCollection?.resources)
    ? selectedVideoCollection.resources
    : [];
  const selectedTrashVideos = Array.isArray(selectedVideoCollection?.trashVideos)
    ? selectedVideoCollection.trashVideos
    : [];
  const availableVideoYears = selectedVideoCollection?.years || [];
  const standardVideoCategories = [...new Set(
    availableVideoYears.flatMap((year) => year.videos.flatMap((video) => Array.isArray(video.categories) ? video.categories : []))
  )];
  const specialVideoCategories = ['watch_history', 'liked_videos', 'channels', 'transcripts', 'interests'];
  const availableVideoCategories = [
    ...specialVideoCategories,
    ...standardVideoCategories,
  ];

  // Build a virtual "All years" entry that combines every video across all years,
  // tagging each video with its source year so per-card display remains accurate.
  const allYearsVideos = availableVideoYears.flatMap((year) =>
    year.videos.map((v) => ({ ...v, _yearKey: year.key, _yearLabel: year.label }))
  );
  const allYearsEntry = { key: '', label: 'All years', videos: allYearsVideos, videoCount: allYearsVideos.length };
  // Default to all years when no specific year is selected (activeYear === '')
  const selectedVideoYear = activeYear
    ? (availableVideoYears.find((year) => year.key === activeYear) || allYearsEntry)
    : allYearsEntry;

  const effectiveVideoCategory = availableVideoCategories.includes(activeCategory) ? activeCategory : 'all';
  const historyPreview = parseYouTubeFootprintPreview(historyRaw);
  const historyBrief = buildWatchHistoryRecommendationBrief(historyPreview, allVideoCollections);

  const hiddenVideoCount = Number(selectedVideoCollection?.hiddenVideoCount || 0);
  const duplicateVideoCount = Number(selectedVideoCollection?.duplicateVideoCount || 0);
  const visibleVideoItems = (selectedVideoYear?.videos || []).filter((video) => {
    if (effectiveVideoCategory === 'all') {
      return true;
    }
    if (effectiveVideoCategory === 'watch_history') {
      return historyPreview.some((entry) => {
        if (entry.url && video.url && getYouTubeVideoId(entry.url) === getYouTubeVideoId(video.url)) {
          return true;
        }
        if (entry.title && video.title && (video.title.toLowerCase().includes(entry.title.toLowerCase()) || entry.title.toLowerCase().includes(video.title.toLowerCase()))) {
          return true;
        }
        return false;
      });
    }
    if (effectiveVideoCategory === 'liked_videos') {
      return likedVideoUrls.includes(video.url);
    }
    if (effectiveVideoCategory === 'channels') {
      return true;
    }
    if (effectiveVideoCategory === 'transcripts') {
      const hasTranscriptCategories = Array.isArray(video.categories) && (
        video.categories.includes('interview') ||
        video.categories.includes('lecture') ||
        video.categories.includes('speech') ||
        video.categories.includes('keynote')
      );
      const titleLower = String(video.title || '').toLowerCase();
      const hasTranscriptTitle = titleLower.includes('interview') ||
        titleLower.includes('lecture') ||
        titleLower.includes('talk') ||
        titleLower.includes('speech') ||
        titleLower.includes('q&a') ||
        titleLower.includes('conversation');
      return hasTranscriptCategories || hasTranscriptTitle;
    }
    if (effectiveVideoCategory === 'interests') {
      const topics = templateState.priorityTopics || [];
      if (topics.length === 0) {
        const defaultInterests = ['ai', 'leadership', 'vision', 'dubai', 'governance', 'scaling', 'strategy', 'future'];
        return defaultInterests.some((keyword) => {
          const content = `${video.title} ${video.summary || ''}`.toLowerCase();
          return content.includes(keyword);
        });
      }
      return topics.some((topic) => {
        const content = `${video.title} ${video.summary || ''}`.toLowerCase();
        return content.includes(topic.toLowerCase());
      });
    }
    return Array.isArray(video.categories) && video.categories.includes(effectiveVideoCategory);
  }).sort((a, b) => {
    if (activeYear) {
      return 0;
    }
    return (b._qualityScore || 0) - (a._qualityScore || 0);
  });

  const openVideoLibraryItem = (libraryItem) => {
    onNavigate?.('detail', libraryItem);
  };

  const figureInputStyle = {
    width: '100%',
    padding: '8px 10px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--text-primary)',
    font: 'var(--font-body)',
  };

  const resetFigureForm = () => {
    setFigureName('');
    setFigureTopic('');
    setFigureRole('');
    setFigureEssay('');
    setFigureLinks('');
    setFigureSources('');
    setFigureError('');
  };

  const handleAddFigure = () => {
    const figure = normalizeUserFigure({
      label: figureName,
      topic: figureTopic,
      role: figureRole,
      essay: figureEssay,
      resources: figureSources.split(/\n+/).map((line) => line.trim()).filter(Boolean),
      videos: figureLinks.split(/\n+/).map((line) => line.trim()).filter(Boolean),
    });

    if (!figure) {
      setFigureError('Add a name for this figure.');
      return;
    }

    const nextFigures = [...userFigures.filter((entry) => entry?.key !== figure.key), figure];
    setUserFigures(nextFigures);
    persistUserFiguresToStorage(nextFigures);
    setActiveCreator(figure.key);
    setActiveYear('');
    resetFigureForm();
    setShowAddFigure(false);
  };

  const handleRemoveFigure = (figureKey) => {
    const nextFigures = userFigures.filter((entry) => entry?.key !== figureKey);
    setUserFigures(nextFigures);
    persistUserFiguresToStorage(nextFigures);
    if (activeCreator === figureKey) {
      setActiveCreator('');
      setActiveYear('');
    }
  };

  const handleImportHistory = async () => {
    if (!historyRaw.trim()) {
      setHistoryMessage('Paste YouTube or Chrome history first.');
      return;
    }
    if (!historyPreview.length) {
      setHistoryMessage('No recognizable YouTube watch or like entries found.');
      return;
    }

    setHistoryImporting(true);
    try {
      const result = await importHierarchyFootprint(historyRaw, 'youtube-history');
      setHistoryMessage(result?.message || `Synced ${historyPreview.length} watch signals.`);
    } catch (error) {
      setHistoryMessage(error?.message || 'Could not sync this history right now.');
    } finally {
      setHistoryImporting(false);
    }
  };

  return (
    <div className="page-enter video-library-screen" style={{ padding: 'var(--space-base) 0 var(--space-large)' }}>
      <div className="container page-shell">
        <div className="page-header">
          <div className="page-header-copy">
            <span className="page-kicker">Curated library</span>
            <h1 style={{ font: 'var(--font-h1)' }}>YouTube videos</h1>
            <p className="page-subtitle">
              Figures, speeches, texts, and source references.
            </p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => onNavigate?.('template')}>
            Edit rules
          </button>
        </div>

        {message ? (
          <div className="card" style={{ marginBottom: 'var(--space-base)', color: 'var(--text-secondary)' }}>
            {message}
          </div>
        ) : null}

        <div style={{ marginBottom: 'var(--space-base)' }}>
          <YoutubeLane onNavigate={onNavigate} />
        </div>

        <section className="card video-taste-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)', marginBottom: 'var(--space-base)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <span className="page-kicker">Taste map</span>
              <h2 className="section-title" style={{ marginTop: '6px' }}>Watch history</h2>
            </div>
            <span className={`status-pill ${historyBrief.hasSignal ? 'is-live' : 'is-empty'}`}>
              {historyBrief.hasSignal ? `${historyBrief.importedCount} signals` : 'Paste export'}
            </span>
          </div>

          <textarea
            style={{ ...figureInputStyle, resize: 'vertical' }}
            rows={3}
            placeholder="Paste YouTube Takeout JSON, Chrome history export text, or copied watch/like lines."
            value={historyRaw}
            onChange={(event) => {
              setHistoryRaw(event.target.value);
              setHistoryMessage('');
            }}
          />

          {historyBrief.hasSignal ? (
            <div className="subtle-panel" style={{ background: 'var(--surface)', gap: '8px' }}>
              <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>Signal read</strong>
              <div className="scroll-row" style={{ gap: '8px' }}>
                {historyBrief.topSignals.map((signal) => (
                  <span key={signal} className="chip" style={{ maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {signal}
                  </span>
                ))}
              </div>
              {historyBrief.rankedCollections.length ? (
                <div className="scroll-row" style={{ gap: '8px' }}>
                  {historyBrief.rankedCollections.map((match) => (
                    <button
                      key={match.key}
                      type="button"
                      className="chip active"
                      onClick={() => {
                        setActiveCreator(match.key);
                        setActiveYear('');
                      }}
                      title={match.reason}
                    >
                      {match.label} {Math.round(match.score * 100)}%
                    </button>
                  ))}
                </div>
              ) : null}
              <span style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                {historyBrief.explorationRule}
              </span>
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleImportHistory}
              disabled={historyImporting}
            >
              {historyImporting ? 'Syncing...' : 'Sync taste'}
            </button>
            {historyMessage ? (
              <span style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>{historyMessage}</span>
            ) : null}
          </div>
        </section>

        {intelligenceVideoLanes.length ? (
          <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)', marginBottom: 'var(--space-base)' }}>
            <div>
              <span className="page-kicker">Life-directed video lanes</span>
              <h2 className="section-title" style={{ marginTop: '6px' }}>Explainable video intelligence</h2>
              <p style={{ margin: '6px 0 0', font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                Sections are ranked from your figures, goals, trust signals, and library scores — not a clone of YouTube Home.
              </p>
            </div>
            {intelligenceVideoLanes.map((lane) => (
              <div key={lane.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <h3 style={{ margin: 0, font: 'var(--font-h3)' }}>{lane.title}</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {lane.items.map((item) => (
                    <div
                      key={`${lane.id}-${item.url || item.title}`}
                      className="subtle-panel"
                      style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}
                    >
                      <strong style={{ font: 'var(--font-body)' }}>{item.title || 'Untitled video'}</strong>
                      <span style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                        {item.creatorName}
                        {item.year ? ` · ${item.year}` : ''}
                        {typeof item.score === 'number' ? ` · score ${item.score.toFixed(2)}` : ''}
                      </span>
                      {item.reasons?.length ? (
                        <span style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                          Why shown: {item.reasons.slice(0, 3).join(' · ')}
                        </span>
                      ) : null}
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {item.trusted ? <span className="chip">Trusted channel</span> : null}
                        {item.goalLinked ? <span className="chip">Current goal</span> : null}
                        {item.rare ? <span className="chip">Rare</span> : null}
                        {item.ageYears != null && item.ageYears >= 3 ? <span className="chip">Evergreen</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        ) : null}

        {selectedVideoCollection ? (
          <section className="card video-library-panel" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' }}>
            <div className="video-library-panel-header" style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-small)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div>
                <span className="page-kicker">Video library</span>
                <h2 className="section-title" style={{ marginTop: '6px' }}>Best videos, no duplicates</h2>
              </div>
              <span className={`status-pill ${visibleVideoItems.length ? 'is-live' : 'is-empty'}`}>
                {loading
                  ? 'Loading...'
                  : visibleVideoItems.length
                    ? `${visibleVideoItems.length} best video${visibleVideoItems.length !== 1 ? 's' : ''}${activeYear ? ` from ${selectedVideoYear?.label}` : ''}`
                    : 'No matching videos'}
              </span>
            </div>

            <div className="video-judgment-strip" aria-label="Video ranking rules">
              <span className="video-judgment-chip">Best-first</span>
              <span className="video-judgment-chip">No duplicates</span>
              <span className="video-judgment-chip">Interviews, speeches, lectures</span>
              {hiddenVideoCount ? (
                <span className="video-judgment-chip is-muted">{hiddenVideoCount} hidden</span>
              ) : null}
              {duplicateVideoCount ? (
                <span className="video-judgment-chip is-muted">{duplicateVideoCount} duplicates</span>
              ) : null}
              <span className="video-judgment-rule">The same judgment is applied to new figures you add.</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-small)' }}>
              {figureCollections.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span className="page-kicker">Figures of interest</span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setShowAddFigure((open) => !open)}
                    >
                      {showAddFigure ? 'Close' : '+ Add figure'}
                    </button>
                  </div>

                  {showAddFigure ? (
                    <div className="subtle-panel" style={{ background: 'var(--surface)', gap: '8px' }}>
                      <input
                        type="text"
                        style={figureInputStyle}
                        placeholder="Figure name (e.g. Naval Ravikant)"
                        value={figureName}
                        onChange={(event) => setFigureName(event.target.value)}
                      />
                      <input
                        type="text"
                        style={figureInputStyle}
                        placeholder="Topic (e.g. AI, Leadership & Vision, Investing)"
                        value={figureTopic}
                        onChange={(event) => setFigureTopic(event.target.value)}
                        list="figure-topic-options"
                      />
                      <datalist id="figure-topic-options">
                        {VIDEO_LIBRARY_TOPIC_OPTIONS.map((option) => (
                          <option key={option.key} value={option.label} />
                        ))}
                      </datalist>
                      <input
                        type="text"
                        style={figureInputStyle}
                        placeholder="Role / one line (optional, e.g. Investor, AngelList)"
                        value={figureRole}
                        onChange={(event) => setFigureRole(event.target.value)}
                      />
                      <textarea
                        style={{ ...figureInputStyle, resize: 'vertical' }}
                        rows={2}
                        placeholder="Why you're studying them (optional)"
                        value={figureEssay}
                        onChange={(event) => setFigureEssay(event.target.value)}
                      />
                      <textarea
                        style={{ ...figureInputStyle, resize: 'vertical' }}
                        rows={2}
                        placeholder="Optional: paste YouTube links, one per line. Auto-discovery will fill these in once enabled."
                        value={figureLinks}
                        onChange={(event) => setFigureLinks(event.target.value)}
                      />
                      <textarea
                        style={{ ...figureInputStyle, resize: 'vertical' }}
                        rows={2}
                        placeholder="Optional: paste source URLs, one per line"
                        value={figureSources}
                        onChange={(event) => setFigureSources(event.target.value)}
                      />
                      {figureError ? (
                        <span style={{ font: 'var(--font-caption)', color: 'var(--danger, #c0392b)' }}>{figureError}</span>
                      ) : null}
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button type="button" className="btn btn-primary btn-sm" onClick={handleAddFigure}>
                          Save figure
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => { setShowAddFigure(false); setFigureError(''); }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {figureTopicKeys.map((topicKey) => (
                    <div key={topicKey} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <span style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                        {resolveTopicLabel(topicKey)}
                      </span>
                      <div className="scroll-row" style={{ gap: 'var(--space-tight)' }}>
                        {figureCollections
                          .filter((creator) => (creator.topic || 'other') === topicKey)
                          .map((creator) => (
                            <button
                              key={creator.key}
                              type="button"
                              className={`chip ${selectedVideoCollection?.key === creator.key ? 'active' : ''}`}
                              onClick={() => setActiveCreator(creator.key)}
                            >
                              {getVideoLibraryCreatorLabel(creator.key)} ({creator.videoCount})
                            </button>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {lowerOrderCollections.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span className="page-kicker">Lower order</span>
                  <div className="scroll-row" style={{ gap: 'var(--space-tight)' }}>
                    {lowerOrderCollections.map((creator) => (
                      <button
                        key={creator.key}
                        type="button"
                        className={`chip ${selectedVideoCollection?.key === creator.key ? 'active' : ''}`}
                        onClick={() => setActiveCreator(creator.key)}
                      >
                        {getVideoLibraryCreatorLabel(creator.key)} ({creator.videoCount})
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            {selectedVideoCollection.tier === 'figure' && (selectedVideoCollection.role || selectedVideoCollection.essay || selectedVideoCollection.userAdded) ? (
              <div className="subtle-panel" style={{ background: 'var(--accent-light)', gap: '6px', borderColor: 'color-mix(in srgb, var(--accent) 30%, var(--border))' }}>
                {selectedVideoCollection.role || selectedVideoCollection.userAdded ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>
                      {selectedVideoCollection.label}{selectedVideoCollection.role ? ` - ${selectedVideoCollection.role}` : ''}
                      {selectedVideoCollection.userAdded ? ' - added by you' : ''}
                    </strong>
                    {selectedVideoCollection.userAdded ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleRemoveFigure(selectedVideoCollection.key)}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {selectedVideoCollection.essay ? (
                  <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: 0 }}>
                    {selectedVideoCollection.essay}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="subtle-panel video-coverage-panel" style={{ background: 'var(--surface)', gap: '8px' }}>
              <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>
                Coverage
              </strong>
              <div className="scroll-row" style={{ gap: '8px' }}>
                {selectedGapReport.map((gap) => (
                  <span
                    key={gap.key}
                    className={`status-pill ${gap.status === 'ready' ? 'is-live' : gap.status === 'missing' ? 'is-empty' : ''}`}
                    title={gap.detail}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    {gap.label}
                  </span>
                ))}
              </div>
            </div>

            {selectedResources.length ? (
              <div className="subtle-panel" style={{ background: 'var(--surface)', gap: '8px' }}>
                <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>
                  References
                </strong>
                <div className="scroll-row" style={{ gap: 'var(--space-small)' }}>
                  {selectedResources.map((resource) => (
                    <a
                      key={resource.id}
                      href={resource.url}
                      target="_blank"
                      rel="noreferrer"
                      className="subtle-panel"
                      style={{
                        minWidth: '220px',
                        maxWidth: '260px',
                        textDecoration: 'none',
                        background: 'var(--accent-light)',
                        borderColor: 'color-mix(in srgb, var(--accent) 28%, var(--border))',
                      }}
                    >
                      <span className="page-kicker">{getVideoLibraryResourceTypeLabel(resource.type)}</span>
                      <strong style={{ font: 'var(--font-body)', color: 'var(--text-primary)' }}>
                        {resource.title}
                      </strong>
                      <span style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                        {resource.source}{resource.year ? ` - ${resource.year}` : ''}
                      </span>
                      {resource.value ? (
                        <span style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                          {resource.value}
                        </span>
                      ) : null}
                    </a>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="subtle-panel video-search-panel" style={{ background: 'var(--surface)', gap: '8px' }}>
              <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>
                Search target
              </strong>
              <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: 0 }}>
                {videoSearchProfiles.find((profile) => profile.key === selectedVideoCollection.key)?.queryHint || selectedVideoCollection.searchFocus}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                <button
                  type="button"
                  className={`chip ${effectiveVideoCategory === 'all' ? 'active' : ''}`}
                  onClick={() => setActiveCategory('all')}
                >
                  All types
                </button>
                {availableVideoCategories.map((categoryKey) => (
                  <button
                    key={categoryKey}
                    type="button"
                    className={`chip ${effectiveVideoCategory === categoryKey ? 'active' : ''}`}
                    onClick={() => setActiveCategory(categoryKey)}
                  >
                    {getCategoryLabel(categoryKey)}
                  </button>
                ))}
              </div>
            </div>

            {selectedTrashVideos.length ? (
              <div className="subtle-panel video-filtered-panel" style={{ background: 'var(--surface)', gap: '8px' }}>
                <strong style={{ font: 'var(--font-caption)', color: 'var(--text-primary)' }}>
                  Hidden noise
                </strong>
                <div className="scroll-row" style={{ gap: '8px' }}>
                  {selectedTrashVideos.map((video, index) => (
                    <span
                      key={`${video.url || video.title}-${index}`}
                      className="chip"
                      title={video.reason}
                      style={{ maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis' }}
                    >
                      {video.title}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="scroll-row" style={{ gap: 'var(--space-small)' }}>
              {/* All-years option shown first — default view showing every interview and recording */}
              <button
                type="button"
                className={`subtle-panel ${!activeYear ? 'accent-panel' : ''}`}
                onClick={() => setActiveYear('')}
                style={{
                  minWidth: '148px',
                  cursor: 'pointer',
                  background: !activeYear ? 'var(--accent-light)' : 'var(--surface)',
                  borderColor: !activeYear ? 'color-mix(in srgb, var(--accent) 36%, var(--border))' : 'var(--border)',
                }}
              >
                <strong style={{ font: 'var(--font-body)', color: 'var(--text-primary)' }}>All years</strong>
                <span style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>
                  {allYearsVideos.filter((video) => (
                    effectiveVideoCategory === 'all' || (Array.isArray(video.categories) && video.categories.includes(effectiveVideoCategory))
                  )).length} videos
                </span>
              </button>
              {availableVideoYears.map((year) => {
                const yearCount = year.videos.filter((video) => (
                  effectiveVideoCategory === 'all' || (Array.isArray(video.categories) && video.categories.includes(effectiveVideoCategory))
                )).length;

                return (
                  <button
                    key={year.key}
                    type="button"
                    className={`subtle-panel video-year-chip ${activeYear === year.key ? 'accent-panel' : ''}`}
                    onClick={() => setActiveYear(year.key)}
                    style={{
                      minWidth: '148px',
                      cursor: 'pointer',
                      background: activeYear === year.key ? 'var(--accent-light)' : 'var(--surface)',
                      borderColor: activeYear === year.key ? 'color-mix(in srgb, var(--accent) 36%, var(--border))' : 'var(--border)',
                    }}
                  >
                    <strong style={{ font: 'var(--font-body)', color: 'var(--text-primary)' }}>{year.label}</strong>
                    <span style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>{yearCount} videos</span>
                  </button>
                );
              })}
            </div>

            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' }}>
                {[1, 2, 3].map((item) => (
                  <div key={item}>
                    <div className="skeleton" style={{ width: '100%', height: '180px', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-small)' }} />
                    <div className="skeleton" style={{ width: '72%', height: '18px', marginBottom: '6px' }} />
                    <div className="skeleton" style={{ width: '40%', height: '14px' }} />
                  </div>
                ))}
              </div>
            ) : visibleVideoItems.length ? (
              <div className="video-card-grid">
                {visibleVideoItems.map((video) => {
                  // When in all-years mode, pass the video's own year data so IDs and labels are accurate
                  const effectiveYear = !activeYear && video._yearKey
                    ? { key: video._yearKey, label: video._yearLabel || video._yearKey }
                    : selectedVideoYear;
                  const libraryItem = toVideoLibraryItem(selectedVideoCollection, effectiveYear, video);

                  return (
                    <article
                      key={libraryItem.id}
                      className="card video-library-card"
                      onClick={() => openVideoLibraryItem(libraryItem)}
                    >
                      <div className={`video-card-thumb ${libraryItem.thumbnail ? '' : 'is-fallback'}`}>
                        {libraryItem.thumbnail ? (
                          <img
                            src={libraryItem.thumbnail}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            onError={(event) => {
                              event.currentTarget.style.display = 'none';
                              event.currentTarget.parentElement?.classList.add('is-fallback');
                            }}
                          />
                        ) : null}
                        <span className="video-card-fallback">Video</span>
                      </div>

                      <div className="video-library-card-body">
                        <div className="video-library-meta">
                          <span>{libraryItem.source}</span>
                          <span>{effectiveYear?.label}</span>
                          <span>{libraryItem.qualityLabel} {libraryItem.qualityScore ? `${libraryItem.qualityScore}` : ''}</span>
                          {libraryItem.videoCategoryLabels.slice(0, 1).map((label) => (
                            <span key={`${libraryItem.id}-${label}`}>{label}</span>
                          ))}
                          {(libraryItem.videoCategories.includes('interview') || libraryItem.videoCategories.includes('lecture')) ? (
                            <span>Transcript</span>
                          ) : null}
                        </div>

                        <h3 className="video-library-title">
                          {libraryItem.title}
                        </h3>

                        <p className="video-library-summary">
                          {libraryItem.summary}
                        </p>

                        <div className="video-quality-row">
                          <span className="video-quality-pill">{libraryItem.qualityLabel}</span>
                          <span className="video-quality-reason">{libraryItem.qualityReason}</span>
                        </div>

                        <div className="video-library-actions" onClick={(event) => event.stopPropagation()}>
                          <button className="btn btn-primary btn-sm" onClick={() => openVideoLibraryItem(libraryItem)}>
                            Watch
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm video-like-button"
                            onClick={() => toggleLikeVideo(libraryItem.url)}
                            aria-label={likedVideoUrls.includes(libraryItem.url) ? 'Unlike video' : 'Like video'}
                            data-liked={likedVideoUrls.includes(libraryItem.url) ? 'true' : 'false'}
                          >
                            <HeartIcon style={{ width: '16px', height: '16px', fill: likedVideoUrls.includes(libraryItem.url) ? 'currentColor' : 'none' }} />
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : selectedVideoCollection.userAdded ? (
              <div className="card" style={{ color: 'var(--text-secondary)' }}>
                No videos yet for {selectedVideoCollection.label}. Add YouTube links or source URLs.
              </div>
            ) : (
              <div className="card" style={{ color: 'var(--text-secondary)' }}>
                No videos match this creator, type, or year combination right now. Adjust the video rules and categorization in Rules if you want a different cut.
              </div>
            )}
          </section>
        ) : (
          <div className="card" style={{ color: 'var(--text-secondary)' }}>
            No curated video collections match the current rules yet. Open Rules and add supported creators in the video library section.
          </div>
        )}

        {selectedVideoCollection?.topic === 'me_leaders' ? (
          <MiddleEastSuccessGraph highlightCountryKey={selectedVideoCollection.key} />
        ) : null}
      </div>
    </div>
  );
}


