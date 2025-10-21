# Dreamify Backend

A FastAPI-based backend for the AI-powered dashboard platform.

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
   # FastAPI (recommended)
   python -m app.main
   
   # Or using uvicorn directly
   uvicorn app.main:app --host 0.0.0.0 --port 5000 --reload
   
   # Or using the startup script
   python start.py
   ```

The server will start on `http://localhost:5000`

## 📁 Project Structure

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI app
│   ├── api/
│   │   ├── __init__.py
│   │   ├── routes.py        # FastAPI routes
│   │   └── routes/
│   │       ├── stripe.py    # FastAPI Stripe routes
│   │       ├── dashboard.py # FastAPI dashboard routes
│   │       ├── files.py     # FastAPI files routes
│   │       └── analyze.py   # FastAPI analyze routes
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
├── start.py                # Startup script
├── .gitignore              # Git ignore rules
└── README.md               # This file
```

## 🔧 Configuration

### Environment Variables

Copy `env.example` to `.env` and configure the following variables:

- `FASTAPI_SECRET_KEY`: FastAPI secret key
- `FASTAPI_DEBUG`: Enable debug mode (True/False)
- `FASTAPI_PORT`: Server port (default: 5000)
- `CORS_ORIGINS`: Allowed CORS origins

### API Endpoints

- `GET /` - Root endpoint with API information
- `GET /health` - Health check endpoint
- `GET /api/v1/docs` - Interactive API documentation (Swagger UI)
- `GET /api/v1/redoc` - Alternative API documentation (ReDoc)
- `POST /api/v1/analytics/dashboard` - Create analytics dashboard
- `POST /api/v1/analytics/data` - Upload data for analysis
- `GET /api/v1/analytics/insights` - Get analytics insights

## 🧪 Testing

Run tests using pytest:

```bash
# Run all tests
pytest tests/

# Run API tests
pytest tests/test_api.py

# Run with coverage
pytest tests/ --cov=app
```

## 📊 Features

- **File Upload**: Support for CSV, Excel, and JSON files
- **Data Processing**: Automated data analysis and statistics
- **Insights Generation**: AI-powered insights from uploaded data
- **Dashboard Creation**: Generate dashboard configurations
- **RESTful API**: Clean API design with proper error handling
- **Interactive Documentation**: Built-in Swagger UI and ReDoc
- **Type Safety**: Full Pydantic model validation
- **Async Support**: High-performance async/await support

## 🔒 Security

- CORS configuration for frontend integration
- File upload validation and size limits
- Secure filename handling
- Environment-based configuration

## 🚀 Development

### Adding New Endpoints

1. Add route in `app/api/routes.py` or create new router in `app/api/routes/`
2. Implement business logic in `app/core/`
3. Add tests in `tests/`
4. Update Pydantic models in `app/models/` if needed

### Code Style

- Use Black for code formatting
- Follow PEP 8 guidelines
- Add type hints where possible

## 📝 License

This project is part of Dreamify.
