import fs from 'fs';
import path from 'path';
import Logger from '../utils/logger.js';

const logger = Logger.getInstance();

/**
 * PlaylistGenerator - Generates M3U playlists from validated IPTV streams
 */
class PlaylistGenerator {
  constructor(database, options = {}) {
    this.db = database;
    this.outputDir = options.outputDir || './playlists';
    this.playlistName = options.playlistName || 'playlist.m3u';
    this.extplaylistName = options.extplaylistName || 'playlist.m3u8';
    this.includeValidOnly = options.includeValidOnly !== false;
    this.sortByGroup = options.sortByGroup !== false;
  }

  /**
   * Initialize playlist directory
   */
  initializePlaylistDirectory() {
    try {
      if (!fs.existsSync(this.outputDir)) {
        fs.mkdirSync(this.outputDir, { recursive: true });
        logger.info(`Created playlist directory: ${this.outputDir}`);
      }
    } catch (error) {
      logger.error('Error creating playlist directory:', error);
      throw error;
    }
  }

  /**
   * Generate complete M3U playlist
   * @param {object} options - Generation options
   * @returns {Promise<object>} Generation result
   */
  async generatePlaylist(options = {}) {
    try {
      this.initializePlaylistDirectory();

      const groups = options.groups || null;
      const maxStreams = options.maxStreams || null;
      const format = options.format || 'extended'; // 'extended' or 'simple'

      // Get streams from database
      let query = 'SELECT * FROM streams WHERE 1=1';
      const params = [];

      if (this.includeValidOnly) {
        query += ' AND is_valid = 1';
      }

      if (groups && groups.length > 0) {
        const placeholders = groups.map(() => '?').join(',');
        query += ` AND group_name IN (${placeholders})`;
        params.push(...groups);
      }

      if (this.sortByGroup) {
        query += ' ORDER BY group_name ASC, name ASC';
      } else {
        query += ' ORDER BY name ASC';
      }

      if (maxStreams) {
        query += ' LIMIT ?';
        params.push(maxStreams);
      }

      const streams = this.db.prepare(query).all(...params);

      logger.info(`Generating ${format} playlist with ${streams.length} streams`);

      const playlistContent = format === 'extended' 
        ? this.generateExtendedPlaylist(streams)
        : this.generateSimplePlaylist(streams);

      // Save extended format (.m3u8)
      const extPlaylistPath = path.join(this.outputDir, this.extplaylistName);
      fs.writeFileSync(extPlaylistPath, playlistContent.extended);
      logger.info(`Extended playlist saved: ${extPlaylistPath}`);

      // Save simple format (.m3u)
      const simplePlaylistPath = path.join(this.outputDir, this.playlistName);
      fs.writeFileSync(simplePlaylistPath, playlistContent.simple);
      logger.info(`Simple playlist saved: ${simplePlaylistPath}`);

      // Save statistics
      const statsPath = path.join(this.outputDir, 'playlist-stats.json');
      fs.writeFileSync(statsPath, JSON.stringify({
        totalStreams: streams.length,
        validStreams: streams.filter((s) => s.is_valid).length,
        groups: this.getGroupStats(streams),
        generatedAt: new Date().toISOString(),
        format
      }, null, 2));

      return {
        success: true,
        totalStreams: streams.length,
        validStreams: streams.filter((s) => s.is_valid).length,
        extPlaylistPath,
        simplePlaylistPath,
        statsPath,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Error generating playlist:', error);
      throw error;
    }
  }

  /**
   * Generate extended M3U8 format playlist
   * @param {array} streams - Stream array
   * @returns {object} Playlist content object
   */
  generateExtendedPlaylist(streams) {
    const lines = ['#EXTM3U'];

    // Add header with custom properties
    lines.push('#EXTM3U url-tvg="http://epg.example.com/guide.xml" tvg-shift=0 cache=3600');

    let currentGroup = null;

    for (const stream of streams) {
      // Add group separator comment
      if (this.sortByGroup && stream.group_name !== currentGroup) {
        lines.push(`\n#EXTINF:-1 group-title="${stream.group_name || 'Unknown'}",`);
        currentGroup = stream.group_name;
      }

      // Format EXTINF line
      const extinf = this.formatExtinfLine(stream);
      lines.push(extinf);
      lines.push(stream.url);
    }

    const extended = lines.join('\n') + '\n';
    const simple = this.formatSimplePlaylist(streams);

    return { extended, simple };
  }

  /**
   * Format EXTINF line for extended format
   * @param {object} stream - Stream object
   * @returns {string} EXTINF formatted line
   */
  formatExtinfLine(stream) {
    const attrs = [];

    // Add TVG attributes
    if (stream.tvg_id) {
      attrs.push(`tvg-id="${stream.tvg_id}"`);
    }

    if (stream.epg_id) {
      attrs.push(`tvg-name="${stream.name}"`);
    }

    if (stream.logo) {
      attrs.push(`tvg-logo="${stream.logo}"`);
    }

    // Add group
    if (stream.group_name) {
      attrs.push(`group-title="${stream.group_name}"`);
    }

    // Add metadata
    const duration = '-1'; // Live streams have -1 duration
    const displayName = `${stream.name}${stream.is_valid ? ' ✓' : ' ✗'}`;

    const attrString = attrs.length > 0 ? ` ${attrs.join(', ')}` : '';
    return `#EXTINF:${duration}${attrString},${displayName}`;
  }

  /**
   * Generate simple M3U playlist
   * @param {array} streams - Stream array
   * @returns {string} Simple playlist content
   */
  generateSimplePlaylist(streams) {
    const lines = ['#EXTM3U'];

    let currentGroup = null;

    for (const stream of streams) {
      // Add group separator
      if (this.sortByGroup && stream.group_name !== currentGroup) {
        lines.push(`# Group: ${stream.group_name || 'Unknown'}`);
        currentGroup = stream.group_name;
      }

      // Add simple format
      const displayName = `${stream.name}${stream.is_valid ? ' ✓' : ' ✗'}`;
      lines.push(`#EXTINF:-1,${displayName}`);
      lines.push(stream.url);
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Format simple playlist (M3U)
   * @param {array} streams - Stream array
   * @returns {string} Simple playlist content
   */
  formatSimplePlaylist(streams) {
    const lines = ['#EXTM3U'];

    let currentGroup = null;

    for (const stream of streams) {
      if (this.sortByGroup && stream.group_name !== currentGroup) {
        lines.push(`# ${stream.group_name || 'Unknown'}`);
        currentGroup = stream.group_name;
      }

      lines.push(`#EXTINF:-1,${stream.name}`);
      lines.push(stream.url);
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Generate group-specific playlists
   * @returns {Promise<array>} Array of generated playlist paths
   */
  async generateGroupPlaylists() {
    try {
      this.initializePlaylistDirectory();

      // Get all groups
      const groups = this.db.prepare(`
        SELECT DISTINCT group_name FROM streams WHERE group_name IS NOT NULL
      `).all();

      const playlists = [];

      for (const group of groups) {
        const streams = this.db.prepare(`
          SELECT * FROM streams 
          WHERE group_name = ? 
          AND ${this.includeValidOnly ? 'is_valid = 1' : '1=1'}
          ORDER BY name ASC
        `).all(group.group_name);

        const content = this.generateExtendedPlaylist(streams).extended;
        const filename = `${group.group_name.toLowerCase().replace(/\s+/g, '-')}.m3u8`;
        const filepath = path.join(this.outputDir, filename);

        fs.writeFileSync(filepath, content);
        logger.info(`Generated group playlist: ${filename} (${streams.length} streams)`);

        playlists.push({
          group: group.group_name,
          filename,
          path: filepath,
          streamCount: streams.length
        });
      }

      return playlists;
    } catch (error) {
      logger.error('Error generating group playlists:', error);
      throw error;
    }
  }

  /**
   * Get group statistics
   * @param {array} streams - Stream array
   * @returns {object} Group statistics
   */
  getGroupStats(streams) {
    const stats = {};

    for (const stream of streams) {
      const group = stream.group_name || 'Unknown';
      if (!stats[group]) {
        stats[group] = { total: 0, valid: 0, invalid: 0 };
      }
      stats[group].total++;
      if (stream.is_valid) {
        stats[group].valid++;
      } else {
        stats[group].invalid++;
      }
    }

    return stats;
  }

  /**
   * Export playlist with metadata
   * @param {object} options - Export options
   * @returns {Promise<object>} Export result
   */
  async exportPlaylist(options = {}) {
    try {
      const format = options.format || 'json';
      const includeMetadata = options.includeMetadata !== false;

      const streams = this.db.prepare(`
        SELECT * FROM streams 
        WHERE ${this.includeValidOnly ? 'is_valid = 1' : '1=1'}
        ORDER BY group_name ASC, name ASC
      `).all();

      let content;
      let filename;

      switch (format) {
        case 'json':
          content = JSON.stringify({
            metadata: includeMetadata ? {
              exportedAt: new Date().toISOString(),
              totalStreams: streams.length,
              validStreams: streams.filter((s) => s.is_valid).length
            } : null,
            streams
          }, null, 2);
          filename = 'playlist.json';
          break;

        case 'csv':
          content = 'Name,URL,Group,Logo,Valid,LastChecked\n';
          for (const stream of streams) {
            content += `"${stream.name}","${stream.url}","${stream.group_name || ''}","${stream.logo || ''}",${stream.is_valid},${stream.last_checked}\n`;
          }
          filename = 'playlist.csv';
          break;

        default:
          throw new Error(`Unsupported format: ${format}`);
      }

      const filepath = path.join(this.outputDir, filename);
      fs.writeFileSync(filepath, content);

      logger.info(`Exported playlist in ${format} format: ${filepath}`);

      return {
        success: true,
        format,
        filepath,
        streamCount: streams.length,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Error exporting playlist:', error);
      throw error;
    }
  }

  /**
   * Get playlist file size and stats
   * @returns {object} File statistics
   */
  getPlaylistStats() {
    try {
      const stats = {};

      const extPath = path.join(this.outputDir, this.extplaylistName);
      const simplePath = path.join(this.outputDir, this.playlistName);

      if (fs.existsSync(extPath)) {
        const extStat = fs.statSync(extPath);
        stats.extended = {
          path: extPath,
          size: `${(extStat.size / 1024).toFixed(2)} KB`,
          lastModified: extStat.mtime
        };
      }

      if (fs.existsSync(simplePath)) {
        const simpleStat = fs.statSync(simplePath);
        stats.simple = {
          path: simplePath,
          size: `${(simpleStat.size / 1024).toFixed(2)} KB`,
          lastModified: simpleStat.mtime
        };
      }

      return stats;
    } catch (error) {
      logger.error('Error getting playlist stats:', error);
      return null;
    }
  }
}

export default PlaylistGenerator;
