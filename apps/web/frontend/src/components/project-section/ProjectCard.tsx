import { Card, CardContent } from "@/components/ui/card";

type Project = {
  id: string;
  name: string;
  thumbnail?: string;
  updatedAt: string;
  description?: string;
};

export default function ProjectCard({ project }: { project: Project }) {
  return (
    <Card className="overflow-hidden hover:border-foreground/20  transition-colors max-w-sm h-full">
      <div className="w-full aspect-video overflow-hidden">
        {project.thumbnail ? (
          <img
            src={project.thumbnail}
            alt={project.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full bg-muted" />
        )}
      </div>
      <CardContent className="p-4">
        <h3 className="font-semibold mb-1">{project.name}</h3>
        {project.description ? (
          <p className="text-sm text-muted-foreground mb-2 line-clamp-2">{project.description}</p>
        ) : null}
        <p className="text-xs text-muted-foreground">Last updated {project.updatedAt}</p>
      </CardContent>
    </Card>
  );
}


