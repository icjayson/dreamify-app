"""
Chart data processing utilities for transforming raw data into chart-ready format.
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Any, Optional, Union
from datetime import datetime, timedelta
from app.models.dashboard_models import (
    ChartConfiguration,
    ChartDataset,
    ChartDataPoint,
    ChartType
)
import logging

logger = logging.getLogger(__name__)


class ChartDataProcessor:
    """Utility class for processing and transforming chart data."""
    
    def __init__(self):
        self.date_formats = [
            '%Y-%m-%d', '%m/%d/%Y', '%d/%m/%Y',
            '%B %d, %Y', '%b %d, %Y',
            '%d-%m-%Y', '%Y/%m/%d',
            '%m-%d-%Y', '%d/%m/%y'
        ]
    
    def process_chart_data(
        self,
        chart_config: ChartConfiguration,
        filters: Optional[Dict[str, Any]] = None,
        aggregation: Optional[str] = None,
        time_range: Optional[Dict[str, Any]] = None
    ) -> List[ChartDataPoint]:
        """
        Process chart data with optional filtering and aggregation.
        
        Args:
            chart_config: Chart configuration
            filters: Data filters to apply
            aggregation: Aggregation method
            time_range: Time range filter
            
        Returns:
            List of processed chart data points
        """
        try:
            # Get base data from chart configuration
            base_data = self._extract_base_data(chart_config)
            
            # Apply filters if provided
            if filters:
                base_data = self._apply_filters(base_data, filters)
            
            # Apply time range if provided
            if time_range:
                base_data = self._apply_time_range(base_data, time_range)
            
            # Apply aggregation if provided
            if aggregation:
                base_data = self._apply_aggregation(base_data, aggregation)
            
            # Transform to chart data points
            data_points = self._transform_to_data_points(base_data, chart_config.type)
            
            return data_points
            
        except Exception as e:
            logger.error(f"Error processing chart data: {str(e)}")
            raise
    
    def transform_dataframe_to_chart_data(
        self,
        df: pd.DataFrame,
        chart_type: ChartType,
        x_column: str,
        y_column: str,
        group_by: Optional[str] = None
    ) -> List[ChartDataset]:
        """
        Transform pandas DataFrame to chart datasets.
        
        Args:
            df: Input DataFrame
            chart_type: Type of chart
            x_column: Column to use for x-axis
            y_column: Column to use for y-axis
            group_by: Optional column to group by
            
        Returns:
            List of chart datasets
        """
        try:
            datasets = []
            
            if group_by and group_by in df.columns:
                # Group data by specified column
                grouped = df.groupby(group_by)
                for group_name, group_df in grouped:
                    data_points = self._dataframe_to_data_points(
                        group_df, x_column, y_column
                    )
                    dataset = ChartDataset(
                        label=str(group_name),
                        data=data_points
                    )
                    datasets.append(dataset)
            else:
                # Single dataset
                data_points = self._dataframe_to_data_points(df, x_column, y_column)
                dataset = ChartDataset(
                    label=y_column,
                    data=data_points
                )
                datasets.append(dataset)
            
            return datasets
            
        except Exception as e:
            logger.error(f"Error transforming DataFrame to chart data: {str(e)}")
            raise
    
    def aggregate_data(
        self,
        data: List[ChartDataPoint],
        aggregation_type: str,
        group_by: Optional[str] = None
    ) -> List[ChartDataPoint]:
        """
        Aggregate chart data points.
        
        Args:
            data: List of data points
            aggregation_type: Type of aggregation (sum, mean, count, etc.)
            group_by: Optional grouping field
            
        Returns:
            Aggregated data points
        """
        try:
            if not data:
                return []
            
            # Convert to DataFrame for easier processing
            df = self._data_points_to_dataframe(data)
            
            if group_by and group_by in df.columns:
                # Group and aggregate
                grouped = df.groupby(group_by)
                if aggregation_type == 'sum':
                    result = grouped['value'].sum()
                elif aggregation_type == 'mean':
                    result = grouped['value'].mean()
                elif aggregation_type == 'count':
                    result = grouped['value'].count()
                elif aggregation_type == 'max':
                    result = grouped['value'].max()
                elif aggregation_type == 'min':
                    result = grouped['value'].min()
                else:
                    result = grouped['value'].sum()  # Default to sum
                
                # Convert back to data points
                data_points = []
                for label, value in result.items():
                    data_points.append(ChartDataPoint(
                        label=str(label),
                        value=float(value)
                    ))
                
                return data_points
            else:
                # Aggregate all data
                values = [float(dp.value) for dp in data if isinstance(dp.value, (int, float))]
                
                if aggregation_type == 'sum':
                    total = sum(values)
                elif aggregation_type == 'mean':
                    total = sum(values) / len(values) if values else 0
                elif aggregation_type == 'count':
                    total = len(values)
                elif aggregation_type == 'max':
                    total = max(values) if values else 0
                elif aggregation_type == 'min':
                    total = min(values) if values else 0
                else:
                    total = sum(values)  # Default to sum
                
                return [ChartDataPoint(label="Total", value=total)]
                
        except Exception as e:
            logger.error(f"Error aggregating data: {str(e)}")
            raise
    
    def validate_chart_data(
        self,
        chart_config: ChartConfiguration
    ) -> Dict[str, Any]:
        """
        Validate chart configuration and data.
        
        Args:
            chart_config: Chart configuration to validate
            
        Returns:
            Validation results
        """
        validation_results = {
            'is_valid': True,
            'errors': [],
            'warnings': [],
            'data_quality_score': 0.0
        }
        
        try:
            # Check if datasets exist
            if not chart_config.datasets:
                validation_results['errors'].append("No datasets provided")
                validation_results['is_valid'] = False
                return validation_results
            
            # Validate each dataset
            for i, dataset in enumerate(chart_config.datasets):
                dataset_validation = self._validate_dataset(dataset, i)
                validation_results['errors'].extend(dataset_validation['errors'])
                validation_results['warnings'].extend(dataset_validation['warnings'])
            
            # Check data quality
            quality_score = self._calculate_data_quality_score(chart_config)
            validation_results['data_quality_score'] = quality_score
            
            if quality_score < 0.5:
                validation_results['warnings'].append("Low data quality score")
            
            # Set overall validity
            if validation_results['errors']:
                validation_results['is_valid'] = False
            
            return validation_results
            
        except Exception as e:
            logger.error(f"Error validating chart data: {str(e)}")
            validation_results['is_valid'] = False
            validation_results['errors'].append(f"Validation error: {str(e)}")
            return validation_results
    
    def _extract_base_data(self, chart_config: ChartConfiguration) -> List[Dict[str, Any]]:
        """Extract base data from chart configuration."""
        base_data = []
        for dataset in chart_config.datasets:
            for data_point in dataset.data:
                base_data.append({
                    'label': data_point.label,
                    'value': data_point.value,
                    'dataset_label': dataset.label,
                    'metadata': data_point.metadata or {}
                })
        return base_data
    
    def _apply_filters(self, data: List[Dict[str, Any]], filters: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Apply filters to data."""
        filtered_data = data.copy()
        
        for filter_key, filter_value in filters.items():
            if filter_key == 'label':
                filtered_data = [d for d in filtered_data if filter_value.lower() in d['label'].lower()]
            elif filter_key == 'value_range':
                min_val, max_val = filter_value
                filtered_data = [d for d in filtered_data if min_val <= float(d['value']) <= max_val]
            elif filter_key == 'dataset':
                filtered_data = [d for d in filtered_data if d['dataset_label'] == filter_value]
        
        return filtered_data
    
    def _apply_time_range(self, data: List[Dict[str, Any]], time_range: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Apply time range filter to data."""
        try:
            start_date = datetime.fromisoformat(time_range['start'])
            end_date = datetime.fromisoformat(time_range['end'])
            
            filtered_data = []
            for item in data:
                # Try to parse label as date
                item_date = self._parse_date(item['label'])
                if item_date and start_date <= item_date <= end_date:
                    filtered_data.append(item)
            
            return filtered_data
        except Exception as e:
            logger.warning(f"Error applying time range filter: {str(e)}")
            return data
    
    def _apply_aggregation(self, data: List[Dict[str, Any]], aggregation: str) -> List[Dict[str, Any]]:
        """Apply aggregation to data."""
        if not data:
            return data
        
        values = [float(item['value']) for item in data if isinstance(item['value'], (int, float))]
        
        if aggregation == 'sum':
            total = sum(values)
        elif aggregation == 'mean':
            total = sum(values) / len(values) if values else 0
        elif aggregation == 'max':
            total = max(values) if values else 0
        elif aggregation == 'min':
            total = min(values) if values else 0
        else:
            total = sum(values)  # Default to sum
        
        return [{
            'label': f'Aggregated ({aggregation})',
            'value': total,
            'dataset_label': 'Aggregated',
            'metadata': {'aggregation_type': aggregation}
        }]
    
    def _transform_to_data_points(
        self,
        data: List[Dict[str, Any]],
        chart_type: ChartType
    ) -> List[ChartDataPoint]:
        """Transform processed data to chart data points."""
        data_points = []
        for item in data:
            data_point = ChartDataPoint(
                label=item['label'],
                value=item['value'],
                metadata=item['metadata']
            )
            data_points.append(data_point)
        return data_points
    
    def _dataframe_to_data_points(
        self,
        df: pd.DataFrame,
        x_column: str,
        y_column: str
    ) -> List[ChartDataPoint]:
        """Convert DataFrame to chart data points."""
        data_points = []
        for _, row in df.iterrows():
            data_point = ChartDataPoint(
                label=str(row[x_column]),
                value=float(row[y_column]) if pd.notna(row[y_column]) else 0
            )
            data_points.append(data_point)
        return data_points
    
    def _data_points_to_dataframe(self, data_points: List[ChartDataPoint]) -> pd.DataFrame:
        """Convert data points to DataFrame."""
        data = []
        for dp in data_points:
            data.append({
                'label': dp.label,
                'value': dp.value,
                'metadata': dp.metadata or {}
            })
        return pd.DataFrame(data)
    
    def _validate_dataset(self, dataset: ChartDataset, index: int) -> Dict[str, List[str]]:
        """Validate individual dataset."""
        validation = {'errors': [], 'warnings': []}
        
        # Check if dataset has data
        if not dataset.data:
            validation['errors'].append(f"Dataset {index} has no data points")
        
        # Check for empty labels
        empty_labels = [dp for dp in dataset.data if not dp.label.strip()]
        if empty_labels:
            validation['warnings'].append(f"Dataset {index} has {len(empty_labels)} empty labels")
        
        # Check for invalid values
        invalid_values = []
        for dp in dataset.data:
            if not isinstance(dp.value, (int, float, str)):
                invalid_values.append(dp.label)
        
        if invalid_values:
            validation['warnings'].append(f"Dataset {index} has {len(invalid_values)} invalid values")
        
        return validation
    
    def _calculate_data_quality_score(self, chart_config: ChartConfiguration) -> float:
        """Calculate data quality score for chart configuration."""
        if not chart_config.datasets:
            return 0.0
        
        total_points = 0
        quality_points = 0
        
        for dataset in chart_config.datasets:
            for data_point in dataset.data:
                total_points += 1
                
                # Check label quality
                if data_point.label and data_point.label.strip():
                    quality_points += 0.3
                
                # Check value quality
                if isinstance(data_point.value, (int, float)) and not np.isnan(float(data_point.value)):
                    quality_points += 0.7
                elif isinstance(data_point.value, str) and data_point.value.strip():
                    quality_points += 0.5
        
        return quality_points / total_points if total_points > 0 else 0.0
    
    def _parse_date(self, date_string: str) -> Optional[datetime]:
        """Parse date string using common formats."""
        for date_format in self.date_formats:
            try:
                return datetime.strptime(date_string, date_format)
            except ValueError:
                continue
        return None
