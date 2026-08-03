import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, MessageSquare, ListTodo, Activity, Percent, Coins } from 'lucide-react';
import { useAdminAuth } from '@/contexts/AdminAuthContext';
import { adminService } from '@/services/adminService';
import {
    LineChart,
    Line,
    AreaChart,
    Area,
    BarChart,
    Bar,
    PieChart,
    Pie,
    Cell,
    Legend,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer
} from 'recharts';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

function calcPercentChange(data: any[], key: string) {
    if (!data || data.length < 2) return 0;
    const half = Math.floor(data.length / 2);
    const firstHalf = data.slice(0, half).reduce((sum, d) => sum + (d[key] || 0), 0);
    const secondHalf = data.slice(half).reduce((sum, d) => sum + (d[key] || 0), 0);
    if (firstHalf === 0) return secondHalf > 0 ? 100 : 0;
    return ((secondHalf - firstHalf) / firstHalf) * 100;
}

export function AdminMetricsPanel() {
    const { getToken, isAdmin } = useAdminAuth();
    const [days, setDays] = useState('30');
    const [tokenModelFilter, setTokenModelFilter] = useState('all');

    // Fetch overarching metrics
    const { data: metrics, isLoading: metricsLoading } = useQuery({
        queryKey: ['admin-metrics'],
        queryFn: async () => {
            const token = await getToken();
            if (!token) throw new Error('Not authenticated');
            return adminService.getMetrics(token);
        },
        enabled: isAdmin,
        refetchInterval: 300000,
    });

    // Fetch time series
    const { data: timeseries, isLoading: timeseriesLoading } = useQuery({
        queryKey: ['admin-metrics-timeseries', days],
        queryFn: async () => {
            const token = await getToken();
            if (!token) throw new Error('Not authenticated');
            return adminService.getMetricsTimeSeries(token, parseInt(days));
        },
        enabled: isAdmin,
    });

    const isLoading = metricsLoading || timeseriesLoading;

    const usersChange = useMemo(() => calcPercentChange(timeseries || [], 'active_users'), [timeseries]);
    const convChange = useMemo(() => calcPercentChange(timeseries || [], 'conversations'), [timeseries]);
    const msgChange = useMemo(() => calcPercentChange(timeseries || [], 'messages'), [timeseries]);
    const tokenChange = useMemo(() => calcPercentChange(timeseries || [], 'tokens'), [timeseries]);

    // Data for mode pie chart
    const modePieData = useMemo(() => {
        if (!metrics?.mode_distribution) return [];
        return Object.entries(metrics.mode_distribution).map(([name, value]) => ({ name: name.toUpperCase(), value }));
    }, [metrics]);

    // Data for model pie chart
    const modelPieData = useMemo(() => {
        if (!metrics?.model_distribution) return [];
        return Object.entries(metrics.model_distribution).map(([name, value]) => ({ name, value }));
    }, [metrics]);

    const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7f50', '#8dd1e1', '#a4de6c'];

    const uniqueModels = useMemo(() => {
        if (!metrics?.model_distribution) return [];
        return Object.keys(metrics.model_distribution).sort();
    }, [metrics]);

    const tokenChartData = useMemo(() => {
        if (!timeseries) return [];
        if (tokenModelFilter === 'all') return timeseries;
        
        return timeseries.map(pt => ({
            ...pt,
            tokens: pt.tokens_by_model?.[tokenModelFilter] || 0
        }));
    }, [timeseries, tokenModelFilter]);

    const renderSparkline = (dataKey: string, color: string) => {
        if (!timeseries || timeseries.length === 0) return null;
        return (
            <div className="h-12 w-full mt-2">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timeseries}>
                        <Area
                            type="monotone"
                            dataKey={dataKey}
                            stroke={color}
                            strokeWidth={2}
                            fill={`${color}33`}
                            isAnimationActive={false}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        );
    };

    const renderChangeLabel = (change: number) => {
        const isPositive = change > 0;
        const isNeutral = change === 0;
        const color = isPositive ? 'text-green-500' : isNeutral ? 'text-muted-foreground' : 'text-red-500';
        return (
            <span className={`text-xs ml-2 font-normal ${color}`}>
                {isPositive ? '+' : ''}{change.toFixed(1)}%
            </span>
        );
    };

    if (isLoading) {
        return (
            <div className="space-y-6 mb-6">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                    {[...Array(5)].map((_, i) => (
                        <Card key={i} className="animate-pulse">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium bg-muted h-4 w-1/2 rounded"></CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold bg-muted h-8 w-3/4 rounded mt-2"></div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>
        );
    }

    if (!metrics || !timeseries) {
        return null;
    }

    return (
        <div className="space-y-6 mb-6">
            {/* Date Filter */}
            <div className="flex justify-between items-center">
                <h2 className="text-lg font-semibold tracking-tight">Overview</h2>
                <Select value={days} onValueChange={setDays}>
                    <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Select timeframe" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="7">Last 7 Days</SelectItem>
                        <SelectItem value="30">Last 30 Days</SelectItem>
                        <SelectItem value="90">Last 90 Days</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* Stat Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Unique Users</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {metrics.total_users.toLocaleString()}
                            {renderChangeLabel(usersChange)}
                        </div>
                        {renderSparkline('active_users', '#8884d8')}
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Conversations</CardTitle>
                        <ListTodo className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {metrics.total_conversations.toLocaleString()}
                            {renderChangeLabel(convChange)}
                        </div>
                        {renderSparkline('conversations', '#82ca9d')}
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Messages</CardTitle>
                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {metrics.total_messages.toLocaleString()}
                            {renderChangeLabel(msgChange)}
                        </div>
                        {renderSparkline('messages', '#ffc658')}
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Tokens</CardTitle>
                        <Coins className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {metrics.total_tokens ? (metrics.total_tokens >= 1000000 ? `${(metrics.total_tokens / 1000000).toFixed(1)}M` : metrics.total_tokens >= 1000 ? `${(metrics.total_tokens / 1000).toFixed(1)}k` : metrics.total_tokens) : '0'}
                            {renderChangeLabel(tokenChange)}
                        </div>
                        {renderSparkline('tokens', '#ff7f50')}
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Avg Msgs/User</CardTitle>
                        <Activity className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{metrics.avg_msgs_per_user}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
                        <Percent className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{metrics.success_rate}%</div>
                    </CardContent>
                </Card>
            </div>

            {/* Main Charts */}
            <div className="grid gap-4 md:grid-cols-2">
                {/* Message Volume */}
                <Card>
                    <CardHeader>
                        <CardTitle>Message Volume</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[300px] w-full mt-4">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={timeseries} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                                    <XAxis dataKey="date" tick={{ fontSize: 12 }} opacity={0.6} />
                                    <YAxis tick={{ fontSize: 12 }} opacity={0.6} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', color: '#f3f4f6' }}
                                        itemStyle={{ color: '#f3f4f6' }}
                                    />
                                    <Area type="monotone" dataKey="messages" name="Messages" stroke="#ffc658" fill="#ffc658" fillOpacity={0.3} strokeWidth={2} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                {/* Token Burn */}
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle>Token Burn Velocity</CardTitle>
                        <Select value={tokenModelFilter} onValueChange={setTokenModelFilter}>
                            <SelectTrigger className="w-[140px] h-8 text-xs">
                                <SelectValue placeholder="All Models" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Models</SelectItem>
                                {uniqueModels.map(name => (
                                    <SelectItem key={name} value={name}>{name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[300px] w-full mt-4">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={tokenChartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                                    <XAxis dataKey="date" tick={{ fontSize: 12 }} opacity={0.6} />
                                    <YAxis tick={{ fontSize: 12 }} opacity={0.6} tickFormatter={(val) => val >= 1000 ? `${(val/1000).toFixed(0)}k` : val} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', color: '#f3f4f6' }}
                                        itemStyle={{ color: '#f3f4f6' }}
                                        formatter={(val: number) => val.toLocaleString()}
                                    />
                                    <Area type="monotone" dataKey="tokens" name="Tokens" stroke="#ff7f50" fill="#ff7f50" fillOpacity={0.3} strokeWidth={2} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                {/* Chat Modes */}
                <Card>
                    <CardHeader>
                        <CardTitle>Chat Mode Adoption</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[300px] w-full mt-4 flex items-center justify-center">
                            {modePieData.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={modePieData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={60}
                                            outerRadius={100}
                                            paddingAngle={5}
                                            dataKey="value"
                                        >
                                            {modePieData.map((_entry, index) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip 
                                            contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', color: '#f3f4f6' }}
                                            itemStyle={{ color: '#f3f4f6' }}
                                        />
                                        <Legend verticalAlign="bottom" height={36} />
                                    </PieChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="text-muted-foreground">No mode data available</div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Model Usage */}
                <Card>
                    <CardHeader>
                        <CardTitle>Global Model Usage</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[300px] w-full mt-4 flex items-center justify-center">
                            {modelPieData.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={modelPieData}
                                            cx="50%"
                                            cy="50%"
                                            outerRadius={100}
                                            dataKey="value"
                                            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                                        >
                                            {modelPieData.map((_entry, index) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[(index + 2) % COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip 
                                            contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', color: '#f3f4f6' }}
                                            itemStyle={{ color: '#f3f4f6' }}
                                        />
                                        <Legend />
                                    </PieChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="text-muted-foreground">No model data available</div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
