# Autonomous IPTV System

A fully autonomous, self-healing IPTV ecosystem with intelligent stream validation, automatic playlist generation, EPG integration, and intelligent source discovery.

## Features

- **Autonomous Source Discovery**: Automatically crawls and discovers IPTV sources
- **Stream Validation**: Intelligent validation of streaming sources with health monitoring
- **Playlist Generation**: Auto-generates M3U playlists with metadata
- **EPG Integration**: Automatic EPG (Electronic Program Guide) generation and updates
- **Self-Healing**: Automatic recovery from failures and source degradation
- **RESTful API**: Complete API for managing streams and playlists
- **Database Persistence**: SQLite backend for reliable data storage
- **Concurrent Processing**: Optimized parallel processing for validation and crawling
- **Logging & Monitoring**: Comprehensive logging with Winston

## Quick Start

### Prerequisites

- Node.js >= 18.0.0
- npm or yarn

### Installation

```bash
git clone https://github.com/FastSayj/autonomous-iptv-system.git
cd autonomous-iptv-system
npm install
cp .env.example .env
```

### Configuration

Edit `.env` file with your settings:

```env
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
DB_PATH=./data/iptv.db
```

### Running

```bash
# Start the system
npm start

# Development mode
npm run dev

# Validate streams
npm run validate

# Crawl sources
npm run crawl

# Generate EPG
npm run generate-epg

# Full update cycle
npm run update-all
```

## Project Structure

```
├── index.js                 # Main entry point
├── config/                  # Configuration files
├── sources/                 # Source discovery modules
├── validators/              # Stream validation logic
├── epg/                     # EPG generation
├── api/                     # REST API routes
├── utils/                   # Utility functions
├── db/                      # Database schemas and migrations
├── tests/                   # Test files
├── data/                    # Generated data (playlists, EPG)
└── logs/                    # Application logs
```

## API Endpoints

- `GET /api/streams` - List all streams
- `GET /api/streams/:id` - Get stream details
- `GET /api/streams/validate` - Validate all streams
- `GET /api/playlist` - Download M3U playlist
- `GET /api/epg` - Download EPG XML
- `POST /api/sources` - Add new source
- `GET /api/health` - System health status

## Database Schema

The system uses SQLite with the following main tables:

- `streams` - Stream entries
- `sources` - Source URLs
- `channels` - Channel information
- `epg_data` - EPG program data
- `validation_history` - Stream validation records

## Contributing

Contributions are welcome! Please submit pull requests or open issues for bugs and feature requests.

## License

MIT
