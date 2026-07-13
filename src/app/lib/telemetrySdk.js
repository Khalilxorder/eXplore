import { apiFetch } from './api';

let eventQueue = [];
let batchTimeout = null;

/**
 * Queue a telemetry event to be sent in batches to the backend.
 * @param {string} eventType - The type of event (e.g., 'visible_2s', 'dwell', 'completion')
 * @param {string} contentItemId - The content item ID
 * @param {Object} eventData - Additional metadata about the event
 * @param {number|null} durationMs - Optional duration of the event in milliseconds
 */
export function queueTelemetryEvent(eventType, contentItemId, eventData = {}, durationMs = null) {
  const event = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
    content_item_id: contentItemId,
    event_type: eventType,
    event_data: eventData,
    duration_ms: durationMs,
    created_at: new Date().toISOString()
  };

  eventQueue.push(event);

  // Send batch immediately if it gets large, or wait for inactivity
  if (eventQueue.length >= 10) {
    flushTelemetryQueue();
  } else {
    if (batchTimeout) clearTimeout(batchTimeout);
    batchTimeout = setTimeout(() => {
      flushTelemetryQueue();
    }, 2000);
  }
}

/**
 * Flush all currently queued telemetry events to the backend.
 */
export async function flushTelemetryQueue() {
  if (eventQueue.length === 0) return;

  const batch = [...eventQueue];
  eventQueue = [];
  if (batchTimeout) {
    clearTimeout(batchTimeout);
    batchTimeout = null;
  }

  try {
    await apiFetch('/api/v1/intelligence/events/batch', {
      method: 'POST',
      body: JSON.stringify({ events: batch })
    });
  } catch (err) {
    // If it fails, prepending back to queue to retry later
    eventQueue = [...batch, ...eventQueue];
    console.error('Failed to send telemetry batch:', err);
  }
}

// Attach lifecycle listeners for flush on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    flushTelemetryQueue();
  });
  window.addEventListener('pagehide', () => {
    flushTelemetryQueue();
  });
}
