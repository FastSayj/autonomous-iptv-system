import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Logger from './utils/logger.js';
import DatabaseManager from './db/databaseManager.js';
import StreamValidator from './validators/streamChecker.js';
import SourceCrawler from './sources/sourceCrawler.js';
import PlaylistGenerator from './playlist/playlistGenerator.js';
import EPGGenerator from './epg/epgGenerator.js';
import { startAPI } from './api/server.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = Logger.getInstance();

class AutonomousIPTVSystem {
  constructor() {
    this.db = null;
    this.validator = null;
    this.crawler = null;
    this.playlistGenerator = null;
    this.epgGenerator = null;
    this.isRunning = false;
  }

  async initialize() {
    try {
      logger.info('Initializing Autonomous IPTV System...');

      // Initialize database
      this.db = new DatabaseManager();
      await this.db.initialize();
      logger.info('Database initialized successfully');

      // Initialize components
      this.validator = new StreamValidator(this.db);
      this.crawler = new SourceCrawler(this.db);
      this.playlistGenerator = new PlaylistGenerator(this.db);
      this.epgGenerator = new EPGGenerator(this.db);

      logger.info('All components initialized successfully');
      this.isRunning = true;
    } catch (error) {
      logger.error('Failed to initialize system:', error);
      process.exit(1);
    }
  }

  async start() {
    try {
      await this.initialize();

      // Start API server
      const port = process.env.PORT || 3000;
      await startAPI(this.db, this.validator, this.playlistGenerator, this.epgGenerator);
      logger.info(`API server started on port ${port}`);

      // Start background tasks
      this.startBackgroundTasks();

      logger.info('Autonomous IPTV System started successfully');
    } catch (error) {
      logger.error('Failed to start system:', error);
      process.exit(1);
    }
  }

  startBackgroundTasks() {
    const sourceUpdateInterval = parseInt(process.env.SOURCE_UPDATE_INTERVAL || '3600000');
    const validationInterval = parseInt(process.env.STREAM_CHECK_INTERVAL || '1800000');
    const epgUpdateInterval = parseInt(process.env.EPG_UPDATE_INTERVAL || '86400000');
    const playlistUpdateInterval = parseInt(process.env.PLAYLIST_UPDATE_INTERVAL || '1800000');

    // Source discovery task
    setInterval(async () => {
      try {
        logger.info('Starting scheduled source discovery...');
        await this.crawler.crawlSources();
        logger.info('Source discovery completed');
      } catch (error) {
        logger.error('Source discovery failed:', error);
      }
    }, sourceUpdateInterval);

    // Stream validation task
    setInterval(async () => {
      try {
        logger.info('Starting scheduled stream validation...');
        await this.validator.validateAllStreams();
        logger.info('Stream validation completed');
      } catch (error) {
        logger.error('Stream validation failed:', error);
      }
    }, validationInterval);

    // EPG generation task
    setInterval(async () => {
      try {
        logger.info('Starting scheduled EPG generation...');
        await this.epgGenerator.generateEPG();
        logger.info('EPG generation completed');
      } catch (error) {
        logger.error('EPG generation failed:', error);
      }
    }, epgUpdateInterval);

    // Playlist generation task
    setInterval(async () => {
      try {
        logger.info('Starting scheduled playlist generation...');
        await this.playlistGenerator.generatePlaylist();
        logger.info('Playlist generation completed');
      } catch (error) {
        logger.error('Playlist generation failed:', error);
      }
    }, playlistUpdateInterval);

    logger.info('Background tasks scheduled');
  }

  async shutdown() {
    try {
      logger.info('Shutting down system...');
      this.isRunning = false;

      if (this.db) {
        await this.db.close();
      }

      logger.info('System shutdown complete');
    } catch (error) {
      logger.error('Error during shutdown:', error);
    }
  }
}

// Main execution
const system = new AutonomousIPTVSystem();

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  await system.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  await system.shutdown();
  process.exit(0);
});

if (import.meta.url === `file://${process.argv[1]}`) {
  system.start().catch((error) => {
    logger.error('Fatal error:', error);
    process.exit(1);
  });
}

export default AutonomousIPTVSystem;
