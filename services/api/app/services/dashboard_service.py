"""
Dashboard service for generating and managing dashboard configurations.
"""

import time
import uuid
from typing import Dict, List, Any, Optional
import os
import json
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
from utils.s3.client import download_bytes
from utils.dynamodb.repos import assets as assets_repo
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
        """Get processed data from data source. Reads from S3 using File record."""
        try:
            asset = assets_repo.get_asset_by_id(data_source)
            if not asset:
                logger.warning(f"Asset not found for data_source: {data_source}")
                return self._get_empty_processed_data(data_source)

            processed_key = asset.get("processed_json_s3_key")
            if not processed_key:
                logger.warning(f"Asset {data_source} missing processed_json_s3_key")
                return self._get_empty_processed_data(data_source)

            try:
                processed_data_bytes = download_bytes(asset["s3_bucket"], processed_key)
                processed_data = json.loads(processed_data_bytes.decode("utf-8"))
                if "data" in processed_data:
                    return processed_data["data"]
                return processed_data
            except FileNotFoundError:
                logger.warning(f"Processed JSON not found in S3 for asset {data_source}")
                return self._get_empty_processed_data(data_source)
            except Exception as e:
                logger.warning(f"Failed to download processed data from S3: {e}")
                return self._get_empty_processed_data(data_source)
        except Exception as e:
            logger.warning(f"Failed to load processed data for {data_source}: {e}")
            return self._get_empty_processed_data(data_source)
    
    def _get_empty_processed_data(self, data_source: str) -> Dict[str, Any]:
        """Return empty processed data structure."""
        return {
            'metrics': [],
            'charts': [],
            'tables': [],
            'business_insights': [],
            'visualization_suggestions': [],
            'data_quality': {},
            'metadata': {'data_source': data_source}
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
        components: List[DashboardComponent] = []
        metrics = processed_data.get('metrics', []) or []
        if not isinstance(metrics, list):
            return components
        
        def map_trend(value: Any) -> MetricTrend:
            if isinstance(value, MetricTrend):
                return value
            s = str(value).lower()
            if 'down' in s:
                return MetricTrend.DOWN
            if 'up' in s:
                return MetricTrend.UP
            return MetricTrend.STABLE if hasattr(MetricTrend, 'STABLE') else MetricTrend.UP
        
        for i, m in enumerate(metrics):
            try:
                metric_config = MetricConfiguration(
                    id=m.get('id') or f'metric_{i+1}',
                    title=m.get('title') or m.get('name') or 'Metric',
                    value=m.get('value'),
                    change=m.get('change'),
                    trend=map_trend(m.get('trend'))
                )
                components.append(DashboardComponent(
                    id=f"metric_{i}",
                    type="metric",
                    position={'x': (i % 4) * 3, 'y': (i // 4) * 2, 'width': 3, 'height': 2},
                    component_config=metric_config
                ))
            except Exception as e:
                logger.warning(f"Skipping metric due to error: {e}")
        
        return components
    
    def _generate_chart_components(
        self,
        processed_data: Dict[str, Any],
        chart_types: Optional[List[ChartType]] = None,
        styling_recommendations: Optional[Dict[str, Any]] = None
    ) -> List[DashboardComponent]:
        """Generate chart components strictly from processed data."""
        components: List[DashboardComponent] = []
        charts = processed_data.get('charts', []) or []
        if not isinstance(charts, list):
            return components
        
        def map_chart_type(t: Any) -> Optional[ChartType]:
            if isinstance(t, ChartType):
                return t
            if t is None:
                return None
            s = str(t).lower()
            mapping = {
                'line': ChartType.LINE,
                'bar': ChartType.BAR,
                'pie': ChartType.PIE,
                'area': ChartType.AREA if hasattr(ChartType, 'AREA') else ChartType.LINE,
                'scatter': ChartType.SCATTER if hasattr(ChartType, 'SCATTER') else ChartType.LINE,
                'composed': ChartType.COMPOSED if hasattr(ChartType, 'COMPOSED') else ChartType.LINE,
                'geographic': ChartType.GEOGRAPHIC,
                'table': None
            }
            return mapping.get(s)
        
        idx = 0
        for chart in charts:
            try:
                ctype = map_chart_type(chart.get('type'))
                if ctype is None:
                    continue
                if chart_types and ctype not in chart_types:
                    continue
                
                datasets_data = chart.get('datasets') or []
                datasets: List[ChartDataset] = []
                for ds in datasets_data:
                    points = [ChartDataPoint(label=p.get('label'), value=p.get('value')) for p in (ds.get('data') or [])]
                    datasets.append(ChartDataset(label=ds.get('label'), data=points, color=ds.get('color')))
                
                styling = self._create_chart_styling(styling_recommendations, ctype)
                chart_config = ChartConfiguration(
                    id=chart.get('id') or f'chart_{idx+1}',
                    type=ctype,
                    title=chart.get('title') or 'Chart',
                    description=chart.get('description'),
                    datasets=datasets,
                    config=chart.get('config') or {},
                    styling=styling
                )
                components.append(DashboardComponent(
                    id=chart_config.id,
                    type="chart",
                    position=chart.get('position') or {'x': (idx * 4) % 12, 'y': (idx // 3) * 2 + 1, 'width': 4, 'height': 2},
                    component_config=chart_config
                ))
                idx += 1
            except Exception as e:
                logger.warning(f"Skipping chart due to error: {e}")
        
        return components
    
    def _generate_table_components(self, processed_data: Dict[str, Any]) -> List[DashboardComponent]:
        """Generate table components strictly from processed data."""
        components: List[DashboardComponent] = []
        tables = processed_data.get('tables', []) or []
        if not isinstance(tables, list):
            return components
        
        for idx, tbl in enumerate(tables):
            try:
                columns_src = tbl.get('columns') or []
                columns = [TableColumn(key=c.get('key'), label=c.get('label'), type=c.get('type') or 'string') for c in columns_src]
                table_config = TableConfiguration(
                    id=tbl.get('id') or f'table_{idx+1}',
                    title=tbl.get('title') or 'Table',
                    description=tbl.get('description'),
                    columns=columns,
                    data=tbl.get('data') or []
                )
                components.append(DashboardComponent(
                    id=table_config.id,
                    type="table",
                    position=tbl.get('position') or {'x': (idx * 4) % 12, 'y': 3 + (idx // 3) * 2, 'width': 4, 'height': 2},
                    component_config=table_config
                ))
            except Exception as e:
                logger.warning(f"Skipping table due to error: {e}")
        
        return components
    
    def _create_layout(
        self,
        components: List[DashboardComponent],
        layout_preference: LayoutType
    ) -> DashboardLayout:
        """Create dashboard layout configuration."""
        return DashboardLayout(
            type=layout_preference,
            grid_columns=24,
            breakpoints={'sm': 8, 'md': 12, 'lg': 24},
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
