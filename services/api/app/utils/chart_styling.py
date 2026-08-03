"""
Chart Styling Utility - Backend utilities for analyzing data context and generating styling recommendations
"""

import re
from typing import Dict, List, Any, Optional, Tuple
from enum import Enum


class DataContext(str, Enum):
    """Data context types for styling recommendations."""
    FINANCIAL = "financial"
    SALES = "sales"
    MARKETING = "marketing"
    DEMOGRAPHICS = "demographics"
    OPERATIONAL = "operational"
    TECHNICAL = "technical"
    HEALTHCARE = "healthcare"
    EDUCATION = "education"
    RETAIL = "retail"
    MANUFACTURING = "manufacturing"


class AudienceType(str, Enum):
    """Audience types for styling recommendations."""
    EXECUTIVE = "executive"
    ANALYST = "analyst"
    GENERAL = "general"
    TECHNICAL = "technical"
    CUSTOMER = "customer"


class ChartStylingAnalyzer:
    """Analyzes data context and generates appropriate styling recommendations."""
    
    def __init__(self):
        self.context_keywords = {
            DataContext.FINANCIAL: [
                'revenue', 'profit', 'cost', 'budget', 'financial', 'money', 'dollar', 'currency',
                'income', 'expense', 'investment', 'return', 'margin', 'cash', 'asset', 'liability'
            ],
            DataContext.SALES: [
                'sales', 'customer', 'client', 'deal', 'opportunity', 'lead', 'conversion',
                'pipeline', 'quota', 'target', 'commission', 'order', 'purchase', 'buy'
            ],
            DataContext.MARKETING: [
                'campaign', 'marketing', 'advertisement', 'promotion', 'brand', 'awareness',
                'engagement', 'click', 'impression', 'conversion', 'funnel', 'acquisition'
            ],
            DataContext.DEMOGRAPHICS: [
                'age', 'gender', 'location', 'region', 'country', 'city', 'population',
                'demographic', 'segment', 'group', 'category', 'classification'
            ],
            DataContext.OPERATIONAL: [
                'operation', 'process', 'workflow', 'efficiency', 'productivity', 'performance',
                'metric', 'kpi', 'benchmark', 'target', 'goal', 'objective'
            ],
            DataContext.TECHNICAL: [
                'technical', 'system', 'performance', 'error', 'bug', 'uptime', 'response',
                'latency', 'throughput', 'capacity', 'utilization', 'monitoring'
            ],
            DataContext.HEALTHCARE: [
                'health', 'medical', 'patient', 'treatment', 'diagnosis', 'symptom', 'drug',
                'therapy', 'clinical', 'hospital', 'doctor', 'nurse', 'care'
            ],
            DataContext.EDUCATION: [
                'education', 'student', 'teacher', 'course', 'grade', 'score', 'learning',
                'academic', 'school', 'university', 'college', 'training'
            ],
            DataContext.RETAIL: [
                'retail', 'store', 'product', 'inventory', 'stock', 'merchandise', 'shopping',
                'customer', 'purchase', 'transaction', 'point of sale', 'pos'
            ],
            DataContext.MANUFACTURING: [
                'manufacturing', 'production', 'factory', 'assembly', 'quality', 'defect',
                'yield', 'throughput', 'capacity', 'equipment', 'machine', 'process'
            ]
        }
        
        self.audience_keywords = {
            AudienceType.EXECUTIVE: [
                'executive', 'ceo', 'cfo', 'cto', 'director', 'vp', 'vice president',
                'board', 'management', 'leadership', 'strategic', 'high-level'
            ],
            AudienceType.ANALYST: [
                'analyst', 'analytics', 'data', 'research', 'insight', 'report', 'analysis',
                'statistical', 'trend', 'pattern', 'correlation', 'regression'
            ],
            AudienceType.TECHNICAL: [
                'technical', 'developer', 'engineer', 'architect', 'system', 'infrastructure',
                'api', 'database', 'server', 'code', 'programming', 'software'
            ],
            AudienceType.CUSTOMER: [
                'customer', 'user', 'client', 'consumer', 'buyer', 'purchaser', 'end-user',
                'public', 'external', 'stakeholder'
            ]
        }
        
        self.theme_recommendations = {
            DataContext.FINANCIAL: {
                'primary': 'corporate',
                'secondary': 'minimal',
                'colors': ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']
            },
            DataContext.SALES: {
                'primary': 'vibrant',
                'secondary': 'corporate',
                'colors': ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']
            },
            DataContext.MARKETING: {
                'primary': 'colorful',
                'secondary': 'vibrant',
                'colors': ['#ec4899', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b']
            },
            DataContext.DEMOGRAPHICS: {
                'primary': 'colorful',
                'secondary': 'vibrant',
                'colors': ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4']
            },
            DataContext.OPERATIONAL: {
                'primary': 'corporate',
                'secondary': 'minimal',
                'colors': ['#6b7280', '#10b981', '#f59e0b', '#ef4444', '#3b82f6']
            },
            DataContext.TECHNICAL: {
                'primary': 'dark',
                'secondary': 'minimal',
                'colors': ['#1f2937', '#10b981', '#f59e0b', '#ef4444', '#3b82f6']
            },
            DataContext.HEALTHCARE: {
                'primary': 'corporate',
                'secondary': 'minimal',
                'colors': ['#059669', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6']
            },
            DataContext.EDUCATION: {
                'primary': 'vibrant',
                'secondary': 'colorful',
                'colors': ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']
            },
            DataContext.RETAIL: {
                'primary': 'colorful',
                'secondary': 'vibrant',
                'colors': ['#ec4899', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b']
            },
            DataContext.MANUFACTURING: {
                'primary': 'corporate',
                'secondary': 'minimal',
                'colors': ['#6b7280', '#10b981', '#f59e0b', '#ef4444', '#3b82f6']
            }
        }
        
        self.audience_preferences = {
            AudienceType.EXECUTIVE: {
                'theme': 'corporate',
                'animation': 'subtle',
                'grid': 'subtle',
                'legend': 'top'
            },
            AudienceType.ANALYST: {
                'theme': 'minimal',
                'animation': 'none',
                'grid': 'visible',
                'legend': 'right'
            },
            AudienceType.TECHNICAL: {
                'theme': 'dark',
                'animation': 'none',
                'grid': 'visible',
                'legend': 'bottom'
            },
            AudienceType.GENERAL: {
                'theme': 'vibrant',
                'animation': 'dynamic',
                'grid': 'subtle',
                'legend': 'top'
            },
            AudienceType.CUSTOMER: {
                'theme': 'colorful',
                'animation': 'dynamic',
                'grid': 'hidden',
                'legend': 'top'
            }
        }
    
    def analyze_data_context(self, data: Dict[str, Any]) -> DataContext:
        """Analyze data to determine the most appropriate context."""
        context_scores = {context: 0 for context in DataContext}
        
        # Analyze column names
        columns = data.get('columns', [])
        for column in columns:
            column_lower = column.lower()
            for context, keywords in self.context_keywords.items():
                for keyword in keywords:
                    if keyword in column_lower:
                        context_scores[context] += 1
        
        # Analyze data values (sample)
        sample_data = data.get('sample_data', [])
        for row in sample_data[:10]:  # Analyze first 10 rows
            if isinstance(row, dict):
                for value in row.values():
                    if isinstance(value, str):
                        value_lower = value.lower()
                        for context, keywords in self.context_keywords.items():
                            for keyword in keywords:
                                if keyword in value_lower:
                                    context_scores[context] += 1
        
        # Return context with highest score
        if context_scores:
            return max(context_scores, key=context_scores.get)
        return DataContext.OPERATIONAL  # Default fallback
    
    def analyze_audience(self, metadata: Dict[str, Any]) -> AudienceType:
        """Analyze metadata to determine audience type."""
        audience_scores = {audience: 0 for audience in AudienceType}
        
        # Check metadata for audience indicators
        metadata_text = str(metadata).lower()
        for audience, keywords in self.audience_keywords.items():
            for keyword in keywords:
                if keyword in metadata_text:
                    audience_scores[audience] += 1
        
        # Return audience with highest score, default to general
        if audience_scores and max(audience_scores.values()) > 0:
            return max(audience_scores, key=audience_scores.get)
        return AudienceType.GENERAL
    
    def generate_styling_recommendations(
        self,
        data: Dict[str, Any],
        chart_type: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Generate comprehensive styling recommendations."""
        if metadata is None:
            metadata = {}
        
        # Analyze context and audience
        data_context = self.analyze_data_context(data)
        audience = self.analyze_audience(metadata)
        
        # Get base recommendations
        context_rec = self.theme_recommendations.get(data_context, self.theme_recommendations[DataContext.OPERATIONAL])
        audience_rec = self.audience_preferences.get(audience, self.audience_preferences[AudienceType.GENERAL])
        
        # Determine final theme (prioritize audience preference for executives)
        if audience == AudienceType.EXECUTIVE:
            theme = audience_rec['theme']
        else:
            theme = context_rec['primary']
        
        # Generate color palette
        color_palette = self._generate_color_palette(data_context, audience, chart_type)
        
        # Determine animation preference
        animation_enabled = audience_rec['animation'] != 'none'
        
        # Determine grid visibility
        grid_visible = audience_rec['grid'] in ['visible', 'subtle']
        
        # Determine legend position
        legend_position = audience_rec['legend']
        
        return {
            'preset_theme': theme,
            'color_palette': color_palette,
            'animation_enabled': animation_enabled,
            'grid_visible': grid_visible,
            'legend_position': legend_position,
            'data_context': data_context.value,
            'audience': audience.value,
            'reasoning': {
                'context': f"Data appears to be {data_context.value} related",
                'audience': f"Target audience is {audience.value}",
                'theme': f"Selected {theme} theme for optimal presentation"
            }
        }
    
    def _generate_color_palette(
        self,
        data_context: DataContext,
        audience: AudienceType,
        chart_type: str
    ) -> List[str]:
        """Generate appropriate color palette based on context and audience."""
        base_colors = self.theme_recommendations[data_context]['colors']
        
        # Adjust colors based on audience
        if audience == AudienceType.EXECUTIVE:
            # More conservative colors for executives
            return ['#2563eb', '#10b981', '#f59e0b', '#6b7280', '#8b5cf6']
        elif audience == AudienceType.ANALYST:
            # High contrast colors for analysts
            return ['#1f2937', '#10b981', '#f59e0b', '#ef4444', '#3b82f6']
        elif audience == AudienceType.TECHNICAL:
            # Dark theme colors for technical audience
            return ['#1f2937', '#10b981', '#f59e0b', '#ef4444', '#3b82f6']
        else:
            # Use base colors for general audience
            return base_colors
    
    def validate_styling_recommendations(self, recommendations: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """Validate styling recommendations."""
        errors = []
        
        required_fields = ['preset_theme', 'color_palette', 'animation_enabled', 'grid_visible', 'legend_position']
        for field in required_fields:
            if field not in recommendations:
                errors.append(f"Missing required field: {field}")
        
        # Validate theme
        valid_themes = ['corporate', 'vibrant', 'minimal', 'dark', 'colorful']
        if 'preset_theme' in recommendations and recommendations['preset_theme'] not in valid_themes:
            errors.append(f"Invalid theme: {recommendations['preset_theme']}")
        
        # Validate color palette
        if 'color_palette' in recommendations:
            color_palette = recommendations['color_palette']
            if not isinstance(color_palette, list) or len(color_palette) == 0:
                errors.append("Color palette must be a non-empty list")
            else:
                for color in color_palette:
                    if not isinstance(color, str) or not self._is_valid_color(color):
                        errors.append(f"Invalid color format: {color}")
        
        # Validate legend position
        valid_legend_positions = ['top', 'bottom', 'right', 'none']
        if 'legend_position' in recommendations and recommendations['legend_position'] not in valid_legend_positions:
            errors.append(f"Invalid legend position: {recommendations['legend_position']}")
        
        return len(errors) == 0, errors
    
    def _is_valid_color(self, color: str) -> bool:
        """Check if color string is valid."""
        # Check for hex color
        if re.match(r'^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$', color):
            return True
        
        # Check for HSL color
        if re.match(r'^hsl\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*\)$', color):
            return True
        
        # Check for RGB color
        if re.match(r'^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$', color):
            return True
        
        return False


# Global instance for use in services
chart_styling_analyzer = ChartStylingAnalyzer()
