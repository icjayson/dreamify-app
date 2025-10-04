"""
Tests for the analytics service.
"""

import pytest
import pandas as pd
import numpy as np
from app.core.analytics import AnalyticsService

class TestAnalyticsService:
    """Test cases for AnalyticsService."""
    
    def setup_method(self):
        """Set up test fixtures."""
        self.service = AnalyticsService()
        self.sample_data = pd.DataFrame({
            'id': [1, 2, 3, 4, 5],
            'name': ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'],
            'age': [25, 30, 35, 28, 32],
            'salary': [50000, 60000, 70000, 55000, 65000],
            'department': ['HR', 'IT', 'IT', 'HR', 'Finance']
        })
    
    def test_process_data(self):
        """Test data processing functionality."""
        stats = self.service.process_data(self.sample_data)
        
        assert stats['rows'] == 5
        assert stats['columns'] == 5
        assert 'id' in stats['column_names']
        assert 'age' in stats['numeric_columns']
        assert 'name' in stats['categorical_columns']
        assert 'numeric_stats' in stats
    
    def test_generate_insights(self):
        """Test insights generation."""
        insights = self.service.generate_insights(self.sample_data)
        
        assert isinstance(insights, list)
        assert len(insights) > 0
        
        # Check for numeric column insights
        age_insights = [i for i in insights if 'age' in i['message']]
        assert len(age_insights) > 0
    
    def test_create_dashboard_config(self):
        """Test dashboard configuration creation."""
        requirements = {
            'chart_types': ['bar', 'line'],
            'metrics': ['age', 'salary']
        }
        
        config = self.service.create_dashboard_config(self.sample_data, requirements)
        
        assert 'charts' in config
        assert 'metrics' in config
        assert 'layout' in config
        assert 'theme' in config
    
    def test_empty_dataframe(self):
        """Test handling of empty DataFrame."""
        empty_df = pd.DataFrame()
        
        with pytest.raises(Exception):
            self.service.process_data(empty_df)
