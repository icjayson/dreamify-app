# Vibe Analytics Studio Backend

A Flask-based backend for the AI-powered dashboard platform.

## 🚀 Quick Start

### Prerequisites

- Python 3.8+
- pip

### Installation

1. **Clone the repository and navigate to backend:**
   ```bash
   cd backend
   ```

2. **Create a virtual environment:**
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

4. **Set up environment variables:**
   ```bash
   cp env.example .env
   # Edit .env with your configuration
   ```

5. **Run the application:**
   ```bash
   python app/main.py
   ```

The server will start on `http://localhost:5000`

## 📁 Project Structure

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py              # Main application entry point
│   ├── api/
│   │   ├── __init__.py
│   │   └── routes.py        # API endpoints
│   ├── core/
│   │   ├── __init__.py
│   │   └── analytics.py     # Core business logic
│   ├── models/
│   │   └── __init__.py      # Data models
│   └── utils/
│       ├── __init__.py
│       └── file_handler.py  # File processing utilities
├── config/                  # Configuration files
├── tests/                   # Test files
├── requirements.txt         # Python dependencies
├── env.example             # Environment variables template
├── .gitignore              # Git ignore rules
└── README.md               # This file
```

## 🔧 Configuration

### Environment Variables

Copy `env.example` to `.env` and configure the following variables:

- `SECRET_KEY`: Flask secret key
- `DEBUG`: Enable debug mode (True/False)
- `PORT`: Server port (default: 5000)
- `CORS_ORIGINS`: Allowed CORS origins

### API Endpoints

- `GET /` - Root endpoint with API information
- `GET /health` - Health check endpoint
- `POST /api/v1/analytics/dashboard` - Create analytics dashboard
- `POST /api/v1/analytics/data` - Upload data for analysis
- `GET /api/v1/analytics/insights` - Get analytics insights

## 🧪 Testing

Run tests using pytest:

```bash
pytest tests/
```

## 📊 Features

- **File Upload**: Support for CSV, Excel, and JSON files
- **Data Processing**: Automated data analysis and statistics
- **Insights Generation**: AI-powered insights from uploaded data
- **Dashboard Creation**: Generate dashboard configurations
- **RESTful API**: Clean API design with proper error handling

## 🔒 Security

- CORS configuration for frontend integration
- File upload validation and size limits
- Secure filename handling
- Environment-based configuration

## 🚀 Development

### Adding New Endpoints

1. Add route in `app/api/routes.py`
2. Implement business logic in `app/core/`
3. Add tests in `tests/`

### Code Style

- Use Black for code formatting
- Follow PEP 8 guidelines
- Add type hints where possible

## 📝 License

This project is part of Vibe Analytics Studio.
