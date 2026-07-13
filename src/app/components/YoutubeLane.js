'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  PlayIcon,
  HeartIcon,
  EditIcon,
  TrashIcon,
  CheckIcon,
  SparklesIcon,
  ExternalLinkIcon
} from './Icons';
import { buildCuratedVideoLibrary } from '../data/videoLibrary';
import { fetchHierarchyState } from '../lib/api';
import { openExternalUrl } from '../lib/external';

const CUSTOM_VIDEOS_STORAGE_KEY = 'explore-custom-youtube-videos-v1';
const VIDEO_CATEGORIES_MAP_KEY = 'explore-video-categories-map-v1';
const RANKING_WEIGHTS_KEY = 'explore-youtube-ranking-weights-v1';

// Helper to extract video ID from YouTube URL
function getYouTubeId(url = '') {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.replace(/^www\./, '') === 'youtu.be') {
      return parsed.pathname.split('/').filter(Boolean)[0];
    }
    return parsed.searchParams.get('v');
  } catch {
    return null;
  }
}

export default function YoutubeLane({ onNavigate }) {
  // 1. Core State
  const [curatedVideos, setCuratedVideos] = useState(() => {
    try {
      const creators = buildCuratedVideoLibrary();
      const list = [];
      creators.forEach((creator) => {
        if (creator.years) {
          creator.years.forEach((year) => {
            if (year.videos) {
              year.videos.forEach((vid) => {
                list.push({
                  id: vid.url,
                  title: vid.title,
                  url: vid.url,
                  creatorKey: creator.key,
                  creatorLabel: creator.label,
                  year: year.key,
                  topic: creator.topic,
                  defaultCategories: vid.categories || [],
                  summary: vid.summary || '',
                  isCustom: false
                });
              });
            }
          });
        }
      });
      return list;
    } catch (err) {
      console.error('Failed to load curated videos:', err);
      return [];
    }
  });
  const [customVideos, setCustomVideos] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = window.localStorage.getItem(CUSTOM_VIDEOS_STORAGE_KEY);
        return saved ? JSON.parse(saved) : [];
      } catch (e) {
        console.error(e);
        return [];
      }
    }
    return [];
  });
  const [videoCategoriesMap, setVideoCategoriesMap] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = window.localStorage.getItem(VIDEO_CATEGORIES_MAP_KEY);
        return saved ? JSON.parse(saved) : {};
      } catch (e) {
        console.error(e);
        return {};
      }
    }
    return {};
  });
  const [goalText, setGoalText] = useState('');
  const [status, setStatus] = useState('');

  // 2. Ranking Weights State
  const [weights, setWeights] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const savedWeights = window.localStorage.getItem(RANKING_WEIGHTS_KEY);
        if (savedWeights) {
          return JSON.parse(savedWeights);
        }
      } catch (e) {
        console.error('Failed to load ranking weights:', e);
      }
    }
    return { ai: 0.5, leadership: 0.5, freshness: 0.5, goal: 0.5 };
  });

  // 3. UI Control State
  const [isGridMode, setIsGridMode] = useState(false);
  const [editingVideoUrl, setEditingVideoUrl] = useState(null);
  const [newTagInput, setNewTagInput] = useState('');
  const [globalRenameFrom, setGlobalRenameFrom] = useState('');
  const [globalRenameTo, setGlobalRenameTo] = useState('');
  const [showGlobalRename, setShowGlobalRename] = useState(false);

  // 4. Add custom video form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newVideoTitle, setNewVideoTitle] = useState('');
  const [newVideoUrl, setNewVideoUrl] = useState('');
  const [newVideoCreator, setNewVideoCreator] = useState('');
  const [newVideoYear, setNewVideoYear] = useState('2026');
  const [newVideoTags, setNewVideoTags] = useState('');

  // Load initial data
  useEffect(() => {
    // Load active user goal for personalization
    const loadUserGoal = async () => {
      try {
        const payload = await fetchHierarchyState();
        if (payload?.currentGoal) {
          setGoalText(payload.currentGoal);
        }
      } catch (err) {
        // Fallback or local only
      }
    };
    void loadUserGoal();
  }, []);

  // Save states to localStorage
  const saveCustomVideos = (list) => {
    setCustomVideos(list);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(CUSTOM_VIDEOS_STORAGE_KEY, JSON.stringify(list));
    }
  };

  const saveVideoCategoriesMap = (map) => {
    setVideoCategoriesMap(map);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(VIDEO_CATEGORIES_MAP_KEY, JSON.stringify(map));
    }
  };

  const saveWeights = (nextWeights) => {
    setWeights(nextWeights);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(RANKING_WEIGHTS_KEY, JSON.stringify(nextWeights));
    }
  };

  // Combine curated and custom, applying category overrides
  const allMergedVideos = useMemo(() => {
    const combined = [
      ...curatedVideos.map(v => ({
        ...v,
        categories: videoCategoriesMap[v.url] !== undefined ? videoCategoriesMap[v.url] : v.defaultCategories
      })),
      ...customVideos.map(v => ({
        ...v,
        categories: videoCategoriesMap[v.url] !== undefined ? videoCategoriesMap[v.url] : v.defaultCategories
      }))
    ];
    return combined;
  }, [curatedVideos, customVideos, videoCategoriesMap]);

  // List of all unique categories currently in use
  const allUniqueCategories = useMemo(() => {
    const categories = new Set();
    allMergedVideos.forEach(v => {
      if (Array.isArray(v.categories)) {
        v.categories.forEach(c => categories.add(c.trim().toLowerCase()));
      }
    });
    return Array.from(categories).filter(Boolean);
  }, [allMergedVideos]);

  // Dynamic Personalized Ranking Algorithm
  const rankedVideos = useMemo(() => {
    const goalWords = goalText
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2);

    return allMergedVideos
      .map((video) => {
        const textToSearch = `${video.title} ${video.summary} ${video.creatorLabel} ${(video.categories || []).join(' ')}`.toLowerCase();

        // 1. AI Score
        const isAiCreator = ['sam-altman', 'dario-amodei', 'demis-hassabis', 'elon-musk'].includes(video.creatorKey);
        const hasAiKeywords = /\b(ai|artificial intelligence|gpt|claude|gemini|deepmind|openai|nlp|machine learning|neural|llm|agile|scaling|model)\b/i.test(textToSearch);
        const aiScore = isAiCreator || hasAiKeywords ? 1.0 : 0.05;

        // 2. Leadership & Vision Score
        const isLeaderCreator = ['mohammed-bin-rashid', 'mohamed-bin-zayed', 'saddam-hussein', 'mohammed-bin-salman', 'tamim-bin-hamad'].includes(video.creatorKey);
        const hasLeaderKeywords = /\b(leader|leadership|vision|governance|state|ruler|strategy|achievement|efficiency|growth|economy|nation)\b/i.test(textToSearch);
        const leadershipScore = isLeaderCreator || hasLeaderKeywords ? 1.0 : 0.05;

        // 3. Freshness / Recency Score
        const yearVal = parseInt(video.year, 10) || 2010;
        const freshnessScore = Math.max(0, Math.min(1, (yearVal - 2005) / 21)); // 2005 is 0, 2026 is 1.0

        // 4. Goal Alignment Score
        let goalScore = 0;
        if (goalWords.length > 0) {
          const matchCount = goalWords.filter(word => textToSearch.includes(word)).length;
          goalScore = Math.min(1.0, matchCount / Math.max(1, goalWords.length / 2));
        } else {
          goalScore = 0.2; // default neutral match
        }

        // Calculate final weighted rank score
        const totalWeight = (weights.ai + weights.leadership + weights.freshness + weights.goal) || 1;
        const rankScore = (
          (aiScore * weights.ai) +
          (leadershipScore * weights.leadership) +
          (freshnessScore * weights.freshness) +
          (goalScore * weights.goal)
        ) / totalWeight;

        // Determine "Why this video now" explanation based on top contributor
        const weightedAi = aiScore * weights.ai;
        const weightedLeadership = leadershipScore * weights.leadership;
        const weightedFreshness = freshnessScore * weights.freshness;
        const weightedGoal = goalScore * weights.goal;

        const maxVal = Math.max(weightedAi, weightedLeadership, weightedFreshness, weightedGoal);
        let explanation = '';
        if (maxVal === weightedGoal && goalWords.length > 0) {
          explanation = `Directly matches your active goal: "${goalText}".`;
        } else if (maxVal === weightedAi && (isAiCreator || hasAiKeywords)) {
          explanation = `Aligned with your high interest in AI innovation and future tech.`;
        } else if (maxVal === weightedLeadership && (isLeaderCreator || hasLeaderKeywords)) {
          explanation = `Highly relevant lessons on leadership, governance, and strategy.`;
        } else if (maxVal === weightedFreshness && yearVal >= 2020) {
          explanation = `Highlighted for its modern perspective from ${video.year}.`;
        } else {
          explanation = `Curated based on your general preferences and creator relevance.`;
        }

        return {
          ...video,
          rankScore: rankScore * 100,
          explanation,
          metrics: {
            ai: aiScore,
            leadership: leadershipScore,
            freshness: freshnessScore,
            goal: goalScore
          }
        };
      })
      .sort((a, b) => b.rankScore - a.rankScore);
  }, [allMergedVideos, weights, goalText]);

  // Handler: Add custom video
  const handleAddVideo = (e) => {
    e.preventDefault();
    if (!newVideoTitle.trim() || !newVideoUrl.trim()) {
      setStatus('Please provide a title and YouTube URL.');
      return;
    }

    const tagsList = newVideoTags
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(Boolean);

    const newVideo = {
      id: newVideoUrl.trim(),
      title: newVideoTitle.trim(),
      url: newVideoUrl.trim(),
      creatorKey: 'custom',
      creatorLabel: newVideoCreator.trim() || 'Custom Ingestion',
      year: newVideoYear.trim() || '2026',
      topic: 'custom',
      defaultCategories: tagsList,
      summary: 'User-added custom video.',
      isCustom: true
    };

    const nextCustomList = [newVideo, ...customVideos];
    saveCustomVideos(nextCustomList);

    // Reset Form
    setNewVideoTitle('');
    setNewVideoUrl('');
    setNewVideoCreator('');
    setNewVideoYear('2026');
    setNewVideoTags('');
    setShowAddForm(false);
    setStatus('Video added successfully!');
    setTimeout(() => setStatus(''), 4000);
  };

  // Handler: Remove custom video
  const handleRemoveCustomVideo = (url) => {
    const nextList = customVideos.filter(v => v.url !== url);
    saveCustomVideos(nextList);
    setStatus('Custom video removed.');
    setTimeout(() => setStatus(''), 3000);
  };

  // Handler: Edit specific video category tags
  const handleAddTagToVideo = (videoUrl) => {
    if (!newTagInput.trim()) return;
    const currentTags = videoCategoriesMap[videoUrl] !== undefined
      ? videoCategoriesMap[videoUrl]
      : (allMergedVideos.find(v => v.url === videoUrl)?.defaultCategories || []);

    const tagToInsert = newTagInput.trim().toLowerCase();
    if (!currentTags.includes(tagToInsert)) {
      const updated = [...currentTags, tagToInsert];
      saveVideoCategoriesMap({
        ...videoCategoriesMap,
        [videoUrl]: updated
      });
    }
    setNewTagInput('');
  };

  const handleRemoveTagFromVideo = (videoUrl, tagToRemove) => {
    const currentTags = videoCategoriesMap[videoUrl] !== undefined
      ? videoCategoriesMap[videoUrl]
      : (allMergedVideos.find(v => v.url === videoUrl)?.defaultCategories || []);

    const updated = currentTags.filter(t => t.toLowerCase() !== tagToRemove.toLowerCase());
    saveVideoCategoriesMap({
      ...videoCategoriesMap,
      [videoUrl]: updated
    });
  };

  // Handler: Rename category globally
  const handleGlobalRename = (e) => {
    e.preventDefault();
    if (!globalRenameFrom.trim() || !globalRenameTo.trim()) {
      setStatus('Please fill in both category names.');
      return;
    }

    const fromTag = globalRenameFrom.trim().toLowerCase();
    const toTag = globalRenameTo.trim().toLowerCase();

    const nextMap = { ...videoCategoriesMap };
    allMergedVideos.forEach(video => {
      const currentTags = videoCategoriesMap[video.url] !== undefined
        ? videoCategoriesMap[video.url]
        : video.defaultCategories;

      if (currentTags.includes(fromTag)) {
        const updated = currentTags.map(t => t.toLowerCase() === fromTag ? toTag : t);
        nextMap[video.url] = updated;
      }
    });

    saveVideoCategoriesMap(nextMap);
    setGlobalRenameFrom('');
    setGlobalRenameTo('');
    setShowGlobalRename(false);
    setStatus(`Globally renamed "${fromTag}" to "${toTag}".`);
    setTimeout(() => setStatus(''), 4000);
  };

  return (
    <div className="youtube-personalization-section" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' }}>
      {/* Header & Mode Selector */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <span className="page-kicker">Personalized recommendations</span>
          <h2 className="section-title" style={{ margin: '4px 0 0' }}>AI YouTube Personalization</h2>
          <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
            Adjust weights, sync with your active goals, and edit categories on the fly.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setIsGridMode(!isGridMode)}
          >
            {isGridMode ? 'View as Lane' : 'View as Grid'}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowAddForm(!showAddForm)}
          >
            {showAddForm ? 'Close Form' : '+ Add Video'}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowGlobalRename(!showGlobalRename)}
          >
            Rename Category
          </button>
        </div>
      </div>

      {/* Global Status Banner */}
      {status && (
        <div className="status-pill is-live" style={{ alignSelf: 'flex-start', padding: '6px 12px' }}>
          {status}
        </div>
      )}

      {/* Add Custom Video Form */}
      {showAddForm && (
        <form onSubmit={handleAddVideo} className="card subtle-panel" style={{ display: 'flex', flexDirection: 'column', gap: '10px', background: 'var(--surface)' }}>
          <h4 style={{ margin: 0 }}>Add Custom YouTube Video</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
            <input
              type="text"
              placeholder="Video Title"
              value={newVideoTitle}
              onChange={(e) => setNewVideoTitle(e.target.value)}
              style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-elevated)' }}
              required
            />
            <input
              type="url"
              placeholder="YouTube URL (watch?v=...)"
              value={newVideoUrl}
              onChange={(e) => setNewVideoUrl(e.target.value)}
              style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-elevated)' }}
              required
            />
            <input
              type="text"
              placeholder="Creator Name"
              value={newVideoCreator}
              onChange={(e) => setNewVideoCreator(e.target.value)}
              style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-elevated)' }}
            />
            <input
              type="text"
              placeholder="Year (e.g. 2026)"
              value={newVideoYear}
              onChange={(e) => setNewVideoYear(e.target.value)}
              style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-elevated)' }}
            />
          </div>
          <input
            type="text"
            placeholder="Categories (comma separated, e.g., coding, tech, design)"
            value={newVideoTags}
            onChange={(e) => setNewVideoTags(e.target.value)}
            style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-elevated)' }}
          />
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="submit" className="btn btn-primary btn-sm">Save Video</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAddForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      {/* Global Category Rename Form */}
      {showGlobalRename && (
        <form onSubmit={handleGlobalRename} className="card subtle-panel" style={{ display: 'flex', gap: '10px', alignItems: 'center', background: 'var(--surface)' }}>
          <strong>Rename Category Globally:</strong>
          <select
            value={globalRenameFrom}
            onChange={(e) => setGlobalRenameFrom(e.target.value)}
            style={{ padding: '6px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-elevated)', color: 'var(--text-primary)' }}
          >
            <option value="">-- Select Category --</option>
            {allUniqueCategories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <span>to</span>
          <input
            type="text"
            placeholder="New Category Name"
            value={globalRenameTo}
            onChange={(e) => setGlobalRenameTo(e.target.value)}
            style={{ padding: '6px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface-elevated)' }}
            required
          />
          <button type="submit" className="btn btn-primary btn-sm">Rename</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowGlobalRename(false)}>Cancel</button>
        </form>
      )}

      {/* Personalization Controller */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'var(--surface-elevated)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <SparklesIcon size={18} style={{ color: 'var(--accent)' }} />
          <h3 style={{ margin: 0, font: 'var(--font-h3)' }}>Ranking Parameter Tuning</h3>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
          {/* Slider: AI Focus */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', font: 'var(--font-caption)' }}>
              <span>AI & Tech Focus</span>
              <strong>{Math.round(weights.ai * 100)}%</strong>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={weights.ai}
              onChange={(e) => saveWeights({ ...weights, ai: parseFloat(e.target.value) })}
              style={{ width: '100%', accentColor: 'var(--accent)' }}
            />
          </div>

          {/* Slider: Leadership & Vision */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', font: 'var(--font-caption)' }}>
              <span>Leadership & Vision Focus</span>
              <strong>{Math.round(weights.leadership * 100)}%</strong>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={weights.leadership}
              onChange={(e) => saveWeights({ ...weights, leadership: parseFloat(e.target.value) })}
              style={{ width: '100%', accentColor: 'var(--accent)' }}
            />
          </div>

          {/* Slider: Freshness */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', font: 'var(--font-caption)' }}>
              <span>Freshness & Recency</span>
              <strong>{Math.round(weights.freshness * 100)}%</strong>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={weights.freshness}
              onChange={(e) => saveWeights({ ...weights, freshness: parseFloat(e.target.value) })}
              style={{ width: '100%', accentColor: 'var(--accent)' }}
            />
          </div>

          {/* Slider: Goal Alignment */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', font: 'var(--font-caption)' }}>
              <span>Active Goal Alignment</span>
              <strong>{Math.round(weights.goal * 100)}%</strong>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={weights.goal}
              onChange={(e) => saveWeights({ ...weights, goal: parseFloat(e.target.value) })}
              style={{ width: '100%', accentColor: 'var(--accent)' }}
            />
          </div>
        </div>

        {/* Goal Word Matching Input */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px', borderTop: '1px solid var(--border-soft)', paddingTop: '8px' }}>
          <label style={{ font: 'var(--font-caption)', fontWeight: 600, color: 'var(--text-primary)' }}>
            Active Personalization Goal
          </label>
          <input
            type="text"
            value={goalText}
            onChange={(e) => setGoalText(e.target.value)}
            placeholder="Type your current objective (e.g. Dubai transformation, AI safety, start-up growth)..."
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-primary)',
              font: 'var(--font-body)',
              width: '100%'
            }}
          />
        </div>
      </section>

      {/* Videos List Container */}
      <div
        className={isGridMode ? 'youtube-grid-container' : 'scroll-row youtube-lane-container'}
        style={{
          display: isGridMode ? 'grid' : 'flex',
          gridTemplateColumns: isGridMode ? 'repeat(auto-fill, minmax(280px, 1fr))' : 'none',
          overflowX: isGridMode ? 'visible' : 'auto',
          gap: 'var(--space-base)',
          paddingBottom: '12px',
          scrollSnapType: isGridMode ? 'none' : 'x mandatory'
        }}
      >
        {rankedVideos.map((video) => {
          const ytId = getYouTubeId(video.url);
          const thumbUrl = ytId
            ? `https://img.youtube.com/vi/${ytId}/0.jpg`
            : null;

          return (
            <article
              key={video.id}
              className="card youtube-video-card"
              style={{
                flex: isGridMode ? 'none' : '0 0 300px',
                scrollSnapAlign: isGridMode ? 'none' : 'start',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                padding: '12px',
                background: 'var(--surface-elevated)',
                border: '1px solid var(--border-soft)',
                borderRadius: 'var(--radius-md)',
                position: 'relative',
                transition: 'transform 0.2s, box-shadow 0.2s'
              }}
            >
              {/* Score Indicator */}
              <div
                style={{
                  position: 'absolute',
                  top: '8px',
                  right: '8px',
                  background: 'var(--accent)',
                  color: 'white',
                  fontWeight: 700,
                  fontSize: '11px',
                  padding: '3px 8px',
                  borderRadius: '12px',
                  zIndex: 2,
                  boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                }}
              >
                Match: {Math.round(video.rankScore)}%
              </div>

              {/* Video Thumbnail */}
              <div
                style={{
                  width: '100%',
                  height: '150px',
                  background: 'var(--border-soft)',
                  borderRadius: 'var(--radius-sm)',
                  position: 'relative',
                  overflow: 'hidden',
                  cursor: 'pointer'
                }}
                onClick={() => void openExternalUrl(video.url)}
              >
                {thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumbUrl}
                    alt={video.title}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <div style={{ display: 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                    <PlayIcon size={36} style={{ color: 'var(--text-secondary)' }} />
                  </div>
                )}
                <div
                  style={{
                    position: 'absolute',
                    bottom: '4px',
                    right: '4px',
                    background: 'rgba(0, 0, 0, 0.75)',
                    color: 'white',
                    fontSize: '10px',
                    padding: '2px 6px',
                    borderRadius: '2px'
                  }}
                >
                  {video.year}
                </div>
              </div>

              {/* Metadata & Title */}
              <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ font: 'var(--font-caption)', color: 'var(--accent)', fontWeight: 600 }}>
                  {video.creatorLabel}
                </span>
                <h4
                  style={{
                    margin: 0,
                    font: 'var(--font-h4)',
                    fontSize: '14px',
                    lineHeight: '1.3',
                    cursor: 'pointer',
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical'
                  }}
                  onClick={() => void openExternalUrl(video.url)}
                  title={video.title}
                >
                  {video.title}
                </h4>
              </div>

              {/* Rationale - Why Recommended Now */}
              <div
                style={{
                  background: 'var(--surface)',
                  padding: '8px',
                  borderRadius: 'var(--radius-sm)',
                  borderLeft: '3px solid var(--accent)',
                  fontSize: '11px',
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '6px',
                  lineHeight: '1.4'
                }}
              >
                <span>💡</span>
                <span>{video.explanation}</span>
              </div>

              {/* Categories/Tags display */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                {(video.categories || []).map((cat) => (
                  <span
                    key={cat}
                    className="chip active"
                    style={{
                      fontSize: '10px',
                      padding: '2px 6px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    {cat}
                    {editingVideoUrl === video.url && (
                      <button
                        type="button"
                        onClick={() => handleRemoveTagFromVideo(video.url, cat)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-secondary)',
                          cursor: 'pointer',
                          padding: 0,
                          fontSize: '11px',
                          display: 'inline-flex',
                          alignItems: 'center'
                        }}
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
                {editingVideoUrl !== video.url && (
                  <button
                    type="button"
                    className="chip"
                    style={{ fontSize: '10px', padding: '2px 6px', background: 'transparent', border: '1px dashed var(--border)' }}
                    onClick={() => {
                      setEditingVideoUrl(video.url);
                      setNewTagInput('');
                    }}
                  >
                    + Edit
                  </button>
                )}
              </div>

              {/* Tags Editor Form */}
              {editingVideoUrl === video.url && (
                <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                  <input
                    type="text"
                    placeholder="Add category tag..."
                    value={newTagInput}
                    onChange={(e) => setNewTagInput(e.target.value)}
                    style={{
                      flexGrow: 1,
                      padding: '4px 6px',
                      fontSize: '12px',
                      borderRadius: '4px',
                      border: '1px solid var(--border)',
                      background: 'var(--surface)'
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleAddTagToVideo(video.url);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    style={{ padding: '2px 8px', fontSize: '11px' }}
                    onClick={() => handleAddTagToVideo(video.url)}
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ padding: '2px 8px', fontSize: '11px' }}
                    onClick={() => setEditingVideoUrl(null)}
                  >
                    Done
                  </button>
                </div>
              )}

              {/* Actions Footer */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', borderTop: '1px solid var(--border-soft)', paddingTop: '8px' }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: 0, height: 'auto', color: 'var(--accent)' }}
                  onClick={() => void openExternalUrl(video.url)}
                >
                  <ExternalLinkIcon size={14} /> Watch
                </button>

                {video.isCustom && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: 0, height: 'auto', color: 'var(--danger, #c0392b)' }}
                    onClick={() => handleRemoveCustomVideo(video.url)}
                  >
                    <TrashIcon size={14} /> Remove
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
