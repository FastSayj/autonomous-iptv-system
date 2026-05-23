import axios from 'axios';
import pRetry from 'p-retry';
import pQueue from 'p-queue';
import Logger from '../utils/logger.js';

const logger = Logger.getInstance();

/**
 * StreamValidator - Validates IPTV streams with timeout, retry logic, and status filtering
 */
class StreamValidator {
  constructor(database, options = {}) {
    this.db = database;
    this.maxConcurrent = options.maxConcurrent || 10;
    this.timeout = options.timeout || 5000; // 5 seconds
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1000;
    this.queue = new pQueue({ concurrency: this.maxConcurrent });
    this.validStatuses = [200, 206]; // HTTP 200 OK, 206 Partial Content
  }

  /**
   * Validate a single stream URL
   * @param {string} streamUrl - URL to validate
   * @param {object} streamData - Additional stream data
   * @returns {Promise<object>} Validation result
   */
  async validateStream(streamUrl, streamData = {}) {
    return pRetry(
      async () => {
        try {
          const startTime = Date.now();
          
          const response = await axios.head(streamUrl, {
            timeout: this.timeout,
            maxRedirects: 5,
            validateStatus: (status) => this.validStatuses.includes(status),
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          });

          const responseTime = Date.now() - startTime;

          return {
            url: streamUrl,
            status: response.status,
            isValid: this.validStatuses.includes(response.status),
            responseTime,
            headers: {
              contentType: response.headers['content-type'] || 'unknown',
              contentLength: response.headers['content-length'] || 'unknown'
            },
            timestamp: new Date().toISOString(),
            attempts: 1,
            error: null,
            ...streamData
          };
        } catch (error) {
          throw error;
        }
      },
      {
        retries: this.maxRetries,
        minTimeout: this.retryDelay,
        maxTimeout: this.retryDelay * 2,
        onFailedAttempt: (error) => {
          logger.warn(`Stream validation attempt ${error.attemptNumber} failed for ${streamUrl}: ${error.message}`);
        }
      }
    ).catch((error) => {
      logger.error(`Stream validation failed after ${this.maxRetries + 1} attempts for ${streamUrl}: ${error.message}`);
      
      return {
        url: streamUrl,
        status: null,
        isValid: false,
        responseTime: null,
        headers: null,
        timestamp: new Date().toISOString(),
        attempts: this.maxRetries + 1,
        error: error.message,
        errorCode: error.code,
        ...streamData
      };
    });
  }

  /**
   * Validate multiple streams concurrently
   * @param {array} streams - Array of stream objects with url property
   * @returns {Promise<array>} Array of validation results
   */
  async validateMultipleStreams(streams) {
    logger.info(`Starting validation of ${streams.length} streams`);
    
    const results = await Promise.all(
      streams.map((stream) =>
        this.queue.add(() =>
          this.validateStream(stream.url, {
            name: stream.name,
            group: stream.group,
            logo: stream.logo,
            epgId: stream.epgId
          })
        )
      )
    );

    const validCount = results.filter((r) => r.isValid).length;
    const invalidCount = results.filter((r) => !r.isValid).length;

    logger.info(`Stream validation complete. Valid: ${validCount}, Invalid: ${invalidCount}`);

    return results;
  }

  /**
   * Validate all streams in the database
   * @param {object} options - Validation options
   * @returns {Promise<object>} Validation summary
   */
  async validateAllStreams(options = {}) {
    const batchSize = options.batchSize || 100;
    const includeGroups = options.groups || null;

    try {
      let query = 'SELECT id, url, name, group_name, logo, epg_id FROM streams WHERE active = 1';
      const params = [];

      if (includeGroups && includeGroups.length > 0) {
        const placeholders = includeGroups.map(() => '?').join(',');
        query += ` AND group_name IN (${placeholders})`;
        params.push(...includeGroups);
      }

      const streams = this.db.prepare(query).all(...params);

      logger.info(`Found ${streams.length} active streams to validate`);

      const results = [];
      let validCount = 0;
      let invalidCount = 0;

      // Process in batches
      for (let i = 0; i < streams.length; i += batchSize) {
        const batch = streams.slice(i, i + batchSize);
        const batchResults = await this.validateMultipleStreams(batch);
        results.push(...batchResults);

        // Update database with results
        for (const result of batchResults) {
          const stream = batch.find((s) => s.url === result.url);
          if (stream) {
            this.updateStreamStatus(stream.id, result);
            
            if (result.isValid) {
              validCount++;
            } else {
              invalidCount++;
            }
          }
        }

        logger.info(`Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(streams.length / batchSize)}`);
      }

      return {
        totalStreams: streams.length,
        validStreams: validCount,
        invalidStreams: invalidCount,
        validationRate: ((validCount / streams.length) * 100).toFixed(2) + '%',
        timestamp: new Date().toISOString(),
        results
      };
    } catch (error) {
      logger.error('Error validating all streams:', error);
      throw error;
    }
  }

  /**
   * Update stream status in database
   * @param {number} streamId - Stream ID
   * @param {object} validationResult - Validation result object
   */
  updateStreamStatus(streamId, validationResult) {
    try {
      const query = `
        UPDATE streams
        SET 
          last_checked = ?,
          is_valid = ?,
          response_time = ?,
          status_code = ?,
          error_message = ?,
          check_count = check_count + 1,
          fail_count = fail_count + ?
        WHERE id = ?
      `;

      this.db.prepare(query).run(
        validationResult.timestamp,
        validationResult.isValid ? 1 : 0,
        validationResult.responseTime || null,
        validationResult.status || null,
        validationResult.error || null,
        validationResult.isValid ? 0 : 1,
        streamId
      );
    } catch (error) {
      logger.error(`Failed to update stream status for ID ${streamId}:`, error);
    }
  }

  /**
   * Filter streams by validation criteria
   * @param {object} criteria - Filter criteria
   * @returns {array} Filtered streams
   */
  filterStreamsByCriteria(criteria = {}) {
    try {
      let query = 'SELECT * FROM streams WHERE 1=1';
      const params = [];

      if (criteria.validOnly === true) {
        query += ' AND is_valid = 1';
      }

      if (criteria.group) {
        query += ' AND group_name = ?';
        params.push(criteria.group);
      }

      if (criteria.maxResponseTime) {
        query += ' AND response_time < ?';
        params.push(criteria.maxResponseTime);
      }

      if (criteria.minUptime) {
        const uptime = criteria.minUptime / 100;
        query += ' AND (check_count - fail_count) / CAST(check_count AS FLOAT) >= ?';
        params.push(uptime);
      }

      if (criteria.sortBy) {
        const sortFields = {
          responseTime: 'response_time ASC',
          uptime: '((check_count - fail_count) / CAST(check_count AS FLOAT)) DESC',
          recent: 'last_checked DESC'
        };
        query += ` ORDER BY ${sortFields[criteria.sortBy] || 'last_checked DESC'}`;
      }

      if (criteria.limit) {
        query += ' LIMIT ?';
        params.push(criteria.limit);
      }

      return this.db.prepare(query).all(...params);
    } catch (error) {
      logger.error('Error filtering streams:', error);
      return [];
    }
  }

  /**
   * Get stream validation statistics
   * @returns {object} Validation statistics
   */
  getValidationStats() {
    try {
      const totalStreams = this.db.prepare('SELECT COUNT(*) as count FROM streams').get().count;
      const validStreams = this.db.prepare('SELECT COUNT(*) as count FROM streams WHERE is_valid = 1').get().count;
      const avgResponseTime = this.db.prepare('SELECT AVG(response_time) as avg FROM streams WHERE response_time IS NOT NULL').get().avg;
      const groupStats = this.db.prepare(`
        SELECT 
          group_name,
          COUNT(*) as total,
          SUM(CASE WHEN is_valid = 1 THEN 1 ELSE 0 END) as valid,
          AVG(response_time) as avg_response_time
        FROM streams
        GROUP BY group_name
      `).all();

      return {
        totalStreams,
        validStreams,
        invalidStreams: totalStreams - validStreams,
        validationRate: ((validStreams / totalStreams) * 100).toFixed(2) + '%',
        avgResponseTime: avgResponseTime ? avgResponseTime.toFixed(2) + 'ms' : 'N/A',
        byGroup: groupStats,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Error calculating validation stats:', error);
      return null;
    }
  }

  /**
   * Mark dead streams for removal
   * @param {number} failThreshold - Number of consecutive failures to mark as dead
   * @returns {object} Operation result
   */
  markDeadStreams(failThreshold = 5) {
    try {
      const query = `
        UPDATE streams
        SET active = 0
        WHERE fail_count >= ?
        AND active = 1
      `;

      const result = this.db.prepare(query).run(failThreshold);

      logger.info(`Marked ${result.changes} dead streams as inactive (threshold: ${failThreshold} failures)`);

      return {
        markedAsInactive: result.changes,
        threshold: failThreshold,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Error marking dead streams:', error);
      throw error;
    }
  }

  /**
   * Get health report of all streams
   * @returns {object} Health report
   */
  getHealthReport() {
    try {
      const stats = this.getValidationStats();
      const recentErrors = this.db.prepare(`
        SELECT error_message, COUNT(*) as count
        FROM streams
        WHERE error_message IS NOT NULL
        GROUP BY error_message
        ORDER BY count DESC
        LIMIT 10
      `).all();

      const needsAttention = this.db.prepare(`
        SELECT id, name, group_name, fail_count, last_checked
        FROM streams
        WHERE fail_count >= 3
        AND active = 1
        ORDER BY fail_count DESC
        LIMIT 20
      `).all();

      return {
        overallStats: stats,
        topErrors: recentErrors,
        streamsNeedingAttention: needsAttention,
        healthScore: calculateHealthScore(stats),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Error generating health report:', error);
      return null;
    }
  }
}

/**
 * Calculate overall health score (0-100)
 */
function calculateHealthScore(stats) {
  if (!stats) return 0;
  
  const validRate = parseFloat(stats.validationRate) || 0;
  const avgResponseTime = parseFloat(stats.avgResponseTime) || 0;
  
  let score = 100;
  
  // Deduct based on validation rate
  score -= (100 - validRate) * 0.5;
  
  // Deduct based on response time (penalize if > 3000ms)
  if (avgResponseTime > 3000) {
    score -= Math.min(20, (avgResponseTime - 3000) / 100);
  }
  
  return Math.max(0, Math.min(100, score)).toFixed(2);
}

export default StreamValidator;
