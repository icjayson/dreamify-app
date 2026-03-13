import { FileText, Eye } from "lucide-react";
import { type AssetRecord } from "@/services/fileService";

interface ProjectContextPickerProps {
    files: Array<{
        id: string;
        name: string;
        ext: string;
        projectId: string;
        sourceType?: string;
        asset: AssetRecord;
    }>;
    onSelect: (file: {
        id: string;
        name: string;
        ext: string;
        projectId: string;
        sourceType?: string;
        asset: AssetRecord;
    }) => void;
    onPreview?: (fileId: string) => void;
    className?: string;
    emptyMessage?: string;
}

const ProjectContextPicker = ({
    files,
    onSelect,
    onPreview,
    className = "",
    emptyMessage = "No files found in this project"
}: ProjectContextPickerProps) => {
    return (
        <div className={`absolute bottom-full left-0 mb-2 w-full max-w-md bg-[#1e1e1e] border border-white/20 rounded-xl shadow-lg z-50 max-h-60 overflow-y-auto ${className}`}>
            <div className="p-2">
                <p className="text-xs text-white/50 px-2 py-1">Select a file from this project:</p>

                {files.length > 0 ? (
                    files.map(asset => (
                        <button
                            key={asset.id}
                            onClick={() => onSelect(asset)}
                            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/10 rounded-lg transition-colors text-left"
                        >
                            {asset.sourceType === 'GA4' ? (
                                <img src="/GA4.png" alt="GA4 Logo" className="flex-shrink-0 w-4 h-4 object-contain" />
                            ) : (
                                <FileText className="w-4 h-4 text-white/70 flex-shrink-0" />
                            )}
                            <span className="text-sm text-white truncate flex-1">
                                {asset.sourceType ? `${asset.sourceType} Data` : asset.name}
                            </span>
                            {asset.sourceType ? (
                                <div className="flex-shrink-0 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                                    <span className="text-xs text-green-500/90 font-medium tracking-wide">Connected</span>
                                </div>
                            ) : (
                                <span className="text-xs text-white/50">{asset.ext}</span>
                            )}
                            {onPreview && (
                                <div
                                    role="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onPreview(asset.id);
                                    }}
                                    className="p-1 hover:bg-white/20 rounded-md transition-colors text-white/50 hover:text-white"
                                    title="Preview dataset"
                                >
                                    <Eye className="w-4 h-4" />
                                </div>
                            )}
                        </button>
                    ))
                ) : (
                    <p className="text-xs text-white/40 px-3 py-2">{emptyMessage}</p>
                )}
            </div>
        </div>
    );
};

export default ProjectContextPicker;
