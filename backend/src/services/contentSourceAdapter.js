'use strict';

/**
 * Interface/Contract for all eXplore Content Source Adapters.
 * All implementations (such as YouTube, RSS, etc.) should implement these methods.
 */
class ContentSourceAdapter {
  /**
   * Determine if the adapter can handle a given source URL
   * @param {string} url 
   * @returns {boolean}
   */
  canHandle(url) {
    throw new Error('Method "canHandle" must be implemented.');
  }

  /**
   * Fetch raw metadata from the source URL
   * @param {string} url 
   * @returns {Promise<object>}
   */
  async fetchMetadata(url) {
    throw new Error('Method "fetchMetadata" must be implemented.');
  }

  /**
   * Extract/retrieve the transcript or full text content
   * @param {string} externalId 
   * @param {object} [metadata]
   * @returns {Promise<object>}
   */
  async extractTranscript(externalId, metadata) {
    throw new Error('Method "extractTranscript" must be implemented.');
  }

  /**
   * Ingest, analyze, and process the content from a URL
   * @param {string} url 
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async process(url, options) {
    throw new Error('Method "process" must be implemented.');
  }
}

module.exports = ContentSourceAdapter;
