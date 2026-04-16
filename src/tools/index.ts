import type { ToolDef } from "./types.js";
import { courseTools } from "./courses.js";
import { assignmentTools } from "./assignments.js";

export const allTools: ToolDef[] = [
    ...courseTools,
    ...assignmentTools,
    // submissions, grades, modules, pages, calendar,
    // announcements, discussions, files, messages, notifications,
    // profile, quizzes, rubrics — added per-domain in later tasks.
];
