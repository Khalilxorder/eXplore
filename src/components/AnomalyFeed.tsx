'use client';
import { useState, useEffect, useRef } from 'react';
import { fetchAnomalyFeed, resolveApiBase } from '../app/lib/api';

export default function AnomalyFeed({ onClose }) {
  const [anomalies, setAnomalies] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const videoRefs = useRef([]);

  useEffect(() => {
    fetchAnomalyFeed()
      .then(data => {
        if (data.success) {
          setAnomalies(data.anomalies);
        }
        setLoading(false);
      });
  }, []);

  const handleNext = () => {
    if (currentIndex < anomalies.length - 1) {
      if (videoRefs.current[currentIndex]) videoRefs.current[currentIndex].pause();
      setCurrentIndex(prev => prev + 1);
    }
  };

  const currentAnomaly = anomalies[currentIndex];

  useEffect(() => {
    // Auto-play the current video
    if (videoRefs.current[currentIndex]) {
      videoRefs.current[currentIndex].currentTime = 0;
      videoRefs.current[currentIndex].play().catch(e => console.log('Auto-play prevented', e));
    }
  }, [currentIndex, anomalies]);

  if (loading) return (
    <div className="fixed inset-0 z-50 bg-black flex items-center justify-center text-white font-mono">
      <div className="animate-pulse">Loading Anomaly Radar...</div>
    </div>
  );

  if (anomalies.length === 0) return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center text-white font-mono">
      <div>No anomalies detected today.</div>
      <button onClick={onClose} className="mt-4 px-4 py-2 border border-white hover:bg-white hover:text-black transition-colors">Return</button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black flex items-center justify-center overflow-hidden">
      {/* Distraction Free Video Area */}
      <div className="relative w-full h-full max-w-[500px] bg-gray-900 shadow-2xl overflow-hidden shadow-[0_0_50px_rgba(255,0,0,0.15)]">
        
        {anomalies.map((anomaly, index) => (
          <div 
            key={anomaly.id} 
            className={`absolute inset-0 transition-opacity duration-300 ${index === currentIndex ? 'opacity-100 z-10' : 'opacity-0 z-0'}`}
          >
            {/* Native Video Player pulling raw .mp4 directly from our backend */}
            <video
              ref={el => videoRefs.current[index] = el}
              src={anomaly.videoUrl || (anomaly.localVideoPath ? `${resolveApiBase()}${anomaly.localVideoPath}` : '')}
              className="w-full h-full object-cover"
              loop
              playsInline
              onClick={() => {
                const vid = videoRefs.current[index];
                if (vid.paused) vid.play();
                else vid.pause();
              }}
            />

            {/* AI HUD Overlay */}
            <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/90 via-black/50 to-transparent pointer-events-none">
              
              <div className="flex items-center gap-3 mb-3">
                <span className="text-red-500 font-mono font-bold text-xl border border-red-500/30 bg-red-500/10 px-2 py-0.5 rounded">
                  Anomaly {anomaly.anomalyScore.toFixed(1)}/10
                </span>
                <span className="text-gray-300 font-mono text-xs">
                  {anomaly.engagementRatio}x Growth Ratio
                </span>
              </div>
              
              <h2 className="text-white font-serif text-2xl mb-2 drop-shadow-lg">
                Phase 2 Value Sync: Highly Relevant
              </h2>
              
              <p className="text-gray-200 text-sm font-sans mb-4 drop-shadow">
                <span className="font-bold text-white mr-2">AI Hook Analysis:</span> 
                {anomaly.aiHookAnalysis}
              </p>

              <div className="flex gap-4 text-xs font-mono text-gray-400">
                <span>[Shock: {anomaly.sentimentBreakdown.shock}/10]</span>
                <span>[Intelligence: {anomaly.sentimentBreakdown.intelligence}/10]</span>
              </div>
            </div>
          </div>
        ))}

        {/* Swipe/Click targets for navigation */}
        <div className="absolute top-1/2 right-4 -translate-y-1/2 z-20 cursor-pointer text-white/50 hover:text-white" onClick={handleNext}>
          <svg className="w-8 h-8 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
        </div>

        <button 
          onClick={onClose}
          className="absolute top-6 left-6 z-20 text-white/50 hover:text-white font-mono text-sm uppercase tracking-widest"
        >
          [Exit Radar]
        </button>
      </div>
    </div>
  );
}
