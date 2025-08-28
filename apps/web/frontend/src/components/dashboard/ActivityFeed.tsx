import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const ActivityFeed = () => {
  const activities = [
    { 
      type: "bug", 
      message: "You fixed a bug.", 
      time: "Just now",
      color: "bg-destructive/20 text-destructive"
    },
    { 
      type: "user", 
      message: "New user registered.", 
      time: "59 minutes ago",
      color: "bg-success/20 text-success"
    },
    { 
      type: "bug", 
      message: "You fixed a bug.", 
      time: "12 hours ago",
      color: "bg-destructive/20 text-destructive"
    },
    { 
      type: "subscription", 
      message: "Andi Lane subscribed to you.", 
      time: "Today, 11:59 AM",
      color: "bg-accent/20 text-accent"
    }
  ];

  const contacts = [
    { name: "Natali Craig", avatar: "NC" },
    { name: "Drew Cano", avatar: "DC" },
    { name: "Andi Lane", avatar: "AL" },
    { name: "Koray Okumus", avatar: "KO" },
    { name: "Kate Morrison", avatar: "KM" },
    { name: "Melody Macy", avatar: "MM" }
  ];

  return (
    <Card className="glass-panel p-6 animate-fade-in">
      <div className="mb-4">
        <h3 className="text-lg font-semibold mb-1">Activities</h3>
        <p className="text-sm text-muted-foreground">Recent system events</p>
      </div>

      {/* Activities */}
      <div className="space-y-3 mb-6">
        {activities.map((activity, index) => (
          <div 
            key={index} 
            className="flex items-start gap-3 animate-slide-up"
            style={{ animationDelay: `${index * 100}ms` }}
          >
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${activity.color}`}>
              {activity.type === "bug" ? "B" : activity.type === "user" ? "U" : "S"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm">{activity.message}</p>
              <p className="text-xs text-muted-foreground">{activity.time}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Contacts */}
      <div>
        <h4 className="text-sm font-semibold mb-3">Contacts</h4>
        <div className="space-y-2">
          {contacts.map((contact, index) => (
            <div 
              key={contact.name} 
              className="flex items-center gap-3 p-2 rounded hover:bg-muted/20 transition-colors animate-slide-up"
              style={{ animationDelay: `${(index + 4) * 100}ms` }}
            >
              <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium">
                {contact.avatar}
              </div>
              <span className="text-sm">{contact.name}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
};

export default ActivityFeed;