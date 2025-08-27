import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import MetricCard from "@/components/dashboard/MetricCard";
import RevenueChart from "@/components/dashboard/RevenueChart";
import ProjectionsChart from "@/components/dashboard/ProjectionsChart";
import TopProductsTable from "@/components/dashboard/TopProductsTable";
import GeographicChart from "@/components/dashboard/GeographicChart";
import ActivityFeed from "@/components/dashboard/ActivityFeed";

const DashboardPreview = () => {
  const [activeSection, setActiveSection] = useState("overview");

  return (
    <div className="h-full overflow-y-auto bg-background/50">
      {/* Dashboard Header */}
      <div className="p-6 border-b border-border/50 glass-panel">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold mb-1">eCommerce Sales Dashboard</h2>
            <p className="text-sm text-muted-foreground">Real-time analytics with AI insights</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-success border-success/30 bg-success/10">
              ● Live Data
            </Badge>
            <Button variant="outline" size="sm">
              Share
            </Button>
          </div>
        </div>
        
        {/* Navigation Tabs */}
        <div className="flex gap-1">
          {["Overview", "Revenue", "Customers", "Products"].map((tab) => (
            <Button
              key={tab}
              variant={activeSection === tab.toLowerCase() ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveSection(tab.toLowerCase())}
              className="text-xs"
            >
              {tab}
            </Button>
          ))}
        </div>
      </div>

      {/* Main Dashboard Grid */}
      <div className="p-6 space-y-6">
        {/* Key Metrics Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="Customers"
            value="3,781"
            change="+11.01%"
            trend="up"
          />
          <MetricCard
            title="Orders"
            value="1,219"
            change="-0.3%"
            trend="down"
          />
          <MetricCard
            title="Revenue"
            value="$695"
            change="+15.03%"
            trend="up"
          />
          <MetricCard
            title="Growth"
            value="30.1%"
            change="+6.08%"
            trend="up"
          />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Revenue Chart - Takes up 2 columns */}
          <div className="lg:col-span-2">
            <RevenueChart />
          </div>
          
          {/* Projections Chart */}
          <div>
            <ProjectionsChart />
          </div>
        </div>

        {/* Bottom Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Top Products Table */}
          <div>
            <TopProductsTable />
          </div>
          
          {/* Geographic Distribution */}
          <div>
            <GeographicChart />
          </div>
          
          {/* Activity Feed */}
          <div>
            <ActivityFeed />
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardPreview;