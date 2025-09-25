# Morpheus - LLM-Powered CSV Analysis API

Morpheus is a FastAPI-based service that uses LLM agents to analyze CSV files and recommend appropriate chart types for data visualization. The service provides intelligent data analysis without actually creating visualizations - it focuses on understanding your data and suggesting the best ways to visualize it.

## Features

- **Intelligent CSV Analysis**: Uses LLM agents with Python REPL to analyze data structure, types, and patterns
- **Chart Type Recommendations**: Provides detailed recommendations for visualization based on data characteristics
- **Comprehensive Data Insights**: Extracts meaningful insights about data quality, distributions, and relationships
- **RESTful API**: Simple HTTP API for integration with other applications
- **Extensible Architecture**: Modular design with tools, workflows, and knowledge bases

## Quick Start

### 1. Setup

```bash
# Clone the repository (if not already done)
cd morpheus

# Install dependencies
pip install -r requirements.txt

# Configure OpenAI API key in config/config.yaml
# Update the api_key field with your OpenAI API key
```

### 2. Start the Server

```bash
# Make the startup script executable
chmod +x start_server.sh

# Start the server
./start_server.sh
```

The server will start on `http://localhost:8000`

### 3. Test the API

```bash
# Check if server is running
curl http://localhost:8000/health

# Or use the test script
python test_api.py
```

## API Usage

### Analyze CSV File

**Endpoint**: `POST /analyze`

**Request Body**:
```json
{
  "file_path": "sales_data.csv",
  "prompt": "Please analyze this sales data and recommend charts for visualization"
}
```

**Response**:
```json
{
  "status": "success",
  "file_path": "sales_data.csv",
  "chart_recommendations": [
    {
      "chart_type": "line_chart",
      "columns": ["Date", "Sales"],
      "x_axis": "Date",
      "y_axis": "Sales", 
      "confidence": 0.85,
      "reasoning": "Time series data perfect for trend analysis"
    }
  ],
  "insights": [
    {
      "column": "dataset",
      "insight_type": "structure",
      "value": {"total_columns": 3, "total_rows": 17},
      "description": "Dataset structure: 3 columns, 17 rows"
    }
  ],
  "messages_saved_to": "storage/out/analysis_20241224_143022.json"
}
```

### Health Check

**Endpoint**: `GET /health`

**Response**:
```json
{
  "status": "ok",
  "timestamp": "2024-12-24T14:30:22.123456"
}
```

## File Structure

```
morpheus/
├── server.py                          # FastAPI application
├── schemas.py                         # Pydantic models for API
├── requirements.txt                   # Python dependencies
├── start_server.sh                    # Server startup script
├── test_api.py                        # API testing script
├── config/
│   └── config.yaml                    # Configuration file
├── morpheus/
│   ├── knowledge/
│   │   └── charts/
│   │       ├── chart_types.py         # Chart type definitions
│   │       └── base.py
│   ├── models/
│   │   └── base.py
│   ├── tools/
│   │   ├── charts_knowledge/
│   │   │   └── tool.py                # Chart recommendation tool
│   │   └── python_repl/
│   │       └── tool.py                # Python REPL tool
│   └── workflows/
│       └── analyze_csv/
│           ├── workflow.py            # Main analysis workflow
│           └── prompts/
│               ├── analysis_prompts.py # Analysis prompts
│               └── user.py
├── storage/
│   ├── in/                            # Input CSV files
│   │   └── sales_data.csv            # Sample data
│   └── out/                           # Analysis results
└── utils/
    └── config.py                      # Configuration utilities
```

## Available Chart Types

The system can recommend the following chart types:

1. **Bar Chart** - Compare categorical data
2. **Line Chart** - Show trends over time
3. **Scatter Plot** - Analyze correlations
4. **Pie Chart** - Show parts of a whole
5. **Histogram** - Display data distribution
6. **Box Plot** - Statistical summaries
7. **Heatmap** - Show intensity/correlation matrices
8. **Violin Plot** - Distribution shapes
9. **Area Chart** - Cumulative trends
10. **Bubble Chart** - Multi-dimensional relationships

Each chart type includes:
- Detailed requirements (column types, data constraints)
- Suitable use cases
- Optimal data size recommendations
- Configuration metadata

## Usage Examples

### 1. Sales Data Analysis

```bash
curl -X POST http://localhost:8000/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "file_path": "sales_data.csv",
    "prompt": "Analyze sales trends and recommend visualizations"
  }'
```

### 2. Customer Data Analysis

```bash
curl -X POST http://localhost:8000/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "file_path": "customer_data.csv", 
    "prompt": "Focus on demographic analysis and customer segmentation"
  }'
```

## Configuration

Edit `config/config.yaml`:

```yaml
openai:
  api_key: "your-openai-api-key-here"
  agent:
    - name: multi_purpose
      model: gpt-4o-mini  # or gpt-4, gpt-3.5-turbo
      temperature: 0.2
```

## Architecture

### Workflow Process

1. **Data Loading & Analysis**: Python REPL loads CSV file and analyzes columns, types, distributions, and relationships
2. **Chart Knowledge**: Available chart types and requirements are retrieved
3. **Recommendation**: LLM recommends suitable charts based on data characteristics
4. **Results**: Analysis results are formatted and saved

### Tools

- **Python REPL Tool**: Executes Python code for CSV loading and data analysis
- **Charts Knowledge Tool**: Provides chart type information and recommendations

### Knowledge Base

- **Chart Types**: Comprehensive definitions of visualization types
- **Data Requirements**: Column type and size requirements for each chart
- **Use Cases**: When to use each chart type

## Development

### Running Tests

```bash
# Test the workflow directly
python test_workflow.py

# Test the API endpoints
python test_api.py
```

### Adding New Chart Types

1. Add chart definition to `morpheus/knowledge/charts/chart_types.py`
2. Update recommendation logic in `morpheus/tools/charts_knowledge/tool.py`
3. Test with sample data

### Adding New Analysis Tools

1. Create tool in `morpheus/tools/your_tool/tool.py`
2. Register tool in workflow
3. Add any required prompts

## Troubleshooting

### Common Issues

1. **OpenAI API Key**: Make sure your API key is set in `config/config.yaml`
2. **File Not Found**: Ensure CSV files are placed in `storage/in/` directory
3. **Dependencies**: Install all requirements with `pip install -r requirements.txt`
4. **Port Conflicts**: Change port in `start_server.sh` if 8000 is occupied

### Logs

Check console output for workflow execution details and any errors.

## API Response Details

### Chart Recommendation Object
```json
{
  "chart_type": "line_chart",           # Chart type identifier
  "columns": ["Date", "Sales"],         # Recommended columns
  "x_axis": "Date",                     # X-axis column (if applicable)
  "y_axis": "Sales",                    # Y-axis column (if applicable)
  "color": null,                        # Color grouping column (if applicable)
  "size": null,                         # Size column for bubble charts (if applicable)
  "metadata": {},                       # Additional configuration
  "confidence": 0.85,                   # Confidence score (0-1)
  "reasoning": "Perfect for trend analysis" # Why this chart was recommended
}
```

### Data Insight Object
```json
{
  "column": "Sales",                    # Column name or "dataset"
  "insight_type": "statistics",         # Type of insight
  "value": {"mean": 1000, "max": 1800}, # Insight value
  "description": "Sales range from 400 to 1800" # Human-readable description
}
```

## License

This project is for educational and development purposes. Make sure to comply with OpenAI's usage policies when using their API.