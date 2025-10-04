"""
Dashboard service for generating and managing dashboard configurations.
"""

import time
import uuid
from typing import Dict, List, Any, Optional
from datetime import datetime
from app.models.dashboard_models import (
    DashboardConfiguration,
    DashboardLayout,
    DashboardComponent,
    ChartConfiguration,
    MetricConfiguration,
    TableConfiguration,
    ChartType,
    LayoutType,
    ChartDataset,
    ChartDataPoint,
    MetricTrend,
    TableColumn,
    ChartStyling
)
from app.core.analytics import CSVProcessor
from app.utils.chart_data_processor import ChartDataProcessor
import logging

logger = logging.getLogger(__name__)


class DashboardService:
    """Service for dashboard configuration generation and management."""
    
    def __init__(self):
        self.csv_processor = CSVProcessor()
        self.chart_processor = ChartDataProcessor()
        self.dashboard_cache = {}  # In-memory cache for dashboard configurations
    
    def generate_dashboard_config(
        self,
        data_source: str,
        requirements: Optional[Dict[str, Any]] = None,
        layout_preference: Optional[LayoutType] = LayoutType.GRID,
        chart_types: Optional[List[ChartType]] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> DashboardConfiguration:
        """
        Generate a complete dashboard configuration based on data source.
        
        Args:
            data_source: File ID or data reference
            requirements: Specific requirements for dashboard
            layout_preference: Preferred layout type
            chart_types: Specific chart types to include
            metadata: Additional metadata
            
        Returns:
            DashboardConfiguration object
        """
        try:
            # Get processed data from data source
            processed_data = self._get_processed_data(data_source)
            
            # Analyze data and generate components
            components = self._generate_components(
                processed_data=processed_data,
                chart_types=chart_types,
                requirements=requirements
            )
            
            # Create dashboard layout
            layout = self._create_layout(
                components=components,
                layout_preference=layout_preference
            )
            
            # Generate dashboard configuration
            dashboard_id = str(uuid.uuid4())
            dashboard_config = DashboardConfiguration(
                id=dashboard_id,
                title=metadata.get('title', 'Analytics Dashboard') if metadata else 'Analytics Dashboard',
                description=metadata.get('description', 'Generated dashboard') if metadata else 'Generated dashboard',
                layout=layout,
                components=components,
                metadata=metadata,
                created_at=datetime.now(),
                updated_at=datetime.now()
            )
            
            # Cache the configuration
            self.dashboard_cache[dashboard_id] = dashboard_config
            
            logger.info(f"Generated dashboard configuration: {dashboard_id}")
            return dashboard_config
            
        except Exception as e:
            logger.error(f"Error generating dashboard config: {str(e)}")
            raise
    
    def get_dashboard_config(self, dashboard_id: str) -> Optional[DashboardConfiguration]:
        """Retrieve dashboard configuration by ID."""
        return self.dashboard_cache.get(dashboard_id)
    
    def refresh_dashboard(
        self,
        dashboard_id: str,
        data_source: Optional[str] = None,
        force_refresh: bool = False
    ) -> Optional[DashboardConfiguration]:
        """Refresh dashboard data and configuration."""
        try:
            # Get existing configuration
            dashboard_config = self.dashboard_cache.get(dashboard_id)
            if not dashboard_config:
                return None
            
            # If force refresh or data source changed, regenerate
            if force_refresh or (data_source and data_source != dashboard_config.metadata.get('data_source')):
                # Regenerate with new data
                new_config = self.generate_dashboard_config(
                    data_source=data_source or dashboard_config.metadata.get('data_source'),
                    requirements=dashboard_config.metadata.get('requirements'),
                    layout_preference=dashboard_config.layout.type,
                    metadata=dashboard_config.metadata
                )
                return new_config
            else:
                # Just update timestamp
                dashboard_config.updated_at = datetime.now()
                return dashboard_config
                
        except Exception as e:
            logger.error(f"Error refreshing dashboard: {str(e)}")
            raise
    
    def get_chart_data(
        self,
        chart_id: str,
        filters: Optional[Dict[str, Any]] = None,
        aggregation: Optional[str] = None,
        time_range: Optional[Dict[str, Any]] = None
    ) -> List[ChartDataPoint]:
        """Get specific chart data with optional filtering."""
        try:
            # Find the chart in cached dashboards
            chart_config = None
            for dashboard in self.dashboard_cache.values():
                for component in dashboard.components:
                    if (component.type == 'chart' and 
                        isinstance(component.component_config, ChartConfiguration) and
                        component.component_config.id == chart_id):
                        chart_config = component.component_config
                        break
                if chart_config:
                    break
            
            if not chart_config:
                raise ValueError(f"Chart with ID {chart_id} not found")
            
            # Process chart data with filters
            processed_data = self.chart_processor.process_chart_data(
                chart_config=chart_config,
                filters=filters,
                aggregation=aggregation,
                time_range=time_range
            )
            
            return processed_data
            
        except Exception as e:
            logger.error(f"Error getting chart data: {str(e)}")
            raise
    
    def list_dashboards(self) -> List[Dict[str, Any]]:
        """List all available dashboard configurations."""
        dashboards = []
        for dashboard_id, config in self.dashboard_cache.items():
            dashboards.append({
                'id': dashboard_id,
                'title': config.title,
                'description': config.description,
                'created_at': config.created_at.isoformat() if config.created_at else None,
                'updated_at': config.updated_at.isoformat() if config.updated_at else None,
                'component_count': len(config.components)
            })
        return dashboards
    
    def delete_dashboard(self, dashboard_id: str) -> bool:
        """Delete a dashboard configuration."""
        if dashboard_id in self.dashboard_cache:
            del self.dashboard_cache[dashboard_id]
            return True
        return False
    
    def _get_processed_data(self, data_source: str) -> Dict[str, Any]:
        """Get processed data from data source."""
        # This would typically fetch from database or file system
        # For now, return mock data structure
        return {
            'column_analysis': {},
            'business_insights': [],
            'visualization_suggestions': [],
            'data_quality': {},
            'metadata': {}
        }
    
    def _generate_components(
        self,
        processed_data: Dict[str, Any],
        chart_types: Optional[List[ChartType]] = None,
        requirements: Optional[Dict[str, Any]] = None
    ) -> List[DashboardComponent]:
        """Generate dashboard components based on data analysis."""
        components = []
        
        # Get styling recommendations from processed data
        styling_recommendations = processed_data.get('styling_recommendations', {})
        
        # Generate metric cards
        metric_components = self._generate_metric_components(processed_data)
        components.extend(metric_components)
        
        # Generate chart components with styling
        chart_components = self._generate_chart_components(
            processed_data=processed_data,
            chart_types=chart_types,
            styling_recommendations=styling_recommendations
        )
        components.extend(chart_components)
        
        # Generate table components
        table_components = self._generate_table_components(processed_data)
        components.extend(table_components)
        
        return components
    
    def _generate_metric_components(self, processed_data: Dict[str, Any]) -> List[DashboardComponent]:
        """Generate metric card components."""
        components = []
        
        # Sample metric configurations
        metrics = [
            {
                'id': 'customers_metric',
                'title': 'Customers',
                'value': '3,781',
                'change': '+11.01%',
                'trend': MetricTrend.UP
            },
            {
                'id': 'orders_metric',
                'title': 'Orders',
                'value': '1,219',
                'change': '-0.3%',
                'trend': MetricTrend.DOWN
            },
            {
                'id': 'revenue_metric',
                'title': 'Revenue',
                'value': '$695',
                'change': '+15.03%',
                'trend': MetricTrend.UP
            },
            {
                'id': 'growth_metric',
                'title': 'Growth',
                'value': '30.1%',
                'change': '+6.08%',
                'trend': MetricTrend.UP
            }
        ]
        
        for i, metric_data in enumerate(metrics):
            metric_config = MetricConfiguration(**metric_data)
            component = DashboardComponent(
                id=f"metric_{i}",
                type="metric",
                position={'x': i % 4, 'y': 0, 'width': 3, 'height': 1},
                component_config=metric_config
            )
            components.append(component)
        
        return components
    
    def _generate_chart_components(
        self,
        processed_data: Dict[str, Any],
        chart_types: Optional[List[ChartType]] = None,
        styling_recommendations: Optional[Dict[str, Any]] = None
    ) -> List[DashboardComponent]:
        """Generate chart components."""
        components = []
        
        # Default chart types if none specified
        if not chart_types:
            chart_types = [ChartType.LINE, ChartType.BAR, ChartType.PIE, ChartType.GEOGRAPHIC]
        
        # Generate revenue chart
        if ChartType.LINE in chart_types:
            revenue_chart = self._create_revenue_chart(styling_recommendations)
            component = DashboardComponent(
                id="revenue_chart",
                type="chart",
                position={'x': 0, 'y': 1, 'width': 8, 'height': 2},
                component_config=revenue_chart
            )
            components.append(component)
        
        # Generate projections chart
        if ChartType.BAR in chart_types:
            projections_chart = self._create_projections_chart(styling_recommendations)
            component = DashboardComponent(
                id="projections_chart",
                type="chart",
                position={'x': 8, 'y': 1, 'width': 4, 'height': 2},
                component_config=projections_chart
            )
            components.append(component)
        
        # Generate geographic chart
        if ChartType.GEOGRAPHIC in chart_types:
            geographic_chart = self._create_geographic_chart(styling_recommendations)
            component = DashboardComponent(
                id="geographic_chart",
                type="chart",
                position={'x': 4, 'y': 3, 'width': 4, 'height': 2},
                component_config=geographic_chart
            )
            components.append(component)
        
        return components
    
    def _generate_table_components(self, processed_data: Dict[str, Any]) -> List[DashboardComponent]:
        """Generate table components."""
        components = []
        
        # Generate top products table
        products_table = self._create_products_table()
        component = DashboardComponent(
            id="products_table",
            type="table",
            position={'x': 0, 'y': 3, 'width': 4, 'height': 2},
            component_config=products_table
        )
        components.append(component)
        
        return components
    
    def _create_layout(
        self,
        components: List[DashboardComponent],
        layout_preference: LayoutType
    ) -> DashboardLayout:
        """Create dashboard layout configuration."""
        return DashboardLayout(
            type=layout_preference,
            grid_columns=12,
            breakpoints={'sm': 6, 'md': 8, 'lg': 12},
            spacing='normal'
        )
    
    def _create_revenue_chart(self, styling_recommendations: Optional[Dict[str, Any]] = None) -> ChartConfiguration:
        """Create revenue chart configuration."""
        datasets = [
            ChartDataset(
                label="Current Week",
                data=[
                    ChartDataPoint(label="Jan", value=58211),
                    ChartDataPoint(label="Feb", value=62000),
                    ChartDataPoint(label="Mar", value=59000),
                    ChartDataPoint(label="Apr", value=71000),
                    ChartDataPoint(label="May", value=68000),
                    ChartDataPoint(label="Jun", value=88768)
                ],
                color="hsl(var(--primary))"
            ),
            ChartDataset(
                label="Previous Week",
                data=[
                    ChartDataPoint(label="Jan", value=45000),
                    ChartDataPoint(label="Feb", value=48000),
                    ChartDataPoint(label="Mar", value=52000),
                    ChartDataPoint(label="Apr", value=55000),
                    ChartDataPoint(label="May", value=58000),
                    ChartDataPoint(label="Jun", value=62000)
                ],
                color="hsl(var(--muted-foreground))"
            )
        ]
        
        # Create styling configuration
        styling = self._create_chart_styling(styling_recommendations, ChartType.LINE)
        
        return ChartConfiguration(
            id="revenue_chart",
            type=ChartType.LINE,
            title="Revenue",
            description="Revenue trends over time",
            datasets=datasets,
            config={
                'animation': True,
                'showGrid': True,
                'showLegend': True
            },
            styling=styling
        )
    
    def _create_projections_chart(self, styling_recommendations: Optional[Dict[str, Any]] = None) -> ChartConfiguration:
        """Create projections chart configuration."""
        datasets = [
            ChartDataset(
                label="Actuals",
                data=[
                    ChartDataPoint(label="Jan", value=20),
                    ChartDataPoint(label="Feb", value=25),
                    ChartDataPoint(label="Mar", value=30),
                    ChartDataPoint(label="Apr", value=28),
                    ChartDataPoint(label="May", value=32),
                    ChartDataPoint(label="Jun", value=35)
                ],
                color="hsl(var(--primary))"
            ),
            ChartDataset(
                label="Projections",
                data=[
                    ChartDataPoint(label="Jan", value=30),
                    ChartDataPoint(label="Feb", value=30),
                    ChartDataPoint(label="Mar", value=30),
                    ChartDataPoint(label="Apr", value=30),
                    ChartDataPoint(label="May", value=30),
                    ChartDataPoint(label="Jun", value=30)
                ],
                color="hsl(var(--muted))"
            )
        ]
        
        # Create styling configuration
        styling = self._create_chart_styling(styling_recommendations, ChartType.BAR)
        
        return ChartConfiguration(
            id="projections_chart",
            type=ChartType.BAR,
            title="Projections vs Actuals",
            description="30M projected target",
            datasets=datasets,
            config={
                'animation': True,
                'showLegend': True
            },
            styling=styling
        )
    
    def _create_geographic_chart(self, styling_recommendations: Optional[Dict[str, Any]] = None) -> ChartConfiguration:
        """Create geographic chart configuration."""
        datasets = [
            ChartDataset(
                label="Revenue by Location",
                data=[
                    ChartDataPoint(label="New York", value=72),
                    ChartDataPoint(label="San Francisco", value=39),
                    ChartDataPoint(label="Sydney", value=25),
                    ChartDataPoint(label="Singapore", value=61)
                ],
                color="hsl(var(--primary))"
            )
        ]
        
        # Create styling configuration
        styling = self._create_chart_styling(styling_recommendations, ChartType.GEOGRAPHIC)
        
        return ChartConfiguration(
            id="geographic_chart",
            type=ChartType.GEOGRAPHIC,
            title="Revenue by Location",
            description="Geographic distribution",
            datasets=datasets,
            config={
                'showProgressBars': True,
                'showPieChart': True
            },
            styling=styling
        )
    
    def _create_products_table(self) -> TableConfiguration:
        """Create products table configuration."""
        columns = [
            TableColumn(key="name", label="Name", type="string"),
            TableColumn(key="price", label="Price", type="currency"),
            TableColumn(key="quantity", label="Quantity", type="number"),
            TableColumn(key="amount", label="Amount", type="currency")
        ]
        
        data = [
            {"name": "ASOS Ridley High Waist", "price": "$79.49", "quantity": 82, "amount": "$6,518.18"},
            {"name": "Marco Lightweight Shirt", "price": "$128.50", "quantity": 37, "amount": "$4,754.50"},
            {"name": "Half Sleeve Shirt", "price": "$39.99", "quantity": 64, "amount": "$2,559.36"},
            {"name": "Lightweight Jacket", "price": "$20.00", "quantity": 184, "amount": "$3,680.00"}
        ]
        
        return TableConfiguration(
            id="products_table",
            title="Top Selling Products",
            description="Product performance metrics",
            columns=columns,
            data=data
        )
    
    def _create_chart_styling(
        self,
        styling_recommendations: Optional[Dict[str, Any]],
        chart_type: ChartType
    ) -> ChartStyling:
        """Create chart styling configuration from recommendations."""
        if not styling_recommendations:
            # Default styling
            return ChartStyling(
                preset_theme="corporate",
                color_palette=["#2563eb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"],
                animation_enabled=True,
                grid_visible=True,
                legend_position="top"
            )
        
        return ChartStyling(
            preset_theme=styling_recommendations.get("preset_theme", "corporate"),
            color_palette=styling_recommendations.get("color_palette", ["#2563eb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"]),
            animation_enabled=styling_recommendations.get("animation_enabled", True),
            grid_visible=styling_recommendations.get("grid_visible", True),
            legend_position=styling_recommendations.get("legend_position", "top")
        )
