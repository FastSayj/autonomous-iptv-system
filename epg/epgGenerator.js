import axios from 'axios';
import xml2js from 'xml2js';
import fs from 'fs';
import path from 'path';
import Logger from '../utils/logger.js';

const logger = Logger.getInstance();

/**
 * EPGGenerator - Generates Electronic Program Guide (XMLTV format)
 */
class EPGGenerator {
  constructor(database, options = {}) {
    this.db = database;
    this.outputDir = options.outputDir || './epg';
    this.epgFilename = options.epgFilename || 'guide.xml';
    this.xmlBuilder = new xml2js.Builder({
      rootName: 'tv',
      xmldec: { version: '1.0', encoding: 'UTF-8' }
    });
  }

  /**
   * Initialize EPG directory
   */
  initializeEPGDirectory() {
    try {
      if (!fs.existsSync(this.outputDir)) {
        fs.mkdirSync(this.outputDir, { recursive: true });
        logger.info(`Created EPG directory: ${this.outputDir}`);
      }
    } catch (error) {
      logger.error('Error creating EPG directory:', error);
      throw error;
    }
  }

  /**
   * Generate EPG from all valid streams
   * @param {object} options - Generation options
   * @returns {Promise<object>} Generation result
   */
  async generateEPG(options = {}) {
    try {
      this.initializeEPGDirectory();

      logger.info('Starting EPG generation');

      // Get all valid streams with EPG IDs
      const streams = this.db.prepare(`
        SELECT DISTINCT epg_id, name, group_name, logo 
        FROM streams 
        WHERE is_valid = 1 
        AND epg_id IS NOT NULL
        ORDER BY group_name ASC, name ASC
      `).all();

      logger.info(`Found ${streams.length} streams with EPG IDs`);

      const epgData = {
        channel: [],
        programme: []
      };

      // Build channel list
      for (const stream of streams) {
        epgData.channel.push({
          $: { id: stream.epg_id },
          'display-name': [
            {
              _: stream.name,
              $: { lang: 'en' }
            }
          ],
          icon: stream.logo ? [{ $: { src: stream.logo } }] : [],
          'category': [
            {
              _: stream.group_name || 'Other',
              $: { lang: 'en' }
            }
          ]
        });
      }

      // Generate sample programmes
      const now = new Date();
      const programmes = this.generateSampleProgrammes(streams, now);
      epgData.programme = programmes;

      // Convert to XML and save
      const xmlContent = this.xmlBuilder.buildObject(epgData);
      const epgPath = path.join(this.outputDir, this.epgFilename);
      
      fs.writeFileSync(epgPath, xmlContent);
      logger.info(`EPG generated and saved: ${epgPath}`);

      // Generate statistics
      const statsPath = path.join(this.outputDir, 'epg-stats.json');
      fs.writeFileSync(statsPath, JSON.stringify({
        totalChannels: epgData.channel.length,
        totalProgrammes: epgData.programme.length,
        generatedAt: new Date().toISOString(),
        epgFile: epgPath
      }, null, 2));

      return {
        success: true,
        totalChannels: epgData.channel.length,
        totalProgrammes: epgData.programme.length,
        epgPath,
        statsPath,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Error generating EPG:', error);
      throw error;
    }
  }

  /**
   * Generate sample programmes for demonstration
   * @param {array} streams - Stream array
   * @param {Date} startDate - Start date for programmes
   * @returns {array} Programme array
   */
  generateSampleProgrammes(streams, startDate) {
    const programmes = [];
    const sampleShows = [
      { title: 'Morning News', duration: 30 },
      { title: 'Sports Today', duration: 60 },
      { title: 'Entertainment Hour', duration: 60 },
      { title: 'Evening News', duration: 30 },
      { title: 'Movie Time', duration: 120 },
      { title: 'Late Night Show', duration: 60 }
    ];

    let currentTime = new Date(startDate);
    currentTime.setHours(6, 0, 0, 0); // Start at 6 AM

    for (const stream of streams) {
      let showIndex = 0;
      let dayTime = new Date(currentTime);

      // Generate 7 days of programming
      for (let day = 0; day < 7; day++) {
        dayTime.setDate(dayTime.getDate() + (day === 0 ? 0 : 1));
        dayTime.setHours(6, 0, 0, 0);

        for (let slot = 0; slot < 18; slot++) {
          const show = sampleShows[showIndex % sampleShows.length];
          const startTime = new Date(dayTime);
          startTime.setHours(6 + Math.floor(slot * 1.33), 0, 0, 0);

          const endTime = new Date(startTime);
          endTime.setMinutes(endTime.getMinutes() + show.duration);

          programmes.push({
            $: {
              start: this.formatXMLTVTime(startTime),
              stop: this.formatXMLTVTime(endTime),
              channel: stream.epg_id
            },
            title: [
              {
                _: show.title,
                $: { lang: 'en' }
              }
            ],
            'sub-title': [
              {
                _: `Episode ${slot + 1}`,
                $: { lang: 'en' }
              }
            ],
            desc: [
              {
                _: `${show.title} - Season 1, Episode ${slot + 1}. Tune in for an exciting broadcast.`,
                $: { lang: 'en' }
              }
            ],
            category: [
              {
                _: 'Entertainment',
                $: { lang: 'en' }
              }
            ],
            rating: [
              {
                $: { system: 'VCHIP' },
                value: ['TV-PG']
              }
            ]
          });

          showIndex++;
        }
      }
    }

    return programmes;
  }

  /**
   * Format time for XMLTV format (YYYYMMDDHHmmss +0000)
   * @param {Date} date - Date object
   * @returns {string} Formatted time string
   */
  formatXMLTVTime(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    return `${year}${month}${day}${hours}${minutes}${seconds} +0000`;
  }

  /**
   * Merge EPG from external source
   * @param {string} externalEPGUrl - URL of external EPG
   * @returns {Promise<object>} Merge result
   */
  async mergeExternalEPG(externalEPGUrl) {
    try {
      logger.info(`Fetching external EPG from: ${externalEPGUrl}`);

      const response = await axios.get(externalEPGUrl, {
        timeout: 30000,
        responseType: 'arraybuffer'
      });

      const xmlParser = new xml2js.Parser();
      const externalData = await xmlParser.parseStringPromise(response.data);

      const localEPGPath = path.join(this.outputDir, this.epgFilename);
      let localData = { channel: [], programme: [] };

      if (fs.existsSync(localEPGPath)) {
        const localContent = fs.readFileSync(localEPGPath, 'utf8');
        localData = await xmlParser.parseStringPromise(localContent);
      }

      // Merge channels (avoid duplicates)
      const channelIds = new Set(localData.tv.channel?.map((c) => c.$.id) || []);
      const mergedChannels = [...(localData.tv.channel || [])];

      if (externalData.tv.channel) {
        for (const channel of externalData.tv.channel) {
          if (!channelIds.has(channel.$.id)) {
            mergedChannels.push(channel);
            channelIds.add(channel.$.id);
          }
        }
      }

      // Merge programmes
      const mergedProgrammes = [
        ...(localData.tv.programme || []),
        ...(externalData.tv.programme || [])
      ];

      const mergedData = {
        tv: {
          channel: mergedChannels,
          programme: mergedProgrammes
        }
      };

      // Save merged EPG
      const xmlContent = this.xmlBuilder.buildObject(mergedData.tv);
      fs.writeFileSync(localEPGPath, xmlContent);

      logger.info(`EPG merged successfully. Total channels: ${mergedChannels.length}, Total programmes: ${mergedProgrammes.length}`);

      return {
        success: true,
        totalChannels: mergedChannels.length,
        totalProgrammes: mergedProgrammes.length,
        epgPath: localEPGPath,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Error merging external EPG:', error);
      throw error;
    }
  }

  /**
   * Update EPG for specific streams
   * @param {array} streamIds - Array of stream IDs to update
   * @returns {Promise<object>} Update result
   */
  async updateEPGForStreams(streamIds) {
    try {
      logger.info(`Updating EPG for ${streamIds.length} streams`);

      const placeholders = streamIds.map(() => '?').join(',');
      const streams = this.db.prepare(`
        SELECT id, epg_id, name, group_name, logo 
        FROM streams 
        WHERE id IN (${placeholders})
        AND is_valid = 1
      `).all(...streamIds);

      if (streams.length === 0) {
        logger.warn('No valid streams found for EPG update');
        return { success: false, message: 'No valid streams found' };
      }

      // Regenerate EPG with updated streams
      const result = await this.generateEPG();

      return {
        success: true,
        updatedStreams: streams.length,
        epgPath: result.epgPath,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Error updating EPG for streams:', error);
      throw error;
    }
  }

  /**
   * Get EPG file statistics
   * @returns {object} File statistics
   */
  getEPGStats() {
    try {
      const epgPath = path.join(this.outputDir, this.epgFilename);

      if (!fs.existsSync(epgPath)) {
        return null;
      }

      const stats = fs.statSync(epgPath);

      return {
        path: epgPath,
        size: `${(stats.size / 1024 / 1024).toFixed(2)} MB`,
        lastModified: stats.mtime,
        lastModifiedISO: stats.mtime.toISOString(),
        lastChecked: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Error getting EPG stats:', error);
      return null;
    }
  }

  /**
   * Clean up old EPG files (keep only recent ones)
   * @param {number} daysToKeep - Number of days of EPG files to keep
   * @returns {object} Cleanup result
   */
  cleanupOldEPGFiles(daysToKeep = 7) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const files = fs.readdirSync(this.outputDir);
      let deletedCount = 0;

      for (const file of files) {
        const filepath = path.join(this.outputDir, file);
        const stats = fs.statSync(filepath);

        if (stats.mtime < cutoffDate && file !== this.epgFilename) {
          fs.unlinkSync(filepath);
          deletedCount++;
          logger.info(`Deleted old EPG file: ${file}`);
        }
      }

      logger.info(`Cleanup complete. Deleted ${deletedCount} old EPG files`);

      return {
        success: true,
        deletedFiles: deletedCount,
        daysToKeep,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Error cleaning up old EPG files:', error);
      throw error;
    }
  }

  /**
   * Validate EPG XML structure
   * @returns {Promise<object>} Validation result
   */
  async validateEPGStructure() {
    try {
      const epgPath = path.join(this.outputDir, this.epgFilename);

      if (!fs.existsSync(epgPath)) {
        return { valid: false, message: 'EPG file does not exist' };
      }

      const content = fs.readFileSync(epgPath, 'utf8');
      const xmlParser = new xml2js.Parser();
      const data = await xmlParser.parseStringPromise(content);

      const isValid = data.tv && (data.tv.channel || data.tv.programme);

      return {
        valid: isValid,
        channels: data.tv.channel?.length || 0,
        programmes: data.tv.programme?.length || 0,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Error validating EPG structure:', error);
      return { valid: false, error: error.message };
    }
  }
}

export default EPGGenerator;
