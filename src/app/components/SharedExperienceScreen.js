'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftIcon, CheckIcon, ExternalLinkIcon, PlayIcon, SparklesIcon, UserIcon, TrashIcon } from './Icons';
import { useAuth } from './AuthProvider';
import {
  createExperienceEntry,
  fetchExperienceEntries,
  updateExperienceEntry,
} from '../lib/api';
import { openExternalUrl } from '../lib/external';

const SHARED_EXPERIENCE_STORAGE_KEY = 'explore-shared-experience-state-v2';
const SHARED_EXPERIENCE_KIND = 'shared-experience-state';

// Pre-defined collaborators for the shared space
const COLLABORATORS = [
  { id: 'me', name: 'Me', status: 'online', avatar: '👤', color: 'var(--accent)' },
  { id: 'sondos', name: 'Sondos', status: 'online', avatar: '👩‍💻', color: '#ec4899' },
  { id: 'advisor', name: 'Advisor', status: 'away', avatar: '👨‍💼', color: '#10b981' },
  { id: 'tech-lead', name: 'Tech Lead', status: 'online', avatar: '🤖', color: '#8b5cf6' }
];

const DEFAULT_SHARED_STATE = {
  collections: [
    { id: 'col-leadership', title: 'Middle East Leadership' },
    { id: 'col-ai', title: 'AI & Technology Strategy' },
    { id: 'col-personal', title: 'Personal Growth & Attachment' }
  ],
  sections: [
    {
      id: 'mbr-leadership',
      collectionId: 'col-leadership',
      topic: 'Leader that changed world',
      title: 'Mohammed bin Rashid',
      meaning: 'Desert future state',
      videoUrl: 'https://www.youtube.com/watch?v=MeDb2nU9jKU',
      categories: ['Middle East identity', 'Sahara roots', 'Dubai transformation', 'government personality'],
      essay: 'A shared study section for leadership, ambition, tradition, and modern state-building.',
    },
    {
      id: 'relationship-shadow',
      collectionId: 'col-personal',
      topic: 'Relationship shadow pattern',
      title: 'Sondos-like pattern',
      meaning: 'Attachment pattern visible',
      videoUrl: '',
      categories: ['projection', 'attachment', 'idealization', 'boundary signals'],
      essay: 'A private comparison section for stories that feel emotionally similar without reducing a person to a label.',
    },
    {
      id: 'ai-advantage',
      collectionId: 'col-ai',
      topic: 'AI advantage',
      title: 'Tools worth using',
      meaning: 'Capability edge found',
      videoUrl: '',
      categories: ['coding edge', 'free accounts', 'discounts', 'real workflow'],
      essay: 'A section for videos and essays that show a tool advantage you can actually use.',
    },
  ],
  comments: {
    'mbr-leadership': [
      {
        id: 'seed-comment-1',
        authorId: 'me',
        author: 'Me',
        body: 'Use this as the first shared leadership section.',
        createdAt: '2026-06-11T00:00:00.000Z',
        reactions: { '👍': ['me'], '💡': ['advisor'] },
        replies: []
      },
      {
        id: 'seed-comment-2',
        authorId: 'advisor',
        author: 'Advisor',
        body: 'Agreed. His focus on speed and risk-taking is a core case study.',
        createdAt: '2026-06-11T02:30:00.000Z',
        reactions: { '🔥': ['sondos'] },
        replies: []
      }
    ],
  },
  projects: [
    {
      id: 'explore-core',
      title: 'eXplore intelligence OS',
      goal: 'Event-only signal, private messaging, shared study, and useful alerts.',
      timeline: 'June 2026',
      tasks: [
        { id: 'auth', label: 'Google sign-in returns to app', done: false, assignedTo: 'tech-lead', priority: 'high' },
        { id: 'messages', label: 'Private messages tested on two accounts', done: false, assignedTo: 'sondos', priority: 'medium' },
        { id: 'shared', label: 'Shared Experience board ready', done: true, assignedTo: 'me', priority: 'high' },
        { id: 'alerts', label: 'Direct notification sources proven on phone', done: false, assignedTo: 'me', priority: 'low' },
      ],
    },
    {
      id: 'video-essay-pack',
      title: 'Shared video essay pack',
      goal: 'Turn videos into categories, essays, comments, and project decisions.',
      timeline: 'This week',
      tasks: [
        { id: 'select', label: 'Choose first 5 videos', done: false, assignedTo: 'me', priority: 'medium' },
        { id: 'essay', label: 'Add essay under each video', done: false, assignedTo: 'advisor', priority: 'low' },
      ],
    },
  ],
  projectComments: {},
  driveFolderUrl: '',
  recordings: [
    {
      id: 'recording-archive-1',
      title: 'Strategic Alignment Sync',
      fileUrl: '',
      recordedAt: '2026-06-25T14:30',
      place: 'Dubai Future Labs',
      weather: '41 C Clear',
      theme: 'Desert blue',
      isTranscribed: false,
      transcript: 'Click "Transcribe Audio" to process the audio recording.',
    },
  ],
};

function cloneState(state) {
  return JSON.parse(JSON.stringify(state || DEFAULT_SHARED_STATE));
}

function uniqueById(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const id = String(item?.id || '').trim();
    if (!id || seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

function normalizeSharedState(value) {
  const incoming = value && typeof value === 'object' ? value : {};
  return {
    collections: uniqueById([
      ...(Array.isArray(incoming.collections) ? incoming.collections : []),
      ...DEFAULT_SHARED_STATE.collections,
    ]),
    sections: uniqueById([
      ...(Array.isArray(incoming.sections) ? incoming.sections : []),
      ...DEFAULT_SHARED_STATE.sections,
    ]),
    comments: {
      ...DEFAULT_SHARED_STATE.comments,
      ...(incoming.comments && typeof incoming.comments === 'object' ? incoming.comments : {}),
    },
    projects: uniqueById([
      ...(Array.isArray(incoming.projects) ? incoming.projects : []),
      ...DEFAULT_SHARED_STATE.projects,
    ]).map((project) => ({
      ...project,
      tasks: Array.isArray(project.tasks) ? project.tasks : [],
    })),
    projectComments: {
      ...DEFAULT_SHARED_STATE.projectComments,
      ...(incoming.projectComments && typeof incoming.projectComments === 'object' ? incoming.projectComments : {}),
    },
    driveFolderUrl: String(incoming.driveFolderUrl || DEFAULT_SHARED_STATE.driveFolderUrl || '').trim(),
    recordings: uniqueById([
      ...(Array.isArray(incoming.recordings) ? incoming.recordings : []),
      ...DEFAULT_SHARED_STATE.recordings,
    ]),
  };
}

function loadLocalState() {
  if (typeof window === 'undefined') {
    return normalizeSharedState();
  }

  try {
    return normalizeSharedState(JSON.parse(window.localStorage.getItem(SHARED_EXPERIENCE_STORAGE_KEY) || '{}'));
  } catch {
    return normalizeSharedState();
  }
}

function writeLocalState(state) {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(SHARED_EXPERIENCE_STORAGE_KEY, JSON.stringify(state));
}

function parseEntryBody(body = '') {
  try {
    return normalizeSharedState(JSON.parse(String(body || '{}')));
  } catch {
    return null;
  }
}

function makeId(prefix = 'item') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 10000)}`;
}

function toYoutubeEmbedUrl(url = '') {
  const rawUrl = String(url || '').trim();
  if (!rawUrl) return '';

  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.replace(/^www\./, '');
    const videoId = host === 'youtu.be'
      ? parsed.pathname.split('/').filter(Boolean)[0]
      : parsed.searchParams.get('v');
    return videoId ? `https://www.youtube.com/embed/${encodeURIComponent(videoId)}` : '';
  } catch {
    return '';
  }
}

export default function SharedExperienceScreen({ onBack }) {
  const { user } = useAuth();
  const [state, setState] = useState(() => loadLocalState());
  const [cloudEntryId, setCloudEntryId] = useState('');
  const [status, setStatus] = useState('');
  const [activeSectionId, setActiveSectionId] = useState(() => DEFAULT_SHARED_STATE.sections[0].id);
  const [sectionCommentDraft, setSectionCommentDraft] = useState('');
  const [replyDrafts, setReplyDrafts] = useState({});
  const [activeReplyId, setActiveReplyId] = useState(null);
  const [projectCommentDrafts, setProjectCommentDrafts] = useState({});
  
  // Collaboration controls
  const [currentCollaboratorId, setCurrentCollaboratorId] = useState('me');
  const activeCollaborator = useMemo(() => (
    COLLABORATORS.find(c => c.id === currentCollaboratorId) || COLLABORATORS[0]
  ), [currentCollaboratorId]);

  const [activeSubTab, setActiveSubTab] = useState('videos');
  const [transcribingId, setTranscribingId] = useState(null);
  const [transcribingProgress, setTranscribingProgress] = useState(0);

  const activeSection = useMemo(() => (
    state.sections.find((section) => section.id === activeSectionId) || state.sections[0]
  ), [activeSectionId, state.sections]);

  // Sync cloud state
  useEffect(() => {
    let cancelled = false;

    if (!user?.id) {
      queueMicrotask(() => {
        if (!cancelled) {
          setStatus('Saved on this device.');
        }
      });
      return () => {
        cancelled = true;
      };
    }

    const loadCloudState = async () => {
      const payload = await fetchExperienceEntries();
      if (cancelled) return;

      const entry = (payload?.entries || []).find((item) => item.kind === SHARED_EXPERIENCE_KIND);
      const cloudState = entry ? parseEntryBody(entry.body) : null;
      if (entry?.id) {
        setCloudEntryId(entry.id);
      }
      if (cloudState) {
        setState(cloudState);
        writeLocalState(cloudState);
        setStatus('Synced.');
      } else {
        setStatus('Ready.');
      }
    };

    void loadCloudState();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const persistState = async (nextState) => {
    const normalized = normalizeSharedState(nextState);
    writeLocalState(normalized);
    setState(normalized);

    if (!user?.id) {
      setStatus('Saved on this device.');
      return;
    }

    try {
      const body = JSON.stringify(normalized);
      const payload = cloudEntryId
        ? await updateExperienceEntry(cloudEntryId, SHARED_EXPERIENCE_KIND, body)
        : await createExperienceEntry(SHARED_EXPERIENCE_KIND, body);
      if (payload?.entry?.id) {
        setCloudEntryId(payload.entry.id);
      }
      setStatus('Synced.');
    } catch {
      setStatus('Saved locally. Cloud sync needs backend access.');
    }
  };

  // Section modification
  const updateSection = (sectionId, patch) => {
    const nextState = {
      ...state,
      sections: state.sections.map((section) => (
        section.id === sectionId ? { ...section, ...patch } : section
      )),
    };
    void persistState(nextState);
  };

  // Add Comment with Reactions and Replies support
  const addSectionComment = () => {
    const body = sectionCommentDraft.trim();
    if (!body || !activeSection?.id) return;

    const nextComments = {
      ...state.comments,
      [activeSection.id]: [
        ...(state.comments[activeSection.id] || []),
        {
          id: makeId('comment'),
          authorId: activeCollaborator.id,
          author: activeCollaborator.name,
          body,
          createdAt: new Date().toISOString(),
          reactions: {},
          replies: []
        },
      ],
    };
    setSectionCommentDraft('');
    void persistState({ ...state, comments: nextComments });
  };

  const handleAddReply = (commentId) => {
    const draft = replyDrafts[commentId]?.trim();
    if (!draft || !activeSection?.id) return;

    const currentComments = state.comments[activeSection.id] || [];
    const nextCommentsForSection = currentComments.map(comment => {
      if (comment.id !== commentId) return comment;
      return {
        ...comment,
        replies: [
          ...(comment.replies || []),
          {
            id: makeId('reply'),
            authorId: activeCollaborator.id,
            author: activeCollaborator.name,
            body: draft,
            createdAt: new Date().toISOString()
          }
        ]
      };
    });

    setReplyDrafts(prev => ({ ...prev, [commentId]: '' }));
    setActiveReplyId(null);
    void persistState({
      ...state,
      comments: {
        ...state.comments,
        [activeSection.id]: nextCommentsForSection
      }
    });
  };

  const handleAddReaction = (commentId, emoji) => {
    if (!activeSection?.id) return;
    const currentComments = state.comments[activeSection.id] || [];
    const nextCommentsForSection = currentComments.map(comment => {
      if (comment.id !== commentId) return comment;
      const reactions = { ...(comment.reactions || {}) };
      const usersWithReaction = reactions[emoji] ? [...reactions[emoji]] : [];
      
      if (usersWithReaction.includes(activeCollaborator.id)) {
        // Toggle off
        reactions[emoji] = usersWithReaction.filter(u => u !== activeCollaborator.id);
      } else {
        // Toggle on
        reactions[emoji] = [...usersWithReaction, activeCollaborator.id];
      }
      
      return { ...comment, reactions };
    });

    void persistState({
      ...state,
      comments: {
        ...state.comments,
        [activeSection.id]: nextCommentsForSection
      }
    });
  };

  // Projects Tasks Assignee & Priority Controls
  const toggleProjectTask = (projectId, taskId) => {
    const nextProjects = state.projects.map((project) => {
      if (project.id !== projectId) return project;
      return {
        ...project,
        tasks: project.tasks.map((task) => (
          task.id === taskId ? { ...task, done: !task.done } : task
        )),
      };
    });
    void persistState({ ...state, projects: nextProjects });
  };

  const handleUpdateTaskField = (projectId, taskId, field, value) => {
    const nextProjects = state.projects.map((project) => {
      if (project.id !== projectId) return project;
      return {
        ...project,
        tasks: project.tasks.map((task) => (
          task.id === taskId ? { ...task, [field]: value } : task
        )),
      };
    });
    void persistState({ ...state, projects: nextProjects });
  };

  const handleAddTask = (projectId, label) => {
    if (!label.trim()) return;
    const nextProjects = state.projects.map((project) => {
      if (project.id !== projectId) return project;
      return {
        ...project,
        tasks: [
          ...project.tasks,
          { id: makeId('task'), label: label.trim(), done: false, assignedTo: 'me', priority: 'medium' }
        ]
      };
    });
    void persistState({ ...state, projects: nextProjects });
  };

  const addProjectComment = (projectId) => {
    const body = String(projectCommentDrafts[projectId] || '').trim();
    if (!body) return;

    const nextProjectComments = {
      ...state.projectComments,
      [projectId]: [
        ...(state.projectComments[projectId] || []),
        {
          id: makeId('project-comment'),
          authorId: activeCollaborator.id,
          author: activeCollaborator.name,
          body,
          createdAt: new Date().toISOString(),
        },
      ],
    };
    setProjectCommentDrafts((current) => ({ ...current, [projectId]: '' }));
    void persistState({ ...state, projectComments: nextProjectComments });
  };

  // Add Blank items
  const addBlankSection = () => {
    const nextSection = {
      id: makeId('shared-section'),
      collectionId: state.collections[0]?.id || 'col-leadership',
      topic: 'New shared section',
      title: 'Untitled video set',
      meaning: 'Meaning being found',
      videoUrl: '',
      categories: ['new category'],
      essay: '',
    };
    const nextState = {
      ...state,
      sections: [nextSection, ...state.sections],
    };
    setActiveSectionId(nextSection.id);
    void persistState(nextState);
  };

  const addBlankProject = () => {
    const nextProject = {
      id: makeId('shared-project'),
      title: 'New project',
      goal: 'Define the aim.',
      timeline: 'Set timeline',
      tasks: [
        { id: makeId('task'), label: 'First task', done: false, assignedTo: 'me', priority: 'medium' },
      ],
    };
    void persistState({
      ...state,
      projects: [nextProject, ...state.projects],
    });
  };

  // Live Collaboration Simulator
  const handleSimulatePartnerActivity = () => {
    setStatus('Partner typing...');
    setTimeout(() => {
      if (!activeSection?.id) return;
      const partner = COLLABORATORS[Math.floor(Math.random() * (COLLABORATORS.length - 1)) + 1]; // Random non-me
      const phrases = [
        "This aligns perfectly with our core values.",
        "I just added a new task to the board.",
        "Can we review this in our next sync?",
        "Excellent choice of resource.",
        "Let's make sure the timeline is realistic."
      ];
      const randomBody = phrases[Math.floor(Math.random() * phrases.length)];

      const nextComments = {
        ...state.comments,
        [activeSection.id]: [
          ...(state.comments[activeSection.id] || []),
          {
            id: makeId('comment'),
            authorId: partner.id,
            author: partner.name,
            body: randomBody,
            createdAt: new Date().toISOString(),
            reactions: {},
            replies: []
          },
        ],
      };

      void persistState({ ...state, comments: nextComments });
      setStatus(`New comment from ${partner.name}`);
      setTimeout(() => setStatus('Synced.'), 3000);
    }, 1500);
  };

  // Simulated Transcription Engine
  const handleTranscribe = (recordingId) => {
    setTranscribingId(recordingId);
    setTranscribingProgress(10);
    
    const interval = setInterval(() => {
      setTranscribingProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setTimeout(() => {
            const transcriptText = `[00:02] Me: Let's focus on Sheikh Mohammed's vision for Dubai's innovation roadmap. How do we translate that into our software architecture?\n\n[00:24] Advisor: It comes down to two things: speed and absolute clarity on the metrics. If you look at the Dubai Future Foundation, they run highly focused, short-term iterations.\n\n[00:58] Sondos: Exactly. And they build in public. The public-facing dashboard acts as accountability.\n\n[01:22] Tech Lead: From a systems perspective, we need a decoupled architecture that allows us to launch new signal widgets without redeploying the core platform.`;
            
            const nextRecordings = state.recordings.map(r => (
              r.id === recordingId ? { ...r, isTranscribed: true, transcript: transcriptText } : r
            ));
            
            void persistState({ ...state, recordings: nextRecordings });
            setTranscribingId(null);
          }, 500);
          return 100;
        }
        return prev + 25;
      });
    }, 400);
  };

  const updateRecording = (recordingId, patch) => {
    const nextRecordings = state.recordings.map((recording) => (
      recording.id === recordingId ? { ...recording, ...patch } : recording
    ));
    void persistState({ ...state, recordings: nextRecordings });
  };

  const addBlankRecording = () => {
    const nextRecording = {
      id: makeId('recording'),
      title: 'New recording',
      fileUrl: '',
      recordedAt: new Date().toISOString().slice(0, 16),
      place: '',
      weather: '',
      theme: '',
      isTranscribed: false,
      transcript: 'Click "Transcribe Audio" to process.',
    };
    void persistState({
      ...state,
      recordings: [nextRecording, ...state.recordings],
    });
  };

  const embedUrl = toYoutubeEmbedUrl(activeSection?.videoUrl);

  return (
    <div className="page-enter shared-experience-shell">
      <div className="container">
        {/* Top Header */}
        <div className="shared-experience-topbar" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <button type="button" className="btn-icon btn-ghost" onClick={onBack} aria-label="Back">
              <ArrowLeftIcon size={22} />
            </button>
            <div>
              <span className="page-kicker">Shared workspace</span>
              <h1 style={{ margin: 0, font: 'var(--font-h1)' }}>Shared Experience</h1>
            </div>
          </div>

          {/* Collaborators Panel */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Active User Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--surface-elevated)', padding: '6px 12px', borderRadius: '20px', border: '1px solid var(--border-soft)' }}>
              <span style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>Acting as:</span>
              <select
                value={currentCollaboratorId}
                onChange={(e) => setCurrentCollaboratorId(e.target.value)}
                style={{ background: 'none', border: 'none', color: 'var(--text-primary)', fontWeight: 600, cursor: 'pointer', outline: 'none' }}
              >
                {COLLABORATORS.map(c => (
                  <option key={c.id} value={c.id} style={{ background: 'var(--surface)' }}>{c.avatar} {c.name}</option>
                ))}
              </select>
            </div>

            {/* Sim Activity button */}
            <button 
              type="button" 
              className="btn btn-secondary btn-sm" 
              onClick={handleSimulatePartnerActivity}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            >
              <SparklesIcon size={14} /> Sim Activity
            </button>

            <span className="shared-sync-status" style={{ fontSize: '12px', color: 'var(--accent)' }}>{status}</span>
          </div>
        </div>

        {/* Presence Bar */}
        <div style={{ display: 'flex', gap: '12px', padding: '8px 0', borderBottom: '1px solid var(--border-soft)', marginBottom: '16px', overflowX: 'auto' }}>
          {COLLABORATORS.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', font: 'var(--font-caption)', whiteSpace: 'nowrap' }}>
              <span style={{ position: 'relative' }}>
                {c.avatar}
                <span 
                  style={{ 
                    position: 'absolute', 
                    bottom: '-2px', 
                    right: '-2px', 
                    width: '8px', 
                    height: '8px', 
                    borderRadius: '50%', 
                    background: c.status === 'online' ? '#10b981' : '#f59e0b',
                    border: '1px solid var(--surface)'
                  }} 
                />
              </span>
              <span style={{ fontWeight: currentCollaboratorId === c.id ? 'bold' : 'normal' }}>{c.name}</span>
            </div>
          ))}
        </div>

        {/* Navigation Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 'var(--space-base)', gap: '16px', flexWrap: 'wrap' }}>
          {[
            { key: 'videos', label: 'Shared Videos' },
            { key: 'essays', label: 'Essays' },
            { key: 'projects', label: 'Projects' },
            { key: 'recordings', label: 'Recordings & Transcription' },
            { key: 'comments', label: 'Discussions' },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`btn ${activeSubTab === tab.key ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setActiveSubTab(tab.key)}
              style={{
                borderRadius: '0',
                borderBottom: activeSubTab === tab.key ? '2px solid var(--accent)' : 'none',
                padding: '8px 16px',
                background: 'transparent',
                color: activeSubTab === tab.key ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* TAB 1: Shared Videos Organized by Collections */}
        {activeSubTab === 'videos' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>Shared Video Collections</h3>
              <button type="button" className="btn btn-secondary btn-sm" onClick={addBlankSection}>
                + Add Video Section
              </button>
            </div>

            {/* Loop through Collections */}
            {state.collections.map((collection) => {
              const collectionSections = state.sections.filter(s => s.collectionId === collection.id);
              return (
                <div key={collection.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'var(--surface-elevated)' }}>
                  <h4 style={{ margin: 0, borderBottom: '1px solid var(--border-soft)', paddingBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
                    <span>📁 {collection.title}</span>
                    <span style={{ font: 'var(--font-caption)', opacity: 0.7 }}>{collectionSections.length} videos</span>
                  </h4>
                  
                  <div className="scroll-row shared-section-row" style={{ gap: '12px', padding: '4px 0' }}>
                    {collectionSections.map((section) => (
                      <button
                        key={section.id}
                        type="button"
                        className={`shared-section-pill ${section.id === activeSection?.id ? 'is-active' : ''}`}
                        onClick={() => setActiveSectionId(section.id)}
                        style={{ flex: '0 0 220px', textAlign: 'left' }}
                      >
                        <span>{section.topic}</span>
                        <strong>{section.title}</strong>
                        <small>{section.meaning}</small>
                      </button>
                    ))}
                    {collectionSections.length === 0 && (
                      <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', margin: '8px' }}>
                        No videos in this collection yet.
                      </p>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Selected Video Player & Management */}
            {activeSection ? (
              <div className="shared-panel" style={{ width: '100%', marginTop: '12px' }}>
                <div className="shared-panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                  <div style={{ flexGrow: 1 }}>
                    <input
                      className="shared-title-input"
                      value={activeSection.title}
                      onChange={(event) => updateSection(activeSection.id, { title: event.target.value })}
                      aria-label="Section title"
                      style={{ font: 'var(--font-h3)', width: '100%', border: 'none', background: 'transparent', outline: 'none' }}
                    />
                    <input
                      className="shared-meaning-input"
                      value={activeSection.meaning}
                      onChange={(event) => updateSection(activeSection.id, { meaning: event.target.value })}
                      aria-label="Three word meaning"
                      style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)', width: '100%', border: 'none', background: 'transparent', outline: 'none' }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ font: 'var(--font-caption)' }}>Collection:</span>
                    <select
                      value={activeSection.collectionId || 'col-leadership'}
                      onChange={(e) => updateSection(activeSection.id, { collectionId: e.target.value })}
                      style={{ padding: '4px 8px', borderRadius: '4px', background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                    >
                      {state.collections.map(c => (
                        <option key={c.id} value={c.id}>{c.title}</option>
                      ))}
                    </select>
                    {activeSection.videoUrl && (
                      <button
                        type="button"
                        className="btn-icon btn-secondary"
                        onClick={() => void openExternalUrl(activeSection.videoUrl)}
                        aria-label="Open video source"
                      >
                        <ExternalLinkIcon size={18} />
                      </button>
                    )}
                  </div>
                </div>

                <input
                  className="shared-video-url"
                  value={activeSection.videoUrl || ''}
                  onChange={(event) => updateSection(activeSection.id, { videoUrl: event.target.value })}
                  placeholder="YouTube URL"
                  aria-label="Video URL"
                  style={{ width: '100%', padding: '8px', margin: '12px 0', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface)' }}
                />

                <div className="shared-video-frame" style={{ position: 'relative', width: '100%', height: '320px', background: '#000', borderRadius: '8px', overflow: 'hidden' }}>
                  {embedUrl ? (
                    <iframe
                      src={embedUrl}
                      title={activeSection.title}
                      style={{ width: '100%', height: '100%', border: '0' }}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    />
                  ) : (
                    <div className="shared-empty-video" style={{ display: 'flex', flexDirection: 'column', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#666' }}>
                      <PlayIcon size={40} />
                      <span style={{ marginTop: '8px' }}>Add a video URL to embed.</span>
                    </div>
                  )}
                </div>

                <div className="shared-category-row" style={{ marginTop: '12px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {(activeSection.categories || []).map((category) => (
                    <span key={category} className="chip active">{category}</span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="card" style={{ color: 'var(--text-secondary)' }}>
                No sections yet. Add a new section to get started.
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Essays */}
        {activeSubTab === 'essays' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' }}>
            <div className="scroll-row shared-section-row" aria-label="Shared sections">
              {state.sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  className={`shared-section-pill ${section.id === activeSection?.id ? 'is-active' : ''}`}
                  onClick={() => setActiveSectionId(section.id)}
                >
                  <span>{section.topic}</span>
                  <strong>{section.title}</strong>
                </button>
              ))}
            </div>

            {activeSection ? (
              <div className="shared-panel" style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <h3 style={{ margin: 0 }}>Essay / Study notes for: {activeSection.title}</h3>
                <textarea
                  className="shared-essay"
                  value={activeSection.essay || ''}
                  onChange={(event) => updateSection(activeSection.id, { essay: event.target.value })}
                  placeholder="Type shared essays, findings, or study notes here..."
                  style={{ width: '100%', minHeight: '350px', padding: '12px', resize: 'vertical', background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '6px' }}
                />
              </div>
            ) : (
              <div className="card" style={{ color: 'var(--text-secondary)' }}>
                Select a section to write an essay.
              </div>
            )}
          </div>
        )}

        {/* TAB 3: Projects - Advanced Task Board */}
        {activeSubTab === 'projects' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>Project Sprint Boards</h3>
              <button type="button" className="btn btn-secondary btn-sm" onClick={addBlankProject}>
                + Add Project
              </button>
            </div>

            <div className="shared-project-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
              {state.projects.map((project) => {
                const tasks = project.tasks || [];
                const doneCount = tasks.filter(t => t.done).length;
                const progress = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0;

                return (
                  <article key={project.id} className="card shared-project-card" style={{ background: 'var(--surface-elevated)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div className="shared-project-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <h3 style={{ margin: 0 }}>{project.title}</h3>
                        <p style={{ margin: '4px 0 0', font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>{project.goal}</p>
                      </div>
                      <strong style={{ font: 'var(--font-h3)' }}>{progress}%</strong>
                    </div>

                    {/* Progress Bar */}
                    <div className="shared-progress" aria-label={`${progress}% complete`} style={{ height: '6px', background: 'var(--border-soft)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.3s' }} />
                    </div>

                    <span className="shared-timeline" style={{ font: 'var(--font-caption)', color: 'var(--accent)', fontWeight: 600 }}>Timeline: {project.timeline}</span>

                    {/* Task list with Assignee & Priority Controls */}
                    <div className="shared-task-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', margin: '8px 0' }}>
                      {tasks.map((task) => (
                        <div 
                          key={task.id} 
                          style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'space-between', 
                            padding: '8px', 
                            borderRadius: '6px', 
                            background: 'var(--surface)', 
                            borderLeft: `3px solid ${task.priority === 'high' ? '#ef4444' : task.priority === 'medium' ? '#f59e0b' : '#3b82f6'}` 
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <input
                              type="checkbox"
                              checked={task.done}
                              onChange={() => toggleProjectTask(project.id, task.id)}
                              style={{ cursor: 'pointer' }}
                            />
                            <span style={{ textDecoration: task.done ? 'line-through' : 'none', opacity: task.done ? 0.6 : 1, fontSize: '13px' }}>
                              {task.label}
                            </span>
                          </div>

                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            {/* Assignee selector */}
                            <select
                              value={task.assignedTo || 'me'}
                              onChange={(e) => handleUpdateTaskField(project.id, task.id, 'assignedTo', e.target.value)}
                              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer' }}
                            >
                              {COLLABORATORS.map(collab => (
                                <option key={collab.id} value={collab.id}>{collab.name}</option>
                              ))}
                            </select>

                            {/* Priority badge */}
                            <span 
                              style={{ 
                                fontSize: '10px', 
                                padding: '2px 6px', 
                                borderRadius: '4px', 
                                background: task.priority === 'high' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                                color: task.priority === 'high' ? '#f87171' : '#fbbf24',
                                fontWeight: 'bold'
                              }}
                            >
                              {task.priority || 'medium'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Add new task input */}
                    <form 
                      onSubmit={(e) => {
                        e.preventDefault();
                        const data = new FormData(e.currentTarget);
                        const taskLabel = data.get('taskLabel');
                        if (taskLabel) {
                          handleAddTask(project.id, taskLabel.toString());
                          e.currentTarget.reset();
                        }
                      }}
                      style={{ display: 'flex', gap: '6px' }}
                    >
                      <input
                        name="taskLabel"
                        placeholder="Add new task..."
                        required
                        style={{ flexGrow: 1, padding: '6px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface)', fontSize: '12px' }}
                      />
                      <button type="submit" className="btn btn-secondary btn-sm">Add</button>
                    </form>
                  </article>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 4: Recordings & Transcription */}
        {activeSubTab === 'recordings' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' }}>
            <div className="shared-drive-row" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <input
                value={state.driveFolderUrl || ''}
                onChange={(event) => void persistState({ ...state, driveFolderUrl: event.target.value })}
                placeholder="Google Drive folder URL for shared recordings"
                aria-label="Google Drive folder URL"
                style={{ flexGrow: 1, padding: '8px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface)' }}
              />
              <button type="button" className="btn btn-secondary btn-sm" onClick={addBlankRecording}>
                + Add Recording
              </button>
              {state.driveFolderUrl ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void openExternalUrl(state.driveFolderUrl)}>
                  Open Drive
                </button>
              ) : null}
            </div>

            <div className="shared-recording-grid" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {state.recordings.map((recording) => (
                <article key={recording.id} className="card shared-recording-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'var(--surface-elevated)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                    <input
                      className="shared-title-input"
                      value={recording.title || ''}
                      onChange={(event) => updateRecording(recording.id, { title: event.target.value })}
                      aria-label="Recording title"
                      style={{ font: 'var(--font-h3)', border: 'none', background: 'transparent', outline: 'none', width: '300px' }}
                    />
                    
                    {/* Transcription Action */}
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      {transcribingId === recording.id ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', font: 'var(--font-caption)' }}>
                          <span className="status-pill is-live">Transcribing {transcribingProgress}%</span>
                          <div style={{ width: '80px', height: '4px', background: 'var(--border-soft)', borderRadius: '2px', overflow: 'hidden' }}>
                            <div style={{ width: `${transcribingProgress}%`, height: '100%', background: 'var(--accent)' }} />
                          </div>
                        </div>
                      ) : (
                        <button 
                          type="button" 
                          className="btn btn-primary btn-sm" 
                          onClick={() => handleTranscribe(recording.id)}
                          disabled={recording.isTranscribed}
                        >
                          {recording.isTranscribed ? '✓ Transcribed' : '🎙 Transcribe Audio'}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="shared-recording-meta" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' }}>
                    <input
                      type="datetime-local"
                      value={String(recording.recordedAt || '').slice(0, 16)}
                      onChange={(event) => updateRecording(recording.id, { recordedAt: event.target.value })}
                      aria-label="Recording time"
                      style={{ padding: '4px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface)' }}
                    />
                    <input
                      value={recording.place || ''}
                      onChange={(event) => updateRecording(recording.id, { place: event.target.value })}
                      placeholder="Place"
                      aria-label="Recording place"
                      style={{ padding: '4px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface)' }}
                    />
                    <input
                      value={recording.weather || ''}
                      onChange={(event) => updateRecording(recording.id, { weather: event.target.value })}
                      placeholder="Weather"
                      aria-label="Recording weather"
                      style={{ padding: '4px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface)' }}
                    />
                  </div>

                  {/* Diarized Transcript Display */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ font: 'var(--font-caption)', fontWeight: 600 }}>Speaker-Diarized Transcript</label>
                    <textarea
                      className="shared-transcript"
                      value={recording.transcript || ''}
                      onChange={(event) => updateRecording(recording.id, { transcript: event.target.value })}
                      placeholder="No transcript generated yet. Click 'Transcribe Audio'."
                      style={{ 
                        width: '100%', 
                        height: '150px', 
                        padding: '10px', 
                        borderRadius: '6px', 
                        background: 'var(--surface)', 
                        color: 'var(--text-primary)', 
                        font: 'monospace', 
                        fontSize: '12px',
                        lineHeight: '1.5',
                        border: '1px solid var(--border)'
                      }}
                    />
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}

        {/* TAB 5: Discussions & Comments */}
        {activeSubTab === 'comments' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-base)' }}>
            {/* Section Comments */}
            <div className="shared-panel card" style={{ background: 'var(--surface-elevated)' }}>
              <h3>Video Discussions</h3>
              <div className="scroll-row shared-section-row" aria-label="Shared sections" style={{ marginBottom: '12px' }}>
                {state.sections.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    className={`shared-section-pill ${section.id === activeSection?.id ? 'is-active' : ''}`}
                    onClick={() => setActiveSectionId(section.id)}
                    style={{ padding: '6px 12px', minWidth: '100px' }}
                  >
                    <strong>{section.title}</strong>
                  </button>
                ))}
              </div>
              
              {activeSection ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <h4 style={{ margin: '0 0 10px' }}>Comments for {activeSection.title}</h4>
                  
                  {/* Comments list with reactions and replies */}
                  <div className="shared-comment-list" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {(state.comments[activeSection.id] || []).map((comment) => (
                      <div key={comment.id} className="shared-comment" style={{ background: 'var(--surface)', padding: '12px', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <strong style={{ color: 'var(--accent)' }}>{comment.author}</strong>
                          <span style={{ font: 'var(--font-caption)', opacity: 0.6 }}>{new Date(comment.createdAt).toLocaleTimeString()}</span>
                        </div>
                        <p style={{ margin: '4px 0', fontSize: '13px' }}>{comment.body}</p>

                        {/* Reactions row */}
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '4px' }}>
                          {['👍', '❤️', '💡', '🔥'].map(emoji => {
                            const users = comment.reactions?.[emoji] || [];
                            const hasReacted = users.includes(activeCollaborator.id);
                            return (
                              <button
                                key={emoji}
                                type="button"
                                onClick={() => handleAddReaction(comment.id, emoji)}
                                style={{
                                  background: hasReacted ? 'rgba(var(--accent-rgb), 0.15)' : 'transparent',
                                  border: '1px solid var(--border-soft)',
                                  borderRadius: '12px',
                                  padding: '2px 8px',
                                  fontSize: '11px',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}
                              >
                                <span>{emoji}</span>
                                {users.length > 0 && <span style={{ fontWeight: 'bold' }}>{users.length}</span>}
                              </button>
                            );
                          })}
                          
                          {/* Reply trigger */}
                          <button
                            type="button"
                            onClick={() => {
                              setActiveReplyId(activeReplyId === comment.id ? null : comment.id);
                            }}
                            style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: '11px', cursor: 'pointer', marginLeft: 'auto' }}
                          >
                            Reply
                          </button>
                        </div>

                        {/* Nested Replies */}
                        {comment.replies && comment.replies.length > 0 && (
                          <div style={{ marginLeft: '20px', paddingLeft: '10px', borderLeft: '2px solid var(--border-soft)', display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                            {comment.replies.map(reply => (
                              <div key={reply.id} style={{ background: 'var(--surface-elevated)', padding: '6px 10px', borderRadius: '6px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
                                  <strong>{reply.author}</strong>
                                  <span style={{ opacity: 0.6 }}>{new Date(reply.createdAt).toLocaleTimeString()}</span>
                                </div>
                                <p style={{ margin: '2px 0', fontSize: '12px' }}>{reply.body}</p>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Inline Reply Form */}
                        {activeReplyId === comment.id && (
                          <div style={{ display: 'flex', gap: '6px', marginTop: '8px', marginLeft: '20px' }}>
                            <input
                              placeholder="Write a reply..."
                              value={replyDrafts[comment.id] || ''}
                              onChange={(e) => setReplyDrafts({ ...replyDrafts, [comment.id]: e.target.value })}
                              style={{ flexGrow: 1, padding: '6px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface)', fontSize: '12px' }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleAddReply(comment.id);
                              }}
                            />
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => handleAddReply(comment.id)}>Send</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Main Comment Composer */}
                  <div className="shared-comment-composer" style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
                    <input
                      value={sectionCommentDraft}
                      onChange={(event) => setSectionCommentDraft(event.target.value)}
                      placeholder="Type a new comment..."
                      style={{ flexGrow: 1, padding: '8px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface)' }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') addSectionComment();
                      }}
                    />
                    <button type="button" className="btn btn-primary" onClick={addSectionComment}>
                      Post Comment
                    </button>
                  </div>
                </div>
              ) : (
                <p className="shared-muted">Select a section to comment.</p>
              )}
            </div>

            {/* Project Comments */}
            <div className="shared-panel card" style={{ background: 'var(--surface-elevated)' }}>
              <h3>Project Board Discussions</h3>
              {state.projects.map((project) => (
                <div key={project.id} style={{ borderBottom: '1px solid var(--border-soft)', paddingBottom: '16px', marginBottom: '16px' }}>
                  <h4 style={{ margin: '0 0 10px' }}>💬 {project.title} Board</h4>
                  <div className="shared-comment-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
                    {(state.projectComments[project.id] || []).map((comment) => (
                      <div key={comment.id} className="shared-comment" style={{ background: 'var(--surface)', padding: '8px 12px', borderRadius: '6px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                          <strong>{comment.author}</strong>
                          <span style={{ opacity: 0.6 }}>{new Date(comment.createdAt).toLocaleTimeString()}</span>
                        </div>
                        <p style={{ margin: '4px 0', fontSize: '13px' }}>{comment.body}</p>
                      </div>
                    ))}
                    {(!state.projectComments[project.id] || state.projectComments[project.id].length === 0) && (
                      <p style={{ font: 'var(--font-caption)', color: 'var(--text-secondary)' }}>No board comments yet.</p>
                    )}
                  </div>

                  <div className="shared-comment-composer" style={{ display: 'flex', gap: '8px' }}>
                    <input
                      value={projectCommentDrafts[project.id] || ''}
                      onChange={(event) => setProjectCommentDrafts((current) => ({
                        ...current,
                        [project.id]: event.target.value,
                      }))}
                      placeholder="Comment on project board..."
                      style={{ flexGrow: 1, padding: '6px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--surface)' }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') addProjectComment(project.id);
                      }}
                    />
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => addProjectComment(project.id)}>
                      Comment
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
