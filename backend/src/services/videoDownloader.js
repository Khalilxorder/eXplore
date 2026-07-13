const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// The local directory for your raw anomalous videos
const UPLOADS_DIR = path.join(__dirname, '../../uploads/anomalies');

// Ensure directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/**
 * Downloads a raw MP4 video file from a given URL to the local disk.
 * @param {string} videoUrl The raw video URL (e.g. from TikWm or Apify)
 * @param {string} videoId The unique ID of the post
 * @returns {Promise<string>} The local file path saved
 */
function downloadRawVideo(videoUrl, videoId) {
    return new Promise((resolve, reject) => {
        const client = videoUrl.startsWith('https') ? https : http;
        const filename = `${videoId}.mp4`;
        const localPath = path.join(UPLOADS_DIR, filename);

        const file = fs.createWriteStream(localPath);

        client.get(videoUrl, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                // Handle redirects (frequent with TikTok CDNs)
                return downloadRawVideo(response.headers.location, videoId)
                    .then(resolve)
                    .catch(reject);
            }

            if (response.statusCode !== 200) {
                return reject(new Error(`Failed to download video. Status code: ${response.statusCode}`));
            }

            response.pipe(file);

            file.on('finish', () => {
                file.close(() => {
                    resolve(`/uploads/anomalies/${filename}`);
                });
            });
        }).on('error', (err) => {
            fs.unlink(localPath, () => {}); // Delete partial file
            reject(err);
        });
    });
}

module.exports = {
    downloadRawVideo
};
