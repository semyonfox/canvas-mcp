import type { ToolDef } from "./types.js";
import { courseTools } from "./courses.js";
import { assignmentTools } from "./assignments.js";
import { submissionTools } from "./submissions.js";
import { gradeTools } from "./grades.js";
import { moduleTools } from "./modules.js";
import { pageTools } from "./pages.js";

export const allTools: ToolDef[] = [
    ...courseTools,
    ...assignmentTools,
    ...submissionTools,
    ...gradeTools,
    ...moduleTools,
    ...pageTools,
    // calendar, announcements, discussions, files, messages, notifications,
    // profile, quizzes, rubrics — added per-domain in later tasks.
];
