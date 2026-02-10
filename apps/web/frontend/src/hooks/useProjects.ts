import { useState, useEffect, useCallback } from "react";
import { useAuth, useUser } from "@clerk/clerk-react";
import { useToast } from "@/hooks/use-toast";
import { projectService } from "@/services/projectService";
import { useChatStore } from "@/chat/useChatStore";
import { useNavigate } from "react-router-dom";

export interface Project {
    id: string;
    title: string;
    updated_at?: string;
    created_at?: string;
}

export const useProjects = () => {
    const { isSignedIn } = useAuth();
    const { user } = useUser();
    const { toast } = useToast();
    const navigate = useNavigate();

    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const refreshProjects = useCallback(async () => {
        if (!isSignedIn) {
            setProjects([]);
            return;
        }

        try {
            // Don't set loading state for background refreshes to avoid UI flickering
            // Only set it if we have no projects yet
            if (projects.length === 0) {
                setIsLoading(true);
            }

            const response = await projectService.listProjects();

            if (response.success) {
                const parseDate = (value?: string | null) => {
                    if (!value) return 0;
                    const timestamp = Date.parse(value);
                    return Number.isNaN(timestamp) ? 0 : timestamp;
                };

                const sortedProjects = [...response.projects].sort((a, b) => {
                    const first = parseDate(b.updated_at || b.created_at);
                    const second = parseDate(a.updated_at || a.created_at);
                    return first - second;
                });

                const mappedProjects = sortedProjects.map((p) => ({
                    id: p.id,
                    title: p.name || p.dashboard_title || "Untitled Project",
                    updated_at: p.updated_at,
                    created_at: p.created_at
                }));

                setProjects(mappedProjects);
            } else {
                console.error('Failed to fetch projects:', response.error);
            }
        } catch (error) {
            console.error('Error refreshing projects:', error);
        } finally {
            setIsLoading(false);
        }
    }, [isSignedIn]); // Removed projects.length dependency to avoid infinite loops if logic changes

    // Initial fetch
    useEffect(() => {
        refreshProjects();
    }, [refreshProjects]);

    // Refresh on focus/visibility
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (!document.hidden && isSignedIn) {
                refreshProjects();
            }
        };

        const handleFocus = () => {
            if (isSignedIn) {
                refreshProjects();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('focus', handleFocus);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('focus', handleFocus);
        };
    }, [isSignedIn, refreshProjects]);

    const createNewProject = async (title: string = "Untitled Project") => {
        try {
            const response = await projectService.createProject(title);
            if (response.success && response.project) {
                useChatStore.getState().resetChat();
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
                await refreshProjects();
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
                await refreshProjects();
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
