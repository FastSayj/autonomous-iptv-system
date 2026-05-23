import axios from 'axios';
import Logger from '../utils/logger.js';
import pRetry from 'p-retry';

const logger = Logger.getInstance();

class SourceCrawler {
  constructor(db) {
    this.db = db;
    this.sources = [
      'https://iptv-org.github.io/iptv/index.m3u',
      'https://raw.githubusercontent.com/iptv-org/iptv/master/index.m3u',
      'https://github.com/iptv-org/iptv/releases/download/latest/iptv.m3u'
    ];
  }

  async crawlSources() {
    logger.info('Starting source crawl...');
    let totalStreams = 0;

    for (const source of this.sources) {
      try {
        const streams = await this.fetchAndParseSource(source);
        totalStreams += streams.length;
        logger.info(`Fetched ${streams.length} streams from ${source}`);
      } catch (error) {
        logger.warn(`Failed to fetch source ${source}: ${error.message}`);
      }
    }

    logger.info(`Total streams discovered: ${totalStreams}`);
    return totalStreams;
  }

  async fetchAndParseSource(url) {
    try {
      const response = await pRetry(
        () => axios.get(url, { timeout: 10000 }),
        { retries: 3 }
      );

      const lines = response.data.split('\n');
      const streams = [];
      let currentStream = null;

      for (const line of lines) {
        if (line.startsWith('#EXTINF:')) {
          currentStream = this.parseExtinf(line);
        } else if (line.trim() && currentStream) {
          currentStream.url = line.trim();
          streams.push(currentStream);
          currentStream = null;
        }
      }

      // Store in database
      for (const stream of streams) {
        await this.db.addStream(stream);
      }

      return streams;
    } catch (error) {
      throw new Error(`Failed to fetch source: ${error.message}`);
    }
  }

  parseExtinf(extinf) {
    const parts = extinf.substring(8).split(',');
    const metadata = parts[0].trim();
    const name = parts.slice(1).join(',').trim();

    const stream = {
      name,
      duration: '-1',
      tvg_id: this.extractAttribute(metadata, 'tvg-id'),
      tvg_name: this.extractAttribute(metadata, 'tvg-name'),
      tvg_logo: this.extractAttribute(metadata, 'tvg-logo'),
      group_title: this.extractAttribute(metadata, 'group-title'),
      status: 'unknown'
    };

    return stream;
  }

  extractAttribute(metadata, attribute) {
    const regex = new RegExp(`${attribute}="([^"]*)"`, 'i');
    const match = metadata.match(regex);
    return match ? match[1] : '';
  }
}

export default SourceCrawler;
