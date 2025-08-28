"""
Core analytics service for Vibe Analytics Studio.
"""

import pandas as pd
import numpy as np
import chardet
import regex as re
from datetime import datetime
from dateutil import parser
from typing import Dict, List, Any, Optional
import io
import time
import os

# Configuration constants
ENCODINGS_TO_TRY = ['utf-8', 'latin-1', 'iso-8859-1', 'cp1252']
SEPARATORS_TO_TRY = [',', ';', '\t', '|', '|']
DATE_FORMATS = [
    '%Y-%m-%d', '%m/%d/%Y', '%d/%m/%Y',
    '%B %d, %Y', '%b %d, %Y',
    '%d-%m-%Y', '%Y/%m/%d',
    '%m-%d-%Y', '%d/%m/%y'
]
BUSINESS_KEYWORDS = {
    'revenue': ['revenue', 'sales', 'income', 'amount', 'price', 'total'],
    'customers': ['customer', 'user', 'client', 'account', 'member'],
    'dates': ['date', 'time', 'created', 'updated', 'timestamp'],
    'products': ['product', 'item', 'sku', 'category', 'type']
}

class CSVProcessor:
    """Advanced CSV processor for handling real-world messy data."""
    
    def __init__(self):
        self.data_cache = {}
        self.processing_stats = {}
    
    def process_upload(self, file_content: bytes, filename: str) -> Dict[str, Any]:
        """
        Main entry point for processing uploaded files.
        
        Returns:
        {
            'success': bool,
            'data': pd.DataFrame,
            'metadata': {
                'encoding': str,
                'separator': str,
                'rows_processed': int,
                'columns_processed': int,
                'cleaning_applied': List[str],
                'processing_time': float
            },
            'column_analysis': Dict[str, Dict],
            'data_quality': Dict[str, Any],
            'visualization_suggestions': List[Dict],
            'business_insights': List[Dict],
            'errors': List[str],
            'warnings': List[str]
        }
        """
        start_time = time.time()
        errors = []
        warnings = []
        
        try:
            # Smart file reading
            df = self._smart_read_file(file_content, filename)
            
            # Clean and normalize data
            df = self._clean_and_normalize(df)
            
            # Analyze columns
            column_analysis = self._analyze_columns(df)
            
            # Detect business metrics
            business_metrics = self._detect_business_metrics(column_analysis)
            
            # Suggest visualizations
            visualization_suggestions = self._suggest_visualizations(column_analysis, business_metrics)
            
            # Assess data quality
            data_quality = self._assess_data_quality(df, column_analysis)
            
            processing_time = time.time() - start_time
            
            return {
                'success': True,
                'data': df,
                'metadata': {
                    'encoding': self.processing_stats.get('encoding', 'unknown'),
                    'separator': self.processing_stats.get('separator', 'unknown'),
                    'rows_processed': len(df),
                    'columns_processed': len(df.columns),
                    'cleaning_applied': self.processing_stats.get('cleaning_applied', []),
                    'processing_time': processing_time
                },
                'column_analysis': column_analysis,
                'data_quality': data_quality,
                'visualization_suggestions': visualization_suggestions,
                'business_insights': business_metrics,
                'errors': errors,
                'warnings': warnings
            }
            
        except Exception as e:
            error_info = self._handle_processing_errors(e, "process_upload")
            return {
                'success': False,
                'data': None,
                'metadata': {},
                'column_analysis': {},
                'data_quality': {},
                'visualization_suggestions': [],
                'business_insights': [],
                'errors': [str(e)],
                'warnings': warnings
            }
    
    def upload_and_process(self, filepath: str) -> Dict[str, Any]:
        """Convenience wrapper: read a file from disk and return a simplified result for tests."""
        if not os.path.isfile(filepath):
            raise FileNotFoundError(f"File not found: {filepath}")
        filename = os.path.basename(filepath)
        with open(filepath, 'rb') as f:
            content = f.read()
        result = self.process_upload(content, filename)
        if not result.get('success'):
            return {
                'data_preview': None,
                'column_analysis': result.get('column_analysis', {}),
                'business_metrics': result.get('business_insights', []),
                'suggested_visualizations': result.get('visualization_suggestions', []),
                'processing_stats': result.get('metadata', {}),
                'errors': result.get('errors', [])
            }
        df: pd.DataFrame = result['data']
        preview = df.head(5).to_dict(orient='records')
        return {
            'data_preview': preview,
            'column_analysis': result['column_analysis'],
            'business_metrics': result['business_insights'],
            'suggested_visualizations': result['visualization_suggestions'],
            'processing_stats': result['metadata']
        }
    
    def _smart_read_file(self, file_content: bytes, filename: str) -> pd.DataFrame:
        """
        Intelligently read file with automatic encoding and separator detection.
        """
        file_extension = filename.split('.')[-1].lower()
        
        if file_extension == 'csv':
            return self._read_csv_smart(file_content)
        elif file_extension in ['xlsx', 'xls']:
            return self._read_excel_smart(file_content)
        elif file_extension == 'json':
            return self._read_json_smart(file_content)
        else:
            raise ValueError(f"Unsupported file type: {file_extension}")
    
    def _read_csv_smart(self, file_content: bytes) -> pd.DataFrame:
        """Smart CSV reading with encoding and separator detection."""
        # Detect encoding
        detected_encoding = chardet.detect(file_content)['encoding']
        encodings_to_try = [detected_encoding] + ENCODINGS_TO_TRY if detected_encoding else ENCODINGS_TO_TRY
        
        for encoding in encodings_to_try:
            try:
                content_str = file_content.decode(encoding)
                self.processing_stats['encoding'] = encoding
                
                # Try different separators
                for separator in SEPARATORS_TO_TRY:
                    try:
                        df = pd.read_csv(io.StringIO(content_str), sep=separator)
                        if len(df.columns) > 1:  # Valid separator found
                            self.processing_stats['separator'] = separator
                            return df
                    except:
                        continue
                        
            except UnicodeDecodeError:
                continue
        
        raise ValueError("Could not read CSV file with any encoding or separator combination")
    
    def _read_excel_smart(self, file_content: bytes) -> pd.DataFrame:
        """Smart Excel reading with sheet detection."""
        try:
            df = pd.read_excel(io.BytesIO(file_content))
            self.processing_stats['encoding'] = 'excel'
            self.processing_stats['separator'] = 'excel'
            return df
        except Exception as e:
            raise ValueError(f"Could not read Excel file: {str(e)}")
    
    def _read_json_smart(self, file_content: bytes) -> pd.DataFrame:
        """Smart JSON reading with normalization."""
        try:
            content_str = file_content.decode('utf-8')
            df = pd.read_json(io.StringIO(content_str))
            self.processing_stats['encoding'] = 'utf-8'
            self.processing_stats['separator'] = 'json'
            return df
        except Exception as e:
            raise ValueError(f"Could not read JSON file: {str(e)}")
    
    def _clean_and_normalize(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Clean and normalize the DataFrame.
        """
        cleaning_applied = []
        
        # Remove completely empty rows and columns
        initial_rows, initial_cols = df.shape
        df = df.dropna(how='all').dropna(axis=1, how='all')
        if df.shape != (initial_rows, initial_cols):
            cleaning_applied.append("removed_empty_rows_columns")
        
        # Clean column names
        df.columns = [self._clean_column_name(col) for col in df.columns]
        cleaning_applied.append("cleaned_column_names")
        
        # Convert string numbers to numeric
        for col in df.columns:
            if df[col].dtype == 'object':
                df[col] = self._convert_string_numbers(df[col])
        
        # Remove duplicate rows
        initial_rows = len(df)
        df = df.drop_duplicates()
        if len(df) < initial_rows:
            cleaning_applied.append("removed_duplicate_rows")
        
        # Handle missing values
        df = self._handle_missing_values(df)
        cleaning_applied.append("handled_missing_values")
        
        self.processing_stats['cleaning_applied'] = cleaning_applied
        return df
    
    def _clean_column_name(self, col_name: str) -> str:
        """Clean column name by converting to lowercase and replacing spaces with underscores."""
        if not isinstance(col_name, str):
            col_name = str(col_name)
        return re.sub(r'[^a-zA-Z0-9_]', '_', col_name.lower().replace(' ', '_'))
    
    def _convert_string_numbers(self, series: pd.Series) -> pd.Series:
        """Convert string numbers to numeric, handling currency and percentage symbols."""
        # Remove currency symbols and commas
        cleaned = series.astype(str).str.replace(r'[\$,]', '', regex=True)
        # Remove percentage symbols and convert to decimal
        cleaned = cleaned.str.replace(r'%$', '', regex=True)
        
        # Try to convert to numeric
        try:
            numeric_series = pd.to_numeric(cleaned, errors='coerce')
            if numeric_series.notna().sum() > len(series) * 0.5:  # More than 50% converted
                return numeric_series
        except:
            pass
        
        return series
    
    def _handle_missing_values(self, df: pd.DataFrame) -> pd.DataFrame:
        """Handle missing values intelligently based on column type."""
        for col in df.columns:
            if df[col].isnull().sum() > 0:
                if df[col].dtype in ['int64', 'float64']:
                    # Fill numeric columns with median
                    df[col] = df[col].fillna(df[col].median())
                elif df[col].dtype == 'object':
                    # Fill categorical columns with mode
                    mode_value = df[col].mode()
                    if len(mode_value) > 0:
                        df[col] = df[col].fillna(mode_value[0])
        
        return df
    
    def _analyze_columns(self, df: pd.DataFrame) -> Dict[str, Dict]:
        """
        Analyze each column for type, statistics, and business context.
        """
        column_analysis = {}
        
        for col in df.columns:
            col_data = df[col].dropna()
            
            # Determine column type
            col_type = self._determine_column_type(col_data, col)
            
            # Calculate statistics
            stats = self._calculate_column_statistics(col_data, col_type)
            
            # Detect business context
            business_context = self._detect_business_context(col)
            
            # Calculate data quality score
            quality_score = self._calculate_quality_score(col_data, df[col])
            
            column_analysis[col] = {
                'type': col_type,
                'cardinality': len(col_data.unique()),
                'missing_count': df[col].isnull().sum(),
                'missing_percentage': (df[col].isnull().sum() / len(df)) * 100,
                'unique_values': len(col_data.unique()),
                'statistics': stats,
                'business_context': business_context,
                'data_quality_score': quality_score,
                'suggested_actions': self._suggest_column_actions(col_data, col_type, quality_score)
            }
        
        return column_analysis
    
    def _determine_column_type(self, col_data: pd.Series, col_name: str) -> str:
        """Determine the most appropriate column type."""
        if col_data.empty:
            return 'unknown'
        
        # Check if it's numeric
        if pd.api.types.is_numeric_dtype(col_data):
            return 'numeric'
        
        # Check if it's boolean
        if col_data.dtype == 'bool' or set(col_data.unique()).issubset({'True', 'False', True, False, 1, 0}):
            return 'boolean'
        
        # Check if it's date
        if self._is_date_column(col_data):
            return 'date'
        
        # Check if it's categorical (low cardinality)
        unique_ratio = len(col_data.unique()) / len(col_data)
        if unique_ratio < 0.1:  # Less than 10% unique values
            return 'categorical'
        
        return 'text'
    
    def _is_date_column(self, col_data: pd.Series) -> bool:
        """Check if column contains date data."""
        sample_data = col_data.head(100)  # Check first 100 values
        
        for value in sample_data:
            if pd.isna(value):
                continue
            try:
                parser.parse(str(value))
                return True
            except:
                continue
        
        return False
    
    def _calculate_column_statistics(self, col_data: pd.Series, col_type: str) -> Dict:
        """Calculate type-specific statistics for a column."""
        stats = {}
        
        if col_type == 'numeric':
            stats = {
                'mean': float(col_data.mean()) if len(col_data) > 0 else None,
                'median': float(col_data.median()) if len(col_data) > 0 else None,
                'std': float(col_data.std()) if len(col_data) > 0 else None,
                'min': float(col_data.min()) if len(col_data) > 0 else None,
                'max': float(col_data.max()) if len(col_data) > 0 else None,
                'q25': float(col_data.quantile(0.25)) if len(col_data) > 0 else None,
                'q75': float(col_data.quantile(0.75)) if len(col_data) > 0 else None
            }
        elif col_type == 'categorical':
            value_counts = col_data.value_counts()
            stats = {
                'top_values': value_counts.head(5).to_dict(),
                'value_counts': value_counts.to_dict()
            }
        elif col_type == 'date':
            try:
                date_data = pd.to_datetime(col_data)
                stats = {
                    'min_date': str(date_data.min()) if len(date_data) > 0 else None,
                    'max_date': str(date_data.max()) if len(date_data) > 0 else None,
                    'date_range_days': (date_data.max() - date_data.min()).days if len(date_data) > 1 else None
                }
            except:
                stats = {'error': 'Could not parse dates'}
        
        return stats
    
    def _detect_business_context(self, col_name: str) -> str:
        """Detect business context based on column name."""
        col_lower = col_name.lower()
        
        for context, keywords in BUSINESS_KEYWORDS.items():
            if any(keyword in col_lower for keyword in keywords):
                return context
        
        return 'unknown'
    
    def _calculate_quality_score(self, col_data: pd.Series, original_col: pd.Series) -> float:
        """Calculate data quality score (0-1) for a column."""
        if len(original_col) == 0:
            return 0.0
        
        # Completeness score
        completeness = len(col_data) / len(original_col)
        
        # Consistency score (for numeric columns)
        consistency = 1.0
        if pd.api.types.is_numeric_dtype(col_data):
            if len(col_data) > 0:
                # Check for outliers (values beyond 3 standard deviations)
                mean_val = col_data.mean()
                std_val = col_data.std()
                if std_val > 0:
                    outliers = ((col_data < mean_val - 3*std_val) | (col_data > mean_val + 3*std_val)).sum()
                    consistency = 1 - (outliers / len(col_data))
        
        # Overall quality score
        quality_score = (completeness + consistency) / 2
        return round(quality_score, 3)
    
    def _suggest_column_actions(self, col_data: pd.Series, col_type: str, quality_score: float) -> List[str]:
        """Suggest actions for improving column data quality."""
        actions = []
        
        if quality_score < 0.7:
            actions.append("Review data quality issues")
        
        if col_type == 'numeric' and len(col_data) > 0:
            if col_data.std() == 0:
                actions.append("Column has no variance - consider removing")
        
        if col_type == 'categorical' and len(col_data.unique()) > 50:
            actions.append("High cardinality categorical - consider grouping")
        
        return actions
    
    def _detect_business_metrics(self, column_info: Dict) -> List[Dict]:
        """
        Detect potential business metrics and KPIs.
        """
        business_metrics = []
        
        for col_name, info in column_info.items():
            context = info['business_context']
            if context != 'unknown':
                business_metrics.append({
                    'column': col_name,
                    'type': context,
                    'confidence': 0.8,
                    'description': f"Detected {context} metric in column '{col_name}'"
                })
        
        return business_metrics
    
    def _suggest_visualizations(self, column_info: Dict, business_metrics: List) -> List[Dict]:
        """
        Generate AI-powered visualization suggestions.
        """
        suggestions = []
        
        # Get column types
        numeric_cols = [col for col, info in column_info.items() if info['type'] == 'numeric']
        categorical_cols = [col for col, info in column_info.items() if info['type'] == 'categorical']
        date_cols = [col for col, info in column_info.items() if info['type'] == 'date']
        
        # Time series charts
        if date_cols and numeric_cols:
            for date_col in date_cols:
                for num_col in numeric_cols:
                    suggestions.append({
                        'type': 'line_chart',
                        'title': f'{num_col} over time',
                        'x_axis': date_col,
                        'y_axis': num_col,
                        'priority': 'high',
                        'description': f'Time series showing {num_col} trends'
                    })
        
        # Distribution charts
        for num_col in numeric_cols:
            suggestions.append({
                'type': 'histogram',
                'title': f'{num_col} distribution',
                'x_axis': num_col,
                'priority': 'medium',
                'description': f'Distribution of {num_col} values'
            })
        
        # Bar charts for categorical
        for cat_col in categorical_cols:
            suggestions.append({
                'type': 'bar_chart',
                'title': f'{cat_col} breakdown',
                'x_axis': cat_col,
                'priority': 'medium',
                'description': f'Breakdown by {cat_col}'
            })
        
        # Scatter plots for numeric pairs
        if len(numeric_cols) >= 2:
            for i, col1 in enumerate(numeric_cols):
                for col2 in numeric_cols[i+1:]:
                    suggestions.append({
                        'type': 'scatter_plot',
                        'title': f'{col1} vs {col2}',
                        'x_axis': col1,
                        'y_axis': col2,
                        'priority': 'low',
                        'description': f'Correlation between {col1} and {col2}'
                    })
        
        return suggestions
    
    def _assess_data_quality(self, df: pd.DataFrame, column_info: Dict) -> Dict[str, Any]:
        """
        Comprehensive data quality assessment.
        """
        total_cells = len(df) * len(df.columns)
        missing_cells = df.isnull().sum().sum()
        completeness = 1 - (missing_cells / total_cells) if total_cells > 0 else 0
        
        # Calculate average quality score
        quality_scores = [info['data_quality_score'] for info in column_info.values()]
        avg_quality = sum(quality_scores) / len(quality_scores) if quality_scores else 0
        
        return {
            'overall_score': round(avg_quality, 3),
            'completeness': round(completeness, 3),
            'total_rows': len(df),
            'total_columns': len(df.columns),
            'missing_cells': missing_cells,
            'duplicate_rows': len(df) - len(df.drop_duplicates()),
            'quality_by_column': {col: info['data_quality_score'] for col, info in column_info.items()}
        }
    
    def _handle_processing_errors(self, error: Exception, context: str) -> Dict[str, Any]:
        """
        Graceful error handling with recovery suggestions.
        """
        error_type = type(error).__name__
        
        suggestions = {
            'UnicodeDecodeError': 'Try different file encoding or check file format',
            'ParserError': 'Check file format and separator characters',
            'ValueError': 'Review data format and content',
            'MemoryError': 'File too large - consider chunked processing'
        }
        
        return {
            'error_type': error_type,
            'error_message': str(error),
            'context': context,
            'suggestion': suggestions.get(error_type, 'Review file format and content')
        }
    
    # Backward compatibility methods
    def process_data(self, data: pd.DataFrame) -> Dict[str, Any]:
        """Backward compatibility method for existing AnalyticsService interface."""
        column_analysis = self._analyze_columns(data)
        return {
            'rows': len(data),
            'columns': len(data.columns),
            'column_names': data.columns.tolist(),
            'data_types': data.dtypes.to_dict(),
            'missing_values': data.isnull().sum().to_dict(),
            'numeric_columns': data.select_dtypes(include=[np.number]).columns.tolist(),
            'categorical_columns': data.select_dtypes(include=['object']).columns.tolist(),
            'column_analysis': column_analysis
        }
    
    def generate_insights(self, data: pd.DataFrame) -> List[Dict[str, Any]]:
        """Backward compatibility method for existing AnalyticsService interface."""
        insights = []
        column_analysis = self._analyze_columns(data)
        
        # Data quality insights
        missing_data = data.isnull().sum().sum()
        if missing_data > 0:
            insights.append({
                'type': 'warning',
                'message': f'Found {missing_data} missing values in the dataset',
                'severity': 'medium'
            })
        
        # Column-specific insights
        for col, info in column_analysis.items():
            if info['type'] == 'numeric':
                col_data = data[col].dropna()
                if len(col_data) > 0:
                    insights.append({
                        'type': 'info',
                        'message': f'Column "{col}": mean={col_data.mean():.2f}, std={col_data.std():.2f}',
                        'severity': 'low'
                    })
        
        return insights
    
    def create_dashboard_config(self, data: pd.DataFrame, requirements: Dict[str, Any]) -> Dict[str, Any]:
        """Backward compatibility method for existing AnalyticsService interface."""
        column_analysis = self._analyze_columns(data)
        business_metrics = self._detect_business_metrics(column_analysis)
        visualization_suggestions = self._suggest_visualizations(column_analysis, business_metrics)
        
        return {
            'charts': visualization_suggestions,
            'metrics': business_metrics,
            'layout': 'grid',
            'theme': 'default',
            'column_analysis': column_analysis
        }

# Maintain backward compatibility
AnalyticsService = CSVProcessor 
