import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth, useUser } from "@/lib/clerk";
import { useToast } from "@/hooks/use-toast";
import { projectService, ProjectRecord } from "@/services/projectService";
import { useChatStore } from "@/chat/useChatStore";
import { useNavigate } from "@/lib/navigation";

export interface Project {
    id: string;
    title: string;
    updated_at?: string;
    created_at?: string;
}

type RefreshOptions = {
    force?: boolean;
    showLoading?: boolean;
    dedupe?: boolean;
};

const PROJECTS_STALE_MS = 60_000;

let cachedUserId: string | null = null;
let cachedProjects: Project[] = [];
let cachedAt = 0;
let inFlightRefresh: Promise<Project[]> | null = null;
let inFlightUserId: string | null = null;

const parseDate = (value?: string | null) => {
    if (!value) return 0;
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? 0 : timestamp;
};

const mapProject = (project: ProjectRecord): Project => ({
    id: project.id,
    title: project.name || project.dashboard_title || "Untitled Project",
    updated_at: project.updated_at,
    created_at: project.created_at,
});

// Map + sort ALL of the user's projects newest-first. No cap — the workspace
// sidebar shows the full list and scrolls.
const mapProjects = (projects: ProjectRecord[]): Project[] => (
    projects
        .map(mapProject)
        .sort((a, b) => {
            const first = parseDate(b.updated_at || b.created_at);
            const second = parseDate(a.updated_at || a.created_at);
            return first - second;
        })
);

const getCachedProjects = (userId: string | null) => (
    userId && cachedUserId === userId ? cachedProjects : []
);

const hasProjectCache = (userId: string | null) => (
    Boolean(userId && cachedUserId === userId && cachedAt > 0)
);

const setProjectCache = (userId: string, projects: Project[]) => {
    cachedUserId = userId;
    cachedProjects = projects;
    cachedAt = Date.now();
};

const clearProjectCache = () => {
    cachedUserId = null;
    cachedProjects = [];
    cachedAt = 0;
    inFlightRefresh = null;
    inFlightUserId = null;
};

export const useProjects = () => {
    const { isSignedIn } = useAuth();
    const { user } = useUser();
    const { toast } = useToast();
    const navigate = useNavigate();
    const userId = user?.id ?? null;

    const [projects, setProjects] = useState<Project[]>(() => getCachedProjects(userId));
    const [isLoading, setIsLoading] = useState(false);
    const projectsRef = useRef(projects);

    useEffect(() => {
        projectsRef.current = projects;
    }, [projects]);

    const refreshProjects = useCallback(async (options: RefreshOptions = {}) => {
        if (!isSignedIn || !userId) {
            clearProjectCache();
            setProjects([]);
            setIsLoading(false);
            return [];
        }

        const cacheForUser = getCachedProjects(userId);
        const hasCache = hasProjectCache(userId);
        const isFresh = hasCache && Date.now() - cachedAt < PROJECTS_STALE_MS;

        if (!options.force && isFresh) {
            setProjects(cacheForUser);
            setIsLoading(false);
            return cacheForUser;
        }

        if (options.dedupe !== false && inFlightRefresh && inFlightUserId === userId) {
            if (!hasCache && projectsRef.current.length === 0) {
                setIsLoading(true);
            }
            const result = await inFlightRefresh;
            setProjects(result);
            setIsLoading(false);
            return result;
        }

        const shouldShowLoading = options.showLoading ?? (!hasCache && projectsRef.current.length === 0);
        if (shouldShowLoading) {
            setIsLoading(true);
        }

        const request = projectService.listProjects().then((response) => {
            if (!response.success) {
                throw new Error(response.error || "Failed to fetch projects");
            }
            const mappedProjects = mapProjects(response.projects);
            setProjectCache(userId, mappedProjects);
            return mappedProjects;
        });

        inFlightRefresh = request;
        inFlightUserId = userId;

        try {
            const mappedProjects = await request;
            setProjects(mappedProjects);
            return mappedProjects;
        } catch (error) {
            console.error('Error refreshing projects:', error);
            return projectsRef.current;
        } finally {
            if (inFlightRefresh === request) {
                inFlightRefresh = null;
                inFlightUserId = null;
            }
            setIsLoading(false);
        }
    }, [isSignedIn, userId]);

    // Initial fetch: hydrate from cache immediately, then refresh only when stale.
    useEffect(() => {
        if (!isSignedIn || !userId) {
            clearProjectCache();
            setProjects([]);
            setIsLoading(false);
            return;
        }

        const cacheForUser = getCachedProjects(userId);
        const hasCache = hasProjectCache(userId);
        if (hasCache) {
            setProjects(cacheForUser);
            setIsLoading(false);
        }

        refreshProjects({ showLoading: !hasCache });
    }, [isSignedIn, userId, refreshProjects]);

    // Refresh on focus/visibility without replacing an existing list with a spinner.
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (!document.hidden && isSignedIn) {
                refreshProjects({ showLoading: false });
            }
        };

        const handleFocus = () => {
            if (isSignedIn) {
                refreshProjects({ showLoading: false });
            }
        };

        const handleProjectUpdated = () => {
            if (isSignedIn) {
                refreshProjects({ force: true, showLoading: false });
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('focus', handleFocus);
        window.addEventListener('projectUpdated', handleProjectUpdated);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('focus', handleFocus);
            window.removeEventListener('projectUpdated', handleProjectUpdated);
        };
    }, [isSignedIn, refreshProjects]);

    const createNewProject = async (title: string = "Untitled Project") => {
        try {
            const response = await projectService.createProject(title);
            if (response.success && response.project) {
                useChatStore.getState().resetChat();
                await refreshProjects({ force: true, showLoading: false, dedupe: false });
                navigate(`/workspace/project?projectId=${response.project.id}`);
                return response.project;
            } else {
                toast({
                    title: "Failed to create project",
                    description: response.error || "Could not create new project",
                    variant: "destructive",
                });
                return null;
            }
        } catch (error) {
            console.error('Error creating project:', error);
            toast({
                title: "Error",
                description: "Failed to create project. Please try again.",
                variant: "destructive",
            });
            return null;
        }
    };

    const renameProject = async (id: string, newTitle: string) => {
        try {
            const response = await projectService.updateProject(id, newTitle);
            if (response.success) {
                await refreshProjects({ force: true, showLoading: false, dedupe: false });
                toast({
                    title: "Project renamed",
                    description: `Project renamed to "${newTitle}"`,
                    className: "border border-border/40 bg-background/90 backdrop-blur-md",
                });
                return true;
            } else {
                toast({
                    title: "Failed to rename project",
                    description: response.error || "Could not update project name",
                    variant: "destructive",
                });
                return false;
            }
        } catch (error) {
            console.error('Error renaming project:', error);
            toast({
                title: "Error",
                description: "Failed to rename project. Please try again.",
                variant: "destructive",
            });
            return false;
        }
    };

    const deleteProject = async (id: string) => {
        try {
            const response = await projectService.deleteProject(id);
            if (response.success) {
                await refreshProjects({ force: true, showLoading: false, dedupe: false });
                toast({
                    title: "Project deleted",
                    description: "Project has been removed",
                    variant: "destructive",
                    className: "border border-destructive/40 bg-destructive/20 backdrop-blur-md",
                });
                return true;
            } else {
                toast({
                    title: "Failed to delete project",
                    description: response.error || "Could not delete project",
                    variant: "destructive",
                });
                return false;
            }
        } catch (error) {
            console.error('Error deleting project:', error);
            toast({
                title: "Error",
                description: "Failed to delete project. Please try again.",
                variant: "destructive",
            });
            return false;
        }
    };

    const openProject = (id: string) => {
        navigate(`/workspace/project?projectId=${id}`);
    };

    return {
        projects,
        isLoading,
        refreshProjects,
        createNewProject,
        renameProject,
        deleteProject,
        openProject
    };
};
