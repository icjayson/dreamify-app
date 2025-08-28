# Animato Data Analytics Platform

A full-stack analytics platform for data processing, visualization, and insights generation.

## Project Structure

```
animato-data/
├── frontend/          # React + TypeScript + Vite frontend
├── backend/           # Python + Flask backend
├── docs/              # Project documentation
├── scripts/           # Utility scripts
└── shared/            # Shared types and utilities
```

## Features

- **Data Processing**: Upload and process CSV/Excel files
- **Analytics Dashboard**: Interactive charts and metrics
- **Real-time Chat**: AI-powered data analysis interface
- **Geographic Visualization**: Location-based data insights
- **Revenue Analytics**: Financial data processing and visualization

## Tech Stack

### Frontend
- React 18 with TypeScript
- Vite for build tooling
- Tailwind CSS for styling
- Shadcn/ui for components
- React Query for data fetching
- Recharts for data visualization

### Backend
- Python 3.8+
- Flask web framework
- Pandas for data processing
- NumPy for numerical operations
- Pytest for testing

## Quick Start

### Prerequisites
- Node.js 18+ and npm/yarn
- Python 3.8+
- Git

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd animato-data
   ```

2. **Setup Frontend**
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

3. **Setup Backend**
   ```bash
   cd backend
   pip install -r requirements.txt
   python -m flask run
   ```

4. **Environment Configuration**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

## Development

### Frontend Development
```bash
cd frontend
npm run dev          # Start development server
npm run build        # Build for production
npm run lint         # Run ESLint
```

### Backend Development
```bash
cd backend
python -m flask run  # Start development server
pytest               # Run tests
black .              # Format code
```

## Project Architecture

### Frontend Architecture
- **Components**: Modular, reusable UI components
- **Pages**: Route-based page components
- **Services**: API communication layer
- **Hooks**: Custom React hooks
- **Context**: Global state management
- **Types**: TypeScript type definitions

### Backend Architecture
- **API Routes**: RESTful endpoints
- **Core**: Business logic and analytics
- **Models**: Data models and schemas
- **Services**: Service layer for business operations
- **Utils**: Utility functions and helpers
- **Config**: Application configuration

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## License

This project is licensed under the MIT License.
