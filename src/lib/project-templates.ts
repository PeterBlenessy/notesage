export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  folders: string[];
  goalTemplate: string | null; // References GoalTemplate.id
  goalFilename: string; // e.g., "project-goals.md"
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'default',
    name: 'Default',
    description: 'A simple project with a goals checklist',
    folders: [],
    goalTemplate: 'checklist',
    goalFilename: 'project-goals.md',
  },
  {
    id: 'research',
    name: 'Research',
    description:
      'Organized workspace for research projects with goals, notes, and documents',
    folders: ['goals', 'notes', 'research', 'documents'],
    goalTemplate: 'okr',
    goalFilename: 'goals/project-goals.md',
  },
  {
    id: 'writing',
    name: 'Writing',
    description: 'Structured workspace for writing projects with notes and drafts',
    folders: ['notes', 'drafts'],
    goalTemplate: 'milestones',
    goalFilename: 'project-goals.md',
  },
  {
    id: 'blank',
    name: 'Blank',
    description: 'An empty project with no goals or extra folders',
    folders: [],
    goalTemplate: null,
    goalFilename: '',
  },
];

export function getProjectTemplate(id: string): ProjectTemplate | undefined {
  return PROJECT_TEMPLATES.find((t) => t.id === id);
}
