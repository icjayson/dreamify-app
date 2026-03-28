import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, MessageSquare, ListTodo, Activity, Percent } from 'lucide-react';
import { useAdminAuth } from '@/contexts/AdminAuthContext';
import { adminService } from '@/services/adminService';
import {
    LineChart,
    Line,
    AreaChart,
    Area,
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
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
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
                <Card>
                    <CardHeader>
                        <CardTitle>Active Usage Trend</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[300px] w-full mt-4">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={timeseries} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                                    <XAxis dataKey="date" tick={{ fontSize: 12 }} opacity={0.6} />
                                    <YAxis tick={{ fontSize: 12 }} opacity={0.6} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', color: '#f3f4f6' }}
                                        itemStyle={{ color: '#f3f4f6' }}
                                    />
                                    <Line type="monotone" dataKey="active_users" name="Active Users" stroke="#8884d8" strokeWidth={2} dot={false} />
                                    <Line type="monotone" dataKey="conversations" name="Conversations" stroke="#82ca9d" strokeWidth={2} dot={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

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
            </div>
        </div>
    );
}
