-- PostgreSQL Schema for Autonomous IPTV System
-- Production-ready database design

-- Drop existing tables if they exist (for fresh setup)
DROP TABLE IF EXISTS stream_history CASCADE;
DROP TABLE IF EXISTS stream_health CASCADE;
DROP TABLE IF EXISTS backup_streams CASCADE;
DROP TABLE IF EXISTS epg_links CASCADE;
DROP TABLE IF EXISTS streams CASCADE;
DROP TABLE IF EXISTS channels CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS countries CASCADE;
DROP TABLE IF EXISTS languages CASCADE;
DROP TABLE IF EXISTS cdn_performance CASCADE;
DROP TABLE IF EXISTS validation_queue CASCADE;

-- Languages table
CREATE TABLE languages (
  id SERIAL PRIMARY KEY,
  code VARCHAR(5) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Countries table
CREATE TABLE countries (
  id SERIAL PRIMARY KEY,
  code VARCHAR(2) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  region VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Categories table
CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  icon_url VARCHAR(500),
  priority INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Channels table (Main channel metadata)
CREATE TABLE channels (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  logo_url VARCHAR(500),
  epg_id VARCHAR(100),
  category_id INT REFERENCES categories(id),
  country_id INT REFERENCES countries(id),
  language_id INT REFERENCES languages(id),
  is_active BOOLEAN DEFAULT true,
  priority INT DEFAULT 0,
  last_verified TIMESTAMP,
  verification_count INT DEFAULT 0,
  ai_reliability_score FLOAT DEFAULT 50.0,
  ai_quality_score FLOAT DEFAULT 50.0,
  ai_stability_score FLOAT DEFAULT 50.0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_channels_active (is_active),
  INDEX idx_channels_category (category_id),
  INDEX idx_channels_country (country_id),
  INDEX idx_channels_scores (ai_reliability_score, ai_quality_score)
);

-- Streams table (Individual stream URLs and variants)
CREATE TABLE streams (
  id SERIAL PRIMARY KEY,
  channel_id INT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  url VARCHAR(1000) NOT NULL,
  stream_type VARCHAR(50), -- 'hls', 'dash', 'http', 'udp', 'rtmp', 'ts', 'm3u8'
  protocol VARCHAR(20), -- 'http', 'https', 'udp', 'rtmp'
  bitrate INT, -- in kbps
  resolution VARCHAR(20), -- '1080p', '720p', etc.
  codec_video VARCHAR(100),
  codec_audio VARCHAR(100),
  fps INT,
  country_id INT REFERENCES countries(id),
  cdn_provider VARCHAR(100),
  source_url VARCHAR(1000), -- Where this stream was discovered
  is_active BOOLEAN DEFAULT true,
  status VARCHAR(20) DEFAULT 'untested', -- 'online', 'unstable', 'dead', 'untested'
  last_checked TIMESTAMP,
  last_successful_check TIMESTAMP,
  
  -- Performance metrics
  response_time_ms INT,
  latency_ms INT,
  buffering_count INT DEFAULT 0,
  black_screen_detected BOOLEAN DEFAULT false,
  frozen_frame_detected BOOLEAN DEFAULT false,
  quality_score FLOAT DEFAULT 50.0,
  reliability_score FLOAT DEFAULT 50.0,
  stability_score FLOAT DEFAULT 50.0,
  uptime_percentage FLOAT DEFAULT 0.0,
  
  -- Check counters
  check_count INT DEFAULT 0,
  success_count INT DEFAULT 0,
  fail_count INT DEFAULT 0,
  consecutive_failures INT DEFAULT 0,
  
  -- AI fields
  ai_score FLOAT DEFAULT 50.0,
  ai_predicted_failure BOOLEAN DEFAULT false,
  ai_last_trained TIMESTAMP,
  
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_streams_active (is_active),
  INDEX idx_streams_channel (channel_id),
  INDEX idx_streams_status (status),
  INDEX idx_streams_cdn (cdn_provider),
  INDEX idx_streams_scores (ai_score, reliability_score, quality_score),
  INDEX idx_streams_checked (last_checked),
  UNIQUE (url, channel_id)
);

-- Stream health table (Real-time health tracking)
CREATE TABLE stream_health (
  id SERIAL PRIMARY KEY,
  stream_id INT NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  
  -- Current state
  is_healthy BOOLEAN DEFAULT true,
  consecutive_healthy_checks INT DEFAULT 0,
  consecutive_failed_checks INT DEFAULT 0,
  
  -- Latest metrics
  latest_response_time_ms INT,
  latest_latency_ms INT,
  latest_bitrate INT,
  latest_fps INT,
  
  -- Health assessment
  health_check_interval_seconds INT DEFAULT 300,
  last_health_check TIMESTAMP,
  next_scheduled_check TIMESTAMP,
  
  -- Performance degradation tracking
  is_degraded BOOLEAN DEFAULT false,
  degradation_reason VARCHAR(500),
  degradation_start TIMESTAMP,
  
  -- AI monitoring
  anomaly_detected BOOLEAN DEFAULT false,
  anomaly_type VARCHAR(100),
  
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_health_stream (stream_id),
  INDEX idx_health_status (is_healthy),
  INDEX idx_health_next_check (next_scheduled_check)
);

-- Backup streams table (Automatic fallback streams)
CREATE TABLE backup_streams (
  id SERIAL PRIMARY KEY,
  primary_stream_id INT NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  backup_stream_id INT NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  priority INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  
  -- Activation tracking
  was_activated BOOLEAN DEFAULT false,
  activation_count INT DEFAULT 0,
  last_activated TIMESTAMP,
  
  -- Performance comparison
  quality_difference FLOAT DEFAULT 0,
  reliability_difference FLOAT DEFAULT 0,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_backup_primary (primary_stream_id),
  INDEX idx_backup_backup (backup_stream_id),
  
  CONSTRAINT check_different_streams CHECK (primary_stream_id != backup_stream_id)
);

-- EPG links table
CREATE TABLE epg_links (
  id SERIAL PRIMARY KEY,
  channel_id INT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  epg_url VARCHAR(1000) NOT NULL,
  epg_id VARCHAR(100),
  source_name VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  last_updated TIMESTAMP,
  program_count INT DEFAULT 0,
  validity_check_interval_hours INT DEFAULT 6,
  is_valid BOOLEAN DEFAULT true,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_epg_channel (channel_id),
  INDEX idx_epg_active (is_active)
);

-- Stream history table (For analytics and AI training)
CREATE TABLE stream_history (
  id SERIAL PRIMARY KEY,
  stream_id INT NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  channel_id INT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  
  -- Check details
  check_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_successful BOOLEAN,
  
  -- Metrics at check time
  response_time_ms INT,
  latency_ms INT,
  bitrate INT,
  fps INT,
  
  -- Quality assessment
  quality_issues TEXT[], -- Array of issues detected
  black_screen BOOLEAN DEFAULT false,
  frozen_frame BOOLEAN DEFAULT false,
  buffering BOOLEAN DEFAULT false,
  
  -- Error details
  error_message VARCHAR(500),
  error_code VARCHAR(50),
  
  -- AI analysis at time of check
  ai_score FLOAT,
  ai_assessment VARCHAR(500),
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_history_stream (stream_id),
  INDEX idx_history_channel (channel_id),
  INDEX idx_history_timestamp (check_timestamp),
  INDEX idx_history_successful (is_successful)
);

-- CDN performance tracking
CREATE TABLE cdn_performance (
  id SERIAL PRIMARY KEY,
  cdn_provider VARCHAR(100) NOT NULL,
  country_id INT REFERENCES countries(id),
  
  -- Aggregated metrics
  avg_response_time_ms FLOAT,
  avg_latency_ms FLOAT,
  avg_bitrate INT,
  uptime_percentage FLOAT,
  
  -- Reliability
  total_checks INT DEFAULT 0,
  successful_checks INT DEFAULT 0,
  failed_checks INT DEFAULT 0,
  
  -- AI scoring
  ai_reliability_score FLOAT DEFAULT 50.0,
  ai_quality_score FLOAT DEFAULT 50.0,
  
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_cdn_provider (cdn_provider),
  INDEX idx_cdn_country (country_id)
);

-- Validation queue (For processing jobs)
CREATE TABLE validation_queue (
  id SERIAL PRIMARY KEY,
  stream_id INT REFERENCES streams(id) ON DELETE CASCADE,
  job_id VARCHAR(255),
  queue_name VARCHAR(100),
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  priority INT DEFAULT 0,
  
  retry_count INT DEFAULT 0,
  max_retries INT DEFAULT 3,
  
  error_message TEXT,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  
  INDEX idx_queue_status (status),
  INDEX idx_queue_stream (stream_id),
  INDEX idx_queue_priority (priority)
);

-- Create indexes for performance
CREATE INDEX idx_channels_updated ON channels(updated_at);
CREATE INDEX idx_streams_updated ON streams(updated_at);
CREATE INDEX idx_streams_consecutive_failures ON streams(consecutive_failures);
CREATE INDEX idx_stream_health_updated ON stream_health(updated_at);

-- Create views for common queries
CREATE VIEW active_channels AS
SELECT c.*, COUNT(s.id) as stream_count, AVG(s.ai_score) as avg_stream_score
FROM channels c
LEFT JOIN streams s ON c.id = s.channel_id AND s.is_active = true
WHERE c.is_active = true
GROUP BY c.id;

CREATE VIEW healthy_streams AS
SELECT s.*, c.name as channel_name, cat.name as category_name
FROM streams s
JOIN channels c ON s.channel_id = c.id
JOIN categories cat ON c.category_id = cat.id
WHERE s.is_active = true AND s.status IN ('online', 'unstable');

CREATE VIEW stream_performance_ranking AS
SELECT 
  s.id,
  c.name as channel_name,
  s.url,
  s.status,
  s.ai_score,
  s.reliability_score,
  s.quality_score,
  s.stability_score,
  RANK() OVER (PARTITION BY s.channel_id ORDER BY s.ai_score DESC) as channel_rank,
  RANK() OVER (ORDER BY s.ai_score DESC) as global_rank
FROM streams s
JOIN channels c ON s.channel_id = c.id
WHERE s.is_active = true;

-- Stored procedures for common operations
CREATE OR REPLACE FUNCTION update_stream_scores(
  p_stream_id INT,
  p_quality_score FLOAT,
  p_reliability_score FLOAT,
  p_stability_score FLOAT
) RETURNS void AS $$
BEGIN
  UPDATE streams SET
    quality_score = p_quality_score,
    reliability_score = p_reliability_score,
    stability_score = p_stability_score,
    ai_score = (p_quality_score * 0.3 + p_reliability_score * 0.4 + p_stability_score * 0.3),
    updated_at = CURRENT_TIMESTAMP
  WHERE id = p_stream_id;
  
  INSERT INTO stream_history (stream_id, channel_id, ai_score, is_successful, check_timestamp)
  SELECT id, channel_id, ai_score, true, CURRENT_TIMESTAMP
  FROM streams WHERE id = p_stream_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_best_stream_for_channel(p_channel_id INT)
RETURNS TABLE(stream_id INT, url VARCHAR, ai_score FLOAT, status VARCHAR) AS $$
BEGIN
  RETURN QUERY
  SELECT s.id, s.url, s.ai_score, s.status
  FROM streams s
  WHERE s.channel_id = p_channel_id AND s.is_active = true
  ORDER BY s.ai_score DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Insert sample data for categories and languages
INSERT INTO categories (name, description, priority) VALUES
('Movies', 'Movie channels and films', 10),
('Sports', 'Live sports and sports news', 20),
('News', 'News channels', 15),
('Entertainment', 'Entertainment and variety', 10),
('Music', 'Music channels', 5),
('Documentary', 'Documentary channels', 5),
('Kids', 'Children content', 8),
('Adult', 'Adult content', 3)
ON CONFLICT DO NOTHING;

INSERT INTO languages (code, name) VALUES
('en', 'English'),
('es', 'Spanish'),
('fr', 'French'),
('de', 'German'),
('pt', 'Portuguese'),
('ru', 'Russian'),
('ar', 'Arabic'),
('zh', 'Chinese'),
('ja', 'Japanese'),
('hi', 'Hindi')
ON CONFLICT DO NOTHING;

INSERT INTO countries (code, name, region) VALUES
('US', 'United States', 'North America'),
('GB', 'United Kingdom', 'Europe'),
('CA', 'Canada', 'North America'),
('AU', 'Australia', 'Asia-Pacific'),
('IN', 'India', 'Asia'),
('BR', 'Brazil', 'South America'),
('MX', 'Mexico', 'North America'),
('FR', 'France', 'Europe'),
('DE', 'Germany', 'Europe'),
('ES', 'Spain', 'Europe'),
('RU', 'Russia', 'Europe/Asia'),
('CN', 'China', 'Asia'),
('JP', 'Japan', 'Asia'),
('KR', 'South Korea', 'Asia')
ON CONFLICT DO NOTHING;
