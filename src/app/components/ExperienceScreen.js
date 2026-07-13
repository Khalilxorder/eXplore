'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftIcon, HeartIcon, MoonIcon, SunIcon, TrashIcon, PlayIcon, SparklesIcon } from './Icons';
import { useAuth } from './AuthProvider';
import { createExperienceEntry, fetchHierarchyState } from '../lib/api';

const HIDDEN_SONG_CATALOG = [
  {
    id: 'tobu-dusk',
    title: 'Dusk',
    artist: 'Tobu',
    energy: 0.72,
    valence: 0.66,
    youtubeUrl: 'https://www.youtube.com/watch?v=w9aZ4n7vVss',
    themes: ['dusk', 'waiting', 'confession', 'love', 'moving', 'departure', 'light', 'threshold', 'sudden understanding', 'hope', 'melodic'],
    symbols: ['sunset', 'motion', 'edge', 'distance', 'glow', 'turning point'],
    gradient: 'linear-gradient(135deg, #f83600 0%, #f9d423 100%)' // Sunset Orange/Yellow
  },
  {
    id: 'threshold-quiet',
    title: 'Threshold Quiet',
    artist: 'Marconi Union - Weightless',
    energy: 0.15,
    valence: 0.42,
    youtubeUrl: 'https://www.youtube.com/watch?v=UfcAVejsrU4',
    themes: ['silence', 'uncertainty', 'reflection', 'night', 'alone', 'memory', 'hesitation', 'calm', 'peace', 'meditation'],
    symbols: ['moon', 'window', 'room', 'shadow', 'water', 'clouds'],
    gradient: 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)' // Deep Blue/Teal
  },
  {
    id: 'arrival-fire',
    title: 'Arrival Fire',
    artist: 'The Prodigy - Firestarter',
    energy: 0.95,
    valence: 0.68,
    youtubeUrl: 'https://www.youtube.com/watch?v=wmin5WIMEs0',
    themes: ['excitement', 'friends', 'trip', 'arrival', 'courage', 'future', 'rush', 'fire', 'intense', 'power', 'wild'],
    symbols: ['road', 'sun', 'open air', 'spark', 'crowd', 'lightning'],
    gradient: 'linear-gradient(135deg, #f12711 0%, #f5af19 100%)' // Fiery Red/Orange
  },
  {
    id: 'old-city-myth',
    title: 'Old City Myth',
    artist: 'Hans Zimmer - Dune Desert Pathway',
    energy: 0.48,
    valence: 0.55,
    youtubeUrl: 'https://www.youtube.com/watch?v=34Na43V4nV4',
    themes: ['tradition', 'myth', 'place', 'history', 'ancestor', 'street', 'journey', 'ancient', 'sand', 'dune'],
    symbols: ['market', 'stone', 'desert', 'gate', 'ritual', 'wind'],
    gradient: 'linear-gradient(135deg, #e65c00 0%, #F9D423 100%)' // Desert Gold
  },
  {
    id: 'body-signal',
    title: 'Body Signal',
    artist: 'Kavinsky - Nightcall',
    energy: 0.64,
    valence: 0.45,
    youtubeUrl: 'https://www.youtube.com/watch?v=MV_3Dpw-BRY',
    themes: ['heartbeat', 'body', 'pressure', 'fear', 'intensity', 'pulse', 'breath', 'driving', 'nighttime'],
    symbols: ['chest', 'blood', 'drum', 'storm', 'heat', 'neon'],
    gradient: 'linear-gradient(135deg, #141e30 0%, #243b55 100%)' // Dark Neon Blue
  },
  {
    id: 'melancholy-rain',
    title: 'Melancholy Rain',
    artist: 'Yiruma - River Flows in You',
    energy: 0.25,
    valence: 0.18,
    youtubeUrl: 'https://www.youtube.com/watch?v=7maJOI3QMu0',
    themes: ['sad', 'lonely', 'rain', 'piano', 'tears', 'loss', 'grief', 'missed', 'anxious', 'pain', 'cold'],
    symbols: ['droplet', 'grey', 'umbrella', 'puddle', 'tear', 'mist'],
    gradient: 'linear-gradient(135deg, #3a7bd5 0%, #3a6073 100%)' // Rain Blue/Grey
  },
  {
    id: 'cosmic-voyage',
    title: 'Cosmic Voyage',
    artist: 'M83 - Outro',
    energy: 0.78,
    valence: 0.85,
    youtubeUrl: 'https://www.youtube.com/watch?v=v80a5urY1Y8',
    themes: ['dreamy', 'space', 'future', 'hope', 'stars', 'universe', 'flight', 'epiphany', 'limitless', 'triumph'],
    symbols: ['star', 'galaxy', 'sky', 'heights', 'comet', 'horizon'],
    gradient: 'linear-gradient(135deg, #4e54c8 0%, #8f94fb 100%)' // Cosmic Purple/Blue
  }
];

function normalizeText(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ');
}

function splitTerms(value = '') {
  return normalizeText(value).split(/\s+/).filter(Boolean);
}

function currentSeason(monthIndex) {
  if ([11, 0, 1].includes(monthIndex)) return 'winter';
  if ([2, 3, 4].includes(monthIndex)) return 'spring';
  if ([5, 6, 7].includes(monthIndex)) return 'summer';
  return 'autumn';
}

function currentDayPhase(hour) {
  if (hour >= 4 && hour < 7) return 'dawn';
  if (hour >= 7 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'day';
  if (hour >= 17 && hour < 21) return 'dusk';
  return 'night';
}

function moonPhase(date = new Date()) {
  const synodicMonth = 29.53058867;
  const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14);
  const days = (date.getTime() - knownNewMoon) / 86400000;
  const phase = ((days % synodicMonth) + synodicMonth) % synodicMonth;
  if (phase < 1.85 || phase > 27.68) return 'new moon';
  if (phase < 5.54) return 'waxing crescent';
  if (phase < 9.23) return 'first quarter';
  if (phase < 12.92) return 'waxing moon';
  if (phase < 16.61) return 'full moon';
  if (phase < 20.3) return 'waning moon';
  if (phase < 23.99) return 'last quarter';
  return 'waning crescent';
}

function buildContext(place = null) {
  const now = new Date();
  return {
    season: currentSeason(now.getMonth()),
    phase: currentDayPhase(now.getHours()),
    moon: moonPhase(now),
    weather: place?.weather || '',
    latitude: place?.latitude,
    longitude: place?.longitude,
  };
}

function countPhraseHits(text, phrases = []) {
  return phrases.reduce((count, phrase) => {
    const normalized = normalizeText(phrase);
    if (!normalized) return count;
    return count + (text.includes(normalized) ? 1 : 0);
  }, 0);
}

function collectProfileLabels(hierarchy = {}) {
  const labels = [
    hierarchy.currentGoal,
    hierarchy.storyHighestOrder,
    hierarchy.storyYours,
    ...(Array.isArray(hierarchy.coreValues) ? hierarchy.coreValues : []),
    ...(Array.isArray(hierarchy.historyHints) ? hierarchy.historyHints.slice(0, 6) : []),
  ];

  return labels
    .filter(Boolean)
    .map((label) => String(label).trim())
    .filter(Boolean)
    .slice(0, 12);
}

function buildProfileContext(payload = {}) {
  const hierarchy = payload?.hierarchy || payload || {};
  const labels = collectProfileLabels(hierarchy);
  const text = [
    hierarchy.currentGoal,
    hierarchy.storyHighestOrder,
    hierarchy.storyYours,
    hierarchy.storySubStories,
    labels.join(' '),
  ].filter(Boolean).join(' ');

  return {
    configured: Boolean(normalizeText(text).trim()),
    text,
    labels: labels.slice(0, 8),
  };
}

function inferEnergy(text = '') {
  const high = countPhraseHits(text, ['rush', 'excited', 'ecstatic', 'running', 'fast', 'heartbeat', 'fire', 'urgent', 'intense', 'wild', 'loud', 'power', 'storm', 'drum']);
  const low = countPhraseHits(text, ['quiet', 'still', 'alone', 'tired', 'slow', 'empty', 'silent', 'soft', 'calm', 'peace', 'sleep', 'relax', 'grief', 'sad']);
  return Math.max(0.12, Math.min(0.98, 0.5 + (high * 0.10) - (low * 0.08)));
}

function inferValence(text = '') {
  const bright = countPhraseHits(text, ['love', 'hope', 'beautiful', 'light', 'friend', 'future', 'joy', 'open', 'triumph', 'stars', 'dream', 'happy']);
  const dark = countPhraseHits(text, ['fear', 'loss', 'sad', 'leaving', 'pain', 'anxious', 'alone', 'tears', 'grey', 'cold', 'grief', 'hurt']);
  return Math.max(0.05, Math.min(0.96, 0.5 + (bright * 0.09) - (dark * 0.09)));
}

function scoreSong(story = '', context = {}, profileContext = {}) {
  const immediateText = normalizeText([
    story,
    context.phase,
    context.season,
    context.moon,
    context.weather,
  ].filter(Boolean).join(' '));
  const text = normalizeText([
    immediateText,
    profileContext?.text,
  ].filter(Boolean).join(' '));
  const terms = new Set(splitTerms(text));
  const storyEnergy = inferEnergy(text);
  const storyValence = inferValence(text);
  const profileHits = profileContext?.configured
    ? Math.min(countPhraseHits(immediateText, profileContext.labels || []), 4)
    : 0;

  return HIDDEN_SONG_CATALOG
    .map((song) => {
      const themeHits = countPhraseHits(text, song.themes);
      const symbolHits = countPhraseHits(text, song.symbols);
      const termHits = [...terms].filter((term) => (
        song.themes.some((theme) => normalizeText(theme).includes(term))
        || song.symbols.some((symbol) => normalizeText(symbol).includes(term))
      )).length;
      const energyDistance = Math.abs(storyEnergy - song.energy);
      const valenceDistance = Math.abs(storyValence - song.valence);
      const score = Math.min(0.99, (
        (themeHits * 0.16)
        + (symbolHits * 0.13)
        + (Math.min(termHits, 8) * 0.04)
        + ((1 - energyDistance) * 0.18)
        + ((1 - valenceDistance) * 0.18)
        + (profileHits * 0.03)
      ));

      return {
        ...song,
        score,
        reason: [
          themeHits ? `${themeHits} theme matches` : '',
          symbolHits ? `${symbolHits} symbol matches` : '',
          profileHits ? 'profile lens' : '',
          context.phase ? `time: ${context.phase}` : '',
        ].filter(Boolean).join(' | '),
      };
    })
    .sort((left, right) => right.score - left.score)[0];
}

async function fetchWeatherForPosition(position) {
  const latitude = Number(position?.coords?.latitude);
  const longitude = Number(position?.coords?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,is_day`;
  const response = await fetch(url);
  if (!response.ok) {
    return { latitude, longitude, weather: '' };
  }
  const data = await response.json();
  const temp = Number(data?.current?.temperature_2m);
  const isDay = data?.current?.is_day === 1 ? 'day' : 'night';
  return {
    latitude,
    longitude,
    weather: Number.isFinite(temp) ? `${Math.round(temp)} C ${isDay}` : isDay,
  };
}

// Helper to convert watch URL to embed URL
function toYoutubeEmbedUrl(url = '') {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.replace(/^www\./, '') === 'youtu.be') {
      return `https://www.youtube.com/embed/${parsed.pathname.split('/').filter(Boolean)[0]}`;
    }
    const videoId = parsed.searchParams.get('v');
    return videoId ? `https://www.youtube.com/embed/${videoId}` : '';
  } catch {
    return '';
  }
}

export default function ExperienceScreen({ onBack }) {
  const { user } = useAuth();
  const audioRef = useRef(null);
  const oscillatorRef = useRef(null);
  const gainRef = useRef(null);
  const [story, setStory] = useState('');
  const [bodyState, setBodyState] = useState('');
  const [place, setPlace] = useState(null);
  const [placeBusy, setPlaceBusy] = useState(false);
  const [match, setMatch] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState('');
  const [profileContext, setProfileContext] = useState(() => buildProfileContext());
  const [profileStatus, setProfileStatus] = useState('Profile lens local.');
  const context = useMemo(() => buildContext(place), [place]);
  const romanticNight = context.phase === 'night' || context.phase === 'dusk';

  // Dynamic Background style based on matched song's feeling
  const dynamicBackgroundStyle = useMemo(() => {
    if (match && match.gradient) {
      return {
        background: match.gradient,
        transition: 'background 1.5s ease-in-out'
      };
    }
    return {};
  }, [match]);

  useEffect(() => () => {
    oscillatorRef.current?.stop?.();
    audioRef.current?.close?.();
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!user?.id) {
      setProfileContext(buildProfileContext());
      setProfileStatus('Profile lens local.');
      return () => {
        cancelled = true;
      };
    }

    const loadProfile = async () => {
      try {
        const payload = await fetchHierarchyState();
        if (cancelled) return;
        const nextProfileContext = buildProfileContext(payload);
        setProfileContext(nextProfileContext);
        setProfileStatus(nextProfileContext.configured ? 'Profile lens connected.' : 'Profile lens empty.');
      } catch {
        if (!cancelled) {
          setProfileContext(buildProfileContext());
          setProfileStatus('Profile lens unavailable.');
        }
      }
    };

    void loadProfile();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const handleConnectPlace = async () => {
    if (!navigator?.geolocation) {
      setStatus('Location unavailable.');
      return;
    }
    setPlaceBusy(true);
    setStatus('');
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          setPlace(await fetchWeatherForPosition(position));
          setStatus('Place connected.');
        } catch {
          setPlace({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            weather: '',
          });
          setStatus('Place connected.');
        } finally {
          setPlaceBusy(false);
        }
      },
      () => {
        setStatus('Location permission needed.');
        setPlaceBusy(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  };

  const handleConnectSong = async (event) => {
    event.preventDefault();
    const fullStory = [story, bodyState].filter(Boolean).join('\n');
    if (!fullStory.trim()) {
      setStatus('Write the experience first.');
      return;
    }

    const nextMatch = scoreSong(fullStory, context, profileContext);
    const isValidMatch = nextMatch && nextMatch.score >= 0.30;
    setMatch(isValidMatch ? nextMatch : null);
    setStatus(isValidMatch ? 'Song connected.' : 'No song revealed yet.');

    if (user?.id) {
      try {
        await createExperienceEntry('xperience', JSON.stringify({
          story,
          bodyState,
          context,
          profileContext: {
            configured: profileContext.configured,
            labels: profileContext.labels,
          },
          match: isValidMatch
            ? { id: nextMatch.id, title: nextMatch.title, artist: nextMatch.artist, score: nextMatch.score }
            : null,
        }));
      } catch {
        setStatus('Matched locally. Cloud save needs backend access.');
      }
    }
  };

  const handlePlayMatchedMusic = async () => {
    if (!match) return;
    if (playing) {
      oscillatorRef.current?.stop?.();
      oscillatorRef.current = null;
      setPlaying(false);
      return;
    }

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      setStatus('Audio unavailable.');
      return;
    }

    const audio = audioRef.current || new AudioContext();
    audioRef.current = audio;
    if (audio.state === 'suspended') {
      await audio.resume();
    }

    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const baseFrequency = 150 + Math.round((match.energy || 0.5) * 220);
    oscillator.type = romanticNight ? 'sine' : 'triangle';
    oscillator.frequency.setValueAtTime(baseFrequency, audio.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(baseFrequency * 1.3, audio.currentTime + 2.0);
    
    // Ambient modulation
    const filter = audio.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(600, audio.currentTime);
    
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(romanticNight ? 0.06 : 0.08, audio.currentTime + 0.5);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 8.0);
    
    oscillator.connect(filter).connect(gain).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 8.0);
    oscillator.onended = () => {
      oscillatorRef.current = null;
      setPlaying(false);
    };
    oscillatorRef.current = oscillator;
    gainRef.current = gain;
    setPlaying(true);
  };

  const embedUrl = match ? toYoutubeEmbedUrl(match.youtubeUrl) : '';

  return (
    <div 
      className={`page-enter xperience-shell ${romanticNight ? 'is-romantic-night' : ''}`}
      style={{
        ...dynamicBackgroundStyle,
        minHeight: '100vh',
        paddingBottom: 'var(--space-large)'
      }}
    >
      <div className="container">
        <div className="xperience-topbar">
          <button type="button" className="btn-icon btn-ghost" onClick={onBack} aria-label="Back">
            <ArrowLeftIcon size={22} />
          </button>
          <h1>Xperience</h1>
        </div>

        <form className="xperience-stage" onSubmit={handleConnectSong}>
          <div className="xperience-context-row">
            <span><SunIcon size={16} /> {context.phase}</span>
            <span><MoonIcon size={16} /> {context.moon}</span>
            <span>{context.season}</span>
            {context.weather ? <span>{context.weather}</span> : null}
            <span>{profileStatus}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleConnectPlace} disabled={placeBusy}>
              {placeBusy ? 'Connecting' : 'Connect place'}
            </button>
          </div>

          <textarea
            className="xperience-paper"
            value={story}
            onChange={(event) => setStory(event.target.value)}
            placeholder="Write the whole experience..."
            autoFocus
          />

          <input
            className="xperience-body-input"
            value={bodyState}
            onChange={(event) => setBodyState(event.target.value)}
            placeholder="Heartbeat, body, pressure, excitement..."
          />

          <div className="xperience-action-row">
            <span>{status || `Hidden songs: ${HIDDEN_SONG_CATALOG.length}`}</span>
            <button type="submit" className="btn btn-primary" disabled={!story.trim()}>
              Connect song
            </button>
          </div>
        </form>

        {match ? (
          <section className="xperience-reveal" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: 'var(--space-base)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div>
                <span className="page-kicker">Connected song revealed</span>
                <h2 style={{ margin: '4px 0' }}>{match.title}</h2>
                <p style={{ margin: 0, opacity: 0.8 }}>{match.artist}</p>
              </div>
              <div className="xperience-match-score" style={{ display: 'flex', alignItems: 'center', gap: '4px', font: 'var(--font-h3)' }}>
                <HeartIcon size={20} style={{ color: 'red' }} />
                {Math.round(match.score * 100)}%
              </div>
            </div>

            <p style={{ font: 'var(--font-caption)', opacity: 0.9, margin: 0 }}>
              <strong>Personal connection:</strong> {match.reason}
            </p>

            {/* Hidden Embedded YouTube Player of the Song */}
            {embedUrl && (
              <div 
                className="youtube-embed-container" 
                style={{ 
                  width: '100%', 
                  height: '240px', 
                  borderRadius: 'var(--radius-md)', 
                  overflow: 'hidden', 
                  boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.1)'
                }}
              >
                <iframe
                  src={`${embedUrl}?autoplay=1&enablejsapi=1`}
                  title={match.title}
                  style={{ width: '100%', height: '100%', border: '0' }}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px' }}>
              <button 
                type="button" 
                className="btn btn-primary" 
                onClick={handlePlayMatchedMusic}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <SparklesIcon size={16} />
                {playing ? 'Stop Ambient Aura' : 'Activate Ambient Aura'}
              </button>
            </div>
          </section>
        ) : (
          <section className="xperience-hidden" aria-live="polite">
            <TrashIcon size={16} />
            Songs stay hidden until the story connects.
          </section>
        )}
      </div>
    </div>
  );
}
