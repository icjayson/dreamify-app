const LocalProjectCard = ({ project }: { project: { id: string; name: string; thumbnail?: string; updatedAt: string; description?: string; } }) => {
  return (
    <div className="glass-panel overflow-hidden hover:scale-[102%] transition-all duration-500 transition-colors max-w-sm h-full rounded-lg bg-background/30">
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
      <div className="p-4">
        <h3 className="font-semibold mb-1 text-white">{project.name}</h3>
        {project.description ? (
          <p className="text-sm text-white/70 mb-2 line-clamp-2">{project.description}</p>
        ) : null}
        <p className="text-xs text-white/60">Last updated {project.updatedAt}</p>
      </div>
    </div>
  );
};

const ProjectsSection = () => {
  return (
    <section className="w-full py-20 relative z-10">
      <div className="max-w-6xl mx-auto px-2 sm:px-4 md:px-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {Array.from({ length: 15 }).map((_, idx) => (
            <LocalProjectCard
              key={idx}
              project={{
                id: String(idx),
                name: idx % 3 === 0 ? "Zapier" : idx % 3 === 1 ? "Recraft AI" : "GitButler",
                thumbnail: "/Projectcard-image-1.png",
                updatedAt: "Today",
                description:
                  idx % 3 === 0
                    ? "Automation Platform"
                    : idx % 3 === 1
                    ? "AI Design Platform"
                    : "Developer Tools",
              }}
            />
          ))}
        </div>
      </div>
    </section>
  );
};

export default ProjectsSection;


